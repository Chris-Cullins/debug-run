# debug-run

A CLI tool that enables AI agents to programmatically debug code via the [Debug Adapter Protocol (DAP)](https://microsoft.github.io/debug-adapter-protocol/).

## Why?

Agents can write and run code, but when something goes wrong, they're blind. They can only see error messages and stack traces—they can't inspect actual runtime state. Human developers reach for the debugger; agents should too.

**debug-run** exposes debugging capabilities through structured JSON output that agents can parse and act on.

## Features

- **Multi-language support**: .NET, Python, Node.js, C/C++/Rust (via LLDB)
- **Breakpoints**: Line, conditional (`file:line?condition`), hit count (`file:line#count`)
- **Exception breakpoints**: Break on thrown/uncaught exceptions
- **Variable inspection**: Automatic recursive expansion of locals and `this`
- **Expression evaluation**: Evaluate arbitrary expressions at breakpoints
- **Stepping**: Step over, step into, step out with state capture
- **Logpoints**: Log messages without breaking execution
- **Structured output**: NDJSON event stream for easy parsing

## Installation

```bash
# Clone and install
git clone https://github.com/Chris-Cullins/debug-run.git
cd debug-run
npm install

# Run via tsx (development)
npx tsx ./src/index.ts --help

# Or build and run
npm run build
node dist/index.js --help
```

## Quick Start

### List available adapters

```bash
npx tsx ./src/index.ts list-adapters
```

### Debug a .NET application

```bash
npx tsx ./src/index.ts ./bin/Debug/net8.0/MyApp.dll \
  -a dotnet \
  -b "src/OrderService.cs:45" \
  --pretty
```

### Debug Python

```bash
npx tsx ./src/index.ts ./main.py \
  -a python \
  -b "processor.py:123" \
  -e "data.count" \
  --pretty
```

### Debug Node.js

```bash
npx tsx ./src/index.ts ./dist/index.js \
  -a node \
  -b "src/handler.ts:30" \
  --pretty
```

## CLI Reference

```
Usage: debug-run [options] [command] [program]

Arguments:
  program                           Program to debug

Options:
  -a, --adapter <name>              Debug adapter (dotnet, python, node, lldb)
  --args <args...>                  Arguments to pass to the program
  --cwd <path>                      Working directory for the program
  -b, --breakpoint <spec...>        Breakpoint specs (file:line, file:line?cond, file:line#count)
  -e, --eval <expr...>              Expressions to evaluate at breakpoints
  -l, --logpoint <spec...>          Logpoints (file:line|message with {expr})
  --break-on-exception <filter...>  Break on exceptions (all, uncaught, user-unhandled)
  -t, --timeout <duration>          Session timeout (default: 60s)
  --capture-locals                  Capture local variables (default: true)
  --pretty                          Pretty print JSON output
  -s, --steps <count>               Steps to execute after breakpoint hit
  --capture-each-step               Capture state at each step
  --env <key=value...>              Environment variables

Commands:
  list-adapters                     List available debug adapters
  install-adapter <name>            Install a debug adapter
```

## Breakpoint Syntax

```bash
# Simple line breakpoint
-b "src/file.cs:45"

# Conditional breakpoint (break when condition is true)
-b "src/file.cs:45?order.Total > 1000"

# Hit count breakpoint (break on Nth hit)
-b "src/file.cs:45#3"

# Logpoint (log without breaking)
-l "src/file.cs:45|Processing order {order.Id} with total {order.Total}"
```

## Output Format

debug-run outputs newline-delimited JSON (NDJSON) events:

```json
{"type":"session_start","timestamp":"...","adapter":"dotnet","program":"./app.dll"}
{"type":"breakpoint_set","id":1,"file":"src/Service.cs","line":45,"verified":true}
{"type":"process_launched","timestamp":"..."}
{"type":"breakpoint_hit","id":1,"threadId":1,"location":{...},"locals":{...},"evaluations":{...}}
{"type":"process_exited","exitCode":0}
{"type":"session_end","summary":{"breakpointsHit":1,"duration":1234}}
```

### Breakpoint Hit Event

```json
{
  "type": "breakpoint_hit",
  "id": 1,
  "threadId": 1,
  "timestamp": "2025-01-15T10:30:01.234Z",
  "location": {
    "file": "src/OrderService.cs",
    "line": 45,
    "function": "ProcessOrder"
  },
  "stackTrace": [...],
  "locals": {
    "order": {
      "type": "OrderDto",
      "value": {
        "Id": "abc-123",
        "Total": 150.00,
        "Items": {"type": "List<Item>", "count": 3, "items": [...]}
      }
    },
    "this": {...}
  },
  "evaluations": {
    "order.Items.Count": {"result": "3", "type": "int"}
  }
}
```

## Supported Debug Adapters

| Adapter | Languages | Installation |
|---------|-----------|--------------|
| `dotnet` / `vsdbg` | C#, F#, VB.NET | VS Code C# extension (auto-detected) |
| `netcoredbg` | C#, F#, VB.NET | `debug-run install-adapter netcoredbg` |
| `python` / `debugpy` | Python | `pip install debugpy` |
| `node` | JavaScript, TypeScript | VS Code (js-debug built-in) |
| `lldb` | C, C++, Rust, Swift | Xcode CLI tools or LLVM |

### Checking adapter status

```bash
$ npx tsx ./src/index.ts list-adapters

Available debug adapters:

  dotnet
    ID: coreclr
    Status: ✓ installed (/path/to/vsdbg)

  debugpy
    ID: python
    Status: ✓ installed (python3)

  node
    ID: pwa-node
    Status: ✗ not installed

  lldb
    ID: lldb
    Status: ✗ not installed
```

## Examples

### Investigate a test failure

```bash
npx tsx ./src/index.ts ./bin/Debug/net8.0/TestApp.dll \
  -a dotnet \
  -b "src/InventoryService.cs:34" \
  -e "requestedQuantity" \
  -e "availableStock" \
  --pretty
```

### Step through code

```bash
npx tsx ./src/index.ts ./app.dll \
  -a dotnet \
  -b "src/PricingService.cs:45" \
  --steps 10 \
  --capture-each-step \
  --pretty
```

### Break on exceptions

```bash
npx tsx ./src/index.ts ./app.dll \
  -a dotnet \
  --break-on-exception "all" \
  --pretty
```

### Conditional breakpoint

```bash
npx tsx ./src/index.ts ./app.dll \
  -a dotnet \
  -b "src/OrderService.cs:67?order.Total > 1000" \
  --pretty
```

## Agent Integration

debug-run is designed for AI agents to use programmatically:

```python
import subprocess
import json

result = subprocess.run([
    "npx", "tsx", "./src/index.ts",
    "./bin/Debug/net8.0/MyApp.dll",
    "-a", "dotnet",
    "-b", "src/Service.cs:45",
    "-e", "order.Total",
    "-t", "30s"
], capture_output=True, text=True)

for line in result.stdout.strip().split('\n'):
    event = json.loads(line)
    if event['type'] == 'breakpoint_hit':
        print(f"Hit breakpoint at {event['location']['file']}:{event['location']['line']}")
        print(f"Locals: {event['locals']}")
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npx tsx ./src/index.ts [args...]

# Type check
npm run typecheck

# Build
npm run build

# Run tests
npm test
```

## Architecture

```
src/
├── index.ts          # Entry point
├── cli.ts            # Command-line parsing
├── dap/              # DAP client implementation
│   ├── client.ts     # Main DAP client
│   ├── transport.ts  # Content-Length framing
│   └── protocol.ts   # DAP message types
├── session/          # Debug session management
│   ├── manager.ts    # Session lifecycle
│   ├── variables.ts  # Variable inspection
│   └── breakpoints.ts
├── adapters/         # Debug adapter configurations
│   ├── base.ts       # Adapter interface
│   ├── debugpy.ts    # Python
│   ├── node.ts       # Node.js
│   ├── lldb.ts       # LLDB
│   └── ...
└── output/           # Event formatting
```

## License

MIT
