import { expect, it } from "vitest";
import { createWindowsNativeMessagingRegistry } from "./windows-native-messaging-registry.js";
import { readWindowsNativeMessagingHostRegistration } from "./native-registration.js";

it("reports the underlying access-denied error when PowerShell wraps a registry failure", async () => {
  const registry = createWindowsNativeMessagingRegistry(async () => ({
    exitCode: 1,
    stdout: JSON.stringify({
      ok: false,
      exceptions: [
        { message: "Exception calling CreateSubKey.", hresult: -2146233087 },
        { message: "Access is denied.", hresult: -2147024891 },
      ],
    }),
    stderr: "",
  }));

  await expect(
    readWindowsNativeMessagingHostRegistration(
      {
        kind: "windows-registry",
        hive: "HKEY_CURRENT_USER",
        key: "SOFTWARE\\Mozilla\\NativeMessagingHosts\\firefox_cli",
        valueName: "",
        value: "C:\\Temp\\firefox_cli.json",
      },
      { windowsRegistry: registry },
    ),
  ).rejects.toMatchObject({
    step: "windows-registry-read",
    diagnostic: "Access is denied.",
    hresult: -2147024891,
    accessDenied: true,
  });
});
