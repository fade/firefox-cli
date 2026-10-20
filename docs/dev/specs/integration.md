## Browser connection

The CLI controls the user's current Firefox session through the extension and native host.

Firefox starts the native host through native messaging. The extension connects to the host. The CLI sends commands to the host over per-user local IPC. The host forwards each command to the extension and returns its response.

Native-host mode writes only native-messaging frames to stdout. It writes diagnostics to stderr or files.

## First-use approval

The extension asks the user to approve browser control. The native host rejects CLI commands until approval, except for approval requests.

The host stores pair state in user-local application storage. The extension stores the pair token in extension storage. The host checks the token, host ID, and extension ID. If the pair state is invalid or either ID changes, the host rejects commands until the user resets approval and approves again.

`firefox-cli unpair` and the extension reset action clear pairing state. After approval, commands run without per-action approval or domain allowlists.

## Permissions

The extension requires Firefox 150 or later. It requests broad access to ordinary web pages during first-use approval. It uses `nativeMessaging`, `scripting`, `tabs`, and `storage`. Commands for downloads, cookies, notifications, clipboard access, and network observation use their matching permissions.

The extension declares access to browsing activity, website activity, and website content. Command results can leave Firefox through the native host and CLI. If Firefox denies a required permission, the extension returns an error with the needed action.

## Extension UI

The popup shows the native-host connection, approval status, and latest error. It lets the user approve or reset browser control. A CLI approval request opens a dedicated Firefox page.
