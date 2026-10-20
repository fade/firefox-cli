import { readFile } from "node:fs/promises";
import { isPersistedJsonFileError, parseNativeMessagingManifestJson, planNativeMessagingManifest } from "@firefox-cli/native-host";
import { optionalAppDataDir } from "../default-dependencies.js";
import { resolveExtensionInstallUrl } from "../extension-updates.js";
import { ok } from "../result.js";
import { createNoopRequest, sendOrUnavailable } from "../transport.js";
import type { CliDependencies, CliResult } from "../types.js";
import {
  formatNativeHostRegistration,
  nativeHostRegistrationFailure,
  readWindowsNativeHostRegistration,
  registerNativeHost,
  type WindowsNativeHostRegistrationStatus,
} from "./native-host-registration.js";

export async function setup(args: readonly string[], dependencies: CliDependencies, renderHelp: () => string): Promise<CliResult> {
  if (args[0] === "native-host") {
    return setupNativeHost(args, dependencies);
  }

  if (args.length === 0 || args.includes("--json") || args.includes("--dry-run")) {
    const dryRun = args.includes("--dry-run");
    const json = args.includes("--json");
    const plan = await createManifestPlan(dependencies);
    if (!dryRun) {
      const failure = await registerNativeHost(plan, dependencies, "firefox-cli setup", json);
      if (failure !== undefined) {
        return failure;
      }
    }
    const extensionInstallUrl = await resolveExtensionInstallUrl(dependencies.version, dependencies.fetchExtensionUpdates);
    if (json) {
      return ok(
        `${JSON.stringify(
          {
            extensionInstallUrl,
            nativeHostManifestPath: plan.manifestPath,
            dryRun,
          },
          null,
          2,
        )}\n`,
      );
    }

    return ok(
      [
        "firefox-cli setup",
        ...formatNativeHostRegistration(plan, dryRun),
        formatExtensionSetupInstruction(extensionInstallUrl),
        "Connection: run `firefox-cli connect` and approve the request in Firefox.",
        "",
      ].join("\n"),
    );
  }

  if (args[0] !== "native-host") {
    return { exitCode: 1, stdout: renderHelp(), stderr: "" };
  }

  return setupNativeHost(args, dependencies);
}

async function setupNativeHost(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const dryRun = args.includes("--dry-run");
  const json = args.includes("--json");
  const plan = await createManifestPlan(dependencies);

  if (!dryRun) {
    const failure = await registerNativeHost(plan, dependencies, "firefox-cli setup native-host", json);
    if (failure !== undefined) {
      return failure;
    }
  }

  if (json) {
    return ok(`${JSON.stringify({ ...plan, dryRun }, null, 2)}\n`);
  }

  return ok([...formatNativeHostRegistration(plan, dryRun), ""].join("\n"));
}

export async function doctor(args: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  const plan = await createManifestPlan(dependencies);
  const setup = await resolveDoctorSetupStatus(plan, dependencies, args.includes("--fix"));
  if (!setup.ok) {
    return setup.result;
  }

  const connection = await checkExtensionConnection(dependencies);
  return args.includes("--json") ? formatDoctorJson(setup.status, connection) : formatDoctorText(plan.manifestPath, setup.status, connection);
}

interface DoctorSetupStatus {
  readonly nativeHostManifest: Awaited<ReturnType<typeof readNativeHostManifestStatus>>;
  readonly nativeHostRegistration?: WindowsNativeHostRegistrationStatus;
}

type DoctorSetupStatusResult = { readonly ok: true; readonly status: DoctorSetupStatus } | { readonly ok: false; readonly result: CliResult };

async function resolveDoctorSetupStatus(
  plan: Awaited<ReturnType<typeof createManifestPlan>>,
  dependencies: CliDependencies,
  fix: boolean,
): Promise<DoctorSetupStatusResult> {
  const current = await readDoctorSetupStatus(plan, dependencies);
  if (!current.ok || !fix || !requiresDoctorRepair(current.status)) {
    return current;
  }

  const failure = await registerNativeHost(plan, dependencies, "firefox-cli doctor --fix");
  if (failure !== undefined) {
    return { ok: false, result: failure };
  }
  return readDoctorSetupStatus(plan, dependencies);
}

async function readDoctorSetupStatus(plan: Awaited<ReturnType<typeof createManifestPlan>>, dependencies: CliDependencies): Promise<DoctorSetupStatusResult> {
  const nativeHostManifest = await readNativeHostManifestStatus(plan);
  try {
    const nativeHostRegistration = await readWindowsNativeHostRegistration(plan, dependencies);
    return {
      ok: true,
      status: {
        nativeHostManifest,
        ...(nativeHostRegistration === undefined ? {} : { nativeHostRegistration }),
      },
    };
  } catch (error) {
    return {
      ok: false,
      result: nativeHostRegistrationFailure(error, "firefox-cli doctor --fix"),
    };
  }
}

function requiresDoctorRepair(status: DoctorSetupStatus): boolean {
  return (
    status.nativeHostManifest.status !== "installed" || (status.nativeHostRegistration !== undefined && status.nativeHostRegistration.status !== "installed")
  );
}

function formatDoctorJson(status: DoctorSetupStatus, connection: Awaited<ReturnType<typeof checkExtensionConnection>>): CliResult {
  const payload = {
    ...status,
    extensionConnection: connection,
  };
  return {
    exitCode: doctorExitCode(status, connection),
    stdout: `${JSON.stringify(payload, null, 2)}\n`,
    stderr: "",
  };
}

