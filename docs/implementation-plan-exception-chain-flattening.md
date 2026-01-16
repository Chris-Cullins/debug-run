# Implementation Plan: Exception Chain Flattening

## Overview

Enterprise .NET applications frequently produce deeply nested exceptions. A `DbUpdateException` might wrap a `SqlException` which wraps a `SocketException`. Currently, debug-run captures the top-level exception, but the root cause is often buried 3-4 levels deep. LLMs waste tokens parsing verbose stack traces to find the actual issue.

This feature flattens exception chains into a structured, token-efficient format that surfaces the root cause immediately.

## Current Behavior

When an exception is caught, we emit:
```json
{
  "type": "exception_thrown",
  "exception": {
    "type": "DbUpdateException",
    "message": "An error occurred while saving the entity changes.",
    "stackTrace": "...(200 lines)...",
    "innerException": "System.Data.SqlClient.SqlException: Connection refused..."
  }
}
```

Problems:
1. `innerException` is a raw string, not structured
2. Only one level of inner exception is captured
3. Root cause (e.g., `SocketException`) is buried
4. Stack traces are repeated/redundant across the chain

## Proposed Behavior

New event type with flattened chain:
```json
{
  "type": "exception_thrown",
  "threadId": 12345,
  "exception": {
    "type": "DbUpdateException",
    "message": "An error occurred while saving the entity changes.",
    "stackTrace": "..."
  },
  "exceptionChain": [
    {
      "depth": 0,
      "type": "DbUpdateException", 
      "message": "An error occurred while saving the entity changes.",
      "source": "Microsoft.EntityFrameworkCore",
      "throwSite": "DbContext.SaveChangesAsync:1423"
    },
    {
      "depth": 1,
      "type": "SqlException",
      "message": "A connection was successfully established with the server, but then an error occurred.",
      "source": "Microsoft.Data.SqlClient",
      "throwSite": "SqlConnection.Open:245",
      "sqlErrorCode": 10054
    },
    {
      "depth": 2,
      "type": "SocketException",
      "message": "Connection refused",
      "source": "System.Net.Sockets",
      "throwSite": "Socket.Connect:312",
      "socketErrorCode": 10061,
      "isRootCause": true
    }
  ],
  "rootCause": {
    "type": "SocketException",
    "message": "Connection refused",
    "category": "network",
    "actionableHint": "Check if the database server is running and accessible"
  },
  "location": { ... },
  "locals": { ... }
}
```

## Implementation Steps

### Phase 1: Core Exception Chain Extraction

**File: `src/session/exceptions.ts` (new)**

```typescript
export interface ExceptionInfo {
  depth: number;
  type: string;
  message: string;
  source?: string;
  throwSite?: string;
  data?: Record<string, unknown>;
  isRootCause?: boolean;
}

export interface ExceptionChain {
  chain: ExceptionInfo[];
  rootCause: {
    type: string;
    message: string;
    category?: ExceptionCategory;
    actionableHint?: string;
  };
}

export type ExceptionCategory = 
  | 'network' 
  | 'database' 
  | 'authentication' 
  | 'validation' 
  | 'timeout'
  | 'file_system'
  | 'configuration'
  | 'unknown';

export function flattenExceptionChain(
  exceptionDetails: string,
  evaluateExpression: (expr: string) => Promise<string>
): Promise<ExceptionChain>;
```

**Implementation approach:**

1. When we hit an exception breakpoint, we already have the thread stopped
2. Use expression evaluation to walk the chain:
   ```csharp
   $exception                           // Current exception
   $exception.InnerException            // First inner
   $exception.InnerException.InnerException  // Second inner
   // ... continue until null
   ```
3. For each exception level, evaluate:
   ```csharp
   $exception.GetType().FullName
   $exception.Message
   $exception.Source
   $exception.StackTrace.Split('\n')[0]  // Just the throw site
   $exception.Data                        // Additional data dictionary
   ```
4. For special exception types, extract additional properties:
   - `SqlException`: `.Number`, `.State`, `.Class`
   - `HttpRequestException`: `.StatusCode`
   - `SocketException`: `.SocketErrorCode`
   - `IOException`: `.HResult`

### Phase 2: Root Cause Classification

**File: `src/session/exceptions.ts`**

