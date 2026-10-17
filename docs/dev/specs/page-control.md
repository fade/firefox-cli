## Targeting

Target resolution is owned by the extension.

- `active` is an explicit selector. `--window active` chooses Firefox's focused normal window. `--tab active` chooses the active tab within the selected window.
- Window and tab IDs use Firefox IDs in JSON output.
- Human-facing indexes use deterministic `browser.windows.getAll({ populate: true })` ordering. The focused window comes first, followed by other windows ordered by Firefox window ID. Tabs use their index within each window.
- Private windows are reported but commands return `UNSUPPORTED_CAPABILITY` unless the extension has private browsing permission and the command is explicitly allowed there.
- Container tab metadata should be included when Firefox exposes it, but no persistent container/session model is added.
- Each command snapshots its resolved target before execution to avoid active-tab races.
- Selector values are `active`, a non-negative listing index, or `id:<non-negative Firefox ID>`. Routes support no selector, `--window` only, `--tab` only, or both, as advertised by CLI help. Unsupported selector flags fail before dispatch.
- An omitted window selector is accepted only when exactly one normal window exists. A globally unique `--tab id:<id>` also identifies its owning window. Other tab selectors resolve within the selected window.
- A tab-dependent command accepts an omitted tab selector only when the selected window has exactly one tab. Pass `--tab active` explicitly to choose Firefox's active tab when several tabs exist.
- Ambiguous omission returns `INVALID_TARGET` with `Ambiguous window` or `Ambiguous tab` guidance before browser side effects.
- Page-targeted routes support both dimensions. `tab`, `tab new`, `window select`, `window close`, and `set viewport` are window-scoped. `open --new-tab` resolves only a window. Targetless routes support neither.
- `tab select` selects a tab within its window. `--focus` also requests window foregrounding. `window select` brings its window forward. Neither command establishes durable CLI target state, so pass selectors explicitly when a later command needs an unambiguous target.

`open <url>` navigates the resolved target tab without changing tab selection. `tab new [url]` and `open --new-tab <url>` create an unselected tab. These commands accept `--focus` to select the target tab and request window foregrounding. `window new [url]` requests foregrounding only with `--focus`.

## Snapshot and ref model

`snapshot` is the core LLM-efficient output format. It must not dump raw HTML by default.

Snapshot output should include:

- Page title and URL.
- A compact semantic tree with stable-for-generation element refs like `@e1`.
- Interactive elements by default with `snapshot -i`.
- Useful accessible names, roles, labels, placeholders, selected/checked/disabled state, hrefs, and input types.
- Iframe boundaries and diagnostics when frames are present.
- Clear truncation markers when output is clipped by `--max-output`.

Ref registry:

- The extension/content-script layer owns a bounded per-tab snapshot registry.
- Each snapshot creates a generation ID with tab ID, frame ID/document ID, timestamp, and ref mappings.
- Refs must survive separate CLI invocations until TTL expiry or invalidation.
- Invalidate refs on navigation, reload, frame reload, document replacement, or registry memory pressure.
- `batch` shares refs created earlier in the same batch transaction.
- Stale refs return `REF_NOT_FOUND` with "run `firefox-cli snapshot -i` again" guidance.
- Refs are actionable only in the main frame.
- Iframe output is diagnostic and read-only in `snapshot` and `frame`. Iframe-targeted commands and interactions against iframe refs return `UNSUPPORTED_CAPABILITY`.

Implementation approach:

- Build snapshots from DOM, ARIA attributes, computed visibility, form metadata, and bounding boxes.
- Start with main-frame content-script snapshots.
- Restricted frames may produce partial output with diagnostics.

## Action backend

MVP starts with WebExtension/content-script actions:

- Pointer actions are implemented through DOM element resolution, scrolling into view, focus, and synthetic mouse/pointer/click events where needed.
- Text entry uses value-setting plus input/change events for form controls, and keyboard/input event simulation for editable content where feasible.
- Click, hover, press, keyboard, fill, type, drag, upload, direct mouse commands, and raw key events are available for normal main-frame web controls with target-site limitations recorded in `docs/target-site-qa.md`.

Generated DOM events are not trusted user input. Sites that check `event.isTrusted`, require browser user activation, use complex editors, or implement anti-abuse controls may reject content-script actions. Track concrete failures. Add OS-level input emulation only when these failures block the product.

## Eval semantics

`eval` is included in MVP but must be explicitly specified and tested.

- Support `eval <js>`, `eval --stdin`, and `eval -b <base64>`.
- Execution target is the resolved tab's main frame.
- Frame-targeted eval returns `UNSUPPORTED_CAPABILITY`.
- Execute in the page/main world when Firefox supports it. Return `UNSUPPORTED_CAPABILITY` for operations that require page-world access when Firefox lacks support.
- Results must be structured-cloneable or JSON-serializable. Unsupported values return a structured serialization error.
- Capture thrown errors with name, message, stack when available, and frame context.
- Enforce command timeout, script size limit, and result size limit.
- Restricted pages return `SCRIPT_INJECTION_BLOCKED`.

## Screenshot semantics

Start with visible-tab screenshots.

- `screenshot [path]` captures the requested visible tab and selects it within its window.
- Use `--focus` to request window foregrounding for human inspection or focus-dependent rendering. Invalid target resolution happens before activation.
- Activation or image-capture failures return `CAPTURE_FAILED` with diagnostic detail. Capture deadlines return `TIMEOUT`.
- Write image bytes through the native host to the requested path. JSON output should include path, format, dimensions when known, and diagnostics.
- Support visible-tab PNG and JPEG captures with JPEG quality.
- `--full` returns `UNSUPPORTED_CAPABILITY` because Firefox WebExtensions expose visible-tab capture APIs and no full-page file API.
