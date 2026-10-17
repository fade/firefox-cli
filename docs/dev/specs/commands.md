## CLI surface and capability matrix

Keep command names close to `agent-browser` unless Firefox capability differences require a different command or explicit unsupported error.

Agent-browser family compatibility summary:

| Agent-browser family | `firefox-cli` status |
| --- | --- |
| Navigation: `open`, `back`, `forward`, `reload` | MVP |
| Browser/session close: `close`, `quit`, `exit`, `close --all` | Unsupported. Use explicit `tab close` or `window close`. |
| Snapshot/refs: `snapshot`, `frame` | MVP for main-frame refs and iframe diagnostics. Actionable iframe refs are unsupported. |
| Core actions: `click`, `dblclick`, `fill`, `type`, `press`, `keyboard`, `hover`, `focus`, `check`, `uncheck`, `select`, `scroll`, `scrollintoview`, `swipe` | MVP for normal main-frame controls. Target-site QA covers representative public click/fill/type/scroll actions and records x.com unauthenticated-headless limits. |
| Advanced input: `drag`, `upload`, direct `mouse`, `keydown`, `keyup` | MVP with content-script event fidelity |
| Semantic locators: `find ...` | MVP |
| Read/check/wait: `get`, `is`, selector/text/URL/function/load/networkidle/download waits | MVP |
| Tabs/windows: `tab`, `window` | MVP |
| Capture: `screenshot` | MVP for visible-tab PNG/JPEG. Full-page/PDF/video are unsupported or deferred. |
| Eval and batch: `eval`, `batch` | MVP |
| Dialogs, downloads, clipboard, cookies, storage, network list/clear | MVP with Firefox/WebExtension limits. HAR is unsupported. |
| Debug/repro: console/errors, `highlight`, diff, trace/profiler, vitals | MVP for listed commands. Other items are deferred as listed below. |
| Auth/state/session/profile/security gates/content boundaries | Deferred or unsupported in MVP because this controls the existing Firefox session after pairing |
| Chrome/CDP/provider/browser-install features: CDP attach, `get cdp-url`, `inspect`, `--extension`, external providers, iOS, Chrome profile import, browser install/upgrade | Unsupported unless Firefox provides an equivalent |

Global options:

- `--json`: emit machine-readable JSON.
- `--timeout <ms>`: override command timeout.
- `--max-output <chars>`: cap text output.
- `--window <target>` and `--tab <target>`: route-specific target selectors. Use only flags advertised by that route's help.
- `--debug`: include transport/protocol diagnostics.

Setup and diagnostics:

- `firefox-cli setup`: print extension download instructions and native-host setup status.
- `firefox-cli setup native-host`: register/update the native messaging host.
- `firefox-cli doctor`: diagnose extension install, native manifest, host path, extension connection, approval, Firefox status, and protocol version.
- `firefox-cli doctor --fix`: repair native-host registration when possible.
- `firefox-cli unpair`: remove local approval state.
- `firefox-cli capabilities`: list command support by capability group.

MVP:

- Navigation: `open`, `back`, `forward`, `reload`.
- Snapshot: `snapshot`, `snapshot -i`, `snapshot -c`, `snapshot -d <depth>`, `snapshot -s <selector>`.
- Stable interactions: `click`, `dblclick`, `focus`, `fill`, `type`, `press`, `keyboard type`, `keyboard inserttext`, `hover`, `check`, `uncheck`, `select`, `scroll`, `scrollintoview`.
- Swipe aliases: `swipe up|down|left|right [px]`, mapped to scrolling/pointer behavior where desktop Firefox supports it.
- Optional tap alias: `tap <selector|ref>` may alias `click` with desktop semantics.
- Information: `get text`, `get html`, `get value`, `get attr`, `get title`, `get url`, `get count`, `get box`, `get styles`.
- State checks: `is visible`, `is enabled`, `is checked`.
- Waits: `wait <selector|ref|ms>`, `wait --text`, `wait --url`, `wait --fn`, `wait --state hidden`, `wait --load domcontentloaded|complete`.
- Tabs/windows: `tab`, `tab new`, `tab close`, `tab select`, `window`, `window new`, `window close`, `window select`. The relevant commands support `--focus` for window foregrounding.
- Screenshots: visible-tab `screenshot [path]`; `--focus` requests window foregrounding.
- Eval: `eval <js>`, `eval --stdin`, `eval -b <base64>`.
- Batch: `batch` with JSON input and `--bail`.

