# debug-run

A CLI tool that enables AI agents to programmatically debug code via the Debug Adapter Protocol (DAP).

## Usage

```bash
# Run directly with npx (no install needed)
npx debug-run --help

# List available debug adapters
npx debug-run list-adapters
```

## Development Setup

If working on the debug-run codebase itself:

```bash
# Install dependencies (automatically builds)
npm install

# Run from source
npx tsx ./src/index.ts --help
```

## Pre-commit Hooks & Testing

This project has a pre-commit hook that runs **typecheck, unit tests, and linting** before every commit. Commits will be blocked if any tests fail.

### For AI Agents Adding Tests

**Be careful when adding new tests** - broken or slow tests will block all commits and slow down development:

1. **Always run `npm run test:run` before committing** to verify tests pass
2. **Keep tests fast** - unit tests should complete in milliseconds, not seconds
3. **Don't add flaky tests** - tests must pass consistently, not intermittently
4. **Mock external dependencies** - don't make network calls, file system operations outside temp dirs, or spawn processes in unit tests
5. **Test files go in `test/`** - mirror the `src/` directory structure (e.g., `src/foo/bar.ts` -> `test/foo/bar.test.ts`)

If you accidentally break tests and need to commit urgently, you can bypass with `git commit --no-verify` but this should be avoided.

## Building the Sample .NET App

Before testing, build the sample application:

```bash
cd samples/dotnet
dotnet build
cd ../..
```

This creates `samples/dotnet/bin/Debug/net8.0/SampleApp.dll`.

## Testing with the Sample App

### Basic Debugging (breakpoint + variable capture)

```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  --pretty \
  -t 30s
```

This will:
- Set a breakpoint at line 67 (inside `ProcessOrder` method)
- Capture local variables including `order`, `this`, and method locals
- Output JSON events for each breakpoint hit

### Expression Evaluation

Use `--eval` or `-e` to evaluate expressions at each breakpoint:

```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  -e "order.Total" \
  -e "order.Items.Count" \
  -e "this._inventory.Count" \
  --pretty \
  -t 30s
```

### Assertion-Based Debugging

Use `--assert` to declare invariants that must remain truthy. The debugger halts immediately when any assertion fails, transforming debugging from "search for the bug" to "let the bug announce itself."

```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  --assert "order.Total >= 0" \
  --assert "order.Items.Count > 0" \
  --assert "this._inventory != null" \
  --pretty \
  -t 30s
```

Assertions are checked:
- At every breakpoint hit
- At every trace step (if `--trace` enabled)
- At every regular step (if `--steps` enabled)

When an assertion fails, the session stops immediately with an `assertion_failed` event containing:
- The failed assertion expression
- The actual value that caused the failure
- Full stack trace and local variables
- Error message (if the assertion threw an exception)

**Important**: Assertions should be pure expressions without side effects. Avoid expressions like `counter++` in assertions.

### Exception Chain Flattening

When `--break-on-exception` is used, exceptions are automatically analyzed to:
1. Traverse the `InnerException` chain
2. Extract structured data from each exception
3. Classify the root cause by category
4. Generate actionable debugging hints

This feature is enabled by default. Use `--no-flatten-exceptions` to disable it.

```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  --break-on-exception all \
  --pretty \
  -t 30s
```

When an exception with inner exceptions is caught, the `exception_thrown` event includes:

```json
{
  "type": "exception_thrown",
  "exception": {
    "type": "DataAccessException",
    "message": "Failed to execute query"
  },
  "exceptionChain": [
    {
      "depth": 0,
      "type": "DataAccessException",
      "message": "Failed to execute query on Orders table",
      "source": "MyApp",
      "throwSite": "Void ExecuteQuery()"
    },
    {
      "depth": 1,
      "type": "DbConnectionException",
      "message": "Unable to connect to database server",
      "source": "MyApp",
      "throwSite": "Void Connect()"
    },
    {
      "depth": 2,
      "type": "NetworkException",
      "message": "Connection refused to db-server:5432",
      "data": { "errorCode": 10061 },
      "isRootCause": true
    }
  ],
  "rootCause": {
    "type": "NetworkException",
    "message": "Connection refused to db-server:5432",
    "category": "network",
    "actionableHint": "Connection refused - check if the target service is running and the port is correct"
  }
}
```

