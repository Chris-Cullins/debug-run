# Implementation Plan: Test Failure Diagnosis Mode

## Overview

When an LLM is tasked with fixing a failing test, it currently has to:
1. Run the test to see it fail
2. Read the test code to understand what's being tested
3. Guess where to set breakpoints
4. Run debug-run manually with those breakpoints
5. Analyze the output to understand the divergence
6. Iterate if the breakpoints weren't in the right place

This is inefficient. Test Failure Diagnosis Mode automates this entire workflow: given a failing test, it automatically instruments the code, captures the execution path, identifies where actual diverged from expected, and provides a focused diagnostic report.

## Proposed User Experience

```bash
# Diagnose a specific failing test
npx debug-run diagnose \
  --test-project tests/EnterpriseApi.Tests \
  --test "CreateOrder_InvalidSku_ReturnsBadRequest"

# Diagnose all failing tests in a project
npx debug-run diagnose \
  --test-project tests/EnterpriseApi.Tests \
  --all-failing

# Diagnose with additional context
npx debug-run diagnose \
  --test-project tests/EnterpriseApi.Tests \
  --test "ProcessOrder_*" \
  --capture-http \
  --trace-depth 3
```

## Output Format

```json
{
  "type": "test_diagnosis",
  "test": {
    "name": "CreateOrder_InvalidSku_ReturnsBadRequest",
    "class": "OrderApiTests",
    "file": "tests/EnterpriseApi.Tests/OrderTests.cs",
    "line": 140
  },
  "result": "failed",
  "assertion": {
    "type": "equality",
    "expected": "BadRequest (400)",
    "actual": "Created (201)",
    "location": "OrderTests.cs:153",
    "expression": "response.StatusCode.Should().Be(HttpStatusCode.BadRequest)"
  },
  "divergencePoint": {
    "description": "Order creation succeeded when it should have failed validation",
    "location": "Commands.cs:85",
    "reason": "Product lookup returned a product for SKU 'INVALID-SKU' instead of null",
    "variable": "products",
    "expected": "Empty dictionary (SKU not found)",
    "actual": "Dictionary with 1 entry: INVALID-SKU -> Product { Name: 'Test Product' }"
  },
  "executionPath": [
    { "location": "OrderTests.cs:145", "description": "Test sends POST /orders with invalid SKU" },
    { "location": "Program.cs:54", "description": "Request hits CreateOrder endpoint" },
    { "location": "Commands.cs:77", "description": "Handler looks up customer (found)" },
    { "location": "Commands.cs:85", "description": "Handler looks up products by SKU" },
    { "location": "Repositories.cs:142", "description": "Repository returns product (UNEXPECTED)" },
    { "location": "Commands.cs:97", "description": "Inventory check passes" },
    { "location": "Commands.cs:162", "description": "Order created successfully" }
  ],
  "rootCause": {
    "hypothesis": "The test data or repository mock contains the 'INVALID-SKU' product",
    "suggestedFix": "Verify InMemoryProductRepository does not contain 'INVALID-SKU', or use a different SKU that's guaranteed not to exist",
    "relevantCode": [
      {
        "file": "Repositories.cs",
        "lines": "98-110",
        "description": "InMemoryProductRepository seed data"
      }
    ]
  },
  "capturedState": {
    "atAssertion": {
      "response.StatusCode": "Created",
      "response.Content": "{\"orderId\":\"ORD-002\",\"success\":true,...}"
    },
    "atDivergence": {
      "products": { "INVALID-SKU": { "Sku": "INVALID-SKU", "Name": "Test Product" } },
      "request.Items": [{ "Sku": "INVALID-SKU", "Quantity": 1 }]
    }
  }
}
```

## Implementation Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     diagnose command                             │
├─────────────────────────────────────────────────────────────────┤
│  1. Test Discovery    │  2. Static Analysis   │  3. Instrumentation │
│  - Find test method   │  - Parse test code    │  - Auto-breakpoints │
│  - Get assertion info │  - Find SUT calls     │  - Trace config     │
├───────────────────────┴───────────────────────┴─────────────────┤
│  4. Execution Phase                                              │
│  - Run test with debugging                                       │
│  - Capture execution path                                        │
│  - Record variable states                                        │
├─────────────────────────────────────────────────────────────────┤
│  5. Analysis Phase                                               │
│  - Compare expected vs actual                                    │
│  - Identify divergence point                                     │
│  - Generate hypothesis                                           │
├─────────────────────────────────────────────────────────────────┤
│  6. Report Generation                                            │
│  - Structured diagnosis event                                    │
│  - Relevant code snippets                                        │
│  - Suggested fixes                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Phase 1: Test Discovery & Metadata Extraction