Implemented with Firefox/WebExtension limits:

- `drag`.
- `upload`.
- Direct mouse commands: `mouse move`, `mouse down`, `mouse up`, `mouse wheel`.
- `keydown` and `keyup`.
- Semantic locators: `find role/text/label/placeholder/alt/title/testid/first/last/nth`.
- Frame listing. Cross-frame direct refs are unsupported.
- JPEG screenshot options.
- File downloads: `download`, `wait --download`.
- Dialogs: `dialog accept`, `dialog dismiss`, `dialog status`.
- Clipboard: `clipboard read/write/copy/paste`.
- Cookies and storage commands.
- Network request listing/filtering.
- `wait --load networkidle`.
- Console/error capture after injected instrumentation.
- `highlight`.
- PDF export returns `UNSUPPORTED_CAPABILITY` because Firefox saves PDFs through a browser dialog.
- Viewport/window sizing commands.
- Diff snapshot/screenshot/url.

Unsupported:

- Full-page screenshot stitching.
- Network route/mock/block, network request detail, and HAR capture.

Defer:

- Auth vault.
- Agent skill packaging.
- AI chat command.
- Content-boundary output markers and other prompt-injection hardening features.
- Dashboard/streaming UI.
- Video recording.
- Profiling/tracing.
- `pushstate`.
- `vitals` and `web-vitals`.
- Device emulation, proxy control, geolocation emulation, offline mode, custom headers, HTTP credentials.
- Browser install/upgrade commands.
- Persistent state/session commands.
- Browser profile listing/import commands.

Unsupported unless Firefox provides an equivalent:

- Top-level `close`, `quit`, `exit`, and `close --all` are unsupported. Use explicit `tab close` and `window close`.
- `confirm` and `deny`, because MVP has no per-action confirmation queue.
- Chrome `debugger`/CDP-specific commands.
- CDP attach by port/URL and `get cdp-url`.
- DevTools opening/inspection behavior equivalent to `agent-browser inspect`.
- Chrome extension loading flags such as `--extension`.
- External browser providers and iOS provider.
- Commands that require controlling pages where Firefox blocks extension injection.

## MVP command contracts

Target-dependent MVP command results include resolved window/tab metadata where their result schema exposes it. Text output may omit fields that are not useful for agents.

Navigation:

- `open <url> [--new-tab] [--focus]`: params are normalized URL, new-tab flag, and focus request. Navigation leaves tab selection unchanged by default. `--new-tab` creates an unselected tab unless `--focus` is set. With `--focus`, navigation selects the target tab and requests window foregrounding. Result is final target, URL, navigation status, and load state when known. Errors include invalid URL, ambiguous or missing target, permission denied, navigation timeout, and unsupported restricted page.
- `back`, `forward`, `reload`: params are empty except target and timeout. Result is final URL and load state when known. Errors include no history entry, ambiguous or missing target, navigation timeout, and restricted page.

Snapshot:

- `snapshot [-i] [-c] [-d <depth>] [-s <selector>]`: params are interactive-only, compact, max depth, selector scope, and max output. Result is text snapshot, generation ID, refs count, truncation flag, and frame diagnostics. Errors include script injection blocked, selector not found, permission denied, and output too large.

Interactions:

