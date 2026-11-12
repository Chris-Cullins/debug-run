# debug-run roadmap

Updated November 12, 2026. Baseline: released version 0.6.0.

## Direction

debug-run gives coding agents reliable access to runtime evidence. The next step
is to let an agent investigate a live, paused program, preserve what it observes,
and compare successful and failing executions. The calling agent supplies the
hypotheses; debug-run supplies execution control and verifiable observations.

This document is the current product roadmap. Older implementation plans under
`docs/` describe individual features and are historical context, not a second
backlog. Commands in the planned sections below are illustrative until shipped.

## What already ships

- Launch and attach through DAP adapters for .NET, Python, Node.js, and LLDB.
- Line, conditional, hit-count, exception breakpoints, and logpoints.
- Locals, stack traces, expression evaluation, and recursive variable expansion.
- Fixed-count stepping and bounded tracing, including stop expressions.
- Assertions at observed stops and semantic variable changes during tracing.
- Compact output, filtering, and NDJSON output to stdout or a file.
- Exception-chain flattening and root-cause classification heuristics.
- Source-map diagnostics, path overrides, and generated-source support.
- .NET testhost discovery and attachment, plus installable agent skills.
- Dependency audits, package smoke tests, supported Node CI, and automatic npm
  publication when a new version merges into main.

Assertions and variable diffing are shipped features, not future milestones.
Exception-chain classification does not reconstruct the history of mutations.
Writing NDJSON to a file records observations, not a replayable process.

## Delivery order

Order reflects usefulness to agents and dependencies between features. Each row
is a reviewable feature area; larger areas should be split into complete vertical
slices. Feature PRs need not bump the package version: prepare a release separately
once a coherent set of changes is ready, since main publishes new versions.

| Order | Work | Useful result | Relative scope |
| --- | --- | --- | --- |
| 1 | Persistent sessions and explicit session outcomes | Inspect unexpected state and choose the next action without rerunning | Large; ship a bounded single-process core first |
| 2 | Doctor and breakpoint explanations | Separate setup failures from application behavior | Medium; reuse existing diagnostics |
| 3 | Reusable debug recipes | Reproduce an investigation with one command | Medium |
| 4 | Changed-code breakpoints and evidence-based suggestions | Narrow the investigation using git changes and stack traces | Medium |
| 5 | Captured-session artifacts and comparisons | Identify meaningful differences between good and bad runs | Large; capture format before comparison |
| 6 | Bounded failure capture | Retain observations leading up to a failure | Medium, after artifact support |
| 7 | Repeat until failure | Investigate flaky tests with bounded repeated runs | Medium, after recipes and artifacts |
| 8 | Data watchpoints | Stop when a supported debugger observes a value being written | Medium to large; adapter-dependent |

## 1. Persistent sessions and explicit outcomes

### Problem

The batch CLI generally captures a stop and resumes automatically. Expressions
must be selected before the run. An agent that discovers an unexpected object
cannot ask a follow-up question while that execution remains paused.

### First useful slice

Start a session, return its identifier, and keep it available across CLI calls:

```bash
debug-run start ./app.js -a node -b src/orders.ts:84
debug-run status <session-id>
debug-run inspect <session-id> --expr order
debug-run step <session-id> --into
debug-run continue <session-id>
debug-run stop <session-id>
```

Provide stack selection, locals, expression evaluation, step over/into/out,
pause, continue, and explicit cleanup. Keep existing batch behavior intact.
Start with one target per session. Additional targets, .NET test-runner startup,
and an MCP interface can follow the same controls rather than defining separate
session semantics.

### Acceptance criteria

- Breakpoints and exceptions remain paused until an explicit command resumes.
- Responses identify the session, state, and stop generation. Reject stale frame
  and variable references after a resume; do not silently inspect a different stop.
- Serialize commands and account for events arriving during an in-flight request.
- Report startup failure, running, paused, normal exit, timeout, adapter failure,
  and explicit cancellation as distinguishable outcomes.
