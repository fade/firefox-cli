`firefox-cli` needs two installed pieces:

- the CLI/native host executable from the npm package
- the Firefox extension that connects Firefox to the native host.

## Install the CLI

```sh
npm install -g firefox-cli
firefox-cli setup
```

`firefox-cli setup` registers the native host for the current user, then prints the matching extension URL and connection-approval instructions. `--json` changes only the output format. Use `--dry-run` to preview setup without writing the manifest or Windows registry entry.

Repository checkouts use:

```sh
bun install --frozen-lockfile
bun run package:check
node dist/package/bin/firefox-cli.js setup
```

## Install the extension

Open the extension URL printed by `firefox-cli setup` in Firefox and accept the install prompt. The URL points at the signed XPI for the matching CLI version.

Repository checkouts can build an unsigned extension directory:

```sh
bun run extension:build
```

Open `about:debugging#/runtime/this-firefox`, choose `Load Temporary Add-on`, and select `dist/extension/manifest.json`.

## Connect Firefox

Run `firefox-cli connect` and approve the request in Firefox, or open the `firefox-cli` extension popup and approve the native host.

Verify the connection:

```sh
firefox-cli doctor
firefox-cli capabilities
firefox-cli tab
```

`doctor` exits non-zero when setup is incomplete and prints the next action.

## Register the native host explicitly

Use `firefox-cli setup native-host` to register or update the native host without fetching the extension URL. Use `--dry-run --json` to preview the registration plan without writes.

Per-user registration:

| Platform | Location |
| --- | --- |
| macOS | `~/Library/Application Support/Mozilla/NativeMessagingHosts/firefox_cli.json` |
| Linux | `~/.mozilla/native-messaging-hosts/firefox_cli.json` |
| Windows | `%APPDATA%\firefox-cli\native-messaging-hosts\firefox_cli.json`. Setup creates `HKEY_CURRENT_USER\SOFTWARE\Mozilla\NativeMessagingHosts\firefox_cli` and points it at the manifest. |

After npm upgrades or package moves, run `firefox-cli doctor --fix`. On Windows, `doctor` reports the registry entry with the manifest and extension connection state. `doctor --fix` repairs a missing or stale manifest and a missing or wrong registry entry.

## Troubleshooting

`Native host manifest: missing`
: Run `firefox-cli setup` or `firefox-cli doctor --fix`.

`Native host manifest: stale`
: The manifest points at an old package path. Run `firefox-cli doctor --fix`.

`Windows native-host registration: missing` or `stale`
: Run `firefox-cli setup` or `firefox-cli doctor --fix`.

`Extension connection: disconnected`
: Load or enable the extension and keep Firefox running.

`Extension connection: not-approved`
: Run `firefox-cli connect` and respond to the approval request in Firefox.

`Version mismatch`
: Upgrade or rebuild the CLI, native host, and extension from the same package version.

`SCRIPT_INJECTION_FAILED`
: Use a normal web page tab. Firefox blocks extension scripts on restricted internal pages and some privileged pages.

`UNSUPPORTED_CAPABILITY`
: The command family is not part of the supported Firefox command surface. Run `firefox-cli capabilities --json` for capability metadata.
