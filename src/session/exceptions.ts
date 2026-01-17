/**
 * Exception Chain Flattening
 *
 * Traverses InnerException chains in .NET exceptions, extracts structured data,
 * classifies root causes, and provides actionable hints.
 *
 * Supports two approaches:
 * 1. Parse from captured locals (preferred - uses already-captured $exception variable)
 * 2. Expression evaluation (fallback - uses DAP evaluate for deeper inspection)
 */

import type { IDapClient } from '../dap/client-interface.js';
import type { VariableValue } from '../output/events.js';

// ========== Types ==========

export type ExceptionCategory =
  | 'network'
  | 'database'
  | 'authentication'
  | 'validation'
  | 'timeout'
  | 'file_system'
  | 'configuration'
  | 'null_reference'
  | 'argument'
  | 'unknown';

export interface ExceptionChainEntry {
  depth: number;
  type: string;
  message: string;
  source?: string;
  throwSite?: string;
  /** Additional data extracted from specific exception types */
  data?: Record<string, unknown>;
  isRootCause?: boolean;
}

export interface RootCauseInfo {
  type: string;
  message: string;
  category: ExceptionCategory;
  actionableHint?: string;
}

export interface ExceptionChainResult {
  chain: ExceptionChainEntry[];
  rootCause: RootCauseInfo;
}

// ========== Exception Classification ==========

const EXCEPTION_CATEGORIES: Record<string, ExceptionCategory> = {
  // Network
  'System.Net.Sockets.SocketException': 'network',
  'System.Net.Http.HttpRequestException': 'network',
  'System.Net.WebException': 'network',
  'System.Net.Http.HttpIOException': 'network',

  // Database
  'System.Data.SqlClient.SqlException': 'database',
  'Microsoft.Data.SqlClient.SqlException': 'database',
  'Npgsql.NpgsqlException': 'database',
  'Npgsql.PostgresException': 'database',
  'MySql.Data.MySqlClient.MySqlException': 'database',
  'MySqlConnector.MySqlException': 'database',
  'Microsoft.EntityFrameworkCore.DbUpdateException': 'database',
  'Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException': 'database',

  // Authentication
  'System.Security.Authentication.AuthenticationException': 'authentication',
  'System.UnauthorizedAccessException': 'authentication',
  'System.Security.SecurityException': 'authentication',

  // Validation
  'System.ArgumentException': 'validation',
  'System.ArgumentNullException': 'validation',
  'System.ArgumentOutOfRangeException': 'validation',
  'System.FormatException': 'validation',
  'System.InvalidCastException': 'validation',
  'FluentValidation.ValidationException': 'validation',
  'System.ComponentModel.DataAnnotations.ValidationException': 'validation',

  // Timeout
  'System.TimeoutException': 'timeout',
  'System.Threading.Tasks.TaskCanceledException': 'timeout',
  'System.OperationCanceledException': 'timeout',

  // File system
  'System.IO.FileNotFoundException': 'file_system',
  'System.IO.DirectoryNotFoundException': 'file_system',
  'System.IO.IOException': 'file_system',
  'System.IO.PathTooLongException': 'file_system',

  // Configuration
  'System.Configuration.ConfigurationException': 'configuration',
  'System.Configuration.ConfigurationErrorsException': 'configuration',
  'Microsoft.Extensions.Options.OptionsValidationException': 'configuration',

  // Null reference
  'System.NullReferenceException': 'null_reference',

  // Argument errors
  'System.InvalidOperationException': 'argument',
  'System.NotSupportedException': 'argument',
  'System.NotImplementedException': 'argument',
};

