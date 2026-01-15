# debug-run

A CLI tool that enables AI agents to programmatically debug code via the Debug Adapter Protocol (DAP).

## Quick Start

```bash
# Install dependencies
npm install

# Run the CLI (using tsx for development)
npx tsx ./src/index.ts --help

# List available debug adapters
npx tsx ./src/index.ts list-adapters
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
npx tsx ./src/index.ts ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
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
npx tsx ./src/index.ts ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
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
npx tsx ./src/index.ts list-adapters
# Should show: vsdbg - Status: installed (path)
```

### netcoredbg

Open-source alternative. Currently has stability issues on some platforms (SIGSEGV crashes observed on macOS ARM64).

Install manually from: https://github.com/Samsung/netcoredbg/releases

Or use the built-in installer:
```bash
npx tsx ./src/index.ts install-adapter netcoredbg
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

Run `npx tsx ./src/index.ts list-adapters` to see what's available.

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
└── dotnet/           # Sample .NET app for testing
    ├── Program.cs    # Test target with order processing
    └── SampleApp.csproj
```
