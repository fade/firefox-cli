import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, win32 } from "node:path";
import { FIREFOX_CLI_EXTENSION_ID, NATIVE_HOST_NAME, parseNativeMessagingManifestJson, resolvePackagedBinary } from "@firefox-cli/native-host";
import { z } from "zod";
import rootPackage from "../package.json" with { type: "json" };
import { type ProcessResult, runProcess } from "./process-runner.js";

const registryKey = `SOFTWARE\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
const registryPath = `HKCU\\${registryKey}`;
const registryInspectionCommand = [
  "$ErrorActionPreference = 'Stop'",
  `$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${registryKey}', $false)`,
  "if ($null -eq $key) {",
  '  [Console]::Out.WriteLine(\'{"keyExists":false,"value":null,"kind":null}\')',
  "} else {",
  "  try {",
  "    $value = $key.GetValue('', $null)",
  "    if ($null -eq $value) {",
  '      [Console]::Out.WriteLine(\'{"keyExists":true,"value":null,"kind":null}\')',
  "    } else {",
  "      $result = @{ keyExists = $true; value = [string]$value; kind = [string]$key.GetValueKind('') }",
  "      [Console]::Out.WriteLine((ConvertTo-Json -InputObject $result -Compress))",
  "    }",
  "  } finally { $key.Dispose() }",
  "}",
].join("\n");

const registrySnapshotSchema = z
  .object({
    keyExists: z.boolean(),
    value: z.string().nullable(),
    kind: z.string().nullable(),
  })
  .strict();

const setupOutputSchema = z
  .object({
    manifestPath: z.string().min(1),
    manifest: z.object({ name: z.string(), path: z.string(), type: z.string(), allowed_extensions: z.array(z.string()) }).loose(),
    registration: z
      .object({
        kind: z.literal("windows-registry"),
        hive: z.literal("HKEY_CURRENT_USER"),
        key: z.string(),
        valueName: z.literal(""),
        value: z.string(),
      })
      .strict(),
    dryRun: z.literal(false),
  })
  .loose();

const doctorOutputSchema = z
  .object({
    nativeHostManifest: z.object({ status: z.string() }).loose(),
    nativeHostRegistration: z
      .object({
        status: z.enum(["installed", "missing", "stale"]),
        manifestPath: z.string(),
        registeredManifestPath: z.string().optional(),
      })
      .loose(),
  })
  .loose();

interface WindowsRegistrationIntegrationContext {
  readonly binaryPath: string;
  readonly env: NodeJS.ProcessEnv;
  readonly manifestPath: string;
  readonly temporaryDirectory: string;
}

if (import.meta.main) {
  await verifyWindowsNativeRegistration();
}

async function verifyWindowsNativeRegistration(): Promise<void> {
  if (process.env.GITHUB_ACTIONS !== "true" || process.platform !== "win32") {
    throw new Error("Windows native-registration integration is restricted to a GitHub Actions Windows runner.");
  }

  const packageRoot = resolve("dist/package");
  const binaryPath = await resolvePackagedBinary(packageRoot);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "firefox-cli-native-registration-"));
  const appDataDir = join(temporaryDirectory, "AppData", "Roaming");
  const context: WindowsRegistrationIntegrationContext = {
    binaryPath,
    env: {
      ...process.env,
      APPDATA: appDataDir,
      HOME: temporaryDirectory,
      USERPROFILE: temporaryDirectory,
    },
    manifestPath: win32.join(appDataDir, "firefox-cli", "native-messaging-hosts", `${NATIVE_HOST_NAME}.json`),
    temporaryDirectory,
  };

  await assertRegistryKeyAbsent();
  const version = await runPackagedCli(context, ["--version"]);
  if (version.stdout.trim() !== rootPackage.version) {
    throw new Error(`Packaged CLI version mismatch: expected ${rootPackage.version}, got ${version.stdout.trim()}.`);
  }

  await verifyPlainSetup(context);
  await verifyTargetedSetupAndRepeat(context);
  await verifyMissingRegistrationRepair(context);
  await verifyStaleRegistrationRepair(context);
  await removeTestRegistryKey();
  await assertRegistryKeyAbsent();
  console.log("PASS removed the test registry key after native-registration verification.");
}

async function verifyPlainSetup(context: WindowsRegistrationIntegrationContext): Promise<void> {
  const result = await runPackagedCli(context, ["setup"]);
  if (!result.stdout.includes(`Native host registration installed: ${context.manifestPath}`)) {
    throw new Error(`Plain setup did not report successful registration of ${context.manifestPath}.\n${result.stdout}`);
  }
  await assertRegistration(context);
  console.log(`PASS packaged firefox-cli setup wrote ${context.manifestPath} and the real HKCU default value.`);
}

async function verifyTargetedSetupAndRepeat(context: WindowsRegistrationIntegrationContext): Promise<void> {
  const firstSetup = await runPackagedCli(context, ["setup", "native-host", "--json"]);
  assertTargetedSetupOutput(firstSetup, context);
  await assertRegistration(context);
  const firstManifest = await readFile(context.manifestPath);

  const repeatedSetup = await runPackagedCli(context, ["setup", "native-host", "--json"]);
  assertTargetedSetupOutput(repeatedSetup, context);
  await assertRegistration(context);
  const repeatedManifest = await readFile(context.manifestPath);
  if (!firstManifest.equals(repeatedManifest)) {
    throw new Error("Repeated setup native-host changed the manifest contents.");
  }
  console.log("PASS repeated packaged setup native-host preserved the manifest and registry registration.");
}