const ACTIONABLE_HINTS: Record<string, string> = {
  // Socket errors (Windows/POSIX error codes)
  'SocketException:10061':
    'Connection refused - check if the target service is running and the port is correct',
  'SocketException:10060': 'Connection timed out - check network connectivity and firewall rules',
  'SocketException:10051': 'Network unreachable - check network configuration',
  'SocketException:10053': 'Connection aborted - the connection was terminated by the remote host',
  'SocketException:10054': 'Connection reset by peer - the remote host closed the connection',
  'SocketException:111': 'Connection refused (Linux) - check if the target service is running',
  'SocketException:110': 'Connection timed out (Linux) - check network connectivity',

  // SQL Server errors
  'SqlException:18456':
    'SQL Server login failed - verify database credentials and user permissions',
  'SqlException:4060': 'Cannot open database - verify database name exists and user has access',
  'SqlException:53': 'SQL Server not found - verify server name/address and network connectivity',
  'SqlException:40': 'Cannot open connection to SQL Server - check connection string and firewall',
  'SqlException:2': 'SQL Server timeout - server may be overloaded or network is slow',

  // PostgreSQL errors
  'PostgresException:28P01': 'PostgreSQL authentication failed - check username and password',
  'PostgresException:3D000': 'PostgreSQL database does not exist - verify database name',
  'PostgresException:42P01': 'PostgreSQL table does not exist - run migrations or check table name',

  // File system
  FileNotFoundException: 'File not found - verify the file path exists and is accessible',
  DirectoryNotFoundException: 'Directory not found - verify the directory path exists',
  UnauthorizedAccessException:
    'Access denied - check file/directory permissions or run with elevated privileges',
  IOException: 'I/O error - check disk space, file locks, or permissions',

  // Null reference
  NullReferenceException:
    'Null reference - an object was not initialized before use. Check for null values in the call chain',

  // Validation
  ArgumentNullException:
    'A required argument was null - check that all required parameters are provided',
  ArgumentException: 'Invalid argument - check the parameter values being passed',
  ArgumentOutOfRangeException:
    'Argument out of range - check that values are within expected bounds',
  ValidationException: 'Validation failed - check the input data against validation rules',

  // Timeout
  TimeoutException: 'Operation timed out - increase timeout or check for performance issues',
  TaskCanceledException: 'Task was cancelled - may indicate timeout or explicit cancellation',
  OperationCanceledException: 'Operation was cancelled - check CancellationToken usage',

  // Configuration
  ConfigurationException: 'Configuration error - check app settings and configuration files',
  OptionsValidationException:
    'Options validation failed - check configuration values match expected schema',

  // HTTP
  'HttpRequestException:404': 'HTTP 404 Not Found - verify the URL is correct',
  'HttpRequestException:401': 'HTTP 401 Unauthorized - check authentication credentials',
  'HttpRequestException:403': 'HTTP 403 Forbidden - check authorization permissions',
  'HttpRequestException:500': 'HTTP 500 Server Error - check server logs for details',
  'HttpRequestException:503': 'HTTP 503 Service Unavailable - service may be down or overloaded',
};

// ========== Chain Extraction ==========

/**
 * Extract and flatten an exception chain from captured locals.
 * This parses the $exception variable that's already captured in locals.
 *
 * @param locals - Captured local variables (should include $exception)
 * @param maxDepth - Maximum depth to traverse (default: 10)
 * @returns Flattened exception chain with root cause classification
 */
export function flattenExceptionChainFromLocals(
  locals: Record<string, VariableValue>,
  maxDepth: number = 10
): ExceptionChainResult | null {
  const exceptionVar = locals['$exception'];
  if (!exceptionVar) {
    return null;
  }

  const chain: ExceptionChainEntry[] = [];
  let current: VariableValue | undefined = exceptionVar;
  let depth = 0;

  while (current && depth < maxDepth) {
    const entry = extractExceptionEntryFromVariable(current, depth);
    if (!entry) {
      break;
    }

    chain.push(entry);

    // Look for InnerException in the value
    const innerException = findInnerException(current);
    if (!innerException) {
      break;
    }

    current = innerException;
    depth++;
  }

  if (chain.length === 0) {
    return null;
  }

  // Mark the deepest exception as root cause
  chain[chain.length - 1].isRootCause = true;

  // Classify the root cause
  const rootException = chain[chain.length - 1];
  const rootCause = classifyRootCause(rootException);

  return { chain, rootCause };
}

