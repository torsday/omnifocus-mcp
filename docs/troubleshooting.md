# Troubleshooting

Common issues and step-by-step recovery procedures for omnifocus-mcp.

---

## Permission Denied — macOS Automation access

**Error code:** `OF_PERMISSION_DENIED`

**When it happens:** The first time any MCP tool calls OmniFocus, macOS shows an Automation permission prompt. If you click **Don't Allow** (or the prompt is dismissed automatically), subsequent calls will fail with a `PermissionDenied` error.

### Symptom

The MCP client surfaces an error whose `suggestion` field reads:

> Open System Settings → Privacy & Security → Automation; grant this terminal or client access to OmniFocus.

### Recovery (macOS Ventura / Sonoma / Sequoia)

1. **Open System Settings** (Apple menu → System Settings).
2. Go to **Privacy & Security** → **Automation**.
3. Find the application that runs your MCP client — typically **Terminal**, **iTerm**, **Claude**, or the specific app launcher you use.
4. Make sure the **OmniFocus** toggle under that app is **enabled** (blue).
5. If OmniFocus does not appear in the list at all: run any `osascript` command targeting OmniFocus from that app first — macOS will re-prompt for permission.

   ```bash
   osascript -e 'tell application "OmniFocus" to name'
   ```

   Click **OK** when the dialog appears.

6. Retry the MCP tool call that failed.

### Recovery (macOS Monterey and earlier)

1. Open **System Preferences** → **Security & Privacy** → **Privacy** tab → **Automation**.
2. Locate your MCP client app; check the **OmniFocus** box.
3. Click the lock icon and authenticate if the list is greyed out.

### Notes

- Automation permissions are **per-app**. If you run the server from a different terminal emulator or launch wrapper, that app needs its own permission grant.
- `tccutil reset Automation com.apple.Terminal` resets all Terminal Automation permissions — use only as a last resort since it removes _all_ app grants for that launcher.
- Some managed (MDM-enrolled) Macs restrict Automation via configuration profiles. Contact your IT department if the toggle is greyed out and you cannot change it.

---

## OmniFocus not running

**Error code:** `OF_NOT_RUNNING`

**Recovery:** Launch OmniFocus.app normally, then retry. The server does not auto-launch OmniFocus to avoid surprise windows.

---

## Additional resources

- [README — Quickstart](../README.md#quickstart)
- [Per-client setup guides](./clients/)
- [Domain reference](./domain-reference.md)
