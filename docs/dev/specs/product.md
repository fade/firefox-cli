## Product goal

`firefox-cli` gives AI agents and terminal users an `agent-browser`-style control surface for the user's real Firefox session. It controls already-running Firefox windows and tabs through a manually installed Firefox extension, not through a separate automation browser profile.

The CLI supports full browser control where Firefox WebExtensions allow it: navigation, tab/window selection, compact page snapshots with element refs, clicking, typing, filling, hovering, scrolling, swipe aliases, screenshots, waits, page queries, JavaScript evaluation, batch execution, and diagnostic output.

## Non-goals

- Do not launch a dedicated automation-only Firefox profile for normal commands.
- Do not create persistent browser profiles, synthetic sessions, saved auth states, auth vaults, or cookie/storage snapshots in the MVP.
- Do not build AMO/public store distribution flows in the MVP.
- Do not build packaged agent skills until the CLI API shape is stable.
- Do not add domain allowlists, action policy files, or per-action confirmations in the MVP.
- Do not implement Chrome CDP/debugger-only capabilities unless Firefox provides an equivalent.
- Do not add OS-level input emulation unless content-script actions fail concrete target-site tests.
- Do not provide top-level `close`, `quit`, or `exit` commands in the MVP. Require explicit `tab close` or `window close` because these commands control the user's existing browser.

## User experience

The happy path:

1. User installs the npm package and gets one executable: `firefox-cli`.
2. User runs `firefox-cli setup` to register the native messaging host and print the extension URL and connection-approval instructions.
3. User manually installs or temporarily loads the Firefox extension from that URL.
4. User runs `firefox-cli connect` and responds to the Firefox approval request, or opens the extension popup and approves the first connection.
5. Commands use the active Firefox tab or window only when the targeting rules permit omitted selectors. Ambiguous targets require explicit selectors.

Example workflow:

```bash
firefox-cli open https://example.com
firefox-cli snapshot -i
firefox-cli click @e3
firefox-cli fill @e4 "hello@example.com"
firefox-cli screenshot page.png
```

CLI output defaults to compact, LLM-readable text. `--json` returns typed protocol-shaped JSON for scripts and tests.
