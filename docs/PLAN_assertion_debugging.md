# Implementation Plan: Assertion-Based Debugging

Adds `--assert` flag to define invariants that halt execution when violated.

---

## Overview

Instead of manually checking conditions with `-e` expressions, agents can declare what *should* be true. When any assertion fails, the debugger stops immediately and reports the violation with full context. This transforms debugging from "search for the bug" to "let the bug announce itself."

## CLI Interface

```bash
npx debug-run ./app.dll -a vsdbg \
  -b "Program.cs:42" \
  --assert "order.Total >= 0" \
  --assert "inventory.Count <= maxInventory" \
  --assert "customer != null" \
  --pretty
```

Assertions are checked:
- At every breakpoint hit
- At every trace step (if `--trace` enabled)
- At every regular step (if `--steps` enabled)

## Output Format

New `assertion_failed` event:

```json
{
  "type": "assertion_failed",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "threadId": 1,
  "assertion": "order.Total >= 0",
  "actualValue": "-50",
  "expected": "truthy (>= 0)",
  "location": {
    "file": "OrderService.cs",
    "line": 87,
    "function": "ProcessRefund"
  },
  "stackTrace": [...],
  "locals": {...}
}
```

---

## Implementation Steps

### 1. Add Types (src/output/events.ts)

```typescript
export interface AssertionFailedEvent {
  type: 'assertion_failed';
  timestamp: string;
  threadId: number;
  assertion: string;
  actualValue: string;
  evaluationError?: string;  // If expression threw
  location: SourceLocation;
  stackTrace: StackFrameInfo[];
  locals: Record<string, VariableValue>;
}
```

### 2. Add CLI Flag (src/cli.ts)

```typescript
.option(
  '--assert <expression...>',
  'Invariant expressions that must remain truthy; stops on first violation'
)
```

### 3. Add Config (src/session/manager.ts)

```typescript
export interface SessionConfig {
  // ... existing
  assertions?: string[];
}
```

### 4. Add Assertion Checker (src/session/manager.ts)

New private method:

```typescript
/**
 * Check all assertions against current frame state
 * @returns First failed assertion or null if all pass
 */
private async checkAssertions(
  frameId: number
): Promise<{ assertion: string; value: string; error?: string } | null> {
  if (!this.config.assertions?.length) return null;

  for (const assertion of this.config.assertions) {
    try {
      const result = await this.client!.evaluate({
        expression: assertion,
        frameId,
        context: 'watch',
      });

      // Assertion fails if result is falsy
      if (!this.isTruthy(result.result)) {
        return {
          assertion,
          value: result.result
        };
      }
    } catch (error) {
      // Evaluation error = assertion failed
      return {
        assertion,
        value: '',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return null; // All assertions passed
}
```

### 5. Emit Assertion Failed Event (src/session/manager.ts)

New helper method:

```typescript
private async emitAssertionFailed(
  threadId: number,
  assertion: string,
  actualValue: string,
  evaluationError: string | undefined,
  location: SourceLocation,
  stackTrace: StackFrameInfo[],
  frameId: number
): Promise<void> {
  // Capture full locals for debugging context
  let locals: Record<string, VariableValue> = {};
  if (this.config.captureLocals !== false) {
    locals = await this.variableInspector!.getLocals(frameId);
  }

  const event: AssertionFailedEvent = {
    type: 'assertion_failed',
    timestamp: new Date().toISOString(),
    threadId,
    assertion,
    actualValue,
    evaluationError,
    location,
    stackTrace,
    locals,
  };

  this.formatter.emit(event);
}
```

### 6. Integrate into Breakpoint Handler (src/session/manager.ts)

In `handleStopped()`, after capturing location/stackTrace but before emitting `breakpoint_hit`:

```typescript
// Check assertions at breakpoint (before emitting breakpoint_hit)
if (reason === "breakpoint" && topFrame) {
  const failed = await this.checkAssertions(topFrame.id);
  if (failed) {
    await this.emitAssertionFailed(
      threadId,
      failed.assertion,
      failed.value,
      failed.error,
      location,
      stackTrace,
      topFrame.id
    );
    // End session on assertion failure
    this.endSession();
    return;
  }
}
```

### 7. Integrate into Trace Step Handler (src/session/manager.ts)

In `handleTraceStep()`, after emitting `trace_step` but before continuing:

```typescript
// Check assertions during trace
if (frameId) {
  const failed = await this.checkAssertions(frameId);
  if (failed) {
    await this.emitAssertionFailed(
      threadId,
      failed.assertion,
      failed.value,
      failed.error,
      location,
      stackFrames,
      frameId
    );
    // End trace and session
    this.isTracing = false;
    this.endSession();
    return;
  }
}
```

### 8. Integrate into Step Handler (src/session/manager.ts)

In the `reason === "step" && this.isStepping` block:

```typescript
// Check assertions after step
if (topFrame) {
  const failed = await this.checkAssertions(topFrame.id);
  if (failed) {
    await this.emitAssertionFailed(
      threadId,
      failed.assertion,
      failed.value,
      failed.error,
      location,
      stackTrace,
      topFrame.id
    );
    this.isStepping = false;
    this.endSession();
    return;
  }
}
```

---

## Behavior Details

### Assertion Evaluation

Assertions use the same evaluation mechanism as `-e` expressions:
- Evaluated in "watch" context
- Have access to locals, `this`, globals
- Can use method calls: `--assert "list.Contains(item)"`
- Can use complex expressions: `--assert "a > 0 && b < 100"`

### Truthiness

Uses existing `isTruthy()` method:
- `true`, non-zero numbers, non-empty strings → pass
- `false`, `null`, `0`, `""`, `None`, `nil` → fail
- Evaluation error → fail (with error message)

### Session Termination

When an assertion fails:
1. Emit `assertion_failed` event with full context
2. Do NOT call `continue` - leave debuggee paused
3. End the debug session cleanly
4. Exit with non-zero code (for CI integration)

This is intentional - a failed assertion is a "stop everything" signal.

### Multiple Assertions

Assertions are checked in order. First failure stops evaluation:
```bash
--assert "a != null" --assert "a.Value > 0"
```
If `a` is null, only the first assertion is reported as failed.

---

## Testing

### Unit Tests

```typescript
describe('checkAssertions', () => {
  it('returns null when no assertions configured', async () => {
    session.config.assertions = [];
    expect(await session.checkAssertions(frameId)).toBeNull();
  });

  it('returns null when all assertions pass', async () => {
    mockEvaluate.mockResolvedValue({ result: 'true' });
    session.config.assertions = ['x > 0'];
    expect(await session.checkAssertions(frameId)).toBeNull();
  });

  it('returns first failed assertion', async () => {
    mockEvaluate.mockResolvedValueOnce({ result: 'true' });
    mockEvaluate.mockResolvedValueOnce({ result: 'false' });
    session.config.assertions = ['a > 0', 'b > 0', 'c > 0'];

    const result = await session.checkAssertions(frameId);
    expect(result).toEqual({ assertion: 'b > 0', value: 'false' });
  });

  it('treats evaluation errors as failures', async () => {
    mockEvaluate.mockRejectedValue(new Error('undefined variable'));
    session.config.assertions = ['nonexistent > 0'];

    const result = await session.checkAssertions(frameId);
    expect(result?.error).toContain('undefined variable');
  });
});
```

### Integration Test

```bash
# Test with assertion that will fail
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  --assert "order.Total > 1000000" \
  --pretty

# Should see:
# 1. breakpoint_hit (or not, if assertion checked first)
# 2. assertion_failed with full context
# 3. session_end
```

### CI Integration Test

```bash
# Assert should cause non-zero exit
npx debug-run ./app.dll -a vsdbg -b "file:10" --assert "false"
echo $?  # Should be non-zero
```

---

## Edge Cases

1. **Expensive assertions**: Complex expressions evaluated at every step could slow debugging. Mitigation: Document this, let users be judicious.

2. **Side effects in assertions**: `--assert "counter++"` would be bad. Mitigation: Document that assertions should be pure.

3. **Assertion on first step**: Should work - frame context is available immediately after stop.

4. **Multiple threads**: Assertions only checked on the stopped thread. Multi-thread assertion support is out of scope for v1.

---

## Future Enhancements

1. **Assertion scoping**: `--assert-scope "OrderService.*"` - only check in specific functions
2. **Soft assertions**: Log but don't stop: `--assert-warn "x > 0"`
3. **Assertion batching**: Check all and report all failures, not just first

These are out of scope for initial implementation.

---

## Files Changed

| File | Change |
|------|--------|
| `src/cli.ts` | Add `--assert` flag |
| `src/session/manager.ts` | Add config, `checkAssertions()`, integrate into handlers |
| `src/output/events.ts` | Add `AssertionFailedEvent` type |
| `src/session/manager.test.ts` | Add assertion tests |

Estimated scope: ~100 lines of new code
