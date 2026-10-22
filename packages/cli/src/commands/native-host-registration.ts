import {
  type NativeMessagingManifestPlan,
  NativeMessagingRegistrationError,
  readWindowsNativeMessagingHostRegistration,
  registerNativeMessagingHost,
} from "@firefox-cli/native-host";
import { error } from "../result.js";
import type { CliDependencies, CliResult } from "../types.js";

export type WindowsNativeHostRegistrationStatus =
  | {
      readonly status: "installed";
      readonly registryPath: string;
      readonly manifestPath: string;
    }
  | {
      readonly status: "missing";
      readonly registryPath: string;
      readonly manifestPath: string;
      readonly nextAction: string;
    }
  | {
      readonly status: "stale";
      readonly registryPath: string;
      readonly manifestPath: string;
      readonly registeredManifestPath: string;
      readonly nextAction: string;
    };

interface NativeHostRegistrationFailureDetails {
  readonly step: NativeMessagingRegistrationError["step"];
  readonly message: string;
  readonly manifestPath: string | undefined;
  readonly diagnostic: string;
  readonly cause: string | undefined;
  readonly hresult: number | undefined;
  readonly windowsPowerShellStdout: string | undefined;
  readonly windowsPowerShellStderr: string | undefined;
  readonly nextAction: string;
}

const nativeHostRegistrationFailureMessages: Readonly<Record<NativeMessagingRegistrationError["step"], string>> = {
  manifest: "Failed while writing the native messaging manifest.",
  "windows-registry-read": "Failed while reading the Windows registry entry.",
  "windows-registry-write": "Failed while updating the Windows registry entry.",
};

export async function registerNativeHost(
  plan: NativeMessagingManifestPlan,
  dependencies: CliDependencies,
  retryCommand: string,
  json = false,
): Promise<CliResult | undefined> {
  try {
    await registerNativeMessagingHost(plan, dependencies.nativeHostRegistration);
    return undefined;
  } catch (failure) {
    return nativeHostRegistrationFailure(failure, retryCommand, json);
  }
}

export async function readWindowsNativeHostRegistration(
  plan: NativeMessagingManifestPlan,
  dependencies: CliDependencies,
): Promise<WindowsNativeHostRegistrationStatus | undefined> {
  if (plan.registration.kind !== "windows-registry") {
    return undefined;
  }

  const registryPath = `${plan.registration.hive}\\${plan.registration.key}`;
  const registeredManifestPath = await readWindowsNativeMessagingHostRegistration(plan.registration, dependencies.nativeHostRegistration);
  if (registeredManifestPath === undefined) {
    return {
      status: "missing",
      registryPath,
      manifestPath: plan.manifestPath,
      nextAction: "Run `firefox-cli setup` or `firefox-cli doctor --fix`.",
    };
  }

  if (registeredManifestPath !== plan.manifestPath) {
    return {
      status: "stale",
      registryPath,
      manifestPath: plan.manifestPath,
      registeredManifestPath,
      nextAction: "Run `firefox-cli setup` or `firefox-cli doctor --fix`.",
    };
  }

  return {
    status: "installed",
    registryPath,
    manifestPath: plan.manifestPath,
  };
}

export function formatNativeHostRegistration(plan: NativeMessagingManifestPlan, dryRun: boolean): readonly string[] {
  const action = dryRun ? "planned" : "installed";
  return [
    `Native host registration ${action}: ${plan.manifestPath}`,
    plan.registration.kind === "windows-registry" ? `Windows registry entry ${action}: ${plan.registration.hive}\\${plan.registration.key}` : undefined,
  ].filter((line): line is string => line !== undefined);
}

export function nativeHostRegistrationFailure(failure: unknown, retryCommand: string, json = false): CliResult {
  if (!(failure instanceof NativeMessagingRegistrationError)) {
    throw failure;
  }

  const details = createNativeHostRegistrationFailureDetails(failure, retryCommand);
  return json ? formatNativeHostRegistrationFailureJson(details) : formatNativeHostRegistrationFailureText(details);
}

