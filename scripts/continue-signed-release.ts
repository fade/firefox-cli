import { basename, resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import {
  hashDirectoryPayload,
  hashPayloadMap,
  signedExtensionProvenanceArtifactName,
  writeSignedExtensionProvenance,
} from "./extension-artifact-provenance.js";
import { verifyExpectedExtensionManifest } from "./extension-manifest-check.js";
import { verifyExtensionBundlePayload, verifyPayloadMatchesExtensionSource } from "./extension-payload-check.js";
import { extensionManifestSchema, parseJsonManifestContent } from "./manifest-validation.js";
import { readValidatedSignedExtensionSource } from "./package-signed-extension.js";
import { verifySignedExtensionArtifactTrust } from "./signed-extension-artifact.js";
import { readZipArchive } from "./zip-archive.js";

const releaseTag = process.env.FIREFOX_CLI_RELEASE_TAG;
const expectedPackageVersion = "0.4.0";
const expectedReleaseTag = `v${expectedPackageVersion}`;
if (rootPackage.version !== expectedPackageVersion) {
  throw new Error(`Expected package version ${expectedPackageVersion}, received ${rootPackage.version}`);
}
if (releaseTag !== expectedReleaseTag) {
  throw new Error(`Expected release tag ${expectedReleaseTag}, received ${releaseTag ?? "<missing>"}`);
}

const extensionSourceDir = resolve("dist/extension");
const artifactDir = resolve("dist/extension-artifacts");
const xpiPath = resolve(artifactDir, `firefox-cli-${rootPackage.version}.xpi`);
const provenancePath = resolve(artifactDir, signedExtensionProvenanceArtifactName(rootPackage.version));
const signedSource = await readValidatedSignedExtensionSource({
  sourceXpiPath: xpiPath,
  provenancePath,
});
const archive = readZipArchive(signedSource.xpiData);
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
await verifyPayloadMatchesExtensionSource(extensionSourceDir, payload);

const manifestData = payload.get("manifest.json");
if (manifestData === undefined) {
  throw new Error(`Expected signed extension manifest in ${xpiPath}`);
}
const manifest = parseJsonManifestContent(manifestData.toString("utf8"), "signed extension manifest", `${xpiPath}!/manifest.json`, extensionManifestSchema);
verifyExpectedExtensionManifest(manifest);

const candidateSourceSha256 = await hashDirectoryPayload(extensionSourceDir);
const signedPayloadSha256 = hashPayloadMap(payload);
if (candidateSourceSha256 !== signedPayloadSha256) {
  throw new Error("Current extension build digest does not match the signed XPI payload.");
}
if (signedSource.provenance.sourceSha256 !== signedPayloadSha256) {
  console.warn(`Refreshing stale signed-extension source provenance: recorded ${signedSource.provenance.sourceSha256}, verified ${signedPayloadSha256}.`);
}

const provenance = await writeSignedExtensionProvenance({
  outputPath: provenancePath,
  packageVersion: rootPackage.version,
  channel: signedSource.provenance.channel,
  sourceDir: extensionSourceDir,
  xpiPath,
});
await verifySignedExtensionArtifactTrust({
  artifactPath: xpiPath,
  signatureEntries,
  xpiPayload: payload,
  provenance,
  expectedChannel: signedSource.provenance.channel,
  expectedXpiFile: basename(xpiPath),
});

console.log(`Verified and prepared the existing signed XPI for ${releaseTag}.`);
