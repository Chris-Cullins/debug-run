# debug-run: Implementation Plan

A CLI tool that enables AI agents to programmatically debug code - set breakpoints, run programs, inspect variables, and step through execution.

## Overview

### Problem

Agents can write and run code, but when something goes wrong, they're blind. They can only see error messages and stack traces - they can't inspect actual runtime state. Human developers reach for the debugger; agents should too.

### Solution

A CLI tool that speaks the Debug Adapter Protocol (DAP), exposing debugging capabilities through structured JSON output that agents can parse and act on.

### Why DAP?

DAP is the protocol VS Code uses to communicate with debuggers. By implementing a DAP client:
- We get .NET debugging via netcoredbg/vsdbg
- We get Python debugging via debugpy
- We get Node.js debugging via the built-in inspector
- We get C/C++/Rust debugging via lldb-vscode or codelldb
- Any future DAP adapter works automatically

One tool, many languages.

---

## CLI Interface

```bash
# Basic: run with breakpoints, output state when hit
debug-run --adapter netcoredbg \
          --program ./bin/Debug/net8.0/MyApp.dll \
          --breakpoint "src/OrderService.cs:45" \
          --breakpoint "src/OrderService.cs:67" \
          --timeout 30s

# Conditional breakpoint
debug-run --adapter netcoredbg \
          --program ./bin/Debug/net8.0/MyApp.dll \
          --breakpoint "src/OrderService.cs:45?order.Total > 1000"

# Run a test with debugging
debug-run --adapter netcoredbg \
          --test "dotnet test --filter OrderServiceTests.PlaceOrder_ValidatesInventory" \
          --breakpoint "src/OrderService.cs:45" \
          --capture-locals

# Python debugging
debug-run --adapter debugpy \
          --program ./main.py \
          --args "--config=test.yaml" \
          --breakpoint "src/processor.py:123"

# Node.js debugging  
debug-run --adapter node \
          --program ./dist/index.js \
          --breakpoint "src/handler.ts:45"

# Attach to running process
debug-run --adapter netcoredbg \
          --attach --pid 12345 \
          --breakpoint "src/OrderService.cs:45"

# Exception breakpoints
debug-run --adapter netcoredbg \
          --program ./bin/Debug/net8.0/MyApp.dll \
          --break-on-exception "InvalidOperationException" \
          --break-on-exception "ArgumentNullException"

# Step through code from breakpoint
debug-run --adapter netcoredbg \
          --program ./bin/Debug/net8.0/MyApp.dll \
          --breakpoint "src/OrderService.cs:45" \
          --steps 5 \
          --capture-each-step

# Evaluate expressions when breakpoint hits
debug-run --adapter netcoredbg \
          --program ./bin/Debug/net8.0/MyApp.dll \
          --breakpoint "src/OrderService.cs:45" \
          --eval "order.Items.Count" \
          --eval "order.Items.Sum(i => i.Total)" \
          --eval "this._repository"

# Read breakpoints and config from file
debug-run --config debug-session.json

# Interactive mode (for complex debugging sessions)
debug-run --adapter netcoredbg \
          --program ./bin/Debug/net8.0/MyApp.dll \
          --interactive
```

---

## Output Schema

### Event Stream (NDJSON)

The tool outputs newline-delimited JSON events as they occur:

```json
{"type":"session_start","adapter":"netcoredbg","program":"./bin/Debug/net8.0/MyApp.dll","timestamp":"2025-01-15T10:30:00Z"}
{"type":"breakpoint_set","id":1,"file":"src/OrderService.cs","line":45,"verified":true}
{"type":"breakpoint_set","id":2,"file":"src/OrderService.cs","line":67,"verified":true,"condition":"order.Total > 1000"}
{"type":"process_launched","pid":12345}
{"type":"breakpoint_hit","id":1,"thread_id":1,"data":{...}}
{"type":"step_completed","thread_id":1,"location":{...},"data":{...}}
{"type":"process_exited","exit_code":0,"duration_ms":1234}
{"type":"session_end","summary":{...}}
```

### Breakpoint Hit Event