export class NativeHostManifestReadError extends Error {
  constructor(
    readonly manifestPath: string,
    cause: unknown,
  ) {
    super("Failed while reading the native messaging manifest.", { cause });
  }
}

export function formatNativeHostManifestReadFailure(failure: NativeHostManifestReadError, json: boolean, fix: boolean): CliResult {
  const cause = failure.cause instanceof Error ? failure.cause.message : "Unknown filesystem error.";
  const filesystemCode = getFilesystemErrorCode(failure.cause);
  const command = fix ? "firefox-cli doctor --fix" : "firefox-cli doctor";
  const details = {
    step: "manifest-read",
    message: failure.message,
    manifestPath: failure.manifestPath,
    cause,
    ...(filesystemCode === undefined ? {} : { filesystemCode }),
    nextAction: `Ensure the manifest path names a readable file, resolve the reported filesystem error, then retry \`${command}\`.`,
  };

  if (json) {
    return {
      exitCode: 1,
      stdout: `${JSON.stringify({ error: details }, null, 2)}\n`,
      stderr: "",
    };
  }

  return error(
    [
      details.message,
      `Path: ${details.manifestPath}`,
      `Cause: ${details.cause}`,
      details.filesystemCode === undefined ? undefined : `Filesystem error code: ${details.filesystemCode}`,
      `Next action: ${details.nextAction}`,
      "",
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
  );
}

function createNativeHostRegistrationFailureDetails(failure: NativeMessagingRegistrationError, retryCommand: string): NativeHostRegistrationFailureDetails {
  return {
    step: failure.step,
    message: nativeHostRegistrationFailureMessages[failure.step],
    manifestPath: failure.manifestPath,
    diagnostic: failure.diagnostic,
    cause: deepestCauseMessage(failure),
    hresult: failure.hresult,
    windowsPowerShellStdout: failure.hresult === undefined ? nonEmptyTrimmed(failure.stdout) : undefined,
    windowsPowerShellStderr: nonEmptyTrimmed(failure.stderr),
    nextAction: registrationFailureNextAction(failure, retryCommand),
  };
}

function formatNativeHostRegistrationFailureJson(details: NativeHostRegistrationFailureDetails): CliResult {
  return {
    exitCode: 1,
    stdout: `${JSON.stringify({ error: details }, null, 2)}\n`,
    stderr: "",
  };
}

function formatNativeHostRegistrationFailureText(details: NativeHostRegistrationFailureDetails): CliResult {
  const diagnostics = [
    details.message,
    details.manifestPath === undefined ? undefined : `Path: ${details.manifestPath}`,
    `Diagnostic: ${details.diagnostic}`,
    details.cause === undefined ? undefined : `Cause: ${details.cause}`,
    details.hresult === undefined ? undefined : `Windows error code: ${String(details.hresult)}`,
    details.windowsPowerShellStdout === undefined ? undefined : `Windows PowerShell stdout: ${details.windowsPowerShellStdout}`,
    details.windowsPowerShellStderr === undefined ? undefined : `Windows PowerShell stderr: ${details.windowsPowerShellStderr}`,
    `Next action: ${details.nextAction}`,
  ];
  return error(`${diagnostics.filter((line): line is string => line !== undefined).join("\n")}\n`);
}

function nonEmptyTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}

function getFilesystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string") {
    return undefined;
  }
  return error.code;
}

function deepestCauseMessage(error: Error): string | undefined {
  let cause: unknown = error.cause;
  let message: string | undefined;
  while (cause instanceof Error) {
    message = cause.message;
    cause = cause.cause;
  }
  return message;
}

function registrationFailureNextAction(failure: NativeMessagingRegistrationError, retryCommand: string): string {
  if (failure.step === "manifest") {
    return `Check that the manifest path is not a directory and its parent is writable, then retry \`${retryCommand}\`.`;
  }

  if (failure.accessDenied) {
    return `If Windows denied registry access, check the account's permissions or retry from an elevated terminal, then run \`${retryCommand}\` again.`;
  }

  return `Resolve the reported problem, then retry \`${retryCommand}\`.`;
}
