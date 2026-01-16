# Implementation Plan: Semantic Variable Diffing

Adds `--diff-vars` flag to show only what changed between steps instead of full variable dumps.

---

## Overview

When tracing through code, agents currently receive full variable snapshots at each step. This creates noise - most variables don't change between steps. Variable diffing highlights only the mutations, making it easier to spot cause-and-effect.

## CLI Interface

```bash
npx debug-run ./app.dll -a vsdbg \
  -b "Program.cs:67" \
  --trace \
  --diff-vars \
  --pretty
```

## Output Format

New `changes` field in `trace_step` events:

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
      "oldValue": { "type": "int", "value": 100 },
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

Change types: `created`, `modified`, `deleted`

---

## Implementation Steps

### 1. Add Types (src/output/events.ts)

```typescript
export interface VariableChange {
  name: string;
  changeType: 'created' | 'modified' | 'deleted';
  oldValue?: VariableValue;
  newValue?: VariableValue;
}

// Update TraceStepEvent
export interface TraceStepEvent {
  // ... existing fields
  changes?: VariableChange[];  // Only present if --diff-vars enabled
}
```

### 2. Add CLI Flag (src/cli.ts)

```typescript
.option('--diff-vars', 'Show only changed variables in trace steps')
```

Pass through to SessionConfig.

### 3. Add Config (src/session/manager.ts)

```typescript
export interface SessionConfig {
  // ... existing
  diffVars?: boolean;
}
```

### 4. Add State Tracking (src/session/manager.ts)

```typescript
// Class properties
private previousLocals: Record<string, VariableValue> = {};
```

### 5. Implement Diff Logic (src/session/variables.ts)

New method in `VariableInspector`:

```typescript
/**
 * Compare two variable snapshots and return changes
 */
diffVariables(
  prev: Record<string, VariableValue>,
  curr: Record<string, VariableValue>
): VariableChange[] {
  const changes: VariableChange[] = [];

  // Deleted or modified
  for (const [name, oldVal] of Object.entries(prev)) {
    if (!(name in curr)) {
      changes.push({ name, changeType: 'deleted', oldValue: oldVal });
    } else if (!this.valuesEqual(oldVal, curr[name])) {
      changes.push({
        name,
        changeType: 'modified',
        oldValue: oldVal,
        newValue: curr[name]
      });
    }
  }

  // Created
  for (const [name, newVal] of Object.entries(curr)) {
    if (!(name in prev)) {
      changes.push({ name, changeType: 'created', newValue: newVal });
    }
  }

  return changes;
}

/**
 * Deep equality check for VariableValue
 */
private valuesEqual(a: VariableValue, b: VariableValue): boolean {
  // Quick check: same type?
  if (a.type !== b.type) return false;

  // For primitives, compare value directly
  if (typeof a.value !== 'object' || a.value === null) {
    return a.value === b.value;
  }

  // For objects/arrays, use JSON serialization
  // (acceptable for debugging output - not perf critical)
  return JSON.stringify(a.value) === JSON.stringify(b.value);
}
```

### 6. Integrate into Trace Step Handler (src/session/manager.ts)

Modify `handleTraceStep()`:

```typescript
private async handleTraceStep(
  threadId: number,
  location: SourceLocation,
  stackDepth: number,
  stackFrames: StackFrameInfo[],
  frameId?: number
): Promise<void> {
  this.traceStepCount++;
  this.tracePath.push(location);

  // Build trace_step event
  const stepEvent: TraceStepEvent = {
    type: "trace_step",
    timestamp: new Date().toISOString(),
    threadId,
    stepNumber: this.traceStepCount,
    location,
    stackDepth,
  };

  // Compute variable diff if enabled
  if (this.config.diffVars && frameId) {
    const currentLocals = await this.variableInspector!.getLocals(frameId);
    const changes = this.variableInspector!.diffVariables(
      this.previousLocals,
      currentLocals
    );

    if (changes.length > 0) {
      stepEvent.changes = changes;
    }

    this.previousLocals = currentLocals;
  }

  this.formatter.emit(stepEvent);

  // ... rest of method unchanged
}
```

### 7. Reset State on Trace Start (src/session/manager.ts)

In `startTrace()`:

```typescript
private async startTrace(...): Promise<void> {
  // ... existing setup

  // Initialize diff state with current locals
  if (this.config.diffVars) {
    const topFrameId = /* get from stack */;
    this.previousLocals = await this.variableInspector!.getLocals(topFrameId);
  }

  // ... rest of method
}
```

---

## Testing

### Unit Tests (new file: src/session/variables.test.ts)

```typescript
describe('diffVariables', () => {
  it('detects created variables', () => {
    const prev = {};
    const curr = { x: { type: 'int', value: 1 } };
    const changes = inspector.diffVariables(prev, curr);
    expect(changes).toEqual([
      { name: 'x', changeType: 'created', newValue: { type: 'int', value: 1 } }
    ]);
  });

  it('detects deleted variables', () => { /* ... */ });
  it('detects modified primitives', () => { /* ... */ });
  it('detects modified objects', () => { /* ... */ });
  it('ignores unchanged variables', () => { /* ... */ });
});
```

### Integration Test

```bash
npx debug-run ./samples/dotnet/bin/Debug/net8.0/SampleApp.dll \
  -a vsdbg \
  -b "samples/dotnet/Program.cs:67" \
  --trace \
  --trace-limit 10 \
  --diff-vars \
  --pretty
```

Verify:
- First step has no `changes` (or all variables as `created`)
- Subsequent steps only show mutations
- Complex object modifications are detected

---

## Edge Cases

1. **First step**: No previous state. Options:
   - Emit all variables as `created` (verbose but complete)
   - Emit empty `changes` (cleaner, assumes agent saw breakpoint_hit locals)
   - **Recommendation**: Empty changes on first step

2. **Out-of-scope variables**: When stepping into/out of functions, variables may appear/disappear. This is expected - emit as `created`/`deleted`.

3. **Large objects**: Deep comparison via JSON.stringify could be slow for huge objects. Mitigation: Only diff top-level or add depth limit.

4. **Circular references**: Already handled by `VariableInspector` - just compare the serialized form.

---

## Files Changed

| File | Change |
|------|--------|
| `src/cli.ts` | Add `--diff-vars` flag |
| `src/session/manager.ts` | Add config, state, integration |
| `src/session/variables.ts` | Add `diffVariables()` and `valuesEqual()` |
| `src/output/events.ts` | Add `VariableChange` type, update `TraceStepEvent` |
| `src/session/variables.test.ts` | New test file |

Estimated scope: ~150 lines of new code
