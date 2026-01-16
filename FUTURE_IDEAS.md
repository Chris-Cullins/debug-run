# Future Ideas for debug-run

High-value feature ideas focused on making AI agents more effective debuggers.

---

## 1. Intelligent Breakpoint Suggestions

**Problem:** AI agents currently guess where to place breakpoints, often requiring multiple debug sessions to zero in on issues.

**Solution:** Add a `--suggest-breakpoints` mode that analyzes:
- Stack traces from exceptions
- Control flow graphs to find branch points
- Entry/exit of suspicious functions
- Lines that modify variables mentioned in error messages

```bash
npx debug-run analyze ./app.dll --error "NullReferenceException at Order.Process"
# Output: Suggested breakpoints with confidence scores
```

**Why it's valuable:** Reduces debugging iterations from 5-10 to 1-2. Directly addresses the core inefficiency in agent debugging workflows.

---

## 2. Diff-Aware Debugging

**Problem:** When debugging a regression, agents don't know which code paths changed between working and broken versions.

**Solution:** Integrate with git to automatically set breakpoints on recently changed lines:

```bash
npx debug-run ./app.dll -a vsdbg \
  --break-on-changes HEAD~5 \
  --filter "src/**/*.cs"
```

**Why it's valuable:** Most bugs are in recently changed code. This leverages information agents already have (git history) to dramatically narrow the search space.

---

## 3. Memory Snapshot & Heap Analysis

**Problem:** Memory leaks and large object graphs are invisible to current variable inspection. Agents can't diagnose "why is this service using 2GB of RAM?"

**Solution:** Add memory inspection commands:

```bash
npx debug-run ./app.dll -a vsdbg \
  -b "Program.cs:100" \
  --heap-snapshot \
  --top-objects 20
```

Events would include:
- `heap_snapshot` - Object type distribution, retained sizes
- Large object detection
- Potential leak indicators (growing collections, circular references)

**Why it's valuable:** Memory issues are notoriously hard to debug. This gives agents visibility into a dimension they currently can't see at all.

---

## 4. Continuous Watch Mode

**Problem:** Current debugging is synchronous - run once, get results, session ends. For intermittent bugs or long-running services, this is inefficient.

**Solution:** Add a watch mode that keeps the session alive and streams events:

```bash
npx debug-run ./app.dll -a vsdbg \
  -b "Program.cs:67" \
  --watch \
  --emit-interval 100  # Emit every 100 hits as batch
```

Features:
- Aggregate statistics over time
- Pattern detection (e.g., "this breakpoint only hits when X > 100")
- Export to file for later analysis

**Why it's valuable:** Enables debugging of race conditions, intermittent failures, and performance patterns that only emerge over time.

---

## 5. Causal Chain Reconstruction

**Problem:** Agents see *where* an exception happened but not *why*. The root cause is often far upstream from the crash site.

**Solution:** When an exception occurs, automatically trace backwards:

```bash
npx debug-run ./app.dll -a vsdbg \
  --break-on-exception all \
  --trace-cause \
  --cause-depth 10
```

The `exception_thrown` event would include:
- `causalChain`: Array of relevant state changes leading to the error
- Variable values at each point where corrupted data was touched
- "Last known good" state vs "first bad" state

**Why it's valuable:** This is the actual debugging work - understanding causality. Current tools show symptoms; this shows disease.

---

## 6. Multi-Process Debugging

**Problem:** Modern apps are distributed - microservices, worker processes, etc. Current tool debugs one process at a time.

**Solution:** Coordinate debugging across processes:

```bash
npx debug-run --multi \
  --process "api:5000" -b "Api/Controllers/OrderController.cs:42" \
  --process "worker:5001" -b "Worker/OrderProcessor.cs:15" \
  --correlate "orderId"
```

Events would include:
- Cross-process correlation (follow orderId through the system)
- Distributed trace visualization
- Race condition detection between processes

**Why it's valuable:** Aligns with how real applications work. Single-process debugging is increasingly insufficient.

---

## 7. Assertion-Based Debugging

