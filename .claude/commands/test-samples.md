# Full Sample App Testing

Run comprehensive manual tests across all debug-run sample applications. This validates that the CLI works correctly with all supported debug adapters and modes.

## Prerequisites

Before testing, ensure all adapters are available:

```bash
npx debug-run list-adapters
```

Expected: vsdbg, debugpy/python, lldb/rust should show as installed.

Build the project:
```bash
npm run build
```

---

## 1. .NET Sample (samples/dotnet)

### Setup
```bash
cd samples/dotnet && dotnet build && cd ../..
```

### Basic Breakpoint Test
```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] `session_start` event appears
- [ ] `breakpoint_set` with `verified: true`
- [ ] `breakpoint_hit` with `locals` containing `order`, `this`
- [ ] `process_exited` with exit code 0
- [ ] `session_end` with statistics

### Expression Evaluation
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

**Verify:**
- [ ] `evaluations` field in `breakpoint_hit` contains all 3 expressions
- [ ] Values are numeric (not errors)

### Assertions
```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  --assert "order.Total >= 0" \
  --assert "order.Items.Count > 0" \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] No `assertion_failed` events (assertions pass)
- [ ] Session completes normally

### Trace Mode
```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  --trace \
  --trace-limit 20 \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] `trace_started` event after breakpoint hit
- [ ] Multiple `trace_step` events with incrementing `stepNumber`
- [ ] `trace_completed` with `stopReason` (likely `limit_reached` or `function_return`)

### Trace with Variable Diffing
```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  --trace \
  --trace-limit 20 \
  --diff-vars \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] `trace_step` events have `changes` array (may be empty if no changes)
- [ ] Changes show `changeType`: `created`, `modified`, or `deleted`

---

## 2. Python Sample (samples/python)

### Basic Breakpoint Test
```bash
npx debug-run samples/python/sample_app.py \
  -a python \
  -b "samples/python/sample_app.py:185" \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] `breakpoint_set` event (may show `verified: false` initially, verifies on hit)
- [ ] `breakpoint_hit` with Python locals (check for `order`, `subtotal`, etc.)
- [ ] Python dataclass fields are expanded

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

**Verify:**
- [ ] `evaluations` contains results for all expressions
- [ ] No evaluation errors

---

## 3. Rust Sample (samples/rust)

### Setup
```bash
cd samples/rust && cargo build && cd ../..
```

### Basic Breakpoint Test
```bash
npx debug-run ./samples/rust/target/debug/sample_app \
  -a rust \
  -b "samples/rust/src/main.rs:250" \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] LLDB adapter connects successfully
- [ ] `breakpoint_hit` with Rust types (e.g., `sample_app::Order`)
- [ ] Enum variants display correctly (e.g., `loyalty_tier: "Gold"`)

### Expression Evaluation
```bash
npx debug-run ./samples/rust/target/debug/sample_app \
  -a rust \
  -b "samples/rust/src/main.rs:250" \
  -e "final_total" \
  -e "customer.loyalty_tier" \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] Expressions evaluate without errors
- [ ] Rust-specific types are readable

---

## 4. TypeScript Sample (samples/typescript)

### Setup
```bash
cd samples/typescript && npm install && npm run build && cd ../..
```

### Basic Breakpoint Test
```bash
npx debug-run ./samples/typescript/dist/index.js \
  -a node \
  -b "samples/typescript/src/index.ts:100" \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] Source maps work (breakpoint set in .ts file, hits in .js)
- [ ] `breakpoint_hit` shows TypeScript source location
- [ ] JavaScript objects are properly expanded

### Expression Evaluation
```bash
npx debug-run ./samples/typescript/dist/index.js \
  -a node \
  -b "samples/typescript/src/index.ts:100" \
  -e "order.total" \
  -e "order.items.length" \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] Expressions evaluate correctly
- [ ] Object property access works

---

## 5. ASP.NET Attach Mode (samples/aspnet)

### Setup (Terminal 1)
```bash
cd samples/aspnet/SampleApi && dotnet build && dotnet run
# Note the PID from output: "SampleApi starting... PID: XXXXX"
# Server runs on http://localhost:5009
```

### Attach Test (Terminal 2)
```bash
npx debug-run --attach --pid <PID> \
  -a vsdbg \
  -b "samples/aspnet/SampleApi/Program.cs:16" \
  --pretty \
  -t 60s
```

Then trigger the breakpoint (Terminal 3):
```bash
curl http://localhost:5009/orders
```

**Verify:**
- [ ] `process_attached` event (not `process_launched`)
- [ ] Breakpoint starts as `verified: false`, becomes verified on hit
- [ ] `breakpoint_hit` occurs after curl request
- [ ] Process continues running after debug-run exits

### Expression Evaluation in Attach Mode
```bash
npx debug-run --attach --pid <PID> \
  -a vsdbg \
  -b "samples/aspnet/SampleApi/Program.cs:16" \
  -e "svc._orders.Count" \
  --pretty \
  -t 60s
