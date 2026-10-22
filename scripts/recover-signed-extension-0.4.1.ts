import { createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { FIREFOX_CLI_EXTENSION_ID } from "@firefox-cli/native-host";
import rootPackage from "../package.json" with { type: "json" };
import {
  hashDirectoryPayload,
  hashPayloadMap,
  signedExtensionProvenanceArtifactName,
  writeSignedExtensionProvenance,
} from "./extension-artifact-provenance.js";
import { verifyExpectedExtensionManifest } from "./extension-manifest-check.js";
import { verifyExtensionBundlePayload, verifyPayloadMatchesExtensionSource } from "./extension-payload-check.js";
import { extensionManifestSchema, parseJsonManifestContent, parseJsonWithSchema } from "./manifest-validation.js";
import { readWebExtJwtCredentials } from "./sign-extension-credentials.js";
import { verifySignedExtensionArtifactTrust } from "./signed-extension-artifact.js";
import { readZipArchive } from "./zip-archive.js";
import { z } from "zod";

const amoVersionSchema = z
  .object({
    version: z.string().min(1),
    file: z
      .object({
        status: z.string().min(1),
        url: z.url(),
      })
      .nullable()
      .optional(),
  })
  .loose();

const version = "0.4.1";
const releaseTag = process.env.FIREFOX_CLI_RELEASE_TAG;
if (rootPackage.version !== version) {
  throw new Error(`Expected package version ${version}, received ${rootPackage.version}`);
}
if (releaseTag !== `v${version}`) {
  throw new Error(`Expected release tag v${version}, received ${releaseTag ?? "<missing>"}`);
}

const sourceDir = resolve("dist/extension");
const artifactDir = resolve("dist/extension-artifacts");
const xpiPath = resolve(artifactDir, `firefox-cli-${version}.xpi`);
const provenancePath = resolve(artifactDir, signedExtensionProvenanceArtifactName(version));
const amoVersionUrl = new URL(`addons/addon/${encodeURIComponent(FIREFOX_CLI_EXTENSION_ID)}/versions/${version}/`, "https://addons.mozilla.org/api/v5/");
const credentials = readWebExtJwtCredentials(process.env);
const signedVersion = await waitForSignedVersion();
const xpiUrl = new URL(signedVersion.file.url);
if (xpiUrl.protocol !== "https:" || xpiUrl.hostname !== "addons.mozilla.org") {
  throw new Error(`Expected an HTTPS AMO download URL, received ${xpiUrl.origin}`);
}

const xpiResponse = await fetch(xpiUrl, {
  headers: { Authorization: createAuthorizationHeader(credentials.issuer, credentials.secret) },
});
if (!xpiResponse.ok) {
  throw new Error(`AMO signed-XPI download failed with HTTP ${String(xpiResponse.status)}: ${await xpiResponse.text()}`);
}
const xpiData = Buffer.from(await xpiResponse.arrayBuffer());
if (xpiData.length === 0) {
  throw new Error("AMO returned an empty signed XPI.");
}

await mkdir(dirname(xpiPath), { recursive: true });
await writeFile(xpiPath, xpiData);

const archive = readZipArchive(xpiData);
const payload = new Map<string, Buffer>();
const signatureEntries = new Map<string, Buffer>();
for (const entry of archive.entries) {
  if (entry.isDirectory) {
    continue;
  }
  const data = archive.readEntry(entry);
  if (entry.name.startsWith("META-INF/")) {
    signatureEntries.set(entry.name, data);
  } else {
    payload.set(entry.name, data);
  }
}

await verifyExtensionBundlePayload(payload);
await verifyPayloadMatchesExtensionSource(sourceDir, payload);
const manifestData = payload.get("manifest.json");
if (manifestData === undefined) {
  throw new Error(`Expected signed extension manifest in ${xpiPath}`);
}
const manifest = parseJsonManifestContent(manifestData.toString("utf8"), "signed extension manifest", `${xpiPath}!/manifest.json`, extensionManifestSchema);
verifyExpectedExtensionManifest(manifest);

const candidateSourceSha256 = await hashDirectoryPayload(sourceDir);
const signedPayloadSha256 = hashPayloadMap(payload);
if (candidateSourceSha256 !== signedPayloadSha256) {
  throw new Error("Current extension build digest does not match the signed XPI payload.");
}
const provenance = await writeSignedExtensionProvenance({
  outputPath: provenancePath,
  packageVersion: version,
  channel: "unlisted",
  sourceDir,
  xpiPath,
});
await verifySignedExtensionArtifactTrust({
  artifactPath: xpiPath,
  signatureEntries,
  xpiPayload: payload,
  provenance,
  expectedChannel: "unlisted",
  expectedXpiFile: `firefox-cli-${version}.xpi`,
});

console.log(`Recovered and verified the existing AMO-signed XPI for ${releaseTag}.`);

async function waitForSignedVersion(): Promise<{ readonly file: { readonly status: string; readonly url: string } }> {
  const deadline = Date.now() + 15 * 60_000;
  let lastStatus = "<missing>";
  while (Date.now() < deadline) {
    const record = await fetchAmoVersion();
    if (record.version !== version) {
      throw new Error(`Expected AMO version ${version}, received ${record.version}`);
    }
    if (record.file?.status === "public") {
      return { file: record.file };
    }
    lastStatus = record.file?.status ?? "<missing>";
    console.log(`AMO version ${version} file status: ${lastStatus}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
  }
  throw new Error(`AMO version ${version} did not reach signed status within 15 minutes (last file status: ${lastStatus}).`);
}

async function fetchAmoVersion(): Promise<{
  readonly version: string;
  readonly file?: { readonly status: string; readonly url: string } | null | undefined;
}> {
  const response = await fetch(amoVersionUrl, {
    headers: { Authorization: createAuthorizationHeader(credentials.issuer, credentials.secret) },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`AMO version lookup failed with HTTP ${String(response.status)}: ${body}`);
  }
  return parseJsonWithSchema(body, "AMO version response", amoVersionUrl.href, amoVersionSchema);
}

function createAuthorizationHeader(issuer: string, secret: string): string {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: issuer, jti: randomUUID(), iat: issuedAt, exp: issuedAt + 60 })).toString("base64url");
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(unsignedToken).digest("base64url");
  return `JWT ${unsignedToken}.${signature}`;
}