**Problem:** Agents often know what *should* be true but have to manually check with expressions. Repeated boilerplate.

**Solution:** Add invariant assertions that automatically halt when violated:

```bash
npx debug-run ./app.dll -a vsdbg \
  --assert "order.Total >= 0" \
  --assert "inventory.Count <= maxInventory" \
  --assert-scope "OrderService.*"
```

Assertions are checked at every step/breakpoint in scope. Violation triggers a detailed event with:
- Which assertion failed
- Current vs expected values
- Stack trace at violation point

**Why it's valuable:** Transforms debugging from "find the bug" to "let the bug find you." Especially powerful for agents that can generate assertions from specifications.

---

## 8. Semantic Variable Diffing

**Problem:** When stepping through code, agents see full variable dumps but struggle to spot what *changed*.

**Solution:** Add diff-aware variable reporting:

```bash
npx debug-run ./app.dll -a vsdbg \
  -b "Program.cs:67" \
  --trace \
  --diff-vars
```

Each `trace_step` event includes:
- `changes`: Only variables that changed since last step
- `changeType`: "modified", "created", "deleted"
- Visual diff for complex objects

**Why it's valuable:** Reduces cognitive load. Instead of comparing 50 variables manually, agents see exactly what moved.

---

## 9. Symbolic Execution Hints

**Problem:** Agents don't know what inputs would trigger specific code paths.

**Solution:** Integrate lightweight symbolic analysis:

```bash
npx debug-run analyze ./app.dll \
  --reach "Program.cs:150" \
  --from "Program.cs:100"
```

Output:
- Constraints that must be true to reach target line
- Example input values that satisfy constraints
- Branch coverage report

**Why it's valuable:** Helps agents construct test cases that exercise specific code paths. Turns "how do I hit this branch?" from guesswork into computation.

---

## 10. Debug Session Recording & Replay

**Problem:** Debugging is expensive. Re-running to verify a fix requires re-executing the entire session.

**Solution:** Record debug sessions for replay:

```bash
# Record
npx debug-run ./app.dll -a vsdbg \
  -b "Program.cs:67" \
  --record session.dbgrec

# Replay (no actual execution)
npx debug-run replay session.dbgrec \
  --at-step 42 \
  -e "newExpression"
```

Features:
- Time-travel debugging (jump to any recorded state)
- Add new expressions to historical state
- Compare two sessions side-by-side

**Why it's valuable:** Amortizes the cost of debugging. One execution, unlimited analysis. Critical for expensive-to-reproduce bugs.

---

## Prioritization Matrix

| Feature | Impact | Complexity | Recommended Phase |
|---------|--------|------------|-------------------|
| Semantic Variable Diffing | High | Low | Phase 3 |
| Intelligent Breakpoint Suggestions | Very High | Medium | Phase 3 |
| Diff-Aware Debugging | High | Low | Phase 3 |
| Assertion-Based Debugging | High | Medium | Phase 3 |
| Continuous Watch Mode | Medium | Medium | Phase 4 |
| Memory Snapshot | Medium | High | Phase 4 |
| Causal Chain Reconstruction | Very High | Very High | Phase 5 |
| Debug Session Recording | High | Very High | Phase 5 |
| Multi-Process Debugging | Medium | Very High | Phase 5 |
| Symbolic Execution | Medium | Very High | Future |

---

## Non-Goals (Avoiding Feature Bloat)

These are explicitly **not** planned:

- **GUI/TUI interface** - This is a CLI for agents, not humans
- **IDE plugins** - Use existing IDE debuggers for human debugging
- **Language server integration** - Out of scope; use existing LSPs
- **Test generation** - Adjacent problem, different tool
- **Code fix suggestions** - Let the agent handle code modifications
- **Historical bug databases** - Interesting but tangential

---

## Design Principles

1. **Output-first**: Every feature should produce actionable JSON events
2. **Composable**: Features work together (e.g., watch + assertions + diff)
3. **Language-agnostic**: Core features work across all adapters
4. **Fail gracefully**: Missing capabilities shouldn't break sessions
5. **Agent-optimized**: Optimize for programmatic consumption, not human readability