function formatDoctorText(manifestPath: string, status: DoctorSetupStatus, connection: Awaited<ReturnType<typeof checkExtensionConnection>>): CliResult {
  const manifest = status.nativeHostManifest;
  return {
    exitCode: doctorExitCode(status, connection),
    stdout: [
      "firefox-cli doctor",
      `Native host manifest: ${manifest.status}`,
      `Path: ${manifestPath}`,
      manifest.status === "stale" ? `Installed path: ${manifest.installedPath}` : undefined,
      manifest.status === "invalid" ? `Validation error: ${manifest.reason}` : undefined,
      ...formatWindowsRegistrationText(status.nativeHostRegistration),
      `Extension connection: ${connection.status}`,
      "nextAction" in manifest ? `Next action: ${manifest.nextAction}` : undefined,
      connection.nextAction === undefined ? undefined : `Connection next action: ${connection.nextAction}`,
      "",
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
    stderr: "",
  };
}

function formatWindowsRegistrationText(registration: WindowsNativeHostRegistrationStatus | undefined): readonly (string | undefined)[] {
  if (registration === undefined) {
    return [];
  }
  return [
    `Windows native-host registration: ${registration.status}`,
    `Registry path: ${registration.registryPath}`,
    registration.status === "stale" ? `Registered manifest path: ${registration.registeredManifestPath}` : undefined,
    registration.status !== "installed" ? `Registration next action: ${registration.nextAction}` : undefined,
  ];
}

function doctorExitCode(status: DoctorSetupStatus, connection: Awaited<ReturnType<typeof checkExtensionConnection>>): 0 | 1 {
  const registrationHealthy = status.nativeHostRegistration === undefined || status.nativeHostRegistration.status === "installed";
  return status.nativeHostManifest.status === "installed" && registrationHealthy && connection.status === "connected" ? 0 : 1;
}

async function createManifestPlan(dependencies: CliDependencies) {
  if (dependencies.binaryPath !== undefined) {
    return planNativeMessagingManifest({
      binaryPath: dependencies.binaryPath,
      platform: dependencies.platform,
      homeDir: dependencies.homeDir,
      ...optionalAppDataDir(dependencies.appDataDir),
    });
  }

  return planNativeMessagingManifest({
    packageRoot: dependencies.packageRoot,
    platform: dependencies.platform,
    arch: dependencies.arch,
    homeDir: dependencies.homeDir,
    ...optionalAppDataDir(dependencies.appDataDir),
  });
}

function formatExtensionSetupInstruction(extensionInstallUrl: string): string {
  return `Extension: download and install ${extensionInstallUrl} in Firefox.`;
}

async function readNativeHostManifestStatus(plan: Awaited<ReturnType<typeof createManifestPlan>>): Promise<
  | {
      readonly status: "installed";
      readonly path: string;
    }
  | {
      readonly status: "missing";
      readonly path: string;
      readonly nextAction: string;
    }
  | {
      readonly status: "stale";
      readonly path: string;
      readonly installedPath: string;
      readonly expectedPath: string;
      readonly nextAction: string;
    }
  | {
      readonly status: "invalid";
      readonly path: string;
      readonly reason: string;
      readonly nextAction: string;
    }
> {
  let content: string;
  try {
    content = await readFile(plan.manifestPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        status: "missing",
        path: plan.manifestPath,
        nextAction: "Run `firefox-cli setup`.",
      };
    }
    throw error;
  }

  let installed: typeof plan.manifest;
  try {
    installed = parseNativeMessagingManifestJson(content, plan.manifestPath);
  } catch (error) {
    if (isPersistedJsonFileError(error)) {
      return {
        status: "invalid",
        path: plan.manifestPath,
        reason: error.message,
        nextAction: "Run `firefox-cli doctor --fix`.",
      };
    }
    throw error;
  }

  if (!isNativeMessagingManifestCanonical(installed, plan.manifest)) {
    return {
      status: "stale",
      path: plan.manifestPath,
      installedPath: installed.path,
      expectedPath: plan.manifest.path,
      nextAction: "Run `firefox-cli doctor --fix`.",
    };
  }

  return {
    status: "installed",
    path: plan.manifestPath,
  };
}

function isNativeMessagingManifestCanonical(
  installed: Awaited<ReturnType<typeof createManifestPlan>>["manifest"],
  expected: Awaited<ReturnType<typeof createManifestPlan>>["manifest"],
): boolean {
  return (
    installed.name === expected.name &&
    installed.description === expected.description &&
    installed.path === expected.path &&
    installed.allowed_extensions.length === expected.allowed_extensions.length &&
    installed.allowed_extensions.every((value, index) => value === expected.allowed_extensions[index])
  );
}

async function checkExtensionConnection(dependencies: CliDependencies): Promise<{
  readonly status: "connected" | "not-approved" | "version-mismatch" | "pairing-mismatch" | "disconnected";
  readonly nextAction?: string;
}> {
  const response = await sendOrUnavailable(dependencies, createNoopRequest());
  if (response.ok) {
    return { status: "connected" };
  }

  if (response.error.code === "NOT_APPROVED") {
    return {
      status: "not-approved",
      nextAction: "Run `firefox-cli connect` and respond to the approval request in Firefox.",
    };
  }

  if (response.error.code === "VERSION_MISMATCH") {
    return {
      status: "version-mismatch",
      nextAction: "Upgrade/rebuild firefox-cli, the native host, and the extension so their protocol versions match.",
    };
  }

  if (response.error.code === "PAIRING_MISMATCH") {
    return {
      status: "pairing-mismatch",
      nextAction: response.error.message,
    };
  }

  return {
    status: "disconnected",
    nextAction: "Load the extension in Firefox and keep Firefox running.",
  };
}