- Give sessions a finite lifetime; provide deterministic cleanup and useful errors
  for dead sessions. Disconnecting an attached target must leave it running.
- Keep local control endpoints private and authenticated. Do not expose debugger
  control or captured values through an unauthenticated network service.
- Bound request size, response size, variable expansion, and request duration.
- Verify the actual multi-command workflow with an adapter, alongside tests of
  stale references, command races, timeout, and cleanup.

## 2. Doctor and breakpoint explanations

Build on adapter detection, `diagnose-sources`, and existing breakpoint messages.

```bash
debug-run doctor ./dist/app.js -a node --json
```

Report adapter executable/version when available, target/runtime availability,
source maps or symbols that can be checked, path mappings, and advertised DAP
capabilities. Distinguish static checks from checks requiring an adapter session;
a detected executable alone is not proof that debugging works.

For each breakpoint, distinguish invalid request, unverified binding, verified
but never reached, and reached. Record requested versus resolved source locations
and provide the adapter's actual diagnostic alongside specific corrective steps.
Do not label an unreached breakpoint as a setup failure without evidence.

Use stable JSON error codes and remediation fields. A failed expression and a
false assertion are different outcomes. Make exit status useful for automation
without treating every expected debuggee exception as an infrastructure failure.

## 3. Reusable debug recipes

Store a named launch/attach configuration, breakpoints, selected expressions,
assertions, and capture limits in a project file.

```bash
debug-run run --recipe order-total
```

Resolve paths relative to the recipe file, support explicit CLI overrides, and
validate the complete configuration before launching. Reference environment
variables by name instead of saving credentials. Make build/setup commands
explicit and opt-in; loading a recipe must not execute arbitrary setup steps.

Record the effective recipe and source revision with each run. Report dirty
working trees and external inputs that prevent an exact reproduction. Extend
existing .NET test support first; add Node/Python test-runner integration through
small adapters rather than assuming all runners start a single process.

## 4. Changed-code breakpoints and suggestions

```bash
debug-run start ./dist/app.js -a node --break-on-changes main --filter 'src/**'
debug-run suggest --stack-trace failure.txt --changed-since main --json
```

Begin with deterministic evidence: stack-trace locations, changed executable
lines, and nearby function entry points where the adapter can resolve them.
Explain every suggestion's origin instead of inventing confidence scores.

Handle renames, deleted lines, generated code, source mappings, and changes
outside executable statements. Use adapter breakpoint-location support where
available and report unverified fallbacks. Limit candidate count so a large diff
does not stop on thousands of lines. Show a preview before launching.

Full language-specific control-flow or binary analysis is a separate investment,
not a prerequisite. Measure whether suggestions reduce failed bindings and
repeated runs on representative debugging tasks before claiming speedups.

## 5. Captured-session artifacts and comparisons

Define a versioned artifact format containing observed stops, selected values,
source identities, recipe, adapter information, outcomes, and capture limits.
Record truncation and redaction explicitly. Never persist live DAP references as
though they remain usable after execution resumes.

```bash
debug-run show good.dbgrun --checkpoint price-calculated
debug-run compare good.dbgrun bad.dbgrun --checkpoint price-calculated
```

Start with offline browsing of captured values, then compare named checkpoints
and selected object paths. Allow explicit rules for ignoring timestamps,
generated IDs, and irrelevant ordering. Align by checkpoint, thread, and frame
identity where possible; do not assume equal step numbers imply equal execution.

A useful result identifies the earliest **observed** difference and shows evidence:
"At price-calculated, discount was 0.10 in run A and 10 in run B. Earlier matched
checkpoints agreed." It must also report unmatched checkpoints and missing data.

This is snapshot inspection, not time-travel execution. Arbitrary new expressions
or method calls cannot run against an NDJSON history. True replay requires a
runtime-specific record/replay backend and is deferred.

## 6. Bounded failure capture

