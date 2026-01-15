# debug-run: Build Plan

A CLI tool that enables AI agents to programmatically debug code via the Debug Adapter Protocol (DAP).

## Project Setup

- [x] Create project structure
- [x] Initialize git repository
- [x] Initialize Bun/TypeScript project
- [x] Configure TypeScript (`tsconfig.json`)
- [x] Add dependencies (`@vscode/debugprotocol`, `commander`, `glob`, `chalk`)
- [ ] Set up Vitest for testing

## Phase 1: Core DAP Client (MVP) ✅

**Goal:** Connect to netcoredbg, set breakpoints, capture state when hit.

### Transport Layer
- [x] Implement Content-Length framing parser (`src/dap/transport.ts`)
- [x] Handle stdin/stdout communication with debug adapter
- [x] Implement request/response correlation via sequence numbers
- [x] Set up event handling and dispatch

### Session Management
- [x] Create session manager (`src/session/manager.ts`)
- [x] Implement DAP initialize sequence
- [x] Implement launch configuration
- [x] Handle `stopped`, `terminated`, `exited`, `output` events

### Breakpoints
- [x] Parse breakpoint specification (file:line format)
- [x] Implement `setBreakpoints` DAP request
- [x] Track breakpoint verification status

### Variable Inspection
- [x] Implement `stackTrace` request
- [x] Implement `scopes` request
- [x] Implement `variables` request (configurable depth)

### Output
- [x] Define event types (`src/output/events.ts`)
- [x] Implement NDJSON serializer
- [x] Output `session_start`, `breakpoint_set`, `breakpoint_hit`, `session_end` events

### CLI
- [x] Set up argument parsing with Commander (`src/cli.ts`)
- [x] Handle `--adapter`, `--program`, `--breakpoint`, `--timeout` flags
- [x] Implement timeout handling

### First Adapter
- [x] Implement netcoredbg adapter config (`src/adapters/netcoredbg.ts`)
- [x] Adapter detection (check if installed)
- [x] Build launch/attach configurations

## Phase 2: Variable Expansion & Evaluation

**Goal:** Deep variable inspection and expression evaluation.

- [x] Implement recursive variable expansion (configurable depth)
- [x] Add collection preview (first N items)
- [x] Implement `evaluate` DAP request for expression evaluation
- [x] Handle `--eval` CLI flag
- [x] Capture `this` context
- [ ] Handle circular references in variable expansion

## Phase 3: Conditional Breakpoints & Exceptions ✅

**Goal:** More control over when to break.

- [x] Support conditional breakpoints (`file:line?condition` syntax)
- [x] Support hit count breakpoints (`file:line#count` syntax)
- [x] Implement `setExceptionBreakpoints` DAP request
- [x] Handle `--break-on-exception` CLI flag
- [x] Support caught vs uncaught exception filtering
- [x] Implement logpoints (log without breaking)

## Phase 4: Stepping & Flow Control

**Goal:** Step through code, not just stop at breakpoints.

- [x] Implement `next` (step over) DAP request
- [x] Implement `stepIn` DAP request
- [x] Implement `stepOut` DAP request
- [x] Implement `continue` DAP request
- [ ] Handle `--steps N` CLI flag for automatic stepping
- [ ] Handle `--capture-each-step` flag
- [ ] Output `step_completed` events

## Phase 5: Multi-Adapter Support

**Goal:** Support Python, Node.js, and other languages.

- [x] Create adapter abstraction layer (`src/adapters/base.ts`)
- [x] Implement adapter registry (`src/adapters/index.ts`)
- [x] Add debugpy adapter for Python (`src/adapters/debugpy.ts`)
- [ ] Add Node.js inspector adapter (`src/adapters/node.ts`)
- [ ] Add LLDB adapter (`src/adapters/lldb.ts`)
- [x] Implement adapter auto-detection
- [x] Provide installation guidance when adapter missing

## Phase 6: Test Integration

**Goal:** Debug specific tests easily.

- [ ] Implement `--test` flag that wraps test runners
- [ ] Support `dotnet test` integration
- [ ] Support pytest integration
- [ ] Support jest/vitest integration
- [ ] Automatic breakpoint on test failure

## Phase 7: Attach & Advanced Scenarios

**Goal:** Debug running processes and complex scenarios.

- [ ] Implement `--attach` mode
- [ ] Support attach by PID (`--pid`)
- [ ] Support attach by process name
- [ ] Multi-process debugging
- [ ] Source mapping for transpiled code
- [ ] Remote debugging via TCP transport

## Phase 8: Interactive Mode

**Goal:** REPL-style debugging for complex sessions.

- [ ] Implement `--interactive` flag
- [ ] Accept commands from stdin
- [ ] Support `break`, `run`, `continue`, `step`, `eval` commands
- [ ] Session persistence

## Supporting Work

### Test Fixtures
- [ ] Create .NET test fixture (`test/fixtures/dotnet/`)
- [ ] Create Python test fixture (`test/fixtures/python/`)
- [ ] Create Node.js test fixture (`test/fixtures/node/`)

### Integration Tests
- [ ] End-to-end tests with netcoredbg
- [ ] End-to-end tests with debugpy
- [ ] End-to-end tests with Node.js inspector

### Documentation
- [ ] Write README.md with usage examples
- [x] Document adapter installation (`adapters/README.md`)
- [ ] Add agent integration examples

### Distribution
- [ ] Configure Bun compile for single binary
- [ ] Test on Linux, macOS, Windows
- [ ] Set up CI/CD pipeline

## Open Questions to Resolve

1. **Output verbosity**: Default variable expansion depth? (suggest: 2 levels)
2. **Binary distribution**: Bun compile vs pkg vs native?
3. **Windows support**: Path handling differences
4. **Source mapping**: TypeScript/transpiled code handling
5. **Security**: Sanitize secrets in variable values?
6. **Performance**: Streaming vs batching for large objects