/**
 * Extract the actual exception type from a type string like "System.Exception {DbConnectionException}"
 */
function extractExceptionType(typeStr: string): string {
  // Handle "System.Exception {ActualType}" format
  const match = typeStr.match(/\{([^}]+)\}/);
  if (match) {
    return match[1];
  }
  return typeStr;
}

/**
 * Extract exception entry from a VariableValue representing an exception
 */
function extractExceptionEntryFromVariable(
  variable: VariableValue,
  depth: number
): ExceptionChainEntry | null {
  const rawType = variable.type;
  if (!rawType) return null;

  // Extract the actual type (handle "System.Exception {ActualType}" format)
  const type = extractExceptionType(rawType);

  // Extract message from the value
  let message = '';
  let source: string | undefined;
  let throwSite: string | undefined;
  const data: Record<string, unknown> = {};

  // Handle case where value is a string (often for deeply nested exceptions)
  if (typeof variable.value === 'string') {
    // Parse message from string like "{NetworkException: Connection refused...}"
    const msgMatch = variable.value.match(/^{?[^:]+:\s*([^\n]+)/);
    if (msgMatch) {
      message = msgMatch[1].trim();
    } else {
      message = variable.value;
    }
  } else if (typeof variable.value === 'object' && variable.value !== null) {
    const val = variable.value as Record<string, VariableValue>;

    // Get Message
    if (val['Message']) {
      message = extractStringValue(val['Message']);
    }

    // Get Source
    if (val['Source']) {
      const sourceVal = extractStringValue(val['Source']);
      if (sourceVal && sourceVal !== 'null') {
        source = sourceVal;
      }
    }

    // Get TargetSite for throw location
    if (val['TargetSite']) {
      const targetSiteVal = val['TargetSite'];
      if (typeof targetSiteVal.value === 'string') {
        // Value is like "{Void ValidateOrder(Order)}"
        const match = targetSiteVal.value.match(/\{([^}]+)\}/);
        if (match) {
          throwSite = match[1];
        }
      }
    }

    // Extract additional data for specific exception types
    if (type.includes('SqlException')) {
      if (val['Number']) data.sqlErrorNumber = extractNumberValue(val['Number']);
      if (val['State']) data.sqlState = extractNumberValue(val['State']);
    }

    if (type.includes('SocketException') || type.includes('NetworkException')) {
      if (val['SocketErrorCode']) data.socketErrorCode = extractStringValue(val['SocketErrorCode']);
      if (val['NativeErrorCode']) data.nativeErrorCode = extractNumberValue(val['NativeErrorCode']);
      if (val['ErrorCode']) data.errorCode = extractNumberValue(val['ErrorCode']);
      // Also try to get error code from the custom ErrorCode property
      if (val['<ErrorCode>k__BackingField'])
        data.errorCode = extractNumberValue(val['<ErrorCode>k__BackingField']);
    }

    if (type.includes('HttpException') || type.includes('HttpRequestException')) {
      if (val['StatusCode']) data.httpStatusCode = extractNumberValue(val['StatusCode']);
      if (val['<StatusCode>k__BackingField'])
        data.httpStatusCode = extractNumberValue(val['<StatusCode>k__BackingField']);
    }

    if (type.includes('ArgumentException') || type.includes('ArgumentNullException')) {
      if (val['ParamName']) data.paramName = extractStringValue(val['ParamName']);
    }

    if (type.includes('FileNotFoundException') || type.includes('FileAccessException')) {
      if (val['FileName']) data.fileName = extractStringValue(val['FileName']);
      if (val['FilePath']) data.filePath = extractStringValue(val['FilePath']);
      if (val['<FilePath>k__BackingField'])
        data.filePath = extractStringValue(val['<FilePath>k__BackingField']);
    }
  }

  return {
    depth,
    type,
    message,
    source,
    throwSite,
    data: Object.keys(data).length > 0 ? data : undefined,
  };
}

