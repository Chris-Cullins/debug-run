# js-debug Bootloader Path Issue

## Problem Summary

When running `debug-run` with the `node` adapter on TypeScript/JavaScript samples, the debug session fails with:

```
Error: Cannot find module '/Users/chriscullins/gt/debug_run/polecats/chrome/bin/adapters/js-debug/src/bootloader.js'
```

The path `/Users/chriscullins/gt/debug_run/polecats/chrome/` is a **stale Gas Town polecat worktree path** that no longer exists.

## What Works

- **.NET debugging (vsdbg)**: Works correctly
- **Breakpoint validation (commit ea35799)**: Works correctly
- **Adapter detection**: Shows correct path `/Users/chriscullins/src/bin/adapters/js-debug/src/dapDebugServer.js`

## Investigation Findings

### 1. The js-debug adapter is correctly installed

```
/Users/chriscullins/src/bin/adapters/js-debug/src/dapDebugServer.js
/Users/chriscullins/src/bin/adapters/js-debug/src/bootloader.js  ← EXISTS
```

Reinstalling with `npx . install-adapter node` downloads a fresh copy (v1.105.0) with no stale paths.

### 2. The stale path is NOT in the adapter files

Grepping for "polecats" in:
- `/Users/chriscullins/src/bin/adapters/js-debug/` - **Not found**
- `/Users/chriscullins/src/debug-run/dist/` - **Not found**
- Environment variables - **Not found**

### 3. How js-debug constructs the bootloader path

In `dapDebugServer.js`, the bootloader path is calculated at runtime:

```javascript
xN = (0, bS.join)(__dirname, "bootloader.js")
```

Where `__dirname` is the directory containing `dapDebugServer.js`.

### 4. The path is injected via NODE_OPTIONS

When js-debug launches the target program, it sets `NODE_OPTIONS` with `--require <bootloader-path>`. The bootloader enables child process auto-attach.

### 5. The mystery: Where does the stale path come from?

The spawned dapDebugServer.js is at:
```
/Users/chriscullins/src/bin/adapters/js-debug/src/dapDebugServer.js
```

So `__dirname` should be:
```
/Users/chriscullins/src/bin/adapters/js-debug/src/
```

But the error shows:
```
/Users/chriscullins/gt/debug_run/polecats/chrome/bin/adapters/js-debug/src/bootloader.js
```

## Root Cause Found

**The issue was a stale js-debug server process running on port 8177.**

debug-run uses a fixed port (8177) for js-debug connections. When spawning a new js-debug server, if a server is already listening on that port from a previous debug session (or a different worktree), the new spawn succeeds but we connect to the OLD server via the socket.

The stale server was from an old "polecats/chrome" worktree that no longer exists:
```
node /Users/chriscullins/gt/debug_run/polecats/chrome/bin/adapters/js-debug/src/dapDebugServer.js 8177
```

That stale server's `__dirname` still points to the old path, so when it injects `NODE_OPTIONS=--require <bootloader>`, it uses the stale bootloader path.

### Detection

Run `ps aux | grep js-debug` to find stale servers:
```bash
$ ps aux | grep js-debug
chriscullins  17846  0.0  0.4 ... node /Users/chriscullins/gt/debug_run/polecats/chrome/bin/adapters/js-debug/src/dapDebugServer.js 8177
```

### Fix

Kill the stale process:
```bash
kill 17846
```

Or kill all js-debug servers:
```bash
pkill -f dapDebugServer.js
```

## Potential Improvements

1. **Use a random/dynamic port** instead of fixed 8177, to avoid port conflicts
2. **Check if port is already in use** before spawning and either kill the old server or pick a different port
3. **Include PID verification** - after spawning, verify the server we connect to matches the PID we spawned

## Related Fix: Breakpoint Path Resolution

After fixing the stale server issue, breakpoints still weren't hitting because of a bug in breakpoint path resolution.

### Problem

When `--cwd` wasn't explicitly provided, breakpoint paths like `samples/typescript/src/index.ts` were being resolved relative to the program directory (`samples/typescript/dist/`) instead of the working directory where debug-run was invoked.

This resulted in incorrect paths like:
```
/Users/chriscullins/src/debug-run/samples/typescript/dist/samples/typescript/src/index.ts
```

### Fix

Changed `resolveBreakpointPath()` to always resolve against `process.cwd()` when no explicit `cwd` is provided, ignoring the `programPath` fallback. This is the most intuitive behavior since users specify breakpoints relative to their repo root (where they run debug-run).

## Original Hypotheses (For Reference)

### Hypothesis A: Another js-debug instance is being used

There's another js-debug at:
```
/Users/chriscullins/gt/debug_run/crew/bin/adapters/js-debug/src/dapDebugServer.js
```

But this path doesn't match the error path (`crew` vs `polecats/chrome`).

### Hypothesis B: getAdaptersDir() has a bundling bug

The `getAdaptersDir()` function uses:
```typescript
const currentFilePath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(currentFilePath), '..', '..');
return path.join(packageRoot, 'bin', 'adapters');
```

When bundled to `dist/index.cjs`, going up 2 levels from `debug-run/dist/` goes to `/Users/chriscullins/src/` instead of `/Users/chriscullins/src/debug-run/`.

**However**, this results in `/Users/chriscullins/src/bin/adapters/` which is correct!

### Hypothesis C: Cached/stale state somewhere ✓ CONFIRMED

Possibilities:
- A stale Unix domain socket or IPC pipe
- Cached NODE_OPTIONS from a previous debug session
- **A stale js-debug server running on the fixed port** ← THIS WAS IT

## Reproduction Steps

```bash
cd /Users/chriscullins/src/debug-run

# Build TypeScript sample
cd samples/typescript && npm run build && cd ../..

# Run debug-run (fails)
npx . samples/typescript/dist/index.js -a node -b "samples/typescript/src/index.ts:177" --pretty -t 30s
```

## Workarounds Tried

1. **Reinstall js-debug**: `rm -rf ~/src/bin/adapters/js-debug && npx . install-adapter node` - **Did not fix**
2. **Clean environment**: `env -i HOME=$HOME PATH=$PATH npx . ...` - **Did not fix**

## Next Steps to Investigate

1. **Add debug logging** to see what command and args are actually being passed to spawn the dapDebugServer
2. **Check if there's a symlink** somewhere that redirects to the old path
3. **Trace the actual spawn call** to verify which dapDebugServer.js file is being executed
4. **Check if js-debug caches** the bootloader path in a temp file or IPC mechanism
5. **Look for VS Code auto-attach** interference (the path structure suggests VS Code's js-debug extension may be involved)

## Related Files

- `src/util/adapter-installer.ts` - `getAdaptersDir()`, `getJsDebugPath()`
- `src/adapters/node.ts` - Node adapter configuration
- `src/dap/socket-client.ts` - DAP server spawning logic

## Environment

- macOS darwin arm64
- Node.js v24.5.0
- debug-run v0.1.0
- js-debug v1.105.0
