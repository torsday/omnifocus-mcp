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

## 5. Runner hooks (`job-started` and `job-completed`)

The `runner-omnifocus-mcp` runner has two lifecycle hooks wired via its `.env` file at
`~/github-runners/runner-omnifocus-mcp/.env`:

```
ACTIONS_RUNNER_HOOK_JOB_STARTED=…/hooks/job-started.sh
ACTIONS_RUNNER_HOOK_JOB_COMPLETED=…/hooks/job-completed.sh
```

### `job-started.sh` — pre-job fixture cleanup

Runs synchronously before every job. For non-Integration-Tests workflows it exits immediately (no-op). For Integration Tests it:

1. **Ensures OmniFocus is running.** `activate` is a no-op when OF is already up; it recovers the edge case where OF crashed or was force-quit between jobs (Login Items only auto-launches at login, not between runner jobs).
2. **Wipes all `mcp-fixture:`-prefixed items** from the OmniFocus database via JXA — projects, inbox tasks, folders, and tags, in dependency order. This clears orphan fixtures left by cancelled or partially-completed prior runs before the workflow's own `seed-integration-db.js --clean` step runs.

The cleanup is best-effort (`set +e`): individual item deletions that throw don't abort the whole pass, and hook failure never fails the job from GitHub's perspective.

**Why this is necessary:** cancelled or partially-completed integration jobs do not run their teardown steps, so fixture items accumulate across runs. By the time the v1.5.1 release pipeline ran, there were 25 stale `mcp-fixture:` tags + 2 stale folders; 13–15 tests failed per run due to fixture collisions. The hook is the runtime backstop; per-test isolation (tracked separately) is the proper fix at the test level.

### `job-completed.sh` — post-job process cleanup

Runs synchronously after every job (success, failure, or cancellation). It SIGTERMs any orphan `osascript` processes reparented to launchd (ppid == 1) — the JXA wedge mode where a worker dies mid-bridge-call and leaves `osascript` stuck. It skips processes with a live parent to avoid killing the maintainer's interactive Claude sessions.

### Verify the hooks are wired

```bash
grep ACTIONS_RUNNER_HOOK ~/github-runners/runner-omnifocus-mcp/.env
# expected: both HOOK_JOB_STARTED and HOOK_JOB_COMPLETED lines

tail -f ~/Library/Logs/runner-omnifocus-mcp-cleanup.log
# watch live during an integration run — both [pre-job] and cleanup entries appear
```

---

## 6. JXA bridge contention with concurrent MCP clients

The OmniFocus JXA bridge is **single-threaded**: one `osascript -l JavaScript` invocation in flight at a time, queued by macOS. On a runner host that is also the maintainer's daily-driver laptop, every active Claude client (Desktop, Code, etc.) spawns its own `@torsday/omnifocus-mcp` server, and each of those servers periodically polls `changes_since` and other read operations. With 5+ Claude clients open, 30+ osascript processes can be queued on the bridge at any moment.

Integration tests assume exclusive bridge access. When the runner picks up an integration job while the maintainer's clients are active, the 60-second `osascript` timeout in `scripts/seed-integration-db.js` fires before the seed query even starts executing. The release-pipeline failure of v1.5.2 (2026-05-10 → 11) is the canonical incident — see [`docs/adr/0023-runner-host-bridge-contention.md`](./adr/0023-runner-host-bridge-contention.md) for the full trace and the architectural options weighed.

### Operational guidance — release procedure

Until either a dedicated CI runner exists ([ADR-0023](./adr/0023-runner-host-bridge-contention.md) Option C) or a cooperative quiesce flag ships ([ADR-0023](./adr/0023-runner-host-bridge-contention.md) Option B):

- **Open release-please PRs any time** — the polish-and-merge step doesn't need OmniFocus.
- **Merge release-please PRs only when the bridge is quiet.** Two equivalent options:
  1. **Off-hours window** — early morning or late night, when no interactive Claude session is active.
  2. **Explicit quiesce** — quit every active Claude client (Desktop, Code, browser extensions) before merging. Confirm with:
     ```bash
     pgrep -af "osascript -l JavaScript" | grep -v "actions-runner" | wc -l
     # expected: 0–2 (the runner's own scripts and incidental ambient processes)
     ```
- **If a release pipeline fails on `Seed integration fixtures` with `ETIMEDOUT`,** the contention pattern is the most likely cause. Don't retry blindly — check the bridge first:
  ```bash
  pgrep -af "osascript -l JavaScript" | wc -l
  ```
  Any double-digit count means the bridge is saturated. Quit Claude clients, wait 60s for the queue to drain, then re-run.

### Why this isn't fixed in the runner config

The maintainer's interactive MCP servers are spawned by their actual Claude clients — they're not orphans the runner can clean up. SIGKILL on them would break the user's working session. The architectural alternatives (dedicated CI machine; cooperative quiesce protocol) are recorded in [ADR-0023](./adr/0023-runner-host-bridge-contention.md); both are explicitly deferred for a single-developer project where temporal isolation is sufficient.

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