async function verifyMissingRegistrationRepair(context: WindowsRegistrationIntegrationContext): Promise<void> {
  await runProcess("reg.exe", ["delete", registryPath, "/f"], { label: "remove native-host registry key", timeoutMs: 15_000 });
  await assertRegistryKeyAbsent();
  await assertDoctorStatus(context, ["doctor", "--json"], "missing");
  console.log("PASS packaged doctor reported the missing real HKCU registration.");

  await assertDoctorStatus(context, ["doctor", "--fix", "--json"], "installed");
  await assertRegistration(context);
  console.log("PASS packaged doctor --fix restored the missing registry entry and manifest.");
}

async function verifyStaleRegistrationRepair(context: WindowsRegistrationIntegrationContext): Promise<void> {
  const staleManifestPath = win32.join(context.temporaryDirectory, "old installation", `${NATIVE_HOST_NAME}.json`);
  await runProcess("reg.exe", ["add", registryPath, "/ve", "/t", "REG_SZ", "/d", staleManifestPath, "/f"], {
    label: "set stale native-host registry value",
    timeoutMs: 15_000,
  });
  await assertRegistryValue(staleManifestPath);
  await assertDoctorStatus(context, ["doctor", "--json"], "stale", staleManifestPath);
  console.log("PASS packaged doctor reported the stale real HKCU default value.");

  await assertDoctorStatus(context, ["doctor", "--fix", "--json"], "installed");
  await assertRegistration(context);
  console.log("PASS packaged doctor --fix replaced the stale registry entry and verified the manifest.");
}

async function assertDoctorStatus(
  context: WindowsRegistrationIntegrationContext,
  args: readonly string[],
  expectedRegistrationStatus: "installed" | "missing" | "stale",
  expectedRegisteredPath?: string,
): Promise<void> {
  const result = await runPackagedCli(context, args, [0, 1]);
  const output = doctorOutputSchema.parse(JSON.parse(result.stdout));
  if (output.nativeHostManifest.status !== "installed") {
    throw new Error(`Expected an installed manifest during ${args.join(" ")}, received ${output.nativeHostManifest.status}.`);
  }
  if (output.nativeHostRegistration.status !== expectedRegistrationStatus) {
    throw new Error(`Expected ${args.join(" ")} to report registry ${expectedRegistrationStatus}, received ${output.nativeHostRegistration.status}.`);
  }
  if (output.nativeHostRegistration.manifestPath !== context.manifestPath) {
    throw new Error(`doctor did not report the expected manifest path ${context.manifestPath}.`);
  }
  if (expectedRegisteredPath !== undefined && output.nativeHostRegistration.registeredManifestPath !== expectedRegisteredPath) {
    throw new Error(`doctor did not report the stale registry path ${expectedRegisteredPath}.`);
  }
}

function assertTargetedSetupOutput(result: ProcessResult, context: WindowsRegistrationIntegrationContext): void {
  const output = setupOutputSchema.parse(JSON.parse(result.stdout));
  if (output.manifestPath !== context.manifestPath || output.manifest.path !== context.binaryPath) {
    throw new Error("setup native-host did not plan the expected manifest path and packaged executable.");
  }
  if (output.registration.key !== registryKey || output.registration.value !== context.manifestPath) {
    throw new Error("setup native-host did not report the expected per-user registry registration.");
  }
}

async function assertRegistration(context: WindowsRegistrationIntegrationContext): Promise<void> {
  await assertRegistryValue(context.manifestPath);
  const manifestText = await readFile(context.manifestPath, "utf8");
  const manifest = parseNativeMessagingManifestJson(manifestText, context.manifestPath);
  if (
    manifest.name !== NATIVE_HOST_NAME ||
    manifest.path !== context.binaryPath ||
    manifest.allowed_extensions.length !== 1 ||
    manifest.allowed_extensions[0] !== FIREFOX_CLI_EXTENSION_ID
  ) {
    throw new Error(`Native-host manifest does not match the packaged executable at ${context.binaryPath}.`);
  }
  console.log(`Verified manifest path and real HKCU value: ${context.manifestPath}`);
}

async function assertRegistryValue(expectedPath: string): Promise<void> {
  const state = await inspectRegistry();
  if (!state.keyExists || state.value !== expectedPath || state.kind !== "String") {
    throw new Error(`Expected the real HKCU default REG_SZ value to equal ${expectedPath}; observed ${JSON.stringify(state)}.`);
  }
}

async function assertRegistryKeyAbsent(): Promise<void> {
  const state = await inspectRegistry();
  if (state.keyExists) {
    throw new Error(`Refusing to use pre-existing HKCU native-host key ${registryPath}: ${JSON.stringify(state)}.`);
  }
}

async function inspectRegistry(): Promise<z.infer<typeof registrySnapshotSchema>> {
  const result = await runProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", registryInspectionCommand], {
    label: "independently inspect native-host registry value",
    timeoutMs: 15_000,
  });
  return registrySnapshotSchema.parse(JSON.parse(result.stdout.trim()));
}

async function removeTestRegistryKey(): Promise<void> {
  await runProcess("reg.exe", ["delete", registryPath, "/f"], {
    label: "clean up test native-host registry key",
    timeoutMs: 15_000,
  });
}

async function runPackagedCli(
  context: WindowsRegistrationIntegrationContext,
  args: readonly string[],
  expectedExitCodes: readonly number[] = [0],
): Promise<ProcessResult> {
  return runProcess(context.binaryPath, args, {
    env: context.env,
    expectedExitCodes,
    label: `packaged firefox-cli ${args.join(" ")}`,
    timeoutMs: 60_000,
  });
}
