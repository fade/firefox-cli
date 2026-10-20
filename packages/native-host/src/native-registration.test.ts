import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { createNativeMessagingManifest, type NativeMessagingManifestPlan } from "./native-manifest.js";
import { NATIVE_HOST_NAME } from "./host-launch.js";
import { registerNativeMessagingHost, type WindowsNativeMessagingRegistry } from "./native-registration.js";

describe("registerNativeMessagingHost", () => {
  it("writes the manifest before registering its path with Windows", async () => {
    const directory = await createTempDir("firefox-cli-native-registration");
    const manifestPath = join(directory, "firefox_cli.json");
    const registry = new FakeWindowsNativeMessagingRegistry();
    const plan = createWindowsPlan(manifestPath);
    registry.beforeWrite = async (registration) => {
      expect(registration.value).toBe(manifestPath);
      await expect(readFile(manifestPath, "utf8")).resolves.toBe(`${JSON.stringify(plan.manifest, null, 2)}\n`);
    };

    await registerNativeMessagingHost(plan, { windowsRegistry: registry });

    await expect(readFile(manifestPath, "utf8")).resolves.toBe(`${JSON.stringify(plan.manifest, null, 2)}\n`);
    expect(registry.value).toBe(manifestPath);
  });

  it("can register the same Windows manifest repeatedly", async () => {
    const directory = await createTempDir("firefox-cli-native-registration");
    const plan = createWindowsPlan(join(directory, "firefox_cli.json"));
    const registry = new FakeWindowsNativeMessagingRegistry();

    await registerNativeMessagingHost(plan, { windowsRegistry: registry });
    await registerNativeMessagingHost(plan, { windowsRegistry: registry });

    await expect(readFile(plan.manifestPath, "utf8")).resolves.toBe(`${JSON.stringify(plan.manifest, null, 2)}\n`);
    expect(registry.value).toBe(plan.manifestPath);
  });

  it("replaces a Windows registry value that points to an old manifest", async () => {
    const directory = await createTempDir("firefox-cli-native-registration");
    const manifestPath = join(directory, "firefox_cli.json");
    const registry = new FakeWindowsNativeMessagingRegistry();
    registry.value = join(directory, "old", "firefox_cli.json");
    const plan = createWindowsPlan(manifestPath);

    await registerNativeMessagingHost(plan, { windowsRegistry: registry });

    expect(registry.value).toBe(manifestPath);
    await expect(readFile(manifestPath, "utf8")).resolves.toBe(`${JSON.stringify(plan.manifest, null, 2)}\n`);
  });

  it("keeps the manifest and reports the registry diagnostic when Windows registration fails", async () => {
    const directory = await createTempDir("firefox-cli-native-registration");
    const manifestPath = join(directory, "firefox_cli.json");
    const registry = new FakeWindowsNativeMessagingRegistry();
    registry.writeError = "Windows denied access to the registry key.";
    const plan = createWindowsPlan(manifestPath);

    await expect(registerNativeMessagingHost(plan, { windowsRegistry: registry })).rejects.toMatchObject({
      step: "windows-registry-write",
      diagnostic: "Windows denied access to the registry key.",
    });
    await expect(readFile(manifestPath, "utf8")).resolves.toBe(`${JSON.stringify(plan.manifest, null, 2)}\n`);
  });
});

class FakeWindowsNativeMessagingRegistry implements WindowsNativeMessagingRegistry {
  value: string | undefined;
  writeError: string | undefined;
  beforeWrite: ((registration: Extract<NativeMessagingManifestPlan["registration"], { readonly kind: "windows-registry" }>) => Promise<void>) | undefined;

  async read(): Promise<string | undefined> {
    return this.value;
  }

  async write(registration: Extract<NativeMessagingManifestPlan["registration"], { readonly kind: "windows-registry" }>): Promise<void> {
    if (this.writeError !== undefined) {
      throw new Error(this.writeError);
    }
    await this.beforeWrite?.(registration);
    this.value = registration.value;
  }
}

function createWindowsPlan(manifestPath: string): NativeMessagingManifestPlan {
  return {
    manifestPath,
    manifest: createNativeMessagingManifest({ binaryPath: "/opt/firefox-cli/bin/win32-x64/firefox-cli.exe" }),
    registration: {
      kind: "windows-registry",
      hive: "HKEY_CURRENT_USER",
      key: `SOFTWARE\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
      valueName: "",
      value: manifestPath,
    },
  };
}
