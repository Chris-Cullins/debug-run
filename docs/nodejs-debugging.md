# Node.js/TypeScript Debugging Support

This document describes the implementation of Node.js and TypeScript debugging support in debug-run.

## Overview

debug-run now supports debugging Node.js and TypeScript applications using Microsoft's [js-debug](https://github.com/microsoft/vscode-js-debug) - the same debugger used by VS Code.

## Installation

Install the js-debug adapter:

```bash
npx debug-run install-adapter node
```

This downloads the standalone DAP version of js-debug from GitHub releases and installs it to `bin/adapters/js-debug/`.

## Usage

```bash
# Debug a JavaScript file
npx debug-run app.js -a node -b "app.js:10" --pretty

# Debug a TypeScript file (compiled with source maps)
npx debug-run dist/index.js -a node -b "src/index.ts:50" --pretty
```

## Architecture

### Socket-based DAP Communication

Unlike vsdbg and debugpy which use stdin/stdout for DAP communication, js-debug uses TCP sockets. This required new transport infrastructure:

- `src/dap/socket-transport.ts` - TCP socket-based DAP message transport
- `src/dap/socket-client.ts` - DAP client that spawns js-debug server and connects via socket
- `src/dap/client-interface.ts` - Common interface (`IDapClient`) implemented by both stdio and socket clients

### Node Adapter Configuration

The node adapter (`src/adapters/node.ts`) is configured to:

1. Detect installed js-debug in `bin/adapters/js-debug/`
2. Use socket transport on port 8177
3. Launch the js-debug DAP server (`dapDebugServer.js`)
4. Connect to it via TCP socket

### Key Differences from Other Adapters

| Aspect | vsdbg/debugpy | js-debug |
|--------|---------------|----------|
| Transport | stdin/stdout | TCP socket |
| `initialized` event | After initialize response | After launch request |
| Breakpoint verification | Immediate | Deferred (provisional) |

## Sample TypeScript App

A sample TypeScript application is provided at `samples/typescript/`:

```bash
cd samples/typescript
npm install
npm run build
cd ../..

npx debug-run samples/typescript/dist/index.js -a node \
  -b "samples/typescript/src/index.ts:165" --pretty
```

The sample includes:
- Order processing simulation
- Multiple classes and interfaces
- Error handling examples
- Good breakpoint targets documented in comments

## Multi-Session Architecture

js-debug uses a parent-child session model for debugging:

1. **Parent Session**: Handles initial launch request
2. **Child Session**: Performs actual runtime debugging

When you launch a Node.js program, js-debug:
1. Starts a parent DAP session
2. Spawns the Node.js process
3. Sends a `startDebugging` reverse request asking the client to create a child session
4. The child session attaches to the actual Node.js runtime

### How debug-run Handles This

debug-run implements full multi-session support:

1. When `startDebugging` is received, a new socket connection is created to js-debug
2. The child session is initialized with the same breakpoint configurations
3. Events from the child session (stopped, terminated, etc.) are forwarded to the main event emitter
4. Debugging operations (stackTrace, variables, continue) are routed through the child transport

### Debug Logging

Enable debug logging to see DAP message flow:

```bash
DEBUG_DAP=1 npx debug-run app.js -a node -b "app.js:10" --pretty
```

This shows sent/received DAP messages including child session creation:
```
[DAP send] request:initialize
[DAP recv] response:initialize:true
[DAP send] request:setBreakpoints
[DAP recv] event:initialized
[DAP recv] response:setBreakpoints:true
[DAP send] request:configurationDone
[DAP recv] response:configurationDone:true
[DAP send] request:launch
[DAP recv] request:startDebugging  # Child session requested
[DAP] Creating child session for js-debug
[DAP child] Connected to js-debug
...
```

## Files Changed

- `src/adapters/base.ts` - Added `TransportType` and socket configuration to `AdapterConfig`
- `src/adapters/node.ts` - Updated to use socket transport and detect js-debug
- `src/dap/socket-transport.ts` - New file for TCP socket DAP transport
- `src/dap/socket-client.ts` - New file for socket-based DAP client
- `src/dap/client-interface.ts` - New file defining `IDapClient` interface
- `src/session/manager.ts` - Updated to use socket client for socket-based adapters
- `src/session/breakpoints.ts` - Updated to use `IDapClient` interface
- `src/session/variables.ts` - Updated to use `IDapClient` interface
- `src/session/exceptions.ts` - Updated to use `IDapClient` interface
- `src/util/adapter-installer.ts` - Added js-debug installer functions
- `src/cli.ts` - Added `install-adapter node` command support
- `samples/typescript/` - New sample TypeScript application
