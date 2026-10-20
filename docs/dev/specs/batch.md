## Batch and concurrency

`batch` executes commands serially.

- Input is a JSON array of argv arrays or command objects.
- The required default window and/or tab is resolved once at batch start unless a step overrides it. Window-only batches do not require or inject a tab selector.
- Steps share ref registry entries created earlier in the batch.
- `--bail` stops at the first failed step.
- Output is an ordered result array with per-step success/error, diagnostics, and final exit status.
- The batch timeout is the outer deadline. Each step may also have a timeout.

Concurrency rules:

- Serialize mutating commands per target tab.
- Allow independent read-only commands only when they do not mutate shared ref or wait state.
- Queue concurrent CLI invocations through the native host and return deterministic timeout/cancellation errors.
