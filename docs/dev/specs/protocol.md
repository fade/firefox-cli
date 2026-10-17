## Protocol

All CLI-extension messages go through `packages/protocol`.

Use a discriminated schema registry for typed command routing:

```ts
type CommandSchema =
  | { command: "open"; params: OpenParams; result: OpenResult }
  | { command: "snapshot"; params: SnapshotParams; result: SnapshotResult }
  | { command: "click"; params: ClickParams; result: ActionResult }
```

Raw boundaries parse unknown JSON into validated envelopes. Runtime packages receive typed command IDs, typed params, typed results, and stable error unions generated or exported from `packages/protocol`.

Request envelope:

```ts
type RequestEnvelope<C extends CommandId = CommandId> = {
  protocolVersion: number
  id: string
  command: C
  target?: BrowserTarget
  params: CommandParams<C>
  output?: OutputOptions
}
```

Response envelope:

```ts
type ResponseEnvelope<C extends CommandId = CommandId> =
  | { protocolVersion: number; id: string; ok: true; result: CommandResult<C>; diagnostics?: Diagnostic[] }
  | { protocolVersion: number; id: string; ok: false; error: ProtocolError; diagnostics?: Diagnostic[] }
```

Protocol rules:

- Validate every incoming message at every process/browser boundary.
- Include a protocol version in every message.
- Return structured errors with stable codes such as `EXTENSION_NOT_CONNECTED`, `NOT_APPROVED`, `UNSUPPORTED_CAPABILITY`, `PERMISSION_DENIED`, `NO_ACTIVE_TAB`, `REF_NOT_FOUND`, `NAVIGATION_TIMEOUT`, `SCRIPT_INJECTION_BLOCKED`, and `VERSION_MISMATCH`.
- Include capability metadata so `firefox-cli capabilities` reports implemented and unsupported command groups.
- Keep command requests under the native app-to-extension message limit. Eval scripts accept stdin/base64 and obey the documented maximum request size.

Startup handshake:

- CLI, native host, and extension exchange `hello` messages with product version, protocol min/max, extension ID, native-host name, and feature flags.
- The negotiated protocol version is the highest shared version.
- If there is no compatible version, commands fail with `VERSION_MISMATCH` and remediation text naming which component must be upgraded.

## Error and output UX

Errors should be concise and actionable:

- If extension is not installed: print the matching extension download URL.
- If native host is not registered: print `firefox-cli setup native-host`.
- If Firefox is not running or extension is disconnected: tell the user to open Firefox and run `firefox-cli connect`.
- If first-use approval is pending: tell the user to run `firefox-cli connect` or open the extension popup and approve.
- If a page is restricted: name the restriction and suggest trying a normal web page/tab.
- If a ref is stale: tell the user to run `firefox-cli snapshot -i` again.
- If a command is unsupported: name the Firefox limitation or missing implementation gate.

Default text output is for agents. JSON output is for programmatic scripts.