```

**Verify:**
- [ ] Expression evaluates after breakpoint hit
- [ ] Service instance is accessible via `svc`

---

## 6. NUnit Test Debugging (samples/nunit)

### Setup
```bash
cd samples/nunit && dotnet build && cd ../..
```

### Basic Test Debugging
```bash
npx debug-run --test-project samples/nunit \
  -b "samples/nunit/CalculatorTests.cs:57" \
  --pretty \
  -t 60s
```

**Verify:**
- [ ] Test runner launches automatically (no manual VSTEST_HOST_DEBUG needed)
- [ ] `process_attached` event shows testhost PID
- [ ] Breakpoint hit inside test method
- [ ] Test runner is cleaned up after session

### Filtered Test Debugging
```bash
npx debug-run --test-project samples/nunit \
  --test-filter "Add_TwoPositiveNumbers_ReturnsSum" \
  -b "samples/nunit/CalculatorTests.cs:57" \
  --pretty \
  -t 60s
```

**Verify:**
- [ ] Only the filtered test runs
- [ ] Breakpoint hits in the specific test

---

## 7. Enterprise Sample (samples/enterprise) - Token Efficiency

### Setup
```bash
cd samples/enterprise && dotnet build && cd ../..
```

### Default Token Optimizations
```bash
npx debug-run ./samples/enterprise/bin/Debug/net8.0/EnterpriseApp.dll \
  -a vsdbg \
  -b "samples/enterprise/Program.cs:50" \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] Service types (Logger, Repository) show compact form: `"{Logger}"`
- [ ] Null properties are omitted
- [ ] Duplicate objects show `[see: ...]` references

### Disabled Optimizations
```bash
npx debug-run ./samples/enterprise/bin/Debug/net8.0/EnterpriseApp.dll \
  -a vsdbg \
  -b "samples/enterprise/Program.cs:50" \
  --expand-services \
  --show-null-props \
  --no-dedupe \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] Service types fully expanded (much more verbose)
- [ ] Null properties appear in output
- [ ] No deduplication references

---

## 8. Edge Cases & Error Handling

### Invalid Breakpoint Path
```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "nonexistent/File.cs:10" \
  --pretty \
  -t 10s
```

**Verify:**
- [ ] `breakpoint_set` with `verified: false`
- [ ] Session times out without hitting breakpoint
- [ ] No crash or unhandled exception

### Invalid Expression
```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  -e "nonexistent.property" \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] `evaluations` contains error message for invalid expression
- [ ] Other expressions still evaluate
- [ ] Session continues normally

### Assertion Failure
```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  --assert "order.Total < 0" \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] `assertion_failed` event emitted
- [ ] Contains `assertion`, `actualValue`, `location`
- [ ] Session stops immediately after failure

### Exception Breakpoints
```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  --break-on-exception all \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] `exception_breakpoint_set` event
- [ ] If exception occurs, `exception_thrown` event with:
  - `exceptionChain` (if inner exceptions exist)
  - `rootCause` with `category` and `actionableHint`

### Output Filtering
```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  --include breakpoint_hit session_end \
  --pretty \
  -t 30s
```

**Verify:**
- [ ] Only `breakpoint_hit` and `session_end` events in output
- [ ] No `session_start`, `breakpoint_set`, `process_launched`, etc.

### Output to File
```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  -o /tmp/debug-output.json \
  --pretty \
  -t 30s

cat /tmp/debug-output.json
```

**Verify:**
- [ ] No output to stdout (except errors)
- [ ] File contains all events
- [ ] File is valid JSON (or NDJSON if not --pretty)

---

## 9. Adapter-Specific Tests

### List Adapters
```bash
npx debug-run list-adapters
```

**Verify:**
- [ ] Shows all adapters with install status
- [ ] Installed adapters show path
- [ ] Missing adapters show install hint

### Adapter Aliases
```bash
# These should be equivalent:
npx debug-run ./samples/python/sample_app.py -a python -b "samples/python/sample_app.py:185" --pretty -t 10s
npx debug-run ./samples/python/sample_app.py -a debugpy -b "samples/python/sample_app.py:185" --pretty -t 10s
```

**Verify:**
- [ ] Both commands work identically
- [ ] `python` and `debugpy` are interchangeable

---

## Summary Checklist

After running all tests, verify:

- [ ] All 4 main adapters work: vsdbg, debugpy, lldb, js-debug
- [ ] Launch mode works (dotnet, python, rust, typescript)
- [ ] Attach mode works (aspnet)
- [ ] Test debugging works (nunit)
- [ ] Expression evaluation works across all adapters
- [ ] Assertions work and fail correctly
- [ ] Trace mode works with and without --diff-vars
- [ ] Token efficiency optimizations work
- [ ] Event filtering works
- [ ] File output works
- [ ] Error cases are handled gracefully

Report any failures with:
1. The exact command run
2. The actual output/error
3. The expected behavior
