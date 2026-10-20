import { spawn } from "node:child_process";
import { z } from "zod";
import type { WindowsNativeMessagingRegistry } from "./native-registration.js";

const resultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("written") }).strict(),
  z.object({ status: z.literal("present"), value: z.string() }).strict(),
  z.object({ status: z.literal("absent") }).strict(),
]);
const exceptionSchema = z.object({ message: z.string().min(1), hresult: z.number().int() }).strict();
const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: resultSchema }).strict(),
  z.object({ ok: z.literal(false), exceptions: z.array(exceptionSchema).min(1) }).strict(),
]);

const powerShellCommand = [
  "$ErrorActionPreference = 'Stop'",
  "$utf8 = New-Object System.Text.UTF8Encoding($false)",
  "[Console]::InputEncoding = $utf8",
  "[Console]::OutputEncoding = $utf8",
  "try {",
  "  $requestLine = [Console]::In.ReadLine()",
  "  if ([string]::IsNullOrWhiteSpace($requestLine)) { throw 'Registry request must be a JSON object.' }",
  "  $request = $requestLine | ConvertFrom-Json -ErrorAction Stop",
  "  if ($null -eq $request -or $request -isnot [pscustomobject]) { throw 'Registry request must be a JSON object.' }",
  "  $operationProperty = $request.PSObject.Properties['operation']",
  "  if ($null -eq $operationProperty -or $operationProperty.Value -isnot [string]) { throw 'Registry request operation must be a string.' }",
  "  $operation = $operationProperty.Value",
  "  if ($operation -eq 'read') {",
  "    $requiredProperties = @('operation', 'key', 'valueName')",
  "  } elseif ($operation -eq 'write') {",
  "    $requiredProperties = @('operation', 'key', 'valueName', 'value')",
  "  } else {",
  "    throw 'Unsupported Firefox native messaging registry operation.'",
  "  }",
  "  if ($request.PSObject.Properties.Count -ne $requiredProperties.Count) { throw 'Registry request has an invalid field set.' }",
  "  foreach ($propertyName in $requiredProperties) {",
  "    if ($null -eq $request.PSObject.Properties[$propertyName]) { throw 'Registry request is missing a required field.' }",
  "  }",
  "  if ($request.key -isnot [string] -or [string]::IsNullOrWhiteSpace($request.key)) { throw 'Registry request key must be a non-empty string.' }",
  "  if ($request.valueName -isnot [string]) { throw 'Registry request valueName must be a string.' }",
  "  if ($operation -eq 'write' -and ($request.value -isnot [string] -or [string]::IsNullOrWhiteSpace($request.value))) { throw 'Registry request value must be a non-empty string.' }",
  "  if ($operation -eq 'read') {",
  "    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($request.key, $false)",
  "    if ($null -eq $key) {",
  "      $result = @{ status = 'absent' }",
  "    } else {",
  "      try { $value = $key.GetValue($request.valueName, $null) } finally { $key.Dispose() }",
  "      if ($null -eq $value) { $result = @{ status = 'absent' } } else { $result = @{ status = 'present'; value = [string]$value } }",
  "    }",
  "  } else {",
  "    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($request.key)",
  "    if ($null -eq $key) { throw 'Could not create the Firefox native messaging registry key.' }",
  "    try {",
  "      $key.SetValue($request.valueName, $request.value, [Microsoft.Win32.RegistryValueKind]::String)",
  "    } finally {",
  "      $key.Dispose()",
  "    }",
  "    $result = @{ status = 'written' }",
  "  }",
  "  [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ ok = $true; result = $result } -Depth 4 -Compress))",
  "} catch {",
  "  $exception = $_.Exception",
  "  $exceptions = @()",
  "  while ($null -ne $exception) {",
  "    $exceptions += @{ message = $exception.Message; hresult = $exception.HResult }",
  "    $exception = $exception.InnerException",
  "  }",
  "  [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ ok = $false; exceptions = $exceptions } -Depth 4 -Compress))",
  "  exit 1",
  "}",
].join("\n");

export function createWindowsNativeMessagingRegistry(
  runProcess: WindowsNativeMessagingRegistryProcessRunner = runPowerShellProcess,
): WindowsNativeMessagingRegistry {
  return {
    async read(registration) {
      const response = await executePowerShell(
        {
          key: registration.key,
          operation: "read",
          valueName: registration.valueName,
        },
        runProcess,
      );
      if (response.result.status === "present") {
        return response.result.value;
      }
      if (response.result.status === "absent") {
        return undefined;
      }
      throw invalidOperationResponse("read", response);
    },
    async write(registration) {
      const response = await executePowerShell(
        {
          key: registration.key,
          operation: "write",
          value: registration.value,
          valueName: registration.valueName,
        },
        runProcess,
      );
      if (response.result.status !== "written") {
        throw invalidOperationResponse("write", response);
      }
    },
  };
}

const windowsNativeMessagingRegistry = createWindowsNativeMessagingRegistry();

type PowerShellRequest =
  | {
      readonly key: string;
      readonly operation: "read";
      readonly valueName: string;
    }
  | {
      readonly key: string;
      readonly operation: "write";
      readonly value: string;
      readonly valueName: string;
    };

async function executePowerShell(
  request: PowerShellRequest,
  runProcess: WindowsNativeMessagingRegistryProcessRunner,
): Promise<Extract<z.infer<typeof responseSchema>, { readonly ok: true }>> {
  const processResult = await runProcess(`${JSON.stringify(request)}\n`);
  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(JSON.parse(processResult.stdout));
  } catch (error) {
    throw new WindowsNativeMessagingRegistryError({
      diagnostic: `Windows PowerShell returned an invalid registry response: ${error instanceof Error ? error.message : String(error)}`,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
    });
  }

  if (!parsed.ok) {
    const cause = parsed.exceptions.reduce((_previous, exception) => exception);
    throw new WindowsNativeMessagingRegistryError({
      diagnostic: cause.message,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      hresult: cause.hresult,
    });
  }

  if (processResult.exitCode !== 0) {
    throw new WindowsNativeMessagingRegistryError({
      diagnostic: "Windows PowerShell failed to update the native messaging registry entry.",
      stdout: processResult.stdout,
      stderr: processResult.stderr,
    });
  }

  return parsed;
}

function invalidOperationResponse(
  operation: "read" | "write",
  response: Extract<z.infer<typeof responseSchema>, { readonly ok: true }>,
): WindowsNativeMessagingRegistryError {
  return new WindowsNativeMessagingRegistryError({
    diagnostic: `Windows PowerShell returned an unexpected result for registry ${operation}.`,
    stdout: JSON.stringify(response),
    stderr: "",
  });
}

interface WindowsNativeMessagingRegistryProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

type WindowsNativeMessagingRegistryProcessRunner = (input: string) => Promise<WindowsNativeMessagingRegistryProcessResult>;

async function runPowerShellProcess(input: string): Promise<WindowsNativeMessagingRegistryProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", powerShellCommand], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.stdin.once("error", reject);
    child.once("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
    child.stdin.end(input);
  });
}

export { windowsNativeMessagingRegistry };

export class WindowsNativeMessagingRegistryError extends Error {
  readonly diagnostic: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly hresult: number | undefined;

  constructor(options: { readonly diagnostic: string; readonly stdout: string; readonly stderr: string; readonly hresult?: number }) {
    super(options.diagnostic);
    this.name = "WindowsNativeMessagingRegistryError";
    this.diagnostic = options.diagnostic;
    this.stdout = options.stdout;
    this.stderr = options.stderr;
    this.hresult = options.hresult;
  }
}