**File: `src/diagnosis/test-discovery.ts` (new)**

```typescript
export interface TestInfo {
  name: string;
  fullName: string;
  className: string;
  methodName: string;
  file: string;
  line: number;
  framework: 'nunit' | 'xunit' | 'mstest';
  attributes: TestAttribute[];
  parameters?: TestParameter[];
}

export interface TestAttribute {
  name: string;  // "Test", "TestCase", "Theory", etc.
  arguments?: unknown[];
}

export interface TestParameter {
  name: string;
  type: string;
  value: unknown;
}

export async function discoverTests(
  projectPath: string,
  filter?: string
): Promise<TestInfo[]>;

export async function getFailingTests(
  projectPath: string
): Promise<TestInfo[]>;
```

**Implementation approach:**

1. Run `dotnet test --list-tests` to get test names
2. Run `dotnet test` (without debug) to identify which tests fail
3. Use Roslyn or regex parsing to extract test method locations
4. Parse test attributes for parameterized tests

### Phase 2: Static Analysis of Test Code

**File: `src/diagnosis/test-analyzer.ts` (new)**

```typescript
export interface TestAnalysis {
  // Arrange phase
  arrangeSection: {
    startLine: number;
    endLine: number;
    variables: VariableDeclaration[];
    mockSetups: MockSetup[];
  };
  
  // Act phase  
  actSection: {
    startLine: number;
    endLine: number;
    primaryAction: ActionCall;
    awaitedCalls: ActionCall[];
  };
  
  // Assert phase
  assertSection: {
    startLine: number;
    endLine: number;
    assertions: Assertion[];
  };
  
  // System under test
  sutCalls: SUTCall[];
}

export interface Assertion {
  line: number;
  expression: string;
  type: 'equality' | 'throws' | 'contains' | 'true' | 'false' | 'null' | 'notNull' | 'custom';
  expected?: string;
  actualExpression?: string;
  framework: 'fluent' | 'nunit' | 'xunit' | 'mstest';
}

export interface SUTCall {
  line: number;
  expression: string;
  targetType: string;
  methodName: string;
  isAsync: boolean;
  file?: string;  // If we can resolve to source
  targetLine?: number;
}

export async function analyzeTest(testInfo: TestInfo): Promise<TestAnalysis>;
```

**Implementation approach:**

1. Read test source file
2. Parse using regex patterns for common test patterns:
   - `// Arrange`, `// Act`, `// Assert` comments
   - FluentAssertions: `.Should().Be()`, `.Should().Throw()`
   - NUnit: `Assert.That()`, `Assert.Throws()`
   - xUnit: `Assert.Equal()`, `Assert.Throws()`
3. Identify the "Act" call (usually the one being asserted on)
4. Trace the call target to find the SUT source location

### Phase 3: Smart Breakpoint Generation

**File: `src/diagnosis/breakpoint-generator.ts` (new)**

```typescript
export interface DiagnosisBreakpoints {
  // Always set
  testMethod: BreakpointSpec;        // Start of test
  assertionLines: BreakpointSpec[];  // Each assertion
  
  // Conditional based on analysis
  actCall: BreakpointSpec;           // The main action
  sutEntryPoints: BreakpointSpec[];  // Entry to system under test
  
  // Smart breakpoints based on common patterns
  validationPoints: BreakpointSpec[];   // Validation method calls
  repositoryCalls: BreakpointSpec[];    // Data access
  externalCalls: BreakpointSpec[];      // HTTP, messaging, etc.
  branchPoints: BreakpointSpec[];       // If/switch that affect flow
}

export interface BreakpointSpec {
  file: string;
  line: number;
  condition?: string;
  purpose: string;  // Why this breakpoint matters
  captureExpressions?: string[];  // What to evaluate here
}

export function generateDiagnosisBreakpoints(
  testInfo: TestInfo,
  testAnalysis: TestAnalysis,
  sutSourceMap: Map<string, string>  // type -> source file
): DiagnosisBreakpoints;
```

**Breakpoint selection heuristics:**