```json
{
  "type": "breakpoint_hit",
  "id": 1,
  "thread_id": 1,
  "timestamp": "2025-01-15T10:30:01.234Z",
  "location": {
    "file": "src/OrderService.cs",
    "line": 45,
    "column": 12,
    "function": "PlaceOrder",
    "module": "MyApp.Services.OrderService"
  },
  "stack_trace": [
    {
      "frame_id": 1000,
      "function": "MyApp.Services.OrderService.PlaceOrder",
      "file": "src/OrderService.cs",
      "line": 45,
      "column": 12,
      "module": "MyApp.dll"
    },
    {
      "frame_id": 1001,
      "function": "MyApp.Controllers.OrderController.Post",
      "file": "src/Controllers/OrderController.cs",
      "line": 23,
      "column": 8,
      "module": "MyApp.dll"
    },
    {
      "frame_id": 1002,
      "function": "Microsoft.AspNetCore.Mvc.Infrastructure.ActionMethodExecutor.Execute",
      "file": null,
      "line": null,
      "module": "Microsoft.AspNetCore.Mvc.Core.dll"
    }
  ],
  "locals": {
    "order": {
      "type": "MyApp.Contracts.OrderDto",
      "value": {
        "Id": "00000000-0000-0000-0000-000000000000",
        "CustomerId": "cust-abc-123",
        "Status": "Pending",
        "Items": {
          "type": "System.Collections.Generic.List<MyApp.Contracts.OrderItemDto>",
          "count": 3,
          "preview": "[OrderItemDto, OrderItemDto, OrderItemDto]"
        },
        "Total": 150.00,
        "CreatedAt": "2025-01-15T10:29:55Z"
      },
      "expandable": true,
      "variables_reference": 2001
    },
    "cancellationToken": {
      "type": "System.Threading.CancellationToken",
      "value": {
        "IsCancellationRequested": false,
        "CanBeCanceled": true
      }
    },
    "this": {
      "type": "MyApp.Services.OrderService",
      "value": {
        "_repository": "<IOrderRepository>",
        "_validator": "<IOrderValidator>",
        "_logger": "<ILogger<OrderService>>"
      },
      "expandable": true,
      "variables_reference": 2002
    }
  },
  "evaluations": {
    "order.Items.Count": {
      "result": "3",
      "type": "int"
    },
    "order.Items.Sum(i => i.Total)": {
      "result": "150.00",
      "type": "decimal"
    }
  }
}
```

### Exception Event

```json
{
  "type": "exception_thrown",
  "thread_id": 1,
  "timestamp": "2025-01-15T10:30:02.567Z",
  "exception": {
    "type": "System.InvalidOperationException",
    "message": "Insufficient inventory for product SKU-001",
    "stack_trace": "   at MyApp.Services.InventoryService.ReserveStock(...)\n   at MyApp.Services.OrderService.PlaceOrder(...)",
    "inner_exception": null
  },
  "location": {
    "file": "src/Services/InventoryService.cs",
    "line": 67,
    "function": "ReserveStock"
  },
  "locals": {
    "productId": {"type": "string", "value": "SKU-001"},
    "requestedQuantity": {"type": "int", "value": 5},
    "availableStock": {"type": "int", "value": 3}
  }
}
```

### Session Summary

```json
{
  "type": "session_end",
  "summary": {
    "duration_ms": 2345,
    "exit_code": 1,
    "breakpoints_hit": 2,
    "exceptions_caught": 1,
    "steps_executed": 5,
    "events": [
      {"type": "breakpoint_hit", "count": 2},
      {"type": "exception_thrown", "count": 1}
    ]
  }
}
```

---

## Architecture

### Language Choice: TypeScript

Rationale:
- DAP client libraries already exist (`vscode-debugadapter`, `@vscode/debugprotocol`)
- Native JSON handling
- Excellent async/await support for handling DAP events
- Can compile to single binary via `bun build --compile` or `pkg`
- Team familiarity (VS Code ecosystem)
- Fast iteration for a tool that's inherently complex

Alternative considered: Go
- Would need to implement DAP client from scratch
- Better for long-term performance
- Could be a future rewrite target

### Project Structure

