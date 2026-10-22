import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowsNativeMessagingRegistration } from "./native-registration.js";
import { readWindowsNativeMessagingHostRegistration } from "./native-registration.js";
import { createWindowsNativeMessagingRegistry } from "./windows-native-messaging-registry.js";

vi.mock("node:child_process", async () => {
  const [{ EventEmitter }, { PassThrough }] = await Promise.all([import("node:events"), import("node:stream")]);
  return {
    spawn: vi.fn(() => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let killed = false;
      stdout.write("partial stdout");
      stderr.write("partial stderr");
      const child = new EventEmitter();
      Object.defineProperties(child, {
        stdin: { value: stdin },
        stdout: { value: stdout },
        stderr: { value: stderr },
        killed: { get: () => killed },
        kill: {
          value: () => {
            killed = true;
            return true;
          },
        },
      });
      return child;
    }),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

it("terminates a stalled PowerShell registry process and preserves its output", async () => {
  vi.useFakeTimers();
  const registry = createWindowsNativeMessagingRegistry();
  const registration: WindowsNativeMessagingRegistration = {
    kind: "windows-registry",
    hive: "HKEY_CURRENT_USER",
    key: "SOFTWARE\\Mozilla\\NativeMessagingHosts\\firefox_cli",
    valueName: "",
    value: "C:\\Temp\\firefox_cli.json",
  };
  let failure: unknown;
  void registry.read(registration).then(
    () => {
      failure = new Error("The stalled registry process unexpectedly completed.");
    },
    (error: unknown) => {
      failure = error;
    },
  );
  const processResult = vi.mocked(spawn).mock.results.at(-1);
  if (processResult?.type !== "return") {
    throw new Error("PowerShell process was not started.");
  }
  const child = processResult.value;

  try {
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.resolve();
    expect(failure).toMatchObject({
      name: "WindowsNativeMessagingRegistryError",
      diagnostic: "Windows PowerShell did not finish the registry operation within 30 seconds.",
      stdout: "partial stdout",
      stderr: "partial stderr",
    });
    expect(child.killed).toBe(true);
  } finally {
    child.kill();
  }
});

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