/**
 * Find InnerException in a VariableValue
 */
function findInnerException(variable: VariableValue): VariableValue | undefined {
  if (typeof variable.value === 'object' && variable.value !== null) {
    const val = variable.value as Record<string, VariableValue>;
    const inner = val['InnerException'];

    // Check if inner exception exists and is not null
    if (inner && inner.type) {
      // Skip if type is literally "null" or if it's a null value
      if (
        inner.type === 'null' ||
        (inner.type.toLowerCase() === 'object' && inner.value === null)
      ) {
        return undefined;
      }
      // Skip if value indicates null (some debuggers show this)
      if (inner.value === null || inner.value === 'null') {
        return undefined;
      }
      return inner;
    }
  }
  return undefined;
}

/**
 * Extract string value from a VariableValue
 */
function extractStringValue(variable: VariableValue): string {
  if (typeof variable.value === 'string') {
    return cleanString(variable.value);
  }
  if (variable.value === null || variable.value === undefined) {
    return '';
  }
  return String(variable.value);
}

/**
 * Extract number value from a VariableValue
 */
function extractNumberValue(variable: VariableValue): number | undefined {
  if (typeof variable.value === 'number') {
    return variable.value;
  }
  if (typeof variable.value === 'string') {
    const num = parseInt(variable.value, 10);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

/**
 * Extract and flatten an exception chain using DAP expression evaluation.
 * This is a fallback method when locals parsing doesn't provide enough detail.
 *
 * @param client - DAP client for evaluating expressions
 * @param frameId - Stack frame ID to evaluate in
 * @param maxDepth - Maximum depth to traverse (default: 10)
 * @returns Flattened exception chain with root cause classification
 */
export async function flattenExceptionChain(
  client: IDapClient,
  frameId: number,
  maxDepth: number = 10
): Promise<ExceptionChainResult | null> {
  const chain: ExceptionChainEntry[] = [];

  try {
    // Start with $exception (current exception in debugger)
    let currentExpr = '$exception';
    let depth = 0;

    while (depth < maxDepth) {
      // Get exception type
      const typeResult = await safeEvaluate(client, frameId, `${currentExpr}.GetType().FullName`);
      if (!typeResult || typeResult === 'null') break;

      const exceptionType = cleanString(typeResult);

      // Get message
      const messageResult = await safeEvaluate(client, frameId, `${currentExpr}.Message`);
      const message = cleanString(messageResult ?? '');

      // Get source (assembly/module that threw)
      const sourceResult = await safeEvaluate(client, frameId, `${currentExpr}.Source`);
      const source =
        sourceResult && sourceResult !== 'null' ? cleanString(sourceResult) : undefined;

      // Get throw site (first line of stack trace)
      const throwSite = await extractThrowSite(client, frameId, currentExpr);

      // Get additional data for specific exception types
      const data = await extractExceptionData(client, frameId, currentExpr, exceptionType);

      chain.push({
        depth,
        type: exceptionType,
        message,
        source,
        throwSite,
        data: Object.keys(data).length > 0 ? data : undefined,
      });

      // Check for inner exception
      const hasInner = await safeEvaluate(client, frameId, `${currentExpr}.InnerException != null`);
      if (hasInner !== 'true') break;

      currentExpr = `${currentExpr}.InnerException`;
      depth++;
    }

    if (chain.length === 0) {
      return null;
    }

    // Mark the deepest exception as root cause
    chain[chain.length - 1].isRootCause = true;

    // Classify the root cause
    const rootException = chain[chain.length - 1];
    const rootCause = classifyRootCause(rootException);

    return { chain, rootCause };
  } catch {
    // If we can't evaluate expressions, return null
    return null;
  }
}

/**
 * Safely evaluate an expression, returning null on error
 */
async function safeEvaluate(
  client: IDapClient,
  frameId: number,
  expression: string
): Promise<string | null> {
  try {
    const result = await client.evaluate({
      expression,
      frameId,
      context: 'watch',
    });
    return result.result;
  } catch {
    return null;
  }
}

/**
 * Extract the throw site (first meaningful line of stack trace)
 */
async function extractThrowSite(
  client: IDapClient,
  frameId: number,
  exceptionExpr: string
): Promise<string | undefined> {
  try {
    // Try to get TargetSite which gives the method that threw
    const targetSite = await safeEvaluate(client, frameId, `${exceptionExpr}.TargetSite?.Name`);

    if (targetSite && targetSite !== 'null') {
      // Get the declaring type
      const declaringType = await safeEvaluate(
        client,
        frameId,
        `${exceptionExpr}.TargetSite?.DeclaringType?.Name`
      );

      if (declaringType && declaringType !== 'null') {
        return `${cleanString(declaringType)}.${cleanString(targetSite)}`;
      }
      return cleanString(targetSite);
    }

    // Fall back to parsing first line of StackTrace
    const stackTrace = await safeEvaluate(client, frameId, `${exceptionExpr}.StackTrace`);
    if (stackTrace && stackTrace !== 'null') {
      const firstLine = stackTrace.split('\\n')[0] ?? stackTrace.split('\n')[0];
      if (firstLine) {
        // Extract method name from "   at Namespace.Class.Method(...)"
        const match = firstLine.match(/at\s+([^\(]+)/);
        if (match) {
          return match[1].trim();
        }
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract additional data from specific exception types
 */
async function extractExceptionData(
  client: IDapClient,
  frameId: number,
  exceptionExpr: string,
  exceptionType: string
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};

  // SqlException specific data
  if (exceptionType.includes('SqlException')) {
    const number = await safeEvaluate(client, frameId, `${exceptionExpr}.Number`);
    if (number && number !== '0') data.sqlErrorNumber = parseInt(number, 10);

    const state = await safeEvaluate(client, frameId, `${exceptionExpr}.State`);
    if (state && state !== '0') data.sqlState = parseInt(state, 10);

    const errorClass = await safeEvaluate(client, frameId, `${exceptionExpr}.Class`);
    if (errorClass && errorClass !== '0') data.sqlClass = parseInt(errorClass, 10);
  }

  // SocketException specific data
  if (exceptionType.includes('SocketException')) {
    const errorCode = await safeEvaluate(client, frameId, `${exceptionExpr}.SocketErrorCode`);
    if (errorCode) data.socketErrorCode = errorCode;

    const nativeCode = await safeEvaluate(client, frameId, `${exceptionExpr}.NativeErrorCode`);
    if (nativeCode && nativeCode !== '0') data.nativeErrorCode = parseInt(nativeCode, 10);
  }

  // HttpRequestException specific data
  if (exceptionType.includes('HttpRequestException')) {
    const statusCode = await safeEvaluate(client, frameId, `${exceptionExpr}.StatusCode`);
    if (statusCode && statusCode !== 'null') data.httpStatusCode = statusCode;
  }

  // PostgresException specific data
  if (exceptionType.includes('PostgresException') || exceptionType.includes('NpgsqlException')) {
    const sqlState = await safeEvaluate(client, frameId, `${exceptionExpr}.SqlState`);
    if (sqlState) data.postgresSqlState = cleanString(sqlState);

    const code = await safeEvaluate(client, frameId, `${exceptionExpr}.Code`);
    if (code) data.postgresCode = cleanString(code);
  }

  // ArgumentException specific data
  if (
    exceptionType.includes('ArgumentException') ||
    exceptionType.includes('ArgumentNullException')
  ) {
    const paramName = await safeEvaluate(client, frameId, `${exceptionExpr}.ParamName`);
    if (paramName && paramName !== 'null') data.paramName = cleanString(paramName);
  }

  // FileNotFoundException specific data
  if (exceptionType.includes('FileNotFoundException')) {
    const fileName = await safeEvaluate(client, frameId, `${exceptionExpr}.FileName`);
    if (fileName && fileName !== 'null') data.fileName = cleanString(fileName);
  }

  return data;
}

/**
 * Classify the root cause exception and generate actionable hint
 */
function classifyRootCause(exception: ExceptionChainEntry): RootCauseInfo {
  const { type, message, data } = exception;

  // Determine category
  let category: ExceptionCategory = 'unknown';

  // Check exact type match first
  if (EXCEPTION_CATEGORIES[type]) {
    category = EXCEPTION_CATEGORIES[type];
  } else {
    // Check partial matches
    for (const [pattern, cat] of Object.entries(EXCEPTION_CATEGORIES)) {
      if (type.includes(pattern.split('.').pop() ?? pattern)) {
        category = cat;
        break;
      }
    }
  }

  // Generate actionable hint
  let actionableHint: string | undefined;

  // Try specific error code hints first
  if (data?.socketErrorCode || data?.nativeErrorCode) {
    const code = data.nativeErrorCode ?? data.socketErrorCode;
    const key = `SocketException:${code}`;
    actionableHint = ACTIONABLE_HINTS[key];
  } else if (data?.sqlErrorNumber) {
    const key = `SqlException:${data.sqlErrorNumber}`;
    actionableHint = ACTIONABLE_HINTS[key];
  } else if (data?.postgresSqlState) {
    const key = `PostgresException:${data.postgresSqlState}`;
    actionableHint = ACTIONABLE_HINTS[key];
  } else if (data?.httpStatusCode) {
    const key = `HttpRequestException:${data.httpStatusCode}`;
    actionableHint = ACTIONABLE_HINTS[key];
  }

  // Fall back to type-based hints
  if (!actionableHint) {
    const shortType = type.split('.').pop() ?? type;
    actionableHint = ACTIONABLE_HINTS[shortType];
  }

  // Generate a generic hint if nothing specific matches
  if (!actionableHint) {
    actionableHint = generateGenericHint(category, message);
  }

  return {
    type,
    message,
    category,
    actionableHint,
  };
}

/**
 * Generate a generic actionable hint based on category
 */
function generateGenericHint(category: ExceptionCategory, message: string): string {
  switch (category) {
    case 'network':
      return 'Network error - check connectivity, DNS resolution, and firewall rules';
    case 'database':
      return 'Database error - check connection string, credentials, and database availability';
    case 'authentication':
      return 'Authentication/authorization error - verify credentials and permissions';
    case 'validation':
      return 'Validation error - check input data matches expected format and constraints';
    case 'timeout':
      return 'Timeout error - increase timeout values or investigate performance bottlenecks';
    case 'file_system':
      return 'File system error - check paths, permissions, and disk space';
    case 'configuration':
      return 'Configuration error - verify app settings and environment variables';
    case 'null_reference':
      return 'Null reference - trace the call chain to find where null was introduced';
    case 'argument':
      return 'Argument/operation error - check the method contract and input values';
    default:
      // Try to extract something useful from the message
      if (message.toLowerCase().includes('connection')) {
        return 'Connection error - check network and service availability';
      }
      if (message.toLowerCase().includes('timeout')) {
        return 'Operation timed out - check for performance issues or increase timeout';
      }
      if (
        message.toLowerCase().includes('permission') ||
        message.toLowerCase().includes('access')
      ) {
        return 'Permission error - check access rights and credentials';
      }
      return 'Check the exception message and stack trace for details';
  }
}

/**
 * Clean a string value from debugger output (remove quotes, handle escapes)
 */
function cleanString(value: string): string {
  // Remove surrounding quotes
  let cleaned = value.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1);
  }

  // Unescape common escape sequences
  cleaned = cleaned
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');

  return cleaned;
}
