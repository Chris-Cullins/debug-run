# debug-run: Build Plan

A CLI tool that enables AI agents to programmatically debug code via the Debug Adapter Protocol (DAP).

## Project Setup

- [x] Create project structure
- [x] Initialize git repository
- [ ] Initialize Bun/TypeScript project
- [ ] Configure TypeScript (`tsconfig.json`)
- [ ] Add dependencies (`@vscode/debugprotocol`, `commander`, `glob`, `chalk`)
- [ ] Set up Vitest for testing

## Phase 1: Core DAP Client (MVP)

**Goal:** Connect to netcoredbg, set breakpoints, capture state when hit.

### Transport Layer
- [ ] Implement Content-Length framing parser (`src/dap/transport.ts`)
- [ ] Handle stdin/stdout communication with debug adapter
- [ ] Implement request/response correlation via sequence numbers
- [ ] Set up event handling and dispatch

### Session Management
- [ ] Create session manager (`src/session/manager.ts`)
- [ ] Implement DAP initialize sequence
- [ ] Implement launch configuration
- [ ] Handle `stopped`, `terminated`, `exited`, `output` events

### Breakpoints
- [ ] Parse breakpoint specification (file:line format)
- [ ] Implement `setBreakpoints` DAP request
- [ ] Track breakpoint verification status

### Variable Inspection
- [ ] Implement `stackTrace` request
- [ ] Implement `scopes` request
- [ ] Implement `variables` request (1 level deep)

### Output
- [ ] Define event types (`src/output/events.ts`)
- [ ] Implement NDJSON serializer
- [ ] Output `session_start`, `breakpoint_set`, `breakpoint_hit`, `session_end` events

### CLI
- [ ] Set up argument parsing with Commander (`src/cli.ts`)
- [ ] Handle `--adapter`, `--program`, `--breakpoint`, `--timeout` flags
- [ ] Implement timeout handling

### First Adapter
- [ ] Implement netcoredbg adapter config (`src/adapters/netcoredbg.ts`)
- [ ] Adapter detection (check if installed)
- [ ] Build launch/attach configurations

## Phase 2: Variable Expansion & Evaluation

**Goal:** Deep variable inspection and expression evaluation.

- [ ] Implement recursive variable expansion (configurable depth)
- [ ] Add collection preview (first N items)
- [ ] Implement `evaluate` DAP request for expression evaluation
- [ ] Handle `--eval` CLI flag
- [ ] Capture `this` context
- [ ] Handle circular references in variable expansion

## Phase 3: Conditional Breakpoints & Exceptions

**Goal:** More control over when to break.

- [ ] Support conditional breakpoints (`file:line?condition` syntax)
- [ ] Support hit count breakpoints
- [ ] Implement `setExceptionBreakpoints` DAP request
- [ ] Handle `--break-on-exception` CLI flag
- [ ] Support caught vs uncaught exception filtering
- [ ] Implement logpoints (log without breaking)

## Phase 4: Stepping & Flow Control

**Goal:** Step through code, not just stop at breakpoints.

- [ ] Implement `next` (step over) DAP request
- [ ] Implement `stepIn` DAP request
- [ ] Implement `stepOut` DAP request
- [ ] Implement `continue` DAP request
- [ ] Handle `--steps N` CLI flag for automatic stepping
- [ ] Handle `--capture-each-step` flag
- [ ] Output `step_completed` events

## Phase 5: Multi-Adapter Support

**Goal:** Support Python, Node.js, and other languages.

- [ ] Create adapter abstraction layer (`src/adapters/base.ts`)
- [ ] Implement adapter registry (`src/adapters/index.ts`)
- [ ] Add debugpy adapter for Python (`src/adapters/debugpy.ts`)
- [ ] Add Node.js inspector adapter (`src/adapters/node.ts`)
- [ ] Add LLDB adapter (`src/adapters/lldb.ts`)
- [ ] Implement adapter auto-detection
- [ ] Provide installation guidance when adapter missing

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
- [ ] Document adapter installation (`adapters/README.md`)
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
