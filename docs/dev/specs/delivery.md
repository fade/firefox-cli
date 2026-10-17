## Testing

Use Vitest for unit and boundary tests. Use the [manual command QA checklist](all-commands-qa.md) for full browser interaction checks.

Required test layers:

- Protocol schema/version/error tests in `packages/protocol`.
- CLI parser, help text, output formatter, and setup/doctor tests in `packages/cli`.
- Native manifest path/registry generation tests for macOS, Linux, and Windows in `packages/native-host`.
- Native messaging framing tests, including app-to-extension size-limit handling.
- Extension background command-routing tests with mocked browser APIs.
- Content-script tests for snapshot generation, ref lifecycle, interactions, waits, eval, and restricted-page errors.
- Manual Firefox QA that runs real `firefox-cli` commands against a designated test page.

Required feasibility gates:

- MV3 idle/restart/reload/native-host crash recovery.
- Pairing, unpairing, token mismatch, and component reinstall behavior.
- Permission revocation and missing host permission errors.
- Restricted pages and restricted iframes.
- Screenshot selection, foregrounding, activation/capture failures, and deadlines.
- Cross-origin iframe partial snapshots.
- Native-host registration on macOS, Linux, and Windows.
- Clean npm install, package binary path, native manifest repair after upgrade, and release package verification.
- Target-site interaction smoke tests for x.com, linkedin.com, reddit.com, and representative rich-text/editor/upload flows before claiming action parity.

CI should run lint, typecheck, unit tests, extension lint, extension build, CLI build, and package verification on every change. Native host registration and IPC tests should run on macOS, Linux, and Windows in the release matrix.

## Development commands

Expose root scripts with these roles once package manifests exist:

- `build`: build all packages.
- `typecheck`: typecheck all TypeScript.
- `lint`: run code lint plus extension lint.
- `test`: run unit tests.
- `extension:run`: load the extension into Firefox for development.
- `extension:build`: produce the extension package.
- `extension:sign`: sign the built extension through Mozilla Add-ons credentials.
- `package`: build the npm package artifacts.
- `release:check`: verify the package can install, register the native host, and print actionable setup state.
- `release:check:signed`: run release verification with signed XPI presence required.

Do not put exact command strings in AGENTS.md or docs until the scripts exist in tracked manifests.

## Packaging and distribution

Publish an npm package named `firefox-cli` with one user-facing binary: `firefox-cli`.

The npm package should include or download platform-specific executable artifacts for macOS, Linux, and Windows. The executable must support:

- CLI mode for normal user commands.
- Native-host mode when launched by Firefox through the native messaging manifest.
- Setup/doctor mode for native-host manifest registration and diagnostics.

Package requirements:

- Native host manifest path points to the real executable path.
- Windows packages provide an `.exe` or wrapper suitable for the native manifest.
- Postinstall may print setup guidance but must not silently mutate Firefox configuration without an explicit setup command.
- `doctor --fix` handles moved package paths after npm upgrades.
- Host-mode stdout is reserved for native messaging frames.
- Release-candidate verification requires a signed `dist/extension-artifacts/firefox-cli-<version>.xpi` artifact and matching provenance.

Manual extension install is in scope. Mozilla store/public listing automation is out of scope.

Install paths:

- Development: temporary extension loading through Firefox tooling or `about:debugging`.
- Release/beta Firefox: signed XPI installed manually from project-provided artifact/URL.

## Documentation

MVP user-delivery docs are CLI help and setup/doctor output. Repository/release-support docs should include:

- `README.md`: install, setup, quickstart, command examples, support matrix, and troubleshooting.
- `docs/setup.md`: manual extension install/load, native-host registration, first-use approval, and platform-specific diagnostics.
- `docs/commands.md`: command reference with Firefox-specific differences from `agent-browser`.
- `docs/architecture.md`: transport, protocol, extension boundaries, native host, and capability decisions.

Do not ship packaged `skills get` docs until the command surface is stable.

## Reference sources

- Firefox native messaging: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging
- Firefox native manifests: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests
- Firefox background scripts: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
- Firefox content scripts: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts
- Firefox `scripting.executeScript()`: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/executeScript
- Firefox `tabs.captureVisibleTab()`: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureVisibleTab
- Firefox permissions: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions
- Firefox Chrome incompatibilities: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities
- DOM event trust: https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted
- Firefox Extension Workshop `web-ext`: https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/
- Firefox signing and distribution: https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
