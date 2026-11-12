# Persistent debug sessions

Status: unreleased development feature; not included in npm 0.6.0.

A live session keeps the debugger and paused target available between CLI invocations.
Start once, inspect what matters, choose the next step, and inspect again. The existing
`debug-run <program> ...` batch command still captures events and continues automatically.

## Run from this checkout

```bash
npm ci
npm run build
npm ci --prefix samples/typescript
npm run build --prefix samples/typescript
node dist/index.cjs install-adapter node
node dist/index.cjs start ./samples/typescript/dist/index.js -a node
```

Build your target before launching it and substitute its actual entry point. In the
examples below, `debug-run` means the CLI built from this checkout; you can substitute
`node /absolute/path/to/debug-run/dist/index.cjs` in each command. The globally installed
0.6.0 CLI does not have these commands.

## Launch, inspect, and resume

```bash
debug-run start ./dist/app.js -a node -b "src/orders.ts:42" --timeout 10m
```

`start` returns one JSON object containing a UUID `sessionId`. Save it for later calls.
The target pauses at each breakpoint or configured exception until explicitly resumed.
With no breakpoint or exception filters, launch requests a pause at entry. Use
`--stop-at-entry` to request that pause alongside breakpoints (adapter support varies).

```bash
debug-run status <session-id>
debug-run inspect <session-id>
debug-run inspect <session-id> --expr "order.items" --depth 2
debug-run step <session-id>
debug-run status <session-id>
debug-run continue <session-id>
debug-run stop <session-id>
```

`step` defaults to step over; `--into` and `--out` select the other operations. `pause`
requests a stop in a running session. Resume/pause commands acknowledge the request;
they do not wait for the next stop. Poll `status` until `state` is `paused` and
`stop.ready` is true, or a terminal state appears. Expression evaluation may execute
code and change program state; it is not a read-only sandbox.

Initial launch options include `--cwd`, `--args`, `--env NAME=value`,
`--break-on-exception`, and `--source-map-overrides`. Put the program before variadic
options such as `-b` and `--args`; run `start --help` for the full option list.
Breakpoints are set at startup; changing them during a session is not yet supported.

## Stop identity and frame selection

A paused status includes a `stop` object with an incrementing `id`, `threadId`, `reason`,
`allThreadsStopped`, `ready`, and a `stack` of up to 20 frames. Stack retrieval failures
appear in `stop.error`. Stopping one thread does not imply all threads are stopped.

Use `--stop <id>` on inspect, step, or continue when acting on a previously observed
pause. References become invalid immediately on resume or another stop; requests using
an old ID fail with `STALE_STOP`. Read status again before retrying. Explicit frame
selection requires the stop ID from the same response:

```bash
debug-run inspect <session-id> --frame <frame-id> --stop <stop-id> --expr "order.id"
```

Without `--frame`, inspection selects the top frame of the current stop. The first
version controls one selected stop/thread in one target; it does not offer independent
multi-thread or child-process debugging.

## Attach to an existing target

For Node, enable an inspector bound to loopback in the process you want to inspect:

```bash
node --inspect=127.0.0.1:9229 ./dist/app.js
# In another terminal:
debug-run start -a node --attach --port 9229 --timeout 10m
debug-run pause <session-id>
debug-run status <session-id>
debug-run inspect <session-id> --expr "process.pid"
debug-run stop <session-id>
```

Node live sessions require an inspector port; `--attach --pid` is rejected with an
actionable error. Other adapters accept `--attach --pid <pid>` when supported by their
own runtime and permissions. Node port attachment is local only. Launch and attach
are mutually exclusive.

`stop`, timeout, and normal cleanup terminate a target launched by the session. For
an attached target they request disconnect without termination, leaving it running.
The real-adapter integration suite covers Node launch and attach. Python/.NET lifecycle
ordering has mocked regression tests; equivalent real-adapter coverage remains future work.

## JSON and outcomes

Successful command response:

```json
{"schemaVersion":1,"sessionId":"<uuid>","ok":true,"result":{"state":"running"}}
```

Command error (exit status 1):

```json
{"schemaVersion":1,"sessionId":"<uuid>","ok":false,"error":{"code":"STALE_STOP","message":"The requested stop is no longer current; read status again."}}
```

CLI usage errors handled by the argument parser can still produce conventional stderr
output. Valid control commands return one JSON object, rather than the batch NDJSON
stream. `status` also includes adapter capabilities and a bounded buffer of recent events
while the worker is alive, with `droppedEvents` reporting discarded events.

States are `starting`, `running`, `paused`, `ended`, or `failed`. Terminal `outcome` is
one of `exited`, `terminated`, `stopped`, `timeout`, `adapter_error`, or `startup_error`.
`exitCode` is included only when the adapter reports it: `terminated` does **not** imply
exit code zero. A successful `status` command exits 0 even if the target failed; inspect
the JSON outcome separately. Completed status remains readable, and repeated `stop` is
safe. Other commands against completed sessions return `SESSION_ENDED`.

## Lifetime, storage, and limits

- Default total lifetime: 10 minutes, including pauses. `--timeout` accepts 1 second
  through 60 minutes. A command timeout closes the session.
- Inspection defaults to depth 2, with a maximum of 4, up to 20 items per
  object/scope, and 200 expanded variables per command. `truncated: true` reports
  these inspection limits being reached. Adapters may apply additional truncation. Narrow the expression if a response is too large.
- Commands are serialized; control requests have a 15-second budget and DAP requests
  a 10-second budget. Requests are capped at 16 KiB and responses at 1 MiB.
- Recent events are held in memory: at most 100 events or 256 KiB, with individual
  events over 64 KiB discarded. This is a diagnostic tail, not a durable recording.
- Each worker binds an authenticated control endpoint to `127.0.0.1` on a random port.
  Browser-origin requests are rejected. Credentials are not printed in command output.
- Session files live under `$DEBUG_RUN_HOME/sessions/<uuid>` (default
  `~/.debug-run/sessions/<uuid>`). On Unix, directories are private (0700) and files
  are 0600. Cleanup removes the connection credentials and retains `result.json` with
  terminal metadata, without captured variable values or the event buffer. Delete a
  completed session's directory to discard that metadata.
- A force-killed worker or machine shutdown can leave stale connection files. Commands
  report `SESSION_UNAVAILABLE` rather than connecting elsewhere or adopting an old PID.
  Inspect any surviving target before deleting the stale directory.

The private endpoint limits who can control this debugger; it does not isolate the
program being debugged. Runtime output, expressions, and adapter behavior remain those
of the target and the installed debugger.

## Validation

```bash
npm run check
npm run test:package
node dist/index.cjs install-adapter node
npm run test:live
```

The integration suite uses temporary fixtures and session storage, separate CLI processes,
and the real js-debug adapter. It checks inspection/stepping, stale references, concurrent
sessions, exception pauses, authentication, timeout cleanup, target termination, and
attach/disconnect behavior. CI runs it on Node 24.