1. **Always instrument**: test method start, each assertion
2. **MediatR pattern**: If test calls `mediator.Send()`, break at handler entry
3. **Repository pattern**: Break at all `I*Repository` method calls
4. **Validation pattern**: Break at `Validate*` methods and FluentValidation validators
5. **Controller/endpoint pattern**: Break at endpoint handler entry
6. **Conditional branches**: Break at `if` statements that check validation/null

### Phase 4: Execution with Diagnosis Capture

**File: `src/diagnosis/diagnosis-session.ts` (new)**

```typescript
export interface DiagnosisCapture {
  executionPath: ExecutionStep[];
  variableSnapshots: Map<string, VariableSnapshot[]>;
  assertionResults: AssertionResult[];
  exceptions: ExceptionInfo[];
}

export interface ExecutionStep {
  stepNumber: number;
  location: SourceLocation;
  purpose?: string;  // From breakpoint spec
  timestamp: number;
  stackDepth: number;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actualValue?: string;
  expectedValue?: string;
  errorMessage?: string;
  capturedState: Record<string, unknown>;
}

export class DiagnosisSession extends DebugSession {
  private capture: DiagnosisCapture;
  private breakpointPurposes: Map<number, string>;
  
  async runDiagnosis(
    testInfo: TestInfo,
    breakpoints: DiagnosisBreakpoints
  ): Promise<DiagnosisCapture>;
}
```

**Execution strategy:**

1. Set all generated breakpoints with their capture expressions
2. Run the test with `--trace` enabled from the test method
3. At each breakpoint:
   - Record the execution step with purpose annotation
   - Capture specified expressions
   - If at assertion, evaluate expected vs actual
4. Continue until test completes (pass or fail)
5. Collect all captured data

### Phase 5: Divergence Analysis

**File: `src/diagnosis/divergence-analyzer.ts` (new)**

```typescript
export interface DivergencePoint {
  location: SourceLocation;
  stepNumber: number;
  description: string;
  reason: string;
  expectedBehavior: string;
  actualBehavior: string;
  relevantVariables: Record<string, {
    expected?: unknown;
    actual: unknown;
  }>;
}

export interface DiagnosisResult {
  test: TestInfo;
  passed: boolean;
  
  // If failed
  failedAssertion?: AssertionResult;
  divergencePoint?: DivergencePoint;
  executionPath: ExecutionStep[];
  
  rootCause: {
    hypothesis: string;
    confidence: 'high' | 'medium' | 'low';
    suggestedFixes: string[];
    relevantCode: CodeReference[];
  };
}

export function analyzeDivergence(
  testAnalysis: TestAnalysis,
  capture: DiagnosisCapture
): DiagnosisResult;
```

**Divergence detection algorithm:**

1. **Start from failure**: Get the failed assertion's expected vs actual
2. **Work backward**: Trace execution path in reverse
3. **Find first divergence**: Where did actual start differing from expected?
   - For equality checks: find where the value was set incorrectly
   - For throws checks: find where exception should have been thrown but wasn't
   - For null checks: find where null/non-null was assigned
4. **Generate hypothesis**: Based on the divergence point and code pattern:
   - Missing validation → "Validation logic not triggered"
   - Wrong return value → "Method returned X instead of Y"
   - No exception → "Expected exception not thrown at [location]"

### Phase 6: CLI Integration

**File: `src/cli.ts` (additions)**

```typescript
program
  .command("diagnose")
  .description("Automatically diagnose failing tests")
  .requiredOption(
    "--test-project <path>",
    "Path to test project"
  )
  .option(
    "--test <name>",
    "Specific test to diagnose (supports wildcards)"
  )
  .option(
    "--all-failing",
    "Diagnose all currently failing tests"
  )
  .option(
    "--trace-depth <depth>",
    "How deep to trace into called methods (default: 2)",
    (val) => parseInt(val, 10),
    2
  )
  .option(
    "--capture-http",
    "Capture HTTP request/response details",
    false
  )
  .option(
    "--max-steps <count>",
    "Maximum trace steps per test (default: 1000)",
    (val) => parseInt(val, 10),
    1000
  )
  .option(
    "-o, --output <file>",
    "Write diagnosis report to file"
  )
  .option(
    "--pretty",
    "Pretty print JSON output"
  )
  .action(async (options) => {
    await runDiagnosis(options);
  });
```

### Phase 7: Report Generation

**File: `src/diagnosis/report-generator.ts` (new)**

