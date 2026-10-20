import {
  NativeMessagingRegistrationError,
  readWindowsNativeMessagingHostRegistration,
  registerNativeMessagingHost,
  type NativeMessagingManifestPlan,
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

export async function registerNativeHost(
  plan: NativeMessagingManifestPlan,
  dependencies: CliDependencies,
  retryCommand: string,
): Promise<CliResult | undefined> {
  try {
    await registerNativeMessagingHost(plan, dependencies.nativeHostRegistration);
    return undefined;
  } catch (failure) {
    return nativeHostRegistrationFailure(failure, retryCommand);
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

export function nativeHostRegistrationFailure(failure: unknown, retryCommand: string): CliResult {
  if (!(failure instanceof NativeMessagingRegistrationError)) {
    throw failure;
  }

  const step =
    failure.step === "manifest"
      ? "writing the native messaging manifest"
      : failure.step === "windows-registry-read"
        ? "reading the Windows registry entry"
        : "updating the Windows registry entry";
  const diagnostics = [
    `Failed while ${step}.`,
    `Diagnostic: ${failure.diagnostic}`,
    failure.hresult === undefined ? undefined : `Windows error code: ${String(failure.hresult)}`,
    failure.stdout === undefined || failure.stdout.trim().length === 0 || failure.hresult !== undefined
      ? undefined
      : `Windows PowerShell stdout: ${failure.stdout.trim()}`,
    failure.stderr === undefined || failure.stderr.trim().length === 0 ? undefined : `Windows PowerShell stderr: ${failure.stderr.trim()}`,
    failure.accessDenied
      ? `If Windows denied registry access, check the account's permissions or retry from an elevated terminal, then run \`${retryCommand}\` again.`
      : `Resolve the reported problem, then retry \`${retryCommand}\`.`,
  ];
  return error(`${diagnostics.filter((line): line is string => line !== undefined).join("\n")}\n`);
}