```typescript
const EXCEPTION_CATEGORIES: Record<string, ExceptionCategory> = {
  // Network
  'System.Net.Sockets.SocketException': 'network',
  'System.Net.Http.HttpRequestException': 'network',
  'System.Net.WebException': 'network',
  
  // Database
  'System.Data.SqlClient.SqlException': 'database',
  'Microsoft.Data.SqlClient.SqlException': 'database',
  'Npgsql.NpgsqlException': 'database',
  'MySql.Data.MySqlClient.MySqlException': 'database',
  
  // Authentication
  'System.Security.Authentication.AuthenticationException': 'authentication',
  'System.UnauthorizedAccessException': 'authentication',
  
  // Validation
  'System.ArgumentException': 'validation',
  'System.ArgumentNullException': 'validation',
  'FluentValidation.ValidationException': 'validation',
  
  // Timeout
  'System.TimeoutException': 'timeout',
  'System.Threading.Tasks.TaskCanceledException': 'timeout',
  
  // File system
  'System.IO.FileNotFoundException': 'file_system',
  'System.IO.DirectoryNotFoundException': 'file_system',
  'System.IO.IOException': 'file_system',
  
  // Configuration
  'System.Configuration.ConfigurationException': 'configuration',
  'Microsoft.Extensions.Options.OptionsValidationException': 'configuration',
};

const ACTIONABLE_HINTS: Record<string, string> = {
  'SocketException:10061': 'Connection refused - check if the target service is running',
  'SocketException:10060': 'Connection timed out - check network connectivity and firewall rules',
  'SqlException:18456': 'Login failed - verify database credentials',
  'SqlException:4060': 'Cannot open database - verify database name and permissions',
  'FileNotFoundException': 'File not found - verify the path exists and is accessible',
  'UnauthorizedAccessException': 'Access denied - check file/directory permissions',
};

export function classifyException(chain: ExceptionInfo[]): {
  category: ExceptionCategory;
  actionableHint?: string;
};
```

### Phase 3: Integration with Session Manager

**File: `src/session/manager.ts`**

Modify the exception handling in `handleStoppedEvent`:

```typescript
// When stopped due to exception
if (stoppedEvent.reason === 'exception') {
  const exceptionInfo = await this.client.request('exceptionInfo', { threadId });
  
  // NEW: Flatten the exception chain
  const exceptionChain = await flattenExceptionChain(
    exceptionInfo,
    (expr) => this.evaluateExpression(threadId, frameId, expr)
  );
  
  this.formatter.emit({
    type: 'exception_thrown',
    timestamp: new Date().toISOString(),
    threadId,
    exception: {
      type: exceptionInfo.details?.typeName ?? 'Unknown',
      message: exceptionInfo.description ?? '',
      stackTrace: exceptionInfo.details?.stackTrace,
    },
    // NEW fields
    exceptionChain: exceptionChain.chain,
    rootCause: exceptionChain.rootCause,
    location,
    stackTrace,
    locals,
  });
}
```

### Phase 4: Update Event Types

**File: `src/output/events.ts`**

```typescript
export interface ExceptionChainEntry {
  depth: number;
  type: string;
  message: string;
  source?: string;
  throwSite?: string;
  data?: Record<string, unknown>;
  isRootCause?: boolean;
}

export interface RootCauseInfo {
  type: string;
  message: string;
  category?: 'network' | 'database' | 'authentication' | 'validation' | 'timeout' | 'file_system' | 'configuration' | 'unknown';
  actionableHint?: string;
}

export interface ExceptionThrownEvent extends BaseEvent {
  type: "exception_thrown";
  threadId: number;
  exception: {
    type: string;
    message: string;
    stackTrace?: string;
    innerException?: string;  // Keep for backward compatibility
  };
  // NEW
  exceptionChain?: ExceptionChainEntry[];
  rootCause?: RootCauseInfo;
  location: SourceLocation;
  locals: Record<string, VariableValue>;
}
```

### Phase 5: CLI Options

**File: `src/cli.ts`**

```typescript
.option(
  '--flatten-exceptions',
  'Flatten exception chains and classify root causes (default: true)',
  true
)
.option(
  '--no-flatten-exceptions',
  'Disable exception chain flattening'
)
.option(
  '--exception-chain-depth <depth>',
  'Maximum depth to traverse exception chain (default: 10)',
  (val: string) => parseInt(val, 10),
  10
)
```

## Token Efficiency Analysis

**Before (typical EF Core exception):**
```
~2,500 tokens for full stack traces
```

**After:**
```
~150 tokens for flattened chain with root cause
```

**Reduction: ~94%** for exception events

## Testing Strategy

1. **Unit tests** (`src/session/exceptions.test.ts`):
   - Test chain flattening with mock expression evaluator
   - Test category classification for all known exception types
   - Test actionable hint generation

2. **Integration tests**:
   - Create sample apps that throw nested exceptions:
     - Database connection failure (SqlException → SocketException)
     - HTTP client failure (HttpRequestException → SocketException)
     - File access failure (IOException chain)
   - Verify chain is correctly extracted and classified

3. **Sample in `samples/dotnet/Program.cs`**:
   - Add a code path that generates nested exceptions for testing

## Rollout

1. Implement behind `--flatten-exceptions` flag (default: true)
2. Keep existing `innerException` string for backward compatibility
3. Add new `exceptionChain` and `rootCause` fields
4. Document in CLAUDE.md with examples

## Future Enhancements

1. **AggregateException handling**: Flatten parallel exception trees
2. **Custom exception extractors**: Plugin system for domain-specific exceptions
3. **Exception pattern matching**: Recognize common patterns like "retry exhausted"
4. **Stack trace deduplication**: Remove repeated frames across the chain