```
debug-run/
├── src/
│   ├── index.ts                 # Entry point
│   ├── cli.ts                   # Argument parsing (commander)
│   ├── config.ts                # Config file parsing
│   │
│   ├── dap/
│   │   ├── client.ts            # DAP client implementation
│   │   ├── protocol.ts          # DAP message types
│   │   ├── events.ts            # Event handling
│   │   └── transport.ts         # stdin/stdout communication
│   │
│   ├── adapters/
│   │   ├── index.ts             # Adapter registry
│   │   ├── base.ts              # Base adapter interface
│   │   ├── netcoredbg.ts        # .NET adapter config
│   │   ├── debugpy.ts           # Python adapter config
│   │   ├── node.ts              # Node.js adapter config
│   │   └── lldb.ts              # LLDB adapter config
│   │
│   ├── session/
│   │   ├── manager.ts           # Debug session lifecycle
│   │   ├── breakpoints.ts       # Breakpoint management
│   │   ├── variables.ts         # Variable inspection & expansion
│   │   └── stepping.ts          # Step execution control
│   │
│   ├── output/
│   │   ├── formatter.ts         # Output formatting
│   │   ├── events.ts            # Event type definitions
│   │   └── serializer.ts        # JSON serialization
│   │
│   └── util/
│       ├── process.ts           # Process spawning
│       ├── paths.ts             # Path resolution
│       └── timeout.ts           # Timeout handling
│
├── adapters/                    # Adapter binaries/configs
│   └── README.md                # How to install adapters
│
├── test/
│   ├── fixtures/
│   │   ├── dotnet/              # Sample .NET project
│   │   ├── python/              # Sample Python project
│   │   └── node/                # Sample Node project
│   └── integration/
│       ├── dotnet.test.ts
│       ├── python.test.ts
│       └── node.test.ts
│
├── package.json
├── tsconfig.json
└── README.md
```

### Core Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLI Layer                                   │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │   Arg       │  │     Config      │  │         Output              │  │
│  │   Parser    │  │     Loader      │  │         Formatter           │  │
│  └──────┬──────┘  └────────┬────────┘  └──────────────▲──────────────┘  │
│         │                  │                          │                  │
│         └──────────────────┼──────────────────────────┘                  │
│                            ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      Session Manager                              │   │
│  │                                                                   │   │
│  │  • Orchestrates debug session lifecycle                          │   │
│  │  • Coordinates breakpoints, stepping, variable inspection        │   │
│  │  • Handles timeouts and graceful shutdown                        │   │
│  └───────────────────────────┬──────────────────────────────────────┘   │
│                              │                                           │
│                              ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                        DAP Client                                 │   │
│  │                                                                   │   │
│  │  • Sends requests, receives responses and events                 │   │
│  │  • Manages sequence numbers and request correlation              │   │
│  │  • Handles DAP protocol encoding/decoding                        │   │
│  └───────────────────────────┬──────────────────────────────────────┘   │
│                              │                                           │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │ stdin/stdout (DAP JSON)
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         Debug Adapter                                     │
│                  (netcoredbg, debugpy, lldb, etc.)                       │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## DAP Client Implementation

### Transport Layer

DAP uses a simple wire protocol: HTTP-style headers followed by JSON body.

```
Content-Length: 119\r\n
\r\n
{"seq":1,"type":"request","command":"initialize","arguments":{"clientID":"debug-run","adapterID":"coreclr"}}
```

```typescript
// src/dap/transport.ts

export class DapTransport {
  private process: ChildProcess;
  private buffer: Buffer = Buffer.alloc(0);
  private pendingRequests: Map<number, {resolve: Function, reject: Function}> = new Map();
  private eventHandlers: Map<string, (event: DapEvent) => void> = new Map();
  private seq: number = 1;

  constructor(process: ChildProcess) {
    this.process = process;
    this.process.stdout!.on('data', (chunk) => this.onData(chunk));
  }

  async sendRequest<T>(command: string, args?: object): Promise<T> {
    const seq = this.seq++;
    const request = {
      seq,
      type: 'request',
      command,
      arguments: args
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(seq, { resolve, reject });
      this.send(request);
    });
  }

  onEvent(event: string, handler: (event: DapEvent) => void) {
    this.eventHandlers.set(event, handler);
  }

  private send(message: object) {
    const json = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
    this.process.stdin!.write(header + json);
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  private processBuffer() {
    // Parse Content-Length header and extract JSON messages
    // Handle multiple messages in buffer
    // Route to pendingRequests or eventHandlers
  }
}
```

