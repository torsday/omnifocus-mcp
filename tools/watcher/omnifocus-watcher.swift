/**
 * omnifocus-watcher — FSEventStream watcher for the OmniFocus database package.
 *
 * Watches `~/Library/Application Support/OmniFocus/OmniFocus.ofocus` (or an
 * override path supplied as argv[1]) using the macOS FSEventStream API, which
 * fires at the OS kernel level — far faster and more reliable than Node's
 * `fs.watch` wrapper.
 *
 * Output: one JSON line per coalesced event batch, written to stdout.
 * The consuming Node process (DatabaseWatcher.ts) debounces and queries OF.
 *
 *   {"event":"change","paths":["OmniFocus.ofocus/abc.ofobjz"],"ts":"2026-04-25T17:00:00.123Z"}
 *   {"event":"change","paths":["OmniFocus.ofocus"],"ts":"..."}
 *
 * Stderr receives diagnostic messages (startup, errors). Stdout is strictly
 * newline-delimited JSON so the Node readline parser never misparses.
 *
 * Lifecycle:
 *   - Receives SIGTERM (from DatabaseWatcher.stop()) → drains stdout → exits 0
 *   - Path does not exist at startup → emits a diagnostic to stderr and waits;
 *     FSEvents will begin firing once OF creates the path (e.g. first launch)
 *   - Unrecoverable stream error → exits 1
 *
 * Build:
 *   swiftc tools/watcher/omnifocus-watcher.swift -o bin/omnifocus-watcher-darwin-$(uname -m)
 *
 * @see src/watcher/DatabaseWatcher.ts — consumer
 * @see scripts/build-watcher.sh — CI build script
 */

import Foundation
import CoreServices

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let watchPath: String = {
  if CommandLine.arguments.count > 1 {
    return CommandLine.arguments[1]
  }
  let home = FileManager.default.homeDirectoryForCurrentUser.path
  return "\(home)/Library/Application Support/OmniFocus/OmniFocus.ofocus"
}()

// FSEventStream fires at most latency seconds after the last event.
// We use 0.0 (immediate) and let the Node side do debouncing — keeps
// policy in one place and lets tests control timing deterministically.
let kStreamLatency: CFTimeInterval = 0.0

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

struct WatchEvent: Codable {
  let event: String
  let paths: [String]
  let ts: String
}

func emitEvent(paths: [String]) {
  let ts = ISO8601DateFormatter().string(from: Date())
  let evt = WatchEvent(event: "change", paths: paths, ts: ts)
  guard let data = try? JSONEncoder().encode(evt),
        let line = String(data: data, encoding: .utf8) else {
    fputs("omnifocus-watcher: JSON encode failed\n", stderr)
    return
  }
  print(line)  // print adds \n; stdout is line-buffered in this context
  // Force flush so the Node readline sees the line immediately.
  fflush(stdout)
}

// ---------------------------------------------------------------------------
// FSEventStream callback
// ---------------------------------------------------------------------------

// The C callback receives an untyped context pointer we use to pass the watch
// path prefix for relative-path stripping.
class WatcherContext {
  let watchPath: String
  init(_ path: String) { self.watchPath = path }
}

let contextObj = WatcherContext(watchPath)
var contextRef = Unmanaged.passRetained(contextObj)
var fsContext = FSEventStreamContext(
  version: 0,
  info: contextRef.toOpaque(),
  retain: nil,
  release: nil,
  copyDescription: nil
)

let callback: FSEventStreamCallback = { (stream, clientCallbackInfo, numEvents, eventPaths, eventFlags, eventIds) in
  let pathsPtr = eventPaths  // UnsafeMutableRawPointer — non-optional in Swift 5.9+
  let ctx = Unmanaged<WatcherContext>.fromOpaque(clientCallbackInfo!).takeUnretainedValue()

  // Collect all changed paths in this batch.
  var changed: [String] = []
  let paths = unsafeBitCast(pathsPtr, to: NSArray.self)
  for i in 0..<numEvents {
    guard let rawPath = paths[i] as? String else { continue }
    // Strip the watch path prefix so paths are relative — easier for the
    // consuming Node process and avoids leaking the full home directory path.
    let rel = rawPath.hasPrefix(ctx.watchPath)
      ? String(rawPath.dropFirst(ctx.watchPath.count + 1))
      : rawPath
    if !rel.isEmpty {
      changed.append(rel)
    }
  }

  if !changed.isEmpty {
    emitEvent(paths: changed)
  }
}

// ---------------------------------------------------------------------------
// Stream setup
// ---------------------------------------------------------------------------

let pathsToWatch = [watchPath] as CFArray

guard let stream = FSEventStreamCreate(
  kCFAllocatorDefault,
  callback,
  &fsContext,
  pathsToWatch,
  FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
  kStreamLatency,
  FSEventStreamCreateFlags(
    kFSEventStreamCreateFlagFileEvents |   // file-level granularity
    kFSEventStreamCreateFlagNoDefer        // don't coalesce — Node debounces
  )
) else {
  fputs("omnifocus-watcher: FSEventStreamCreate failed for path: \(watchPath)\n", stderr)
  exit(1)
}

FSEventStreamSetDispatchQueue(stream, DispatchQueue.global())

guard FSEventStreamStart(stream) else {
  fputs("omnifocus-watcher: FSEventStreamStart failed\n", stderr)
  exit(1)
}

fputs("omnifocus-watcher: watching \(watchPath)\n", stderr)

// ---------------------------------------------------------------------------
// Signal handling — SIGTERM → flush stdout → exit 0
// ---------------------------------------------------------------------------

signal(SIGTERM) { _ in
  fflush(stdout)
  exit(0)
}

signal(SIGPIPE, SIG_IGN)  // Node may close the pipe before we exit

// ---------------------------------------------------------------------------
// Run loop
// ---------------------------------------------------------------------------

// dispatchMain() blocks forever on the main thread, servicing the dispatch
// queue where FSEvents fires our callback.
dispatchMain()
