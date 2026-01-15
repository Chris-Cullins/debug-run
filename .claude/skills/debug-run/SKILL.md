---
name: debug-run
description: Programmatically debug code using debug-run CLI with DAP. Use when debugging .NET or Python applications, setting breakpoints, capturing variables, evaluating expressions, or attaching to running processes.
---

# debug-run Debugging Skill

Use the `debug-run` CLI tool to programmatically debug applications via the Debug Adapter Protocol (DAP). This skill enables you to set breakpoints, capture variable state, and evaluate expressions without interactive debugger sessions.

## When to Use This Skill

- Debugging .NET applications (using vsdbg adapter)
- Debugging Python applications (using debugpy adapter)
- Capturing runtime state at specific code locations
- Evaluating expressions to inspect object properties
- Attaching to running processes for live debugging

## Prerequisites

Ensure debug-run is installed in the project:

```bash
npm install  # in the debug-run directory
```

Check available adapters:

```bash
npx debug-run list-adapters
```

## Launch Mode (Debug New Process)

### Basic Usage

```bash
npx debug-run <program> -a <adapter> -b "<file:line>" [options]
```

### .NET Example

```bash
npx debug-run ./bin/Debug/net8.0/MyApp.dll \
  -a vsdbg \
  -b "src/Services/OrderService.cs:42" \
  --pretty \
  -t 30s
```

### Python Example

```bash
npx debug-run ./main.py \
  -a debugpy \
  -b "src/processor.py:25" \
  --pretty \
  -t 30s
```

### With Expression Evaluation

```bash
npx debug-run ./bin/Debug/net8.0/MyApp.dll \
  -a vsdbg \
  -b "src/Services/OrderService.cs:42" \
  -e "order.Total" \
  -e "order.Items.Count" \
  -e "this._repository" \
  --pretty
```

## Attach Mode (Debug Running Process)

For long-running services like web APIs:

```bash
npx debug-run --attach --pid <PID> \
  -a vsdbg \
  -b "src/Controllers/OrderController.cs:28" \
  -e "request.OrderId" \
  --pretty \
  -t 60s
```

**Important**: After attaching, wait 10-15 seconds before triggering the code path. The debugger needs time to instrument the process.

## Trace Mode (Follow Execution Path)

Trace mode automatically steps through code after hitting a breakpoint, capturing the execution path. Use this to understand how code flows through functions, loops, and conditionals.

### Basic Trace

```bash
npx debug-run ./bin/Debug/net8.0/MyApp.dll \
  -a vsdbg \
  -b "src/Services/OrderService.cs:42" \
  --trace \
  --pretty \
  -t 30s
```

### Trace Into Function Calls

```bash
npx debug-run ./bin/Debug/net8.0/MyApp.dll \
  -a vsdbg \
  -b "src/Services/OrderService.cs:42" \
  --trace \
  --trace-into \
  --trace-limit 100 \
  --pretty
```

### Trace Until Condition

```bash
npx debug-run ./bin/Debug/net8.0/MyApp.dll \
  -a vsdbg \
  -b "src/Services/OrderService.cs:42" \
  --trace \
  --trace-until "order.Total > 100" \
  --pretty
```

### Trace Output Events

- `trace_started` - Trace begins (includes config)
- `trace_step` - Each step location (lightweight)
- `trace_completed` - Trace finished with:
  - `stopReason`: `function_return`, `exception`, `breakpoint`, `limit_reached`, `expression_true`
  - `path`: Array of all locations visited
  - `locals`: Variables at final location

## Options Reference

| Option | Description |
|--------|-------------|
| `-a, --adapter <name>` | Debug adapter: `vsdbg` (recommended for .NET), `debugpy` (Python) |
| `-b, --breakpoint <loc>` | Breakpoint location as `file:line` (can specify multiple) |
| `-e, --eval <expr>` | Expression to evaluate at breakpoints (can specify multiple) |
| `-t, --timeout <time>` | Timeout duration: `30s`, `2m`, `5m` (default: 60s) |
| `--pretty` | Pretty-print JSON output |
| `--attach` | Attach to running process instead of launching |
| `--pid <id>` | Process ID for attach mode |
| `--trace` | Enable trace mode - step through code after breakpoint |
| `--trace-into` | Use stepIn instead of stepOver (follow into functions) |
| `--trace-limit <N>` | Max steps in trace mode (default: 500) |
| `--trace-until <expr>` | Stop trace when expression is truthy |

## Output Format

debug-run outputs NDJSON events. Key event types:

### breakpoint_hit

```json
{
  "event": "breakpoint_hit",
  "timestamp": "...",
  "data": {
    "location": {
      "file": "src/Services/OrderService.cs",
      "line": 42,
      "function": "ProcessOrder"
    },
    "stackTrace": [...],
    "locals": {
      "order": {
        "type": "Order",
        "value": {...}
      },
      "this": {...}
    },
    "evaluations": {
      "order.Total": { "value": "125.50" },
      "order.Items.Count": { "value": "3" }
    }
  }
}
```

### Other Events

- `session_start` - Debug session initialized
- `breakpoint_set` - Breakpoint configured (check `verified` field)
- `process_launched` / `process_attached` - Debuggee started/connected
- `process_exited` - Program terminated
- `session_end` - Summary with statistics

## Best Practices

1. **Use relative paths for breakpoints**: `-b "src/MyFile.cs:42"` not `-b "MyFile.cs:42"`

2. **Adapter selection**:
   - .NET: Use `vsdbg` (most stable, requires VS Code C# extension)
   - Python: Use `debugpy` (requires `pip install debugpy`)

3. **Expression timing**: Expressions evaluate BEFORE the breakpoint line executes. Variables assigned on that line will be null/unset.

4. **Unverified breakpoints**: In attach mode, breakpoints start as `verified: false`. This is normal; they verify when the code path is hit.

5. **Long-running processes**: Use appropriate timeouts (`-t 5m`) and trigger the code path while debug-run is waiting.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Adapter not installed" | Run `list-adapters` to check; install VS Code C# extension for vsdbg |
| Breakpoint not hitting | Verify path is relative to working directory and line has executable code |
| vsdbg license warning | Informational only, can be ignored |
| netcoredbg SIGSEGV | Use vsdbg instead (`-a vsdbg`) |

## Example Workflow

1. **Identify the code location** to debug
2. **Build the application** if needed (`dotnet build`, etc.)
3. **Run debug-run** with breakpoint and expressions
4. **Parse the JSON output** to extract variable values
5. **Iterate** with additional breakpoints or expressions as needed

```bash
# Example: Debug a failing order calculation
npx debug-run ./bin/Debug/net8.0/OrderProcessor.dll \
  -a vsdbg \
  -b "src/Calculator.cs:89" \
  -e "subtotal" \
  -e "taxRate" \
  -e "discount" \
  -e "this._config" \
  --pretty \
  -t 30s
```