### Session Manager

```typescript
// src/session/manager.ts

export class DebugSession {
  private transport: DapTransport;
  private config: SessionConfig;
  private state: SessionState = 'initializing';

  async start(): Promise<void> {
    // 1. Spawn debug adapter
    const adapterProcess = await this.spawnAdapter();
    this.transport = new DapTransport(adapterProcess);

    // 2. Initialize DAP session
    await this.transport.sendRequest('initialize', {
      clientID: 'debug-run',
      adapterID: this.config.adapter.id,
      pathFormat: 'path',
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: false,
    });

    // 3. Set up event handlers
    this.transport.onEvent('stopped', (e) => this.onStopped(e));
    this.transport.onEvent('terminated', (e) => this.onTerminated(e));
    this.transport.onEvent('exited', (e) => this.onExited(e));
    this.transport.onEvent('output', (e) => this.onOutput(e));

    // 4. Set breakpoints
    await this.setBreakpoints();

    // 5. Set exception breakpoints
    await this.setExceptionBreakpoints();

    // 6. Launch or attach
    if (this.config.attach) {
      await this.attach();
    } else {
      await this.launch();
    }

    // 7. Signal ready to go
    await this.transport.sendRequest('configurationDone');
  }

  private async onStopped(event: StoppedEvent): Promise<void> {
    const threadId = event.body.threadId;
    const reason = event.body.reason; // 'breakpoint', 'step', 'exception', etc.

    // Capture full state
    const stackTrace = await this.getStackTrace(threadId);
    const locals = await this.getLocals(stackTrace.stackFrames[0].id);
    const evaluations = await this.runEvaluations(stackTrace.stackFrames[0].id);

    // Emit event
    this.emit({
      type: reason === 'exception' ? 'exception_thrown' : 'breakpoint_hit',
      thread_id: threadId,
      timestamp: new Date().toISOString(),
      location: this.frameToLocation(stackTrace.stackFrames[0]),
      stack_trace: stackTrace.stackFrames.map(f => this.frameToLocation(f)),
      locals,
      evaluations,
    });

    // Decide what to do next
    if (this.config.steps && this.stepsRemaining > 0) {
      this.stepsRemaining--;
      await this.step(threadId);
    } else if (this.shouldContinue(reason)) {
      await this.continue(threadId);
    }
    // Otherwise, session ends
  }

  private async getLocals(frameId: number): Promise<Record<string, Variable>> {
    const scopes = await this.transport.sendRequest<ScopesResponse>('scopes', { frameId });
    const result: Record<string, Variable> = {};

    for (const scope of scopes.scopes) {
      if (scope.name === 'Locals' || scope.name === 'Arguments') {
        const vars = await this.transport.sendRequest<VariablesResponse>('variables', {
          variablesReference: scope.variablesReference
        });

        for (const v of vars.variables) {
          result[v.name] = await this.expandVariable(v);
        }
      }
    }

    return result;
  }

  private async expandVariable(v: DapVariable, depth: number = 2): Promise<Variable> {
    const variable: Variable = {
      type: v.type || 'unknown',
      value: this.parseValue(v),
      expandable: v.variablesReference > 0,
      variables_reference: v.variablesReference || undefined,
    };

    // Auto-expand objects to reasonable depth
    if (v.variablesReference > 0 && depth > 0) {
      const children = await this.transport.sendRequest<VariablesResponse>('variables', {
        variablesReference: v.variablesReference,
        count: 20 // Limit for sanity
      });

      variable.value = {};
      for (const child of children.variables) {
        variable.value[child.name] = await this.expandVariable(child, depth - 1);
      }
    }

    return variable;
  }
}
```

---

## Adapter Configuration

Each debug adapter has different launch/attach parameters:

