<!-- Originally DESIGN.md §22 (split per #805) -->

# Configuration & environment

Environment variables only — no config file in v1 (see "out of scope" in SPEC).

| Variable                           | Purpose                                                                | Default   |
| ---------------------------------- | ---------------------------------------------------------------------- | --------- |
| `OMNIFOCUS_LOG_LEVEL`              | Log level                                                              | `info`    |
| `OMNIFOCUS_INTEGRATION`            | Enable integration test suite                                          | unset     |
| `OMNIFOCUS_E2E`                    | Enable end-to-end suite                                                | unset     |
| `OMNIFOCUS_ALLOW_RAW_SCRIPT`       | Register `run_jxa_script` / `run_omnijs_script`                        | unset     |
| `OMNIFOCUS_CACHE_TTL_MS`           | Read-cache TTL (ms)                                                    | 30000     |
| `OMNIFOCUS_CACHE_CAPACITY`         | LRU capacity (entries)                                                 | 256       |
| `OMNIFOCUS_READ_CACHE_MAX_BYTES`   | LRU byte-cap (size-aware eviction; 0 disables)                         | 16777216  |
| `OMNIFOCUS_READ_POOL_SIZE`         | Concurrent `osascript` processes for reads                             | 2         |
| `OMNIFOCUS_WRITE_QUEUE_CAP`        | Max pending writes before `QueueFull`                                  | 50        |
| `OMNIFOCUS_JXA_TIMEOUT_MS`         | Per-call JXA timeout (ms)                                              | 30000     |
| `OMNIFOCUS_OMNIJS_TIMEOUT_MS`      | Per-call OmniJS timeout (ms)                                           | 45000     |
| `OMNIFOCUS_PERSISTENT_OSASCRIPT`   | Persistent `osascript` child for JXA (#882); `1` enables (opt-in)      | unset     |
| `OMNIFOCUS_ATTACHMENT_PATHS`       | Colon-separated allowlist of attachment path roots                     | `$HOME`   |
| `OMNIFOCUS_MAX_ATTACHMENT_MB`      | Max attachment size for `attachment_add`                               | 100       |
| `OMNIFOCUS_TOOL_RATE_LIMIT`        | Per-tool rate limit: `N/SECONDS` format                                | `120/60`  |
| `TZ`                               | Override the OS time zone for ISO-8601 output                          | OS        |

Config resolution is read once at startup; changes require a restart.