```typescript
export interface DiagnosisReport {
  type: "test_diagnosis";
  timestamp: string;
  test: {
    name: string;
    class: string;
    file: string;
    line: number;
  };
  result: "passed" | "failed";
  duration: number;
  
  // Only if failed
  assertion?: {
    type: string;
    expected: string;
    actual: string;
    location: string;
    expression: string;
  };
  divergencePoint?: {
    description: string;
    location: string;
    reason: string;
    variable?: string;
    expected?: string;
    actual?: string;
  };
  executionPath?: Array<{
    location: string;
    description: string;
  }>;
  rootCause?: {
    hypothesis: string;
    suggestedFix: string;
    relevantCode: Array<{
      file: string;
      lines: string;
      description: string;
    }>;
  };
  capturedState?: {
    atAssertion: Record<string, unknown>;
    atDivergence: Record<string, unknown>;
  };
}

export function generateReport(
  diagnosis: DiagnosisResult,
  capture: DiagnosisCapture
): DiagnosisReport;
```

## Example Walkthrough

Given this failing test:

```csharp
[Test]
public async Task CreateOrder_InvalidSku_ReturnsBadRequest()
{
    // Arrange
    var command = new CreateOrderCommand(
        CustomerId: "CUST-001",
        Items: new List<OrderItemDto> { new("INVALID-SKU", 1) }
    );

    // Act
    var response = await _client.PostAsJsonAsync("/orders", command);

    // Assert
    response.StatusCode.Should().Be(HttpStatusCode.BadRequest);  // FAILS: Got 201
}
```

**Diagnosis flow:**

1. **Discovery**: Find test at `OrderTests.cs:140`
2. **Analysis**: 
   - Act: `PostAsJsonAsync("/orders", command)` → targets `POST /orders` endpoint
   - Assert: `StatusCode.Should().Be(BadRequest)` - equality check
3. **Breakpoints generated**:
   - `OrderTests.cs:145` - arrange complete
   - `OrderTests.cs:150` - after act (response received)
   - `OrderTests.cs:153` - assertion
   - `Program.cs:54` - endpoint handler
   - `Commands.cs:77` - customer lookup
   - `Commands.cs:85` - product lookup (KEY)
   - `Commands.cs:97` - inventory check
4. **Execution**: Trace through, capture at each breakpoint
5. **Divergence detected**:
   - At `Commands.cs:85`: `products.ContainsKey("INVALID-SKU")` is `true`
   - Expected: SKU not found → return error
   - Actual: SKU found → order created
6. **Report**: "Product lookup returned unexpected result for 'INVALID-SKU'"

## Token Efficiency

**Traditional debugging flow for LLM:**
- ~500 tokens: Run test, see failure
- ~1000 tokens: Read test code
- ~500 tokens: Decide breakpoints
- ~2000 tokens: Run debug-run, analyze output
- ~1000 tokens: Iterate if wrong breakpoints
- **Total: ~5000+ tokens**

**With diagnosis mode:**
- ~800 tokens: Single diagnosis report with root cause
- **Reduction: ~84%**

## Testing Strategy

1. **Unit tests** for each component:
   - Test discovery parsing
   - Test analysis (arrange/act/assert detection)
   - Breakpoint generation
   - Divergence analysis

2. **Integration tests** using the enterprise sample:
   - Create intentionally failing tests with known root causes
   - Verify diagnosis correctly identifies divergence

3. **End-to-end tests**:
   - Run full diagnosis on sample test project
   - Verify report format and accuracy

## Implementation Order

1. **Phase 1-2**: Test discovery and static analysis (can be developed independently)
2. **Phase 3**: Breakpoint generation (depends on 1-2)
3. **Phase 4**: Diagnosis session (extends existing DebugSession)
4. **Phase 5**: Divergence analysis (depends on 4)
5. **Phase 6**: CLI integration
6. **Phase 7**: Report generation

**Estimated effort**: 3-4 weeks for full implementation

## Future Enhancements

1. **Learning from fixes**: Track which fixes resolved which divergence patterns
2. **Multi-test correlation**: Find common root causes across multiple failing tests
3. **Flaky test detection**: Run multiple times, identify non-deterministic failures
4. **Code coverage integration**: Show which code paths the failing test exercised
5. **Git integration**: `diagnose --since HEAD~5` to diagnose tests that started failing after recent commits
6. **IDE integration**: VS Code extension that shows diagnosis inline
