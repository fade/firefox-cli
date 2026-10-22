import { access, mkdir, readFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import {
  NATIVE_HOST_NAME,
  type WindowsNativeMessagingRegistration,
  type WindowsNativeMessagingRegistry,
  WindowsNativeMessagingRegistryError,
} from "@firefox-cli/native-host";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { baseDependencies, extensionUpdatesForVersion } from "./cli-test-support.js";
import { runCli } from "./index.js";

describe("runCli setup registration", () => {
  it("registers the native host before reporting setup success", async () => {
    const homeDir = await createTempDir("firefox-cli-home");
    const output = await runCli(["setup"], {
      ...baseDependencies(),
      homeDir,
    });
    const manifestPath = macOSManifestPath(homeDir);

    expect(output).toEqual({
      exitCode: 0,
      stdout: [
        "firefox-cli setup",
        `Native host registration installed: ${manifestPath}`,
        "Extension: download and install https://github.com/respawn-llc/firefox-cli/releases/download/v0.0.0/firefox-cli-0.0.0.xpi in Firefox.",
        "Connection: run `firefox-cli connect` and approve the request in Firefox.",
        "",
      ].join("\n"),
      stderr: "",
    });
    await expect(readFile(manifestPath, "utf8")).resolves.toContain(baseDependencies().binaryPath);
  });

  it("preserves setup effects and extension URL in JSON output", async () => {
    const textHomeDir = await createTempDir("firefox-cli-setup-text");
    const jsonHomeDir = await createTempDir("firefox-cli-setup-json");
    const textOutput = await runCli(["setup"], {
      ...baseDependencies(),
      homeDir: textHomeDir,
    });
    const jsonOutput = await runCli(["setup", "--json"], {
      ...baseDependencies(),
      homeDir: jsonHomeDir,
      version: "0.1.1",
      fetchExtensionUpdates: async () => extensionUpdatesForVersion("0.1.1"),
    });
    const jsonManifest = await readFile(macOSManifestPath(jsonHomeDir), "utf8");
    const textManifest = await readFile(macOSManifestPath(textHomeDir), "utf8");

    expect(textOutput.exitCode).toBe(0);
    expect(JSON.parse(jsonOutput.stdout)).toMatchObject({
      extensionInstallUrl: "https://github.com/respawn-llc/firefox-cli/releases/download/v0.1.1/firefox-cli-0.1.1.xpi",
      nativeHostManifestPath: macOSManifestPath(jsonHomeDir),
      dryRun: false,
    });
    expect(jsonManifest).toBe(textManifest);
  });

  it("reports the manifest path and filesystem reason when setup cannot write", async () => {
    const homeDir = await createTempDir("firefox-cli-setup-manifest-write-failure");
    const manifestPath = macOSManifestPath(homeDir);
    await mkdir(manifestPath, { recursive: true });

    const output = await runCli(["setup"], {
      ...baseDependencies(),
      homeDir,
    });

    expect(output.exitCode).toBe(1);
    expect(output.stderr).toContain(`Path: ${manifestPath}`);
    expect(output.stderr).toMatch(/Cause: .*rename/i);
    expect(output.stderr).toContain("Check that the manifest path is not a directory");
    expect(output.stderr).toContain("firefox-cli setup");
  });

  it("returns a machine-readable JSON error when setup cannot write the manifest", async () => {
    const homeDir = await createTempDir("firefox-cli-setup-json-manifest-write-failure");
    const manifestPath = macOSManifestPath(homeDir);
    await mkdir(manifestPath, { recursive: true });

    const output = await runCli(["setup", "--json"], {
      ...baseDependencies(),
      homeDir,
    });
    const payload: unknown = JSON.parse(output.stdout);
    if (!isRecord(payload) || !isRecord(payload.error)) {
      throw new Error("Expected a structured setup error.");
    }
    const registrationError = payload.error;
    if (typeof registrationError.cause !== "string") {
      throw new Error("Expected the setup error to include its filesystem cause.");
    }

    expect(output.exitCode).toBe(1);
    expect(output.stderr).toBe("");
    expect(registrationError).toMatchObject({
      step: "manifest",
      message: "Failed while writing the native messaging manifest.",
      manifestPath,
      diagnostic: "Atomic file write failed.",
      nextAction: "Check that the manifest path is not a directory and its parent is writable, then retry `firefox-cli setup`.",
    });
    expect(registrationError.cause).toContain("rename");
  });

  it("registers the Windows native host during targeted setup", async () => {
    const temporaryDirectory = await createTempDir("firefox-cli-windows-setup");
    const registry = new FakeWindowsNativeMessagingRegistry();
    const { manifestPath, dependencies } = windowsSetupContext(temporaryDirectory, registry);
    registry.beforeWrite = async (registration) => {
      await expect(readFile(registration.value, "utf8")).resolves.toContain("firefox-cli");
    };
    const outputs = await withWorkingDirectory(temporaryDirectory, async () => ({
      text: await runCli(["setup", "native-host"], dependencies),
      json: await runCli(["setup", "native-host", "--json"], dependencies),
    }));

    expect(outputs.text.exitCode).toBe(0);
    expect(outputs.text.stdout).toContain(`Windows registry entry installed: HKEY_CURRENT_USER\\SOFTWARE\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`);
    expect(JSON.parse(outputs.json.stdout)).toMatchObject({
      manifestPath,
      dryRun: false,
      registration: {
        kind: "windows-registry",
        value: manifestPath,
      },
    });
    expect(registry.value).toBe(manifestPath);
    expect(registry.writeCalls).toBe(2);
    await expect(readFile(windowsManifestFilesystemPath(temporaryDirectory, manifestPath), "utf8")).resolves.toContain("firefox-cli");
  });

  it("keeps plain and targeted JSON dry runs free of Windows writes", async () => {
    const temporaryDirectory = await createTempDir("firefox-cli-windows-dry-run");
    const registry = new FakeWindowsNativeMessagingRegistry();
    const { manifestPath, dependencies } = windowsSetupContext(temporaryDirectory, registry);

    const [plain, targeted] = await withWorkingDirectory(temporaryDirectory, async () => [
      await runCli(["setup", "--dry-run", "--json"], dependencies),
      await runCli(["setup", "native-host", "--dry-run", "--json"], dependencies),
    ]);

    expect(JSON.parse(plain.stdout)).toMatchObject({
      nativeHostManifestPath: manifestPath,
      dryRun: true,
    });
    expect(JSON.parse(targeted.stdout)).toMatchObject({
      manifestPath,
      dryRun: true,
    });
    expect(registry.writeCalls).toBe(0);
    await expect(access(windowsManifestFilesystemPath(temporaryDirectory, manifestPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports missing Windows registration even when the manifest is correct", async () => {
    const temporaryDirectory = await createTempDir("firefox-cli-doctor-missing-registration");
    const registry = new FakeWindowsNativeMessagingRegistry();
    const { manifestPath, dependencies } = windowsSetupContext(temporaryDirectory, registry);

    const results = await withWorkingDirectory(temporaryDirectory, async () => {
      const setup = await runCli(["setup", "native-host"], dependencies);
      registry.value = undefined;
      registry.writeCalls = 0;
      const checked = await runCli(["doctor", "--json"], dependencies);
      const text = await runCli(["doctor"], dependencies);
      return { setup, checked, text };
    });
    const output: unknown = JSON.parse(results.checked.stdout);

    expect(results.setup.exitCode).toBe(0);
    expect(results.checked.exitCode).toBe(1);
    expect(results.text.exitCode).toBe(1);
    expect(output).toMatchObject({
      nativeHostManifest: { status: "installed" },
      nativeHostRegistration: {
        status: "missing",
        registryPath: `HKEY_CURRENT_USER\\SOFTWARE\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
        manifestPath,
        nextAction: "Run `firefox-cli setup` or `firefox-cli doctor --fix`.",
      },
    });
    expect(results.text.stdout).toContain("Windows native-host registration: missing");
    expect(results.text.stdout).toContain(`Registry path: HKEY_CURRENT_USER\\SOFTWARE\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`);
    expect(results.text.stdout).toContain(`Path: ${manifestPath}`);
    expect(results.text.stdout).toContain("Registration next action: Run `firefox-cli setup` or `firefox-cli doctor --fix`.");
    expect(registry.readCalls).toBe(2);
    expect(registry.writeCalls).toBe(0);
    await expect(readFile(windowsManifestFilesystemPath(temporaryDirectory, manifestPath), "utf8")).resolves.toContain("firefox-cli");
  });

  it("repairs missing Windows registration even when the manifest is already correct", async () => {
    const temporaryDirectory = await createTempDir("firefox-cli-doctor-repair-registration");
    const registry = new FakeWindowsNativeMessagingRegistry();
    const { manifestPath, dependencies } = windowsSetupContext(temporaryDirectory, registry);
    const fixed = await withWorkingDirectory(temporaryDirectory, async () => {
      await runCli(["setup", "native-host"], dependencies);
      registry.value = undefined;
      registry.writeCalls = 0;
      return runCli(["doctor", "--fix", "--json"], dependencies);
    });
    const output: unknown = JSON.parse(fixed.stdout);

    expect(fixed.exitCode).toBe(1);
    expect(output).toMatchObject({
      nativeHostManifest: { status: "installed" },
      nativeHostRegistration: { status: "installed", manifestPath },
      extensionConnection: { status: "disconnected" },
    });
    expect(registry.value).toBe(manifestPath);
    expect(registry.writeCalls).toBe(1);
  });

  it("diagnoses and repairs a Windows registry value that points to an old manifest", async () => {
    const temporaryDirectory = await createTempDir("firefox-cli-doctor-stale-registration");
    const oldManifestPath = win32.join(temporaryDirectory, "old", `${NATIVE_HOST_NAME}.json`);
    const registry = new FakeWindowsNativeMessagingRegistry();
    const { manifestPath, dependencies } = windowsSetupContext(temporaryDirectory, registry);
    const results = await withWorkingDirectory(temporaryDirectory, async () => {
      await runCli(["setup", "native-host"], dependencies);
      registry.value = oldManifestPath;
      registry.writeCalls = 0;
      const beforeFix = await runCli(["doctor", "--json"], dependencies);
      const fixed = await runCli(["doctor", "--fix", "--json"], dependencies);
      return { beforeFix, fixed };
    });

    expect(results.beforeFix.exitCode).toBe(1);
    expect(JSON.parse(results.beforeFix.stdout)).toMatchObject({
      nativeHostManifest: { status: "installed" },
      nativeHostRegistration: {
        status: "stale",
        manifestPath,
        registeredManifestPath: oldManifestPath,
        nextAction: "Run `firefox-cli setup` or `firefox-cli doctor --fix`.",
      },
    });
    expect(results.fixed.exitCode).toBe(1);
    expect(JSON.parse(results.fixed.stdout)).toMatchObject({
      nativeHostManifest: { status: "installed" },
      nativeHostRegistration: { status: "installed", manifestPath },
      extensionConnection: { status: "disconnected" },
    });
    expect(registry.value).toBe(manifestPath);
    expect(registry.writeCalls).toBe(1);
  });

  it("reports Windows registry inspection failures without treating them as missing", async () => {
    const temporaryDirectory = await createTempDir("firefox-cli-doctor-registry-read-error");
    const registry = new FakeWindowsNativeMessagingRegistry();
    const { dependencies } = windowsSetupContext(temporaryDirectory, registry);
    registry.readError = new WindowsNativeMessagingRegistryError({
      diagnostic: "Registry inspection failed.",
      stdout: "",
      stderr: "PowerShell could not read the key.",
    });

    const output = await withWorkingDirectory(temporaryDirectory, async () => {
      await runCli(["setup", "native-host"], dependencies);
      registry.writeCalls = 0;
      return runCli(["doctor", "--json"], dependencies);
    });

    expect(output.exitCode).toBe(1);
    expect(output.stderr).toBe("");
    expect(JSON.parse(output.stdout)).toMatchObject({ error: { step: "windows-registry-read", diagnostic: "Registry inspection failed." } });
    expect(output.stdout).toContain("PowerShell could not read the key.");
    expect(output.stdout).toContain("firefox-cli doctor --fix");
    expect(registry.writeCalls).toBe(0);
  });

  it("returns Windows registry failures from doctor repair with their diagnostic", async () => {
    const temporaryDirectory = await createTempDir("firefox-cli-doctor-registry-write-error");
    const registry = new FakeWindowsNativeMessagingRegistry();
    const { manifestPath, dependencies } = windowsSetupContext(temporaryDirectory, registry);
    const failure = await withWorkingDirectory(temporaryDirectory, async () => {
      await runCli(["setup", "native-host"], dependencies);
      registry.value = undefined;
      registry.writeError = new WindowsNativeMessagingRegistryError({
        diagnostic: "Access is denied.",
        stdout: "",
        stderr: "Windows registry write failed.",
        hresult: -2147024891,
      });
      registry.writeCalls = 0;
      return runCli(["doctor", "--fix", "--json"], dependencies);
    });

    expect(failure.exitCode).toBe(1);
    expect(failure.stderr).toBe("");
    expect(JSON.parse(failure.stdout)).toMatchObject({ error: { step: "windows-registry-write", diagnostic: "Access is denied." } });
    expect(failure.stdout).toContain("Windows registry write failed.");
    expect(failure.stdout).toContain("elevated terminal");
    expect(registry.value).toBeUndefined();
    expect(registry.writeCalls).toBe(1);
    await expect(readFile(windowsManifestFilesystemPath(temporaryDirectory, manifestPath), "utf8")).resolves.toContain("firefox-cli");
  });

  it("returns actionable setup errors when Windows denies registry registration", async () => {
    const temporaryDirectory = await createTempDir("firefox-cli-windows-setup-error");
    const registry = new FakeWindowsNativeMessagingRegistry();
    const { manifestPath, dependencies } = windowsSetupContext(temporaryDirectory, registry);
    registry.writeError = new WindowsNativeMessagingRegistryError({
      diagnostic: "Access is denied.",
      stdout: "",
      stderr: "Registry write failed.",
      hresult: -2147024891,
    });
    const output = await withWorkingDirectory(temporaryDirectory, async () => runCli(["setup"], dependencies));

    expect(output.exitCode).toBe(1);
    expect(output.stderr).toContain("Failed while updating the Windows registry entry.");
    expect(output.stderr).toContain("Diagnostic: Access is denied.");
    expect(output.stderr).toContain("Windows error code: -2147024891");
    expect(output.stderr).toContain("Windows PowerShell stderr: Registry write failed.");
    expect(output.stderr).toContain("elevated terminal");
    expect(output.stderr).toContain("firefox-cli setup");
    await expect(readFile(windowsManifestFilesystemPath(temporaryDirectory, manifestPath), "utf8")).resolves.toContain("firefox-cli");
  });
});

function macOSManifestPath(homeDir: string): string {
  return posix.join(homeDir, "Library/Application Support/Mozilla/NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`);
}

function windowsManifestFilesystemPath(temporaryDirectory: string, manifestPath: string): string {
  return process.platform === "win32" ? manifestPath : join(temporaryDirectory, manifestPath);
}

class FakeWindowsNativeMessagingRegistry implements WindowsNativeMessagingRegistry {
  value: string | undefined;
  writeError: Error | undefined;
  readError: Error | undefined;
  readCalls = 0;
  writeCalls = 0;
  beforeWrite: ((registration: WindowsNativeMessagingRegistration) => Promise<void>) | undefined;

  async read(): Promise<string | undefined> {
    this.readCalls += 1;
    if (this.readError !== undefined) {
      throw this.readError;
    }
    return this.value;
  }

  async write(registration: WindowsNativeMessagingRegistration): Promise<void> {
    this.writeCalls += 1;
    if (this.writeError !== undefined) {
      throw this.writeError;
    }
    await this.beforeWrite?.(registration);
    this.value = registration.value;
  }
}

function windowsSetupContext(temporaryDirectory: string, registry: FakeWindowsNativeMessagingRegistry) {
  const appDataDir = win32.join(temporaryDirectory, "AppData", "Roaming");
  return {
    manifestPath: win32.join(appDataDir, "firefox-cli", "native-messaging-hosts", `${NATIVE_HOST_NAME}.json`),
    dependencies: {
      ...baseDependencies(),
      homeDir: win32.join(temporaryDirectory, "home"),
      appDataDir,
      platform: "win32" as const,
      nativeHostRegistration: { windowsRegistry: registry },
    },
  };
}

async function withWorkingDirectory<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const previousDirectory = process.cwd();
  process.chdir(directory);
  try {
    return await action();
  } finally {
    process.chdir(previousDirectory);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