Maintain a bounded ring of selected observations and flush it when an assertion
fails, a chosen exception occurs, or a trigger expression matches. Configure
limits by events/bytes and total duration, with an optional small post-trigger
window. Report dropped observations and sampling policy.

Include recent variable changes, stack information, relevant program output,
source revision, and the reproduction recipe. Scrub configured sensitive fields
before persistence. A long-running watch mode can aggregate hit counts and
selected values rather than emitting full objects on every hit.

The first version records only what configured breakpoints/steps observe. It must
not claim to identify an unobserved write or prove causality. Breakpoints can
change timing; capture under a debugger is not transparent production tracing.

## 7. Repeat until failure

```bash
debug-run repeat --recipe checkout-test --runs 50 --stop-on assertion_failed
```

Require a run limit and total time budget. Save matching failure artifacts and a
summary of completed, failed, timed-out, and interrupted runs. Group failures by
stable signatures while preserving their underlying evidence.

Each run gets fresh session state. Make reset/setup policy explicit, propagate
cancellation, and avoid overlapping target processes. Repetition is opt-in
because target execution can have side effects. Report a failed reproduction as
"not observed in N runs," not proof that a bug is fixed.

## 8. Data watchpoints

Expose `dataBreakpointInfo` and `setDataBreakpoints` when the active adapter
advertises support. Let the agent select an in-scope value and stop on supported
read/write access, subject to debugger limits.

Distinguish native data breakpoints from a fallback that compares expressions at
selected stops. The latter can miss intermediate mutations and cannot reliably
identify the writing instruction. Respect reference lifetimes and report why a
particular value cannot be watched.

## Improvements to carry alongside the roadmap

- Scope variable-diff history to thread and frame, and distinguish nested changes
  from whole-object replacement. Report limits rather than implying a complete
  object was captured.
- Extend assertions with explicit scope/checkpoint selection. Distinguish false,
  unavailable, and evaluation error; do not equate all three with a violated rule.
- Support changing breakpoints during a paused session after the control core is
  stable, with the same validation and binding diagnostics as initial breakpoints.
- Publish a versioned machine-readable contract for commands, events, errors,
  capabilities, and stop identifiers. Preserve the simple batch CLI.
- Maintain small real-adapter smoke tests and benchmark representative agent
  workflows: time to first useful stop, failed bindings, repeated runs, bytes
  emitted, and cleanup reliability. Avoid unmeasured efficiency claims.

## Deferred work

- **Causal reconstruction:** build on recorded evidence and watchpoints. Separate
  observed mutation history from inferred explanations; exception chains alone
  are not a history of how bad state was introduced.
- **True recording/time travel:** integrate a suitable backend per runtime or OS.
  It is not a generic DAP feature that an event log can implement.
- **Heap analysis:** start with a runtime-specific integration only after a clear
  use case. Retained sizes and memory ownership need runtime tooling; circular
  references alone do not establish a leak.
- **Multiprocess/distributed debugging:** add explicit target ownership and event
  correlation after single-process sessions are reliable. Correlation IDs can
  join observations but do not automatically detect races or establish causality.
- **Symbolic execution:** defer language-specific solvers and path constraints;
  focus first on executing and inspecting concrete reproductions.

## Non-goals

- A graphical debugger, TUI, or IDE replacement.
- An embedded model that invents diagnoses or modifies application code.
- General-purpose test generation, language-server functionality, or a historical
  bug database. Saving a debug recipe is in scope; generating a test suite is not.
- Silent execution of project setup hooks, unbounded background debugging, or
  claims that all adapters support the same optional features.

## Protocol constraints

DAP object references are generally valid only for their suspended state; control
commands and artifacts must respect this boundary. Optional capabilities must be
negotiated and reported rather than assumed. See the
[DAP overview](https://microsoft.github.io/debug-adapter-protocol/overview) and
[data-breakpoint protocol history](https://microsoft.github.io/debug-adapter-protocol/changelog.html).