```typescript
// src/adapters/netcoredbg.ts

export const netcoredbgAdapter: AdapterConfig = {
  id: 'coreclr',
  name: 'netcoredbg',
  
  command: 'netcoredbg',
  args: ['--interpreter=vscode'],
  
  // How to find/install the adapter
  detect: async () => {
    return await which('netcoredbg').catch(() => null);
  },
  
  installHint: `
    Install netcoredbg:
    - Ubuntu/Debian: apt install netcoredbg
    - macOS: brew install netcoredbg  
    - Manual: https://github.com/Samsung/netcoredbg/releases
  `,
  
  // Build launch configuration
  launchConfig: (opts: LaunchOptions) => ({
    name: '.NET Core Launch',
    type: 'coreclr',
    request: 'launch',
    program: opts.program,
    args: opts.args || [],
    cwd: opts.cwd || path.dirname(opts.program),
    env: opts.env || {},
    stopAtEntry: opts.stopAtEntry || false,
    console: 'internalConsole',
  }),
  
  // Build attach configuration  
  attachConfig: (opts: AttachOptions) => ({
    name: '.NET Core Attach',
    type: 'coreclr',
    request: 'attach',
    processId: opts.pid,
  }),
  
  // Map source paths (for containers, remote debugging)
  pathMappings: (opts) => opts.pathMappings || [],
};
```

```typescript
// src/adapters/debugpy.ts

export const debugpyAdapter: AdapterConfig = {
  id: 'python',
  name: 'debugpy',
  
  command: 'python',
  args: ['-m', 'debugpy.adapter'],
  
  detect: async () => {
    try {
      await exec('python -c "import debugpy"');
      return 'python';
    } catch {
      return null;
    }
  },
  
  installHint: 'pip install debugpy',
  
  launchConfig: (opts) => ({
    name: 'Python Launch',
    type: 'python',
    request: 'launch',
    program: opts.program,
    args: opts.args || [],
    cwd: opts.cwd || path.dirname(opts.program),
    env: opts.env || {},
    stopOnEntry: opts.stopAtEntry || false,
    console: 'internalConsole',
    justMyCode: true,
  }),
};
```

---

## Implementation Phases

### Phase 1: Core DAP Client (MVP)

**Goal:** Connect to netcoredbg, set breakpoints, capture state when hit.

- [ ] DAP transport layer (Content-Length framing)
- [ ] Request/response correlation
- [ ] Event handling
- [ ] Initialize/launch sequence
- [ ] Basic breakpoint setting (file:line)
- [ ] Stack trace capture
- [ ] Local variable inspection (1 level deep)
- [ ] NDJSON output
- [ ] Timeout handling

**Deliverable:**
```bash
debug-run --adapter netcoredbg \
          --program ./bin/Debug/net8.0/MyApp.dll \
          --breakpoint "src/OrderService.cs:45"
# Outputs breakpoint_hit event with stack and locals
```

### Phase 2: Variable Expansion & Evaluation

**Goal:** Deep variable inspection and expression evaluation.

- [ ] Recursive variable expansion (configurable depth)
- [ ] Collection preview (first N items)
- [ ] Expression evaluation at breakpoint
- [ ] Watch expressions
- [ ] "this" context capture
- [ ] Handle circular references

**Deliverable:**
```bash
debug-run ... --eval "order.Items.Count" --eval "order.Total * 1.1"
# Includes evaluations in breakpoint_hit event
```

### Phase 3: Conditional Breakpoints & Exceptions

**Goal:** More control over when to break.

- [ ] Conditional breakpoints (expression-based)
- [ ] Hit count breakpoints
- [ ] Exception breakpoints (by type)
- [ ] Caught vs uncaught exception filtering
- [ ] Logpoints (log without breaking)

**Deliverable:**
```bash
debug-run ... --breakpoint "file.cs:45?order.Total > 1000" \
              --break-on-exception "InvalidOperationException"
```

### Phase 4: Stepping & Flow Control

**Goal:** Step through code, not just stop at breakpoints.

- [ ] Step over (next)
- [ ] Step into
- [ ] Step out
- [ ] Continue
- [ ] Automatic stepping (--steps N)
- [ ] Capture state after each step

**Deliverable:**
```bash
debug-run ... --breakpoint "file.cs:45" --steps 10 --capture-each-step
# Outputs 10 step_completed events with state
```

### Phase 5: Multi-Adapter Support

**Goal:** Support Python, Node.js, and other languages.

