## Repository and stack

Use Bun workspaces with TypeScript, strict typechecking, and ESM-first packages.

Package boundaries:

- `packages/protocol`: command schemas, request/response envelopes, runtime validation, version negotiation, error codes, and capability metadata.
- `packages/cli`: command parser, help text, text/JSON output formatting, setup/doctor UX, local IPC client, and packaging entrypoint.
- `packages/native-host`: native messaging stdio protocol, CLI-to-host IPC server, extension connection broker, pairing state, and OS-specific native manifest registration primitives.
- `packages/extension`: Firefox MV3 WebExtension, background script, popup UI, content scripts, browser API adapters, and extension build artifacts.
- `packages/test-support`: fake native host, fake extension transport, test pages, browser API mocks, and command fixtures.
- `docs`: user docs, setup guide, command reference, troubleshooting, and architecture notes.
- `scripts`: release/build automation that is not package-local.

Root scripts should own build, test, lint, typecheck, extension lint/build, native binary build, and package verification once package manifests exist.

## Architecture

The system has four layers:

- CLI process: parses commands, connects to the native-host broker over per-user local IPC, renders output, and exits.
- Native-host broker: is launched by Firefox through native messaging, verifies extension identity, exposes a per-user local IPC endpoint for CLI invocations, forwards protocol messages, and returns results.
- Extension background: owns Firefox APIs, target tab/window resolution, permission errors, command routing, popup state, native messaging connection, and content-script orchestration.
- Content scripts: run page-local actions and page analysis: snapshots, refs, DOM events, text/value/style queries, waits, eval, and frame-scoped work.

Use the same executable for CLI mode and native-host mode. Firefox launches the binary from the native messaging manifest. Native-host mode detection must be deterministic: expected native messaging argv shape, manifest path/name, extension ID, and native framing on stdin/stdout. Normal user invocations run CLI mode only when those native-host signals are absent. Host mode must reserve stdout for native messaging frames and write logs to stderr or files.

The default command target is the active tab in the active Firefox window. Target selection uses Firefox's active state without hidden CLI sessions.

## Transport

Use Firefox native messaging as the preferred transport because it is designed for extension-to-native communication and can restrict the host to the project extension ID.

Native messaging setup:

- The extension requests `nativeMessaging`.
- The extension declares a stable Gecko add-on ID in `browser_specific_settings.gecko.id`.
- The CLI writes a native messaging manifest whose `allowed_extensions` contains only that add-on ID.
- Per-user native host registration is preferred over machine-global registration.
- macOS/Linux registration writes the manifest to the user-level Mozilla native messaging host path.
- Windows registration writes a `HKEY_CURRENT_USER\SOFTWARE\Mozilla\NativeMessagingHosts\<name>` key pointing to the manifest.
- The manifest points to the platform executable that implements native-host mode. `doctor --fix` repairs the manifest after npm package upgrades move that executable path.

Broker behavior:

- Extension background calls `runtime.connectNative()` in the unpaired state to discover host identity, and in the paired state to maintain the command channel.
- The native host stays alive while the extension's native messaging port is connected.
- The host exposes a per-user local IPC endpoint for `firefox-cli` invocations.
- CLI commands return actionable setup errors for a missing extension, pending approval, a disconnected extension, or a native-host connection failure.
- Native messaging messages from native app to extension must stay small. Large payloads should flow from extension to native host or through files because Firefox limits app-to-extension messages to 1 MB.

## Pairing, approval, and local IPC

MVP security posture is pairing-gated and command-permissive.

Unpaired handshake:

1. Extension connects to the native host.
2. Native host sends identity metadata: host name, executable path, package version, protocol min/max, native manifest path, extension ID, and a generated pairing nonce.
3. The extension approval UI asks the user to approve first use.
4. Until approval, the native host rejects CLI commands with `NOT_APPROVED`, except for the dedicated approval request command.
5. On approval, extension and native host persist the minimum pair state needed to reconnect.

After approval, all commands are allowed without per-action confirmations, domain allowlists, or action policies.

Local IPC rules:

- Use a per-user socket/pipe endpoint that is not reachable by other users.
- On Unix-like systems, use filesystem permissions and peer-credential checks where available.
- On Windows, use named-pipe ACLs restricted to the current user.
- Protect CLI-to-host requests with a generated pair token stored in user-local app state. Rotate it on `firefox-cli unpair`, extension reset, or pair-state mismatch.
- `firefox-cli unpair` clears host-side pair state. The popup reset action clears extension-side pair state.

Store pair state only in OS user-local application storage and extension-local storage. Do not store pair tokens, native-host paths, or approval state in the project repository, npm package directory, extension source tree, or generated native manifest. Pair state should include enough metadata to detect stale approvals, such as extension ID, host name, host executable identity, protocol range, and token generation. Rotate the token whenever either side resets approval, the host identity changes unexpectedly, or the extension/native-host pair cannot prove it is the same approved pair.

## MV3 lifecycle prototype gate

Target Manifest V3 unless a prototype proves MV3 unusable for the required control channel. MV2 is only an escape hatch.

The MV3/native-host prototype passes only if commands recover or fail actionably after:

- Background idle/unload and wake.
- Firefox restart.
- Extension reload/update.
- Native-host crash or disconnect.
- System sleep/wake.
- CLI invocation before the extension reconnects.
- Protocol version mismatch between CLI, native host, and extension.

Implement reconnect/backoff in the extension background and native host. If these cases cannot be made reliable, evaluate localhost broker fallback or MV2 before changing the target architecture.

## Extension UX

Keep the extension UI smaller than a control panel. The popup should show:

- Connection status: extension loaded, native host registered, native host connected, approved/not approved.
- Last actionable error, if any.
- Setup guide with extension install/load step and native-host setup command.
- Approval/reset action for the first connection.
- Copy diagnostics action.

Do not mirror CLI commands in the popup. Setup text can tell users to run `firefox-cli connect` or click the Firefox extension popup to approve.

## Permissions

Use broad host access for the MVP full-control model after explicit first-use approval.

Expected manifest shape:

- `permissions`: native messaging, content scripting, tab access, local extension storage, downloads, cookies, notifications, clipboard, and web request observation.
- `host_permissions`: broad web access for normal web pages.
- `browser_specific_settings.gecko.strict_min_version`: Firefox `150.0`.
- `browser_specific_settings.gecko.data_collection_permissions`: browsing activity, website activity, and website content because command results can leave the extension through the local native host and CLI.

Command behavior:

- Check required permissions at startup and command time because users can revoke extension permissions.
- Translate permission failures into CLI errors that name the missing capability and required user action.
- Do not treat `activeTab` as a general CLI permission. Sensitive/browser UI capture or script injection that requires user activation should return an action-required or unsupported error unless an explicit user action grants it.