- `click`, `dblclick`, `focus`, `hover`, `check`, `uncheck`, `scrollintoview`: params are selector/ref plus action options. Result is action status, resolved element summary, and post-action URL if it changed. Errors include ref not found, selector not found, not visible, disabled, script injection blocked, and action rejected by page.
- `fill <selector|ref> <text>`: params are target and text. Result is action status plus resulting value length when readable. Errors include not editable, ref not found, selector not found, script injection blocked, and action rejected by page.
- `type <selector|ref> <text>`, `keyboard type <text>`, `keyboard inserttext <text>`: params are target when applicable, text, and input mode. Result is action status and focused element summary when available. Errors include no focused element, not editable, script injection blocked, and action rejected by page.
- `press <key>`: params are normalized key chord. Result is action status and focused element summary when available. Errors include invalid key, no focused element when focus is required, script injection blocked, and action rejected by page.
- `select <selector|ref> <value...>`: params are target and selected values. Result is selected values when readable. Errors include not a select control, option not found, ref not found, and script injection blocked.
- `scroll <direction> [px]` and `swipe <direction> [px]`: params are direction, distance, and optional selector/ref container. Result is scroll position when readable. Errors include invalid direction, ref not found, selector not found, and script injection blocked.

Information:

- `get text|html|value|attr|count|box|styles <selector|ref>`: params are getter type, target when required, and attribute name for `attr`. Result is the requested scalar/object with truncation metadata for large text/html. Errors include missing attr name, ref not found, selector not found, and script injection blocked.
- `get title` and `get url`: params are target only. Result is title or URL. Errors include no active tab and permission denied.

State checks:

- `is visible|enabled|checked <selector|ref>`: params are check type and target element. Result is boolean plus element summary. Errors include ref not found, selector not found, unsupported check, and script injection blocked.

Waits:

- `wait <selector|ref>`: waits for visible element by default. Result is matched element summary and elapsed time. Errors include timeout, ref not found, selector not found before timeout, and script injection blocked.
- `wait <ms>`: waits for duration. Result is elapsed time.
- `wait --text <text>`: waits for substring in visible document text. Result is match status and elapsed time.
- `wait --url <glob>`: waits for target tab URL to match. Result is final URL and elapsed time.
- `wait --fn <js>`: evaluates until truthy in the same execution mode as `eval`. Result is elapsed time and final truthy value when serializable.
- `wait --state hidden <selector|ref>`: waits for element to be absent or not visible. Result is elapsed time.
- `wait --load domcontentloaded|complete|networkidle`: waits for document readiness or background network idle.
- `wait --download [id|filename-glob]`: waits for a download to complete.

Tabs and windows:

- `tab`: lists tabs for the selected or only window. Result includes ID, index, active flag, title, URL when permitted, window ID, private flag, and container metadata when available.
- `tab new [url] [--focus]`: creates an unselected tab by default. `--focus` selects the new tab and requests window foregrounding. Result is created tab target and URL when provided.
- `tab close [id|index|active]`: closes a tab. Result is closed tab ID and next active tab when known.
- `tab select [id|index|active] [--focus]`: selects a tab within its window. `--focus` also requests window foregrounding. Result is the selected target. Target-dependent follow-up commands need explicit selectors when the target is ambiguous.
- `window`: lists normal windows and their active tabs. Result includes Firefox window IDs, focus/active flags, bounds when available, and tab count.
- `window new [url] [--focus]`: creates a new window. `--focus` requests foregrounding. Result is created window ID and active tab ID.
- `window close <id|active>`: closes a window. Result is closed window ID.
- `window select [id|index|active]`: brings a window forward to the user. Result includes refreshed focus metadata and its active tab. Target-dependent follow-up commands need explicit selectors when the target is ambiguous.

Screenshots:

- `screenshot [path] [--focus]`: params are output path, format, target, focus request, and timeout. Result is file path, format, dimensions when known, and activation side-effect diagnostics. Errors include no active tab, permission denied, `CAPTURE_FAILED` for activation or image-capture failures, `TIMEOUT` for capture deadlines, and write failure.

Eval:

- `eval <js>`, `eval --stdin`, `eval -b <base64>`: params are script, encoding source, target, timeout, and size limits. Result is serialized value or `undefined` marker. Errors include syntax/runtime error, serialization failure, timeout, script injection blocked, unsupported execution world, and result too large.

Batch:

- `batch [--bail]`: params are ordered command steps, bail flag, default target, and timeout. Result is ordered step results, first failed index when any, and final exit status. Errors include invalid step, batch timeout, and concurrent target lock timeout.