- [ ] Adapter abstraction layer
- [ ] debugpy adapter (Python)
- [ ] Node.js inspector adapter
- [ ] Adapter auto-detection
- [ ] Adapter installation guidance

**Deliverable:**
```bash
debug-run --adapter debugpy --program ./main.py --breakpoint "processor.py:45"
debug-run --adapter node --program ./dist/index.js --breakpoint "handler.ts:30"
```

### Phase 6: Test Integration

**Goal:** Debug specific tests easily.

- [ ] `--test` flag that wraps test runners
- [ ] dotnet test integration
- [ ] pytest integration
- [ ] jest/vitest integration
- [ ] Automatic breakpoint on test failure

**Deliverable:**
```bash
debug-run --adapter netcoredbg \
          --test "dotnet test --filter FullyQualifiedName~PlaceOrder" \
          --breakpoint "OrderService.cs:45"
```

### Phase 7: Attach & Advanced Scenarios

**Goal:** Debug running processes and complex scenarios.

- [ ] Attach to process by PID
- [ ] Attach to process by name
- [ ] Multi-process debugging
- [ ] Source mapping for transpiled code
- [ ] Remote debugging (TCP transport)

**Deliverable:**
```bash
debug-run --adapter netcoredbg --attach --pid 12345 --breakpoint "file.cs:45"
```

### Phase 8: Interactive Mode

**Goal:** For complex debugging sessions that need human-in-the-loop or agent iteration.

- [ ] REPL-style interactive mode
- [ ] Accept commands from stdin
- [ ] Continue/step/evaluate on demand
- [ ] Session persistence

**Deliverable:**
```bash
debug-run --adapter netcoredbg --program ./app.dll --interactive
> break src/OrderService.cs:45
> run
[breakpoint hit]
> eval order.Items.Count
3
> step
[stepped to line 46]
> continue
```

---

## Configuration File

For complex debugging sessions, support a config file:

```json
{
  "adapter": "netcoredbg",
  "program": "./bin/Debug/net8.0/MyApp.dll",
  "args": ["--environment", "Test"],
  "cwd": "./src/MyApp",
  "env": {
    "ASPNETCORE_ENVIRONMENT": "Development",
    "LOG_LEVEL": "Debug"
  },
  "breakpoints": [
    {"file": "src/OrderService.cs", "line": 45},
    {"file": "src/OrderService.cs", "line": 67, "condition": "order.Total > 1000"},
    {"file": "src/InventoryService.cs", "line": 23, "hitCount": 3}
  ],
  "exceptionBreakpoints": [
    {"type": "InvalidOperationException"},
    {"type": "ArgumentNullException", "caught": false}
  ],
  "evaluations": [
    "order.Items.Count",
    "order.Total",
    "this._repository.GetType().Name"
  ],
  "options": {
    "timeout": 30000,
    "maxVariableDepth": 3,
    "maxCollectionItems": 10,
    "captureOutput": true,
    "steps": 0
  }
}
```

```bash
debug-run --config debug-session.json
```

---

## Agent Integration Examples

### Example 1: Test Failure Investigation

```
Agent: "Test OrderServiceTests.PlaceOrder_ValidatesInventory is failing with 
        'Insufficient inventory'. Let me debug to understand why."

Agent runs:
  debug-run --adapter netcoredbg \
            --test "dotnet test --filter PlaceOrder_ValidatesInventory" \
            --breakpoint "src/Services/InventoryService.cs:34" \
            --eval "requestedQuantity" \
            --eval "availableStock"

Output:
  {"type":"breakpoint_hit","location":{"file":"InventoryService.cs","line":34,"function":"CheckStock"},
   "locals":{"productId":{"type":"string","value":"SKU-001"},"requestedQuantity":{"type":"int","value":5}},
   "evaluations":{"availableStock":{"result":"3","type":"int"}}}

Agent: "The test requests 5 units of SKU-001 but only 3 are available. 
        I need to either fix the test data to have 5+ units, 
        or the test expectation is wrong."
```

### Example 2: Understanding Control Flow

