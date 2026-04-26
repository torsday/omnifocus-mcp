# Runner setup — `macos-omnifocus`

This document describes how to configure the `macos-omnifocus` self-hosted runner so that integration tests pass without manual intervention.

The runner is a macOS machine (typically the maintainer's laptop) registered under `Settings → Actions → Runners`. It must satisfy the following before integration tests can run reliably:

1. OmniFocus is installed and licensed.
2. OmniFocus starts automatically when the user session begins (login / reboot).
3. macOS Automation permission is granted to the `osascript` process.

---

## 1. Auto-start OmniFocus at login

**Recommended approach: Login Items** (simplest for a personal machine that is also the daily driver).

1. Open **System Settings → General → Login Items & Extensions**.
2. Under **Open at Login**, click **+**.
3. Navigate to `/Applications/OmniFocus.app` and click **Add**.

After the next login or reboot, OmniFocus will be running before GitHub Actions executes any integration job.

> **Why Login Items and not a launchd plist?**  
> A LaunchAgent plist (`~/Library/LaunchAgents/com.omnigroup.omnifocus.runner.plist`) is more robust on a headless dedicated runner but adds operational overhead on a personal machine. Login Items is the right trade-off here — one UI click, zero maintenance, and it respects the existing OmniFocus session rather than launching a second instance. If the runner ever moves to a dedicated headless machine, switch to the LaunchAgent approach (see the appendix below).

### Verify

After the next login, confirm OmniFocus started automatically before starting any runner process:

```bash
osascript -e 'tell application "System Events" to (name of processes) contains "OmniFocus"'
# expected: true
```

---

## 2. Grant Automation permission

The integration tests drive OmniFocus via JXA (`osascript -l JavaScript`). macOS requires explicit Automation permission for this.

1. Run the permission-check script once:

   ```bash
   bash scripts/check-automation-permission.sh
   ```

2. If it exits non-zero, open **System Settings → Privacy & Security → Automation** and enable the toggle for **Terminal** (or whichever app hosts the runner process) → **OmniFocus**.

3. Re-run the check to confirm:

   ```bash
   bash scripts/check-automation-permission.sh && echo "OK"
   ```

---

## 3. Register the runner

Follow the standard GitHub instructions for adding a self-hosted runner. Apply the label **`macos-omnifocus`** (in addition to the default `self-hosted` and `macOS` labels) so that `integration.yml` targets it correctly:

```yaml
runs-on: [self-hosted, macos-omnifocus]
```

---

## 4. Ongoing maintenance

| Task | Frequency |
|------|-----------|
| OmniFocus app updates | Apply promptly — the JXA API surface is stable across minor versions, but major upgrades should be re-tested |
| macOS upgrades | Re-check Automation permission after every major macOS upgrade (Privacy & Security resets some grants) |
| Runner application updates | `cd ~/actions-runner && ./run.sh` should be kept current |
| `scripts/_project-constants.sh` | Must be present at `~/actions-runner/_work/omnifocus-mcp/omnifocus-mcp/scripts/_project-constants.sh` (or the checkout path) for the `board-sync` workflow to set project fields. Copy it from the repo root after any project board changes. |

---

## Appendix: LaunchAgent alternative (dedicated runner)

If the runner moves to a headless dedicated machine, use a LaunchAgent instead of Login Items:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.omnigroup.omnifocus.runner</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-a</string>
    <string>OmniFocus</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>
```

Install it:

```bash
cp .runner/com.omnigroup.omnifocus.runner.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.omnigroup.omnifocus.runner.plist
```

Remove it:

```bash
launchctl unload ~/Library/LaunchAgents/com.omnigroup.omnifocus.runner.plist
rm ~/Library/LaunchAgents/com.omnigroup.omnifocus.runner.plist
```
