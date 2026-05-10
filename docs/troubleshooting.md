# Troubleshooting

Common issues and step-by-step recovery procedures for omnifocus-mcp.

---

## OmniFocus version compatibility

omnifocus-mcp targets **OmniFocus 4.x** (current). OmniFocus 3.x is functional but with caveats.

| Feature | OF 3.x | OF 4.x |
|---|---|---|
| Core task / project CRUD | ✓ | ✓ |
| Tags | ✓ | ✓ |
| Perspectives (read) | ✓ | ✓ |
| Custom perspectives (write) | Pro only | Pro only |
| Forecast tag | ✗ | ✓ (Pro) |
| `task_move` / `task_reorder` | Limited | ✓ (via OmniJS) |
| `note_get_html` | ✗ | ✓ |
| Review interval (days) | ✗ | ✓ |
| `omnifocus://calendar` resource | Requires Calendar TCC | Requires Calendar TCC |

**Error code:** `OF_FEATURE_REQUIRES_VERSION` — a tool or resource requires a newer OmniFocus.

**Fix:** Update OmniFocus from the Mac App Store.

**Error code:** `OF_FEATURE_REQUIRES_PRO` — the tool requires OmniFocus Pro (not Standard).

**Fix:** Upgrade to OmniFocus Pro, or use a different tool. The `omnifocus://capabilities` resource reports the current edition.

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

**Recovery:** Launch OmniFocus.app normally, then retry. The server does not auto-launch OmniFocus to avoid surprise windows. Alternatively, call the `app_launch` MCP tool to open it.

---

## Sync conflict (`OF_CONFLICT`)

**When it happens:** A mutation tool (e.g. `project_update`, `task_update`) detected that the resource was modified between your read and your write — a concurrent change from another device or another MCP call racing on the same item.

### Recovery

1. Re-read the resource with `project_get` / `task_get` to get the current state.
2. Merge your intended changes with what you see.
3. Retry the mutation with the fresh `modifiedAt` value from the re-read response.

### Prevention

- Avoid issuing multiple concurrent write calls against the same resource.
- After calling `sync_trigger`, wait a moment before writing — in-flight sync can update resources concurrently.

---

## OmniFocus window unavailable (`OF_WINDOW_UNAVAILABLE`)

**When it happens:** A tool that requires an open OmniFocus window (e.g. `window_set_focus`, `window_set_perspective`) is called while OmniFocus has no front window — for example, OmniFocus is running in the background with all windows closed or minimised to the Dock.

**Fix:**

1. Click the OmniFocus icon in the Dock to bring it forward, or press **⌘N** inside OmniFocus to open a new window.
2. Retry the tool call.

Alternatively, call `app_window_new` via MCP to open a fresh window programmatically.

---

## macOS Calendar permission denied (`OF_CALENDAR_PERMISSION_DENIED`)

**When it happens:** The `omnifocus://calendar` and `omnifocus://agenda` resources need EventKit (Calendar) access, which is a separate TCC gate from Automation.

**Fix:**

1. Open **System Settings → Privacy & Security → Calendars**.
2. Find the app running the MCP server and enable it.

If the toggle is missing, the macOS TCC prompt may not have fired yet. Call the calendar bridge's `request-access` flow to trigger it:

```bash
omnifocus-mcp --request-calendar-access
```

---

## Calendar bridge unavailable (`OF_CALENDAR_BRIDGE_UNAVAILABLE`)

**When it happens:** The compiled Swift binary for the calendar bridge is missing or fails to start. This happens when running from source without building.

**Fix:**

```bash
pnpm build:calendar-bridge
```

The published npm tarball includes a prebuilt binary; this only applies to source installs.

---

## Stale data after a write

Writes are saved locally and show up immediately in subsequent tool calls. Changes do not reach other devices until iCloud sync runs. Call `sync_trigger` after bulk mutations or when cross-device visibility matters.

---

## First-call timeout / slow startup

JXA starts an `osascript` subprocess on each call. The first call after a system sleep or a fresh OmniFocus launch can take 5–15 seconds while the database loads. This is normal.

If calls consistently time out (**error code `OF_TIMEOUT`**):

```bash
OMNIFOCUS_JXA_TIMEOUT_MS=60000 omnifocus-mcp
```

If the problem persists: quit OmniFocus, relaunch it, and retry.

---

## `run_jxa_script` / `run_omnijs_script` not available

**Error:** `ValidationError: run_jxa_script is not available in this adapter configuration`

**Fix:** The raw-script tools are opt-in. Start the server with:
```bash
OMNIFOCUS_ALLOW_RAW_SCRIPT=1 omnifocus-mcp
```

See [`docs/adr/0004-raw-script-escape-hatch.md`](./adr/0004-raw-script-escape-hatch.md) for the security rationale.

---

## Common error codes

| Code | Class | Agent action |
|---|---|---|
| `OF_NOT_RUNNING` | `environment` | Launch OmniFocus and retry |
| `OF_PERMISSION_DENIED` | `environment` | Grant Automation access (see above) |
| `OF_CALENDAR_PERMISSION_DENIED` | `environment` | Grant Calendar access (see above) |
| `OF_CALENDAR_BRIDGE_UNAVAILABLE` | `environment` | Run `pnpm build:calendar-bridge` |
| `OF_FEATURE_REQUIRES_PRO` | `environment` | Upgrade to Pro or use a different tool |
| `OF_FEATURE_REQUIRES_VERSION` | `environment` | Update OmniFocus |
| `OF_WINDOW_UNAVAILABLE` | `environment` | Open an OmniFocus window |
| `OF_VALIDATION` | `input` | Fix the input; see `details` for field reasons |
| `OF_NOT_FOUND` | `input` | Confirm ID with `*_list`; use persistent IDs |
| `OF_CONFLICT` | `input` | Re-read, merge, retry with fresh `modifiedAt` |
| `OF_TIMEOUT` | `transient` | Retry once; relaunch OmniFocus if repeated |
| `OF_RATE_LIMITED` | `transient` | Wait `details.retryAfterMs` ms then retry |
| `OF_CIRCUIT_OPEN` | `transient` | Wait `details.retryAfterMs` ms for circuit to half-open |
| `OF_TRANSPORT_UNAVAILABLE` | `infrastructure` | Verify OmniFocus is running |
| `OF_SCRIPT_ERROR` | `infrastructure` | Inspect `details.transport` and `details.reason` |
| `OF_SHUTTING_DOWN` | `lifecycle` | Reconnect to a fresh server instance |

Full error taxonomy: [`docs/errors.md`](./errors.md)

---

## Additional resources

- [README — Quick start](../README.md#quick-start)
- [Per-client setup guides](./clients/)
- [Domain reference](./domain-reference.md)
- [Error taxonomy](./errors.md)
