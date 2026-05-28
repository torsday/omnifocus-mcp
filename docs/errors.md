# Error taxonomy

Every error thrown by omnifocus-mcp is an instance of `OmniFocusError` (defined in `src/errors/index.ts`) with a stable `code`, a machine-readable `remediationClass`, and a human-readable `suggestion`. Generic `Error` is forbidden by custom lint rule.

## Remediation classes

Agents switch on `remediationClass` to decide next action without parsing text.

| Class | Agent action |
|---|---|
| `environment` | Stop; user must act (launch OF, grant permission, upgrade) |
| `input` | Fix the input and retry |
| `transient` | Wait `details.retryAfterMs` ms then retry |
| `infrastructure` | Retry once; if still failing, surface to user |
| `lifecycle` | Reconnect to a fresh server instance |

## Error codes

### Environment — `remediationClass: "environment"`

| Code | Class | Suggestion |
|---|---|---|
| `OF_NOT_RUNNING` | `OmniFocusNotRunning` | Launch OmniFocus and retry |
| `OF_PERMISSION_DENIED` | `PermissionDenied` | Open System Settings → Privacy → Automation; grant access |
| `OF_CALENDAR_PERMISSION_DENIED` | `CalendarPermissionDenied` | Open System Settings → Privacy → Calendars; grant access |
| `OF_CALENDAR_BRIDGE_UNAVAILABLE` | `CalendarBridgeUnavailable` | Run `pnpm build:calendar-bridge` |
| `OF_FEATURE_REQUIRES_PRO` | `FeatureRequiresPro` | Upgrade to OmniFocus Pro |
| `OF_FEATURE_REQUIRES_VERSION` | `FeatureRequiresOfVersion` | Update OmniFocus |
| `OF_WINDOW_UNAVAILABLE` | `WindowUnavailable` | Ask user to open an OmniFocus window |

### Input — `remediationClass: "input"`

| Code | Class | Suggestion |
|---|---|---|
| `OF_VALIDATION` | `ValidationError` | Fix the input; see `details` for field-level reasons |
| `OF_NOT_FOUND` | `NotFound` | Confirm the ID with `*_list`; use persistent IDs, not names |
| `OF_CONFLICT` | `ConflictError` | Re-read the resource, merge changes, retry with fresh `modifiedAt` |
| `OF_LOOP_DETECTED` | `LoopDetected` | Act on the previous result before repeating this tool |

### Transient — `remediationClass: "transient"`

| Code | Class | Suggestion |
|---|---|---|
| `OF_TIMEOUT` | `Timeout` | Retry once; if repeated, relaunch OmniFocus |
| `OF_RATE_LIMITED` | `RateLimited` | Wait `details.retryAfterMs` ms then retry |
| `OF_QUEUE_FULL` | `QueueFull` | Wait for in-flight writes to drain, then retry |
| `OF_CIRCUIT_OPEN` | `CircuitOpen` | Wait `details.retryAfterMs` ms for the circuit to half-open |

### Infrastructure — `remediationClass: "infrastructure"`

| Code | Class | Suggestion |
|---|---|---|
| `OF_TRANSPORT_UNAVAILABLE` | `TransportUnavailable` | Verify OmniFocus is running and responsive |
| `OF_TRANSPORT_RESTARTED` | `OmniFocusTransportRestarted` | Persistent osascript child exited mid-call and was replaced; retry. Inspect `internal_status` transport stats if it recurs |
| `OF_SCRIPT_ERROR` | `ScriptError` | Inspect `details.transport` and `details.reason` |
| `OF_STRAY_STDOUT` | `StrayStdout` | Check for console.log or libraries writing to stdout; all logging must go to stderr |

### Lifecycle — `remediationClass: "lifecycle"`

| Code | Class | Suggestion |
|---|---|---|
| `OF_SHUTTING_DOWN` | `ServerShuttingDown` | Reconnect to a fresh server instance |

## Template errors

Template tools define domain-specific subclasses that inherit from the base taxonomy:

| Error class | Base | Code | Suggestion |
|---|---|---|---|
| `TemplateNotFoundError` (templateInstantiate) | `NotFound` | `OF_NOT_FOUND` | List with `project_template_list`, retry with valid name |
| `MissingTemplateParameterError` | `ValidationError` | `OF_VALIDATION` | Provide values for `details.missing` parameters |
| `TemplateNotFoundError` (templateDelete) | `NotFound` | `OF_NOT_FOUND` | List with `project_template_list`, retry with valid name |
| `TemplateExistsError` | `ConflictError` | `OF_CONFLICT` | Delete existing template or choose a different name |

## Coverage notes

- Every error class has `remediationClass` and `suggestion` defaults in the constructor.
- Throw sites may override `suggestion` with context-specific guidance; consult `details` for structured payload.
- Errors that have no actionable remediation state that explicitly in `suggestion` (e.g. `OF_STRAY_STDOUT` which requires developer investigation).
