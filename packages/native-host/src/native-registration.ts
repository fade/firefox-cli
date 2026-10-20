import { writeNativeMessagingManifest, type NativeMessagingManifestPlan, type NativeMessagingManifestRegistration } from "./native-manifest.js";
import { WindowsNativeMessagingRegistryError, windowsNativeMessagingRegistry } from "./windows-native-messaging-registry.js";

export type WindowsNativeMessagingRegistration = Extract<NativeMessagingManifestRegistration, { readonly kind: "windows-registry" }>;

export interface WindowsNativeMessagingRegistry {
  read(registration: WindowsNativeMessagingRegistration): Promise<string | undefined>;
  write(registration: WindowsNativeMessagingRegistration): Promise<void>;
}

export interface NativeMessagingRegistrationOptions {
  readonly windowsRegistry?: WindowsNativeMessagingRegistry;
}

type NativeMessagingRegistrationStep = "manifest" | "windows-registry-read" | "windows-registry-write";

export class NativeMessagingRegistrationError extends Error {
  readonly step: NativeMessagingRegistrationStep;
  readonly diagnostic: string;
  readonly stdout: string | undefined;
  readonly stderr: string | undefined;
  readonly hresult: number | undefined;
  readonly accessDenied: boolean;

  constructor(options: {
    readonly step: NativeMessagingRegistrationStep;
    readonly diagnostic: string;
    readonly stdout?: string;
    readonly stderr?: string;
    readonly hresult?: number;
  }) {
    super(options.diagnostic);
    this.name = "NativeMessagingRegistrationError";
    this.step = options.step;
    this.diagnostic = options.diagnostic;
    this.stdout = options.stdout;
    this.stderr = options.stderr;
    this.hresult = options.hresult;
    this.accessDenied = options.hresult === -2147024891;
  }
}

export async function registerNativeMessagingHost(plan: NativeMessagingManifestPlan, options: NativeMessagingRegistrationOptions = {}): Promise<void> {
  try {
    await writeNativeMessagingManifest(plan);
  } catch (error) {
    throw new NativeMessagingRegistrationError({
      step: "manifest",
      diagnostic: errorMessage(error),
    });
  }

  if (plan.registration.kind === "windows-registry") {
    try {
      await (options.windowsRegistry ?? windowsNativeMessagingRegistry).write(plan.registration);
    } catch (error) {
      throw toRegistrationError("windows-registry-write", error);
    }
  }
}

export async function readWindowsNativeMessagingHostRegistration(
  registration: WindowsNativeMessagingRegistration,
  options: NativeMessagingRegistrationOptions = {},
): Promise<string | undefined> {
  try {
    return await (options.windowsRegistry ?? windowsNativeMessagingRegistry).read(registration);
  } catch (error) {
    throw toRegistrationError("windows-registry-read", error);
  }
}

function toRegistrationError(step: "windows-registry-read" | "windows-registry-write", error: unknown): NativeMessagingRegistrationError {
  if (error instanceof NativeMessagingRegistrationError) {
    return error;
  }

  if (error instanceof WindowsNativeMessagingRegistryError) {
    return new NativeMessagingRegistrationError({
      step,
      diagnostic: error.diagnostic,
      stdout: error.stdout,
      stderr: error.stderr,
      ...(error.hresult === undefined ? {} : { hresult: error.hresult }),
    });
  }

  return new NativeMessagingRegistrationError({
    step,
    diagnostic: errorMessage(error),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