```
Agent: "I don't understand why the discount isn't being applied. 
        Let me step through the calculation."

Agent runs:
  debug-run --adapter netcoredbg \
            --program ./bin/Debug/net8.0/MyApp.dll \
            --args "--order-id=test-123" \
            --breakpoint "src/Services/PricingService.cs:45" \
            --steps 5 \
            --capture-each-step

Output (sequence):
  {"type":"breakpoint_hit","location":{"line":45,"function":"CalculateTotal"},...}
  {"type":"step_completed","location":{"line":46},"locals":{"subtotal":{"value":100.00}}}
  {"type":"step_completed","location":{"line":47},"locals":{"discountPercent":{"value":0}}}
  {"type":"step_completed","location":{"line":48},"locals":{"discountAmount":{"value":0}}}
  ...

Agent: "I see discountPercent is 0 at line 47. The condition on line 46 
        must not be matching. Let me check the customer's loyalty tier..."
```

### Example 3: Exception Investigation

```
Agent: "Production is throwing NullReferenceException in OrderService. 
        Let me catch it and see the state."

Agent runs:
  debug-run --adapter netcoredbg \
            --program ./bin/Debug/net8.0/MyApp.dll \
            --break-on-exception "NullReferenceException" \
            --eval "this" \
            --eval "order"

Output:
  {"type":"exception_thrown",
   "exception":{"type":"System.NullReferenceException","message":"Object reference not set..."},
   "location":{"file":"OrderService.cs","line":78,"function":"ApplyDiscount"},
   "locals":{"order":{"type":"OrderDto","value":{"CustomerId":"abc","LoyaltyTier":null}}},
   "evaluations":{"order.Customer":{"result":"null","type":"Customer"}}}

Agent: "The order has a CustomerId but order.Customer is null - 
        the customer lookup must have failed silently. 
        I need to add a null check or fix the customer loading."
```

---

## Dependencies

```json
{
  "dependencies": {
    "commander": "^11.0.0",
    "@vscode/debugprotocol": "^1.65.0",
    "glob": "^10.0.0",
    "chalk": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0",
    "vitest": "^1.0.0",
    "bun-types": "^1.0.0"
  }
}
```

Build:
```bash
bun build --compile --target=bun-linux-x64 ./src/index.ts --outfile debug-run
```

---

## Debug Adapter Installation

The tool doesn't bundle debug adapters - they need to be installed separately:

### .NET (netcoredbg)
```bash
# Ubuntu/Debian
apt install netcoredbg

# macOS
brew install netcoredbg

# Windows (scoop)
scoop install netcoredbg

# Manual
# Download from https://github.com/Samsung/netcoredbg/releases
```

### Python (debugpy)
```bash
pip install debugpy
```

### Node.js
```bash
# Built into Node.js - no installation needed
# Uses --inspect protocol
```

---

## Testing Strategy

### Unit Tests
- DAP message parsing
- Variable expansion logic
- Output serialization
- Adapter configuration

### Integration Tests
- End-to-end with real debuggers
- Test fixtures in each language
- Verify breakpoint hits, variable values, stepping

### Test Fixtures

```
test/fixtures/
├── dotnet/
│   ├── TestApp/
│   │   ├── TestApp.csproj
│   │   ├── Program.cs
│   │   └── Services/
│   │       └── Calculator.cs    # Simple methods to debug
│   └── TestApp.sln
├── python/
│   └── calculator.py
└── node/
    ├── package.json
    └── src/
        └── calculator.ts
```

---

## Open Questions

1. **Output verbosity**: How much variable data to include by default? Full expansion can be huge.
2. **Binary distribution**: Bun compile vs pkg vs native executables?
3. **Windows support**: Path handling, adapter locations differ significantly.
4. **Source mapping**: How to handle TypeScript, transpiled code, source maps?
5. **Security**: Should we sanitize variable values that might contain secrets?
6. **Performance**: Large objects can take seconds to serialize - streaming vs batching?

---

## Future Ideas

- **Heap analysis**: Integration with ClrMD for .NET heap inspection
- **Time-travel debugging**: Integration with rr or WinDbg TTD
- **Distributed tracing**: Correlate with OpenTelemetry spans
- **AI-assisted**: Suggest breakpoint locations based on error messages
- **Record & replay**: Save debug sessions for later analysis
