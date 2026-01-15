# debug-run

A CLI tool that enables AI agents to programmatically debug code via the Debug Adapter Protocol (DAP).

## Quick Start

```bash
# Install dependencies (automatically builds)
npm install

# Run the CLI
npx debug-run --help

# List available debug adapters
npx debug-run list-adapters
```

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
5. `process_exited` - Program finished
6. `session_end` - Summary with statistics

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

For Python debugging:
```bash
pip install debugpy
```

## Important Notes

### Breakpoint Paths

Breakpoint paths should be relative to the working directory:
- Good: `-b "samples/dotnet/Program.cs:67"`
- Bad: `-b "Program.cs:67"` (won't resolve correctly)

### Adapter Selection

- Use `-a vsdbg` for .NET (most stable)
- Use `-a netcoredbg` only if vsdbg isn't available
- Use `-a debugpy` for Python

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
└── output/           # Event formatting

samples/
├── dotnet/           # Console app for testing launch mode
│   ├── Program.cs    # Order processing simulation
│   └── SampleApp.csproj
└── aspnet/           # Web API for testing attach mode
    └── SampleApi/
        └── Program.cs  # Minimal API with orders endpoints
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