#### Exception Categories

| Category | Exception Types |
|----------|----------------|
| `network` | SocketException, HttpRequestException, WebException |
| `database` | SqlException, NpgsqlException, DbUpdateException |
| `authentication` | AuthenticationException, UnauthorizedAccessException |
| `validation` | ArgumentException, FormatException, ValidationException |
| `timeout` | TimeoutException, TaskCanceledException |
| `file_system` | FileNotFoundException, DirectoryNotFoundException, IOException |
| `configuration` | ConfigurationException, OptionsValidationException |
| `null_reference` | NullReferenceException |
| `argument` | InvalidOperationException, NotSupportedException |
| `unknown` | Unrecognized exception types |

#### Exception Options

| Option | Description |
|--------|-------------|
| `--no-flatten-exceptions` | Disable exception chain analysis |
| `--exception-chain-depth <n>` | Max depth to traverse (default: 10) |

### Expected Output

The tool outputs NDJSON (newline-delimited JSON) events:

1. `session_start` - Session begins
2. `breakpoint_set` - Breakpoint configured
3. `process_launched` - Debuggee started
4. `breakpoint_hit` - Breakpoint was hit, includes:
   - `location` - file, line, function name
   - `stackTrace` - call stack
   - `locals` - captured local variables with recursive expansion
   - `evaluations` - results of --eval expressions
5. `assertion_failed` - Assertion violated (if `--assert` used), includes:
   - `assertion` - the expression that failed
   - `actualValue` - the value that made it fail
   - `location` - where the assertion was checked
   - `stackTrace` - full call stack
   - `locals` - captured variables for context
6. `process_exited` - Program finished
7. `session_end` - Summary with statistics

## Debug Adapters

### vsdbg (Recommended for .NET)

The VS Code C# extension's debugger. Automatically detected if you have the C# extension installed.

```bash
npx debug-run list-adapters
# Should show: vsdbg - Status: installed (path)
```

### netcoredbg

Open-source alternative. Currently has stability issues on some platforms (SIGSEGV crashes observed on macOS ARM64).

Install manually from: https://github.com/Samsung/netcoredbg/releases

Or use the built-in installer:
```bash
npx debug-run install-adapter netcoredbg
```

### debugpy (Python)

Python debugger using Microsoft's debugpy. Automatically detected if:
1. VS Code debugpy extension is installed (ms-python.debugpy) - recommended
2. VS Code Python extension is installed (ms-python.python) - older versions bundled debugpy
3. Or debugpy is installed via pip: `pip install debugpy`

```bash
npx debug-run list-adapters
# Should show: debugpy - Status: installed (VS Code Python extension or pip)
```

## Testing with the Python Sample App

```bash
# Debug Python application with breakpoint
npx debug-run samples/python/sample_app.py \
  -a python \
  -b "samples/python/sample_app.py:185" \
  --pretty \
  -t 30s
```

### Expression Evaluation

```bash
npx debug-run samples/python/sample_app.py \
  -a python \
  -b "samples/python/sample_app.py:188" \
  -e "subtotal" \
  -e "tax" \
  -e "order.order_id" \
  --pretty \
  -t 30s
```

### Good Breakpoint Locations (Python Sample)

| Line | Location | Description |
|------|----------|-------------|
| 185 | `process_order` | After variable setup, before loyalty points calculation |
| 140 | `calculate_discount` | After discount calculation |
| 298 | `main` | Before processing first order |

### Python-Specific Notes

- Use `-a python` or `-a debugpy` for Python debugging
- Breakpoints are set AFTER launch (debugpy DAP flow differs from .NET)
- Python dataclasses show `special variables` which can be filtered
- Use `justMyCode: false` in launch config to step into library code

### lldb (Rust/C/C++/Swift)

LLDB-based debugger for native code. Automatically detected from:
1. `lldb-dap` in PATH
2. Homebrew LLVM on macOS (`brew install llvm`) - auto-detected, no PATH changes needed
3. CodeLLDB VS Code extension (vadimcn.vscode-lldb)

```bash
npx debug-run list-adapters
# Should show: lldb - Status: installed (/opt/homebrew/opt/llvm/bin/lldb-dap)
```

