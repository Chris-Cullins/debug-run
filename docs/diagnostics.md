# Doctor and breakpoint diagnostics

These features are in development source, not npm 0.6.0. Build with `npm ci && npm run build`
and substitute `node /path/to/debug-run/dist/index.cjs` for `debug-run` below.

## Check prerequisites

```bash
debug-run doctor ./dist/app.js -a node --json
debug-run doctor ./dist/app.js -a node --cwd /path/to/project -b "src/orders.ts:42" --json
debug-run doctor ./bin/Debug/net10.0/App.dll -a dotnet --json
```

The target is optional: `debug-run doctor -a node` checks the adapter and runtime only.
Without `--json`, a concise text report lists each result and suggested next action.

Preflight checks inspect:

- Adapter detection, command/arguments, and supported local version metadata (currently
  js-debug's package metadata when available). Other adapter versions are explicitly unchecked.
- Working-directory and target-file access, and executable permission for native Unix targets.
- Node/Python runtime version or installed .NET runtimes. Presence is not a compatibility check
  against a target's requested runtime version.
- The Node entry point's referenced local external source map, or adjacent `.map` as fallback.
  Local source resolution and embedded content are checked with existing source-map diagnostics.
  `--source-map-overrides` accepts the same presets/JSON mappings as debug sessions.
- An adjacent .NET PDB. Absence is a warning because symbols can be embedded or stored elsewhere;
  presence does not prove that the PDB matches the binary. Native debug symbols are not inspected.
- Breakpoint syntax and source-file access. Missing local sources are warnings because virtual
  or embedded sources can still bind. Existing files do not establish executable line locations.

Adapter detection and runtime-version checks may execute installed tool commands, with bounded
subprocess timeouts. The target program is never executed. File checks are limited to the entry
point and its local map (8 MiB per file); remote maps are never fetched and inline maps are reported
as unchecked. The map report includes at most 20 source details. Use `diagnose-sources` to scan a
build directory and inspect imported modules' maps.

## Probe the adapter handshake

```bash
debug-run doctor ./dist/app.js -a node --probe --json
```

`--probe` starts the configured adapter, sends DAP `initialize`, reports the advertised
capabilities, and disconnects without launching or attaching to a target. Socket adapters use
an ephemeral loopback port. The handshake is bounded to 10 seconds and individual requests to
2 seconds; cleanup disconnects the probe adapter. If adapter detection or working-directory
checks fail, the probe is skipped.

Capabilities describe what the adapter advertises. Some features depend on the target or
language, so a successful handshake does not establish support in every actual session.
This command does not install adapters, compile a project, load symbols into a target, or test
breakpoint binding. The real-adapter CI probe covers js-debug; other adapters have mocked
lifecycle coverage.

## JSON and exit status

```json
{
  "schemaVersion": 1,
  "ok": true,
  "adapter": "node",
  "cwd": "/project",
  "program": "/project/dist/app.js",
  "checks": [
    {
      "code": "ADAPTER_HANDSHAKE",
      "status": "skipped",
      "evidence": "handshake",
      "message": "Adapter was not started. Use --probe to test its DAP handshake."
    }
  ]
}
```

Every check has a stable `code`, `status` (`pass`, `warn`, `fail`, `skipped`), an evidence
category (`preflight`, `handshake`), and a message. Failed checks and warnings may include
`remediation`; `details` contains relevant paths, versions, mappings, or capabilities.

Exit 1 and `ok: false` mean at least one check failed. Warnings alone exit 0. Examples of
failure codes are `UNKNOWN_ADAPTER`, `ADAPTER_AVAILABLE` with status `fail`,
`RUNTIME_UNAVAILABLE`, `TARGET_FILE` with status `fail`, `INVALID_BREAKPOINT`,
`INVALID_PATH_MAPPINGS`, and `ADAPTER_HANDSHAKE_FAILED`. Conventional argument-parser
errors can still use stderr instead of the report format.

## Explain breakpoints from a real session

```bash
debug-run start ./dist/app.js -a node -b "src/orders.ts:42"
debug-run status <session-id>
```

Live status and retained terminal metadata include `result.breakpoints`. Batch runs include
`summary.breakpoints` in their final `session_end` event. Each entry records:

| Field | Meaning |
| --- | --- |
| `requested` | Original source path and line, resolved against the session working directory |
| `resolved` | Latest verified adapter location, when available; omitted for unverified bindings |
| `binding` | `rejected` (request failed), `unverified`, or `verified` according to adapter evidence |
| `hitStatus` | `observed` when the adapter reports this breakpoint ID at a stop, otherwise `not_observed` |
| `hits` | Number of stops explicitly attributed to this breakpoint ID |
| `code` | `BREAKPOINT_REJECTED`, `BREAKPOINT_UNVERIFIED`, `BREAKPOINT_VERIFIED`, or `BREAKPOINT_REACHED` |
| `adapterMessage` | The adapter's actual binding diagnostic, when present |
| `suggestions` | Contextual troubleshooting steps for bindings that are unverified or rejected and have no observed hits |

`breakpoint_set.diagnostics` preserves the original request and verified resolved location,
including when the adapter moves a breakpoint to another executable line. Subsequent DAP
binding changes update the report. Node child-session bindings are associated by original
request order so duplicate line locations with different conditions remain distinguishable.

Binding and execution are independent observations. A verified breakpoint with no observed hit
may be in a path the input did not reach. A provisional binding may already have an observed hit.
A later module unload can invalidate a binding without erasing earlier hits. Missing hit IDs,
logpoints, or termination before a stop was reported do not prove the line never executed.
`not_observed` is deliberately not a failure classification or coverage measurement.