## Testing with the Rust Sample App

```bash
# Build the sample first
cd samples/rust && cargo build && cd ../..

# Debug Rust application with breakpoint
npx debug-run ./samples/rust/target/debug/sample_app \
  -a rust \
  -b "samples/rust/src/main.rs:250" \
  --pretty \
  -t 30s
```

### Expression Evaluation (Rust)

```bash
npx debug-run ./samples/rust/target/debug/sample_app \
  -a rust \
  -b "samples/rust/src/main.rs:250" \
  -e "final_total" \
  -e "customer.loyalty_tier" \
  --pretty \
  -t 30s
```

### Good Breakpoint Locations (Rust Sample)

| Line | Location | Description |
|------|----------|-------------|
| 250 | `process_order` | After calculations, before formatting result |
| 175 | `calculate_discount` | Inside discount calculation match |
| 415 | `main` | Before processing first order |

### Rust-Specific Notes

- Use `-a rust` or `-a lldb` for Rust debugging
- Rust types display with full module paths (e.g., `sample_app::Order`)
- Enums show variant names (e.g., `loyalty_tier: "Gold"`)
- Strings show as `alloc::string::String` with internal `vec` structure
- First debug session may require macOS permission prompt

## Important Notes

### Breakpoint Paths

Breakpoint paths should be relative to the working directory:
- Good: `-b "samples/dotnet/Program.cs:67"`
- Bad: `-b "Program.cs:67"` (won't resolve correctly)

### Adapter Selection

- Use `-a vsdbg` for .NET (most stable)
- Use `-a netcoredbg` only if vsdbg isn't available
- Use `-a debugpy` or `-a python` for Python
- Use `-a rust` or `-a lldb` for Rust/C/C++

### Timeout

Default timeout is 60 seconds. For long-running tests:
```bash
-t 120s  # 2 minutes
-t 5m    # 5 minutes
```

### Output Modes

- Default: Compact JSON (one event per line)
- `--pretty`: Formatted JSON (easier to read)

## Phase 2 Features (Current)

The following Phase 2 features are implemented:

1. **Recursive Variable Expansion** - Objects are automatically expanded to depth 2 by default
2. **Collection Preview** - Lists/arrays show count and first N items
3. **Expression Evaluation** - Use `-e` to evaluate arbitrary expressions
4. **'this' Context** - Instance members captured in `this` local
5. **Circular Reference Handling** - Prevents infinite loops in object graphs

## Trace Mode

Trace mode automatically steps through code after hitting a breakpoint, capturing the execution path. This is useful for understanding how code flows through functions, loops, and conditionals.

### Basic Trace

```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  --trace \
  --pretty \
  -t 30s
```

### Trace Options

| Option | Description |
|--------|-------------|
| `--trace` | Enable trace mode |
| `--trace-into` | Use stepIn instead of stepOver (follow into function calls) |
| `--trace-limit <N>` | Maximum steps before stopping (default: 500) |
| `--trace-until <expr>` | Stop when expression evaluates to truthy |
| `--diff-vars` | Show only changed variables in trace steps instead of full dumps |

### Examples

```bash
# Trace up to 50 steps
npx debug-run ./app.dll -a vsdbg \
  -b "Program.cs:42" \
  --trace \
  --trace-limit 50 \
  --pretty

# Trace into function calls
npx debug-run ./app.dll -a vsdbg \
  -b "Program.cs:42" \
  --trace \
  --trace-into \
  --pretty

# Trace until a condition is met
npx debug-run ./app.dll -a vsdbg \
  -b "Program.cs:42" \
  --trace \
  --trace-until "order.Total > 100" \
  --pretty
```

### Trace Events

Trace mode emits these events:

1. `trace_started` - Trace begins after breakpoint hit
   - `startLocation` - where trace began
   - `initialStackDepth` - stack depth at start
   - `traceConfig` - trace configuration

2. `trace_step` - Emitted for each step (lightweight)
   - `stepNumber` - step counter
   - `location` - current file/line/function
   - `stackDepth` - current stack depth
   - `changes` - variable changes since last step (only if `--diff-vars` enabled)

3. `trace_completed` - Trace finished
   - `stopReason` - why trace stopped: `function_return`, `exception`, `breakpoint`, `limit_reached`, `expression_true`
   - `stepsExecuted` - total steps taken
   - `path` - array of all locations visited
   - `locals` - captured variables at final location
   - `evaluations` - expression results (if `-e` specified)

### Stop Conditions

Trace stops when any of these conditions is met:

| Condition | Description |
|-----------|-------------|
| `function_return` | Stepped out of the breakpoint's function |
| `exception` | An exception was thrown |
| `breakpoint` | Hit another breakpoint |
| `limit_reached` | Reached `--trace-limit` steps |
| `expression_true` | `--trace-until` expression became truthy |

## Output Control

Control where output goes and filter out events you don't need.

### Output to File

Write events to a file instead of stdout:

```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  -o debug-output.json \
  --pretty \
  -t 30s
```

### Event Filtering

Filter which event types are emitted using `--include` or `--exclude`:

```bash
# Only emit breakpoint hits and errors
npx debug-run ./app.dll -a vsdbg \
  -b "Program.cs:42" \
  --include breakpoint_hit error session_end \
  --pretty

# Suppress noisy events (exceptions, program output)
npx debug-run ./app.dll -a vsdbg \
  -b "Program.cs:42" \
  --exclude exception_thrown program_output \
  --pretty
```

### Available Event Types

| Event Type | Description |
|------------|-------------|
| `session_start` | Session begins |
| `session_end` | Session ends with summary |
| `process_launched` | Debuggee process started |
| `process_attached` | Attached to running process |
| `process_exited` | Debuggee process exited |
| `breakpoint_set` | Breakpoint configured |
| `breakpoint_hit` | Breakpoint was hit |
| `exception_thrown` | Exception occurred |
| `exception_breakpoint_set` | Exception breakpoint configured |
| `logpoint_hit` | Logpoint triggered |
| `step_completed` | Step operation completed |
| `trace_started` | Trace mode began |
| `trace_step` | Single trace step |
| `trace_completed` | Trace mode finished |
| `program_output` | stdout/stderr from debuggee |
| `error` | Error from debug adapter |
| `assertion_failed` | Assertion violation |

### Output Options

| Option | Description |
|--------|-------------|
| `-o, --output <file>` | Write events to file instead of stdout |
| `--include <types...>` | Only emit these event types |
| `--exclude <types...>` | Suppress these event types |
| `--pretty` | Pretty print JSON output |

## Semantic Variable Diffing

When tracing through code, agents receive full variable snapshots at each step by default. This creates noise - most variables don't change between steps. Variable diffing highlights only the mutations, making it easier to spot cause-and-effect.

### Basic Usage

```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  --trace \
  --diff-vars \
  --pretty \
  -t 30s
```

### Output Format

With `--diff-vars` enabled, `trace_step` events include a `changes` field showing only what changed:

```json
{
  "type": "trace_step",
  "stepNumber": 5,
  "location": { "file": "Program.cs", "line": 72 },
  "stackDepth": 3,
  "changes": [
    {
      "name": "total",
      "changeType": "modified",
      "newValue": { "type": "int", "value": 150 }
    },
    {
      "name": "discount",
      "changeType": "created",
      "newValue": { "type": "double", "value": 0.1 }
    }
  ]
}
```

### Change Types

| Type | Description | Includes |
|------|-------------|----------|
| `created` | Variable appeared (new scope entry or assignment) | `newValue` only |
| `modified` | Variable value changed from previous step | `newValue` only (for token efficiency) |
| `deleted` | Variable went out of scope | `oldValue` only |

### Notes

- The first trace step after a breakpoint hit has no `changes` (baseline established from breakpoint locals)
- When stepping into/out of functions, variables may appear/disappear as expected
- Deep object changes are detected via JSON serialization comparison
- Circular references are handled safely
- Modified variables omit `oldValue` for token efficiency (LLMs typically only need current state)

## Troubleshooting

### "Adapter not installed"

Run `npx debug-run list-adapters` to see what's available.

### Breakpoint not hitting

1. Make sure the path matches your source file location
2. Check that the line number has executable code
3. Verify the program actually reaches that code path

### vsdbg license warning

The message about VS Code/Visual Studio usage is expected - it's informational only.

### netcoredbg crashes (SIGSEGV)

Use vsdbg instead:
```bash
-a vsdbg  # instead of -a netcoredbg
```

## Attach Mode (Debugging Running Processes)

Attach to a running process instead of launching:

```bash
# Start your app (note the PID)
cd samples/aspnet/SampleApi && dotnet run
# Output: SampleApi starting... PID: 12345

# Attach debug-run
npx debug-run --attach --pid 12345 \
  -a vsdbg \
  -b "samples/aspnet/SampleApi/Program.cs:16" \
  -e "svc._orders.Count" \
  --pretty \
  -t 30s
```

### Important Attach Mode Behaviors

1. **Timing matters**: After `process_attached` event, wait 10-15 seconds before triggering the code path. The debugger needs time to fully instrument the process and verify breakpoints.

2. **Breakpoints start as `verified: false`**: This is normal. They become verified when the code path is first hit or the JIT recompiles.

3. **Process survives**: In attach mode, the debuggee keeps running after debug-run exits. This is intentional for long-running services.

4. **Expression evaluation timing**: Expressions are evaluated BEFORE the breakpoint line executes. Variables assigned ON that line will be null/unset.

### Testing Attach Mode with ASP.NET

There's a sample ASP.NET Web API in `samples/aspnet/SampleApi/`:

```bash
# Build and run the sample API
cd samples/aspnet/SampleApi
dotnet build
dotnet run  # Runs on http://localhost:5009

# Good breakpoint locations:
# - Line 16: GET /orders handler
# - Line 23: GET /orders/{id} handler
# - Line 39: POST /orders/{id}/process handler

# Test endpoints:
curl http://localhost:5009/orders
curl -X POST http://localhost:5009/orders/ORD-001/process
```

## Test Debugging (NUnit, xUnit, MSTest)

debug-run supports debugging .NET unit tests with automatic test runner orchestration. This eliminates the manual two-terminal workflow of starting `dotnet test` with `VSTEST_HOST_DEBUG=1` and then attaching.

### Quick Start

```bash
# Build the test project first
cd samples/nunit && dotnet build && cd ../..

# Debug tests with a single command
npx debug-run --test-project samples/nunit \
  -b "samples/nunit/CalculatorTests.cs:57" \
  --pretty \
  -t 60s
```

### How It Works

1. Launches `dotnet test --no-build` with `VSTEST_HOST_DEBUG=1`
2. Parses the testhost PID from the output
3. Automatically attaches the debugger to the testhost process
4. Sets breakpoints and captures variables as normal

### Test Runner Options

| Option | Description |
|--------|-------------|
| `--test-project <path>` | Path to test project directory or .csproj file |
| `--test-filter <filter>` | Filter tests (passed to `dotnet test --filter`) |

### Examples

```bash
# Debug all tests in a project
npx debug-run --test-project samples/nunit \
  -b "samples/nunit/CalculatorTests.cs:57" \
  --pretty

# Debug a specific test
npx debug-run --test-project samples/nunit \
  --test-filter "Add_TwoPositiveNumbers_ReturnsSum" \
  -b "samples/nunit/CalculatorTests.cs:57" \
  --pretty

# Debug with expression evaluation
npx debug-run --test-project samples/nunit \
  -b "samples/nunit/CalculatorTests.cs:57" \
  -e "a" -e "b" -e "result" \
  --pretty

# Debug with tracing
npx debug-run --test-project samples/nunit \
  -b "samples/nunit/CalculatorTests.cs:57" \
  --trace \
  --trace-into \
  --pretty
```

### Good Breakpoint Locations (Sample NUnit Project)

| Line | Location | Description |
|------|----------|-------------|
| 57 | `Add_TwoPositiveNumbers_ReturnsSum` | After variable setup, before calling Add() |
| 12 | `Calculator.Add` | Inside the Add method |
| 31 | `Calculator.Divide` | Inside the Divide method (exception check) |

### Manual Two-Terminal Workflow (Alternative)

If you need more control, you can still use the manual approach:

**Terminal 1:**
```bash
cd samples/nunit
dotnet test --environment "VSTEST_HOST_DEBUG=1" --no-build
# Note the PID from: "Process Id: 12345, Name: testhost"
```

**Terminal 2:**
```bash
npx debug-run --attach --pid 12345 \
  -a vsdbg \
  -b "samples/nunit/CalculatorTests.cs:57" \
  --pretty \
  -t 60s
```

### Notes

- The adapter defaults to `vsdbg` for test debugging (can override with `-a`)
- Build your test project before debugging (`dotnet build`)
- The test runner is automatically cleaned up after the debug session ends

## File Structure

```
src/
├── index.ts          # Entry point
├── cli.ts            # Command-line parsing
├── dap/              # DAP client implementation
├── session/          # Debug session management
│   ├── manager.ts    # Session lifecycle
│   ├── variables.ts  # Variable inspection (Phase 2)
│   └── breakpoints.ts
├── adapters/         # Adapter configurations
├── util/
│   └── test-runner.ts  # Test runner orchestration
└── output/           # Event formatting

samples/
├── dotnet/           # Console app for testing launch mode
│   ├── Program.cs    # Order processing simulation
│   └── SampleApp.csproj
├── python/           # Python app for testing Python debugging
│   └── sample_app.py # Order processing simulation (Python)
├── rust/             # Rust app for testing Rust/LLDB debugging
│   ├── src/main.rs   # Order processing simulation (Rust)
│   └── Cargo.toml
├── typescript/       # TypeScript app for testing JS/TS debugging
│   ├── src/index.ts  # Order processing simulation (TypeScript)
│   └── tsconfig.json
├── nunit/            # NUnit tests for testing test debugging
│   ├── CalculatorTests.cs  # Calculator class + tests
│   └── SampleTests.csproj
└── aspnet/           # Web API for testing attach mode
    └── SampleApi/
        └── Program.cs  # Minimal API with orders endpoints
```

## Adapter Storage Location

Debug adapters installed via `debug-run install-adapter` are stored in:

```
~/.debug-run/adapters/
├── js-debug/        # Node.js/TypeScript debugger
├── netcoredbg/      # .NET debugger (open-source alternative to vsdbg)
└── ...
```

This location:
- Works for npm global installs, npx, and local development
- Survives package updates
- Is user-specific (no root/admin permissions needed)
- Can be overridden with `DEBUG_RUN_HOME` environment variable

## Source Map Path Overrides

When debugging TypeScript or bundled code, breakpoints may fail to bind if source maps aren't configured correctly. Use `--source-map-overrides` to fix path resolution:

### Using Presets

```bash
# For webpack-bundled apps
npx debug-run ./dist/bundle.js -a node \
  -b "src/handler.ts:45" \
  --source-map-overrides webpack \
  --pretty

# For vite-bundled apps
npx debug-run ./dist/index.js -a node \
  -b "src/main.ts:10" \
  --source-map-overrides vite \
  --pretty
```

### Using Custom JSON

```bash
npx debug-run ./dist/bundle.js -a node \
  -b "src/handler.ts:45" \
  --source-map-overrides '{"webpack:///./*": "${workspaceFolder}/*"}' \
  --pretty
```

### Available Presets

| Preset | Description |
|--------|-------------|
| `webpack` | Handles `webpack:///` paths with common patterns |
| `vite` | Handles `/@fs/` paths for Vite builds |
| `esbuild` | Handles `file://` paths for esbuild |

## Source Map Diagnostics

Diagnose source map issues with the `diagnose-sources` command:

```bash
# Scan current directory for .map files
npx debug-run diagnose-sources

# Scan specific directory with verbose output
npx debug-run diagnose-sources ./dist --verbose

# Output as JSON for programmatic use
npx debug-run diagnose-sources ./dist --json

# Test with custom overrides
npx debug-run diagnose-sources ./dist --source-map-overrides webpack
```

### Example Output

```
Source Map Diagnostic Report
========================================

Summary:
  Maps scanned:        3
  Maps valid:          3
  Maps invalid:        0
  Total sources:       15
  Sources resolved:    12
  Sources missing:     3
  Sources w/ content:  0

Top Issues:
  - Source not found: webpack:///./src/utils.ts (2x)
  - Source not found: webpack:///./src/config.ts (1x)
```

## Token Efficiency (LLM Optimization)

debug-run is optimized for consumption by LLMs. Several features reduce token usage without sacrificing debugging utility:

### Automatic Filtering

The following are automatically filtered from variable output to reduce noise:

**Blocked Properties** (reflection metadata that wastes tokens):
- `EqualityContract` - C# record equality contract (often 4KB+ of useless reflection data)
- `CustomAttributes`, `DeclaredConstructors`, `DeclaredMethods`, etc. - System.Type reflection
- `[More]`, `Raw View`, `Static members`, `Non-Public members` - debugger UI artifacts

**Blocked Types** (not expanded):
- `System.Reflection.*` - Reflection metadata
- `System.RuntimeType` - Type information internals
- `System.Guid` - GUID internals

### Measured Impact

On the sample .NET app with C# records:

| Scenario | Before | After | Reduction |
|----------|--------|-------|-----------|
| Basic debugging (3 breakpoints) | 22KB | 10KB | **55%** |
| Trace mode with `--diff-vars` | 453KB | 101KB | **78%** |
| Single breakpoint_hit event | 6.8KB | 2.8KB | **59%** |

### Tips for Minimal Token Usage

1. **Use `--diff-vars` with trace mode** - Only shows changed variables, not full dumps
2. **Use `--no-capture-locals`** - If you only need expression evaluation results
3. **Set lower `--trace-limit`** - Fewer steps = fewer events
4. **Use specific `-e` expressions** - Instead of relying on full variable capture

### Enterprise App Optimizations

Large enterprise applications often have many service dependencies (Logger, Repository, Cache, etc.) that create verbose, repetitive output. debug-run includes three features (all enabled by default) to handle this:

**1. Service Type Compaction** (`--expand-services` to disable)

Types matching common service patterns are shown in compact form instead of fully expanded:
```
// Without compaction (verbose):
"logger": {
  "type": "Logger",
  "value": {
    "_config": {
      "type": "LoggingConfiguration",
      "value": { "MinLevel": "Debug", "EnableConsole": true, ... }
    }
  }
}

// With compaction (default):
"logger": { "type": "Logger", "value": "{Logger}" }
```

Compacted type patterns: `Logger`, `ILogger`, `Repository`, `Service`, `Provider`, `Factory`, `Manager`, `Handler`, `Cache`, `EventBus`, `MetricsCollector`

**2. Null Property Omission** (`--show-null-props` to disable)

Properties with null/undefined values are omitted from output. In enterprise apps with many uninitialized dependencies, this dramatically reduces noise.

**3. Content-Based Deduplication** (`--no-dedupe` to disable)

When the same object content appears multiple times (e.g., the same `FeatureFlags` instance referenced by multiple services), subsequent occurrences show a reference instead of repeating the full content:
```
"discountService._features": { "type": "FeatureFlags", "value": { ... full content ... } }
"loyaltyService._features": { "type": "FeatureFlags", "value": "[see: discountService._features]", "deduplicated": true }
```

**Measured Impact on Enterprise Sample:**

| Scenario | Without Optimizations | With Optimizations | Reduction |
|----------|----------------------|-------------------|-----------|
| Constructor with 15 services | ~12KB | ~2KB | **83%** |
| Method with service dependencies | ~8KB | ~1.5KB | **81%** |

**Override Flags:**
```bash
# Full expansion of service types
npx debug-run ... --expand-services

# Include null properties
npx debug-run ... --show-null-props

# Disable deduplication
npx debug-run ... --no-dedupe
```

## Non-Obvious Implementation Details

### Shell Command Quoting
When using conditional breakpoints with special characters, use single quotes:
```bash
-b 'samples/dotnet/Program.cs:67?order.Total > 100'
```

### vsdbg Handshake
vsdbg requires a cryptographic handshake. The tool handles this automatically via `src/util/vsda-signer.ts` which uses the VS Code extension's signing mechanism.

### DAP Protocol Flow
1. `initialize` → capabilities exchange
2. `setBreakpoints` → configure breakpoints (may be pending)
3. `launch` or `attach` → start/connect to debuggee
4. `configurationDone` → signal ready
5. `stopped` events → breakpoint hits, capture state, `continue`
6. `disconnect` → detach (terminateDebuggee=false for attach mode)
