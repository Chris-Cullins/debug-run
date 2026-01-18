/**
 * Unit tests for exception chain flattening functionality
 */

import { describe, it, expect } from 'vitest';
import { flattenExceptionChainFromLocals } from './exceptions.js';
import type { VariableValue } from '../output/events.js';

describe('flattenExceptionChainFromLocals', () => {
  describe('basic exception parsing', () => {
    it('extracts single exception with no inner exception', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.InvalidOperationException',
          value: {
            Message: { type: 'string', value: 'Operation is not valid' },
            Source: { type: 'string', value: 'TestAssembly' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result).not.toBeNull();
      expect(result!.chain).toHaveLength(1);
      expect(result!.chain[0].type).toBe('System.InvalidOperationException');
      expect(result!.chain[0].message).toBe('Operation is not valid');
      expect(result!.chain[0].source).toBe('TestAssembly');
      expect(result!.chain[0].isRootCause).toBe(true);
    });

    it('returns null when no $exception in locals', () => {
      const locals: Record<string, VariableValue> = {
        someVar: { type: 'int', value: 42 },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result).toBeNull();
    });

    it('extracts exception chain with inner exceptions', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.Exception {DbConnectionException}',
          value: {
            Message: { type: 'string', value: 'Database connection failed' },
            Source: { type: 'string', value: 'DataLayer' },
            InnerException: {
              type: 'System.Net.Sockets.SocketException',
              value: {
                Message: { type: 'string', value: 'Connection refused' },
                Source: { type: 'string', value: 'System.Net.Sockets' },
                InnerException: { type: 'null', value: null },
              },
            },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result).not.toBeNull();
      expect(result!.chain).toHaveLength(2);
      expect(result!.chain[0].type).toBe('DbConnectionException');
      expect(result!.chain[0].depth).toBe(0);
      expect(result!.chain[0].isRootCause).toBeUndefined();
      expect(result!.chain[1].type).toBe('System.Net.Sockets.SocketException');
      expect(result!.chain[1].depth).toBe(1);
      expect(result!.chain[1].isRootCause).toBe(true);
    });

    it('respects maxDepth parameter', () => {
      // Create a deep exception chain
      const innerException3: VariableValue = {
        type: 'System.Exception',
        value: {
          Message: { type: 'string', value: 'Level 3' },
          InnerException: { type: 'null', value: null },
        },
      };
      const innerException2: VariableValue = {
        type: 'System.Exception',
        value: {
          Message: { type: 'string', value: 'Level 2' },
          InnerException: innerException3,
        },
      };
      const innerException1: VariableValue = {
        type: 'System.Exception',
        value: {
          Message: { type: 'string', value: 'Level 1' },
          InnerException: innerException2,
        },
      };
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.Exception',
          value: {
            Message: { type: 'string', value: 'Level 0' },
            InnerException: innerException1,
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals, 2);

      expect(result).not.toBeNull();
      expect(result!.chain).toHaveLength(2);
      expect(result!.chain[0].message).toBe('Level 0');
      expect(result!.chain[1].message).toBe('Level 1');
    });
  });

  describe('exception type extraction', () => {
    it('extracts actual type from "System.Exception {ActualType}" format', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.Exception {CustomException}',
          value: {
            Message: { type: 'string', value: 'Custom error' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.chain[0].type).toBe('CustomException');
    });

    it('uses full type when no curly brace format', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.ArgumentNullException',
          value: {
            Message: { type: 'string', value: 'Value cannot be null' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.chain[0].type).toBe('System.ArgumentNullException');
    });
  });

  describe('exception data extraction', () => {
    it('extracts SQL error number from SqlException', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'Microsoft.Data.SqlClient.SqlException',
          value: {
            Message: { type: 'string', value: 'Login failed' },
            Number: { type: 'int', value: 18456 },
            State: { type: 'int', value: 1 },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.chain[0].data).toBeDefined();
      expect(result!.chain[0].data!.sqlErrorNumber).toBe(18456);
      expect(result!.chain[0].data!.sqlState).toBe(1);
    });

    it('extracts socket error code from SocketException', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.Net.Sockets.SocketException',
          value: {
            Message: { type: 'string', value: 'Connection refused' },
            SocketErrorCode: { type: 'string', value: 'ConnectionRefused' },
            NativeErrorCode: { type: 'int', value: 10061 },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.chain[0].data).toBeDefined();
      expect(result!.chain[0].data!.socketErrorCode).toBe('ConnectionRefused');
      expect(result!.chain[0].data!.nativeErrorCode).toBe(10061);
    });

    it('extracts param name from ArgumentNullException', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.ArgumentNullException',
          value: {
            Message: { type: 'string', value: 'Value cannot be null' },
            ParamName: { type: 'string', value: 'customerId' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.chain[0].data).toBeDefined();
      expect(result!.chain[0].data!.paramName).toBe('customerId');
    });

    it('extracts file name from FileNotFoundException', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.IO.FileNotFoundException',
          value: {
            Message: { type: 'string', value: 'Could not find file' },
            FileName: { type: 'string', value: '/path/to/missing.txt' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.chain[0].data).toBeDefined();
      expect(result!.chain[0].data!.fileName).toBe('/path/to/missing.txt');
    });
  });

  describe('root cause classification', () => {
    it('classifies network exceptions', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.Net.Sockets.SocketException',
          value: {
            Message: { type: 'string', value: 'Connection refused' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.rootCause.category).toBe('network');
    });

    it('classifies database exceptions', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'Microsoft.Data.SqlClient.SqlException',
          value: {
            Message: { type: 'string', value: 'Database error' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.rootCause.category).toBe('database');
    });

    it('classifies validation exceptions', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.ArgumentNullException',
          value: {
            Message: { type: 'string', value: 'Value cannot be null' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.rootCause.category).toBe('validation');
    });

    it('classifies timeout exceptions', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.TimeoutException',
          value: {
            Message: { type: 'string', value: 'Operation timed out' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.rootCause.category).toBe('timeout');
    });

    it('classifies file system exceptions', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.IO.FileNotFoundException',
          value: {
            Message: { type: 'string', value: 'File not found' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.rootCause.category).toBe('file_system');
    });

    it('classifies null reference exceptions', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.NullReferenceException',
          value: {
            Message: { type: 'string', value: 'Object reference not set' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.rootCause.category).toBe('null_reference');
    });

    it('returns unknown for unrecognized exceptions', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'CustomNamespace.CustomException',
          value: {
            Message: { type: 'string', value: 'Some custom error' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.rootCause.category).toBe('unknown');
    });
  });

  describe('actionable hints', () => {
    it('provides actionable hint for SQL login failure', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'Microsoft.Data.SqlClient.SqlException',
          value: {
            Message: { type: 'string', value: 'Login failed for user' },
            Number: { type: 'int', value: 18456 },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.rootCause.actionableHint).toContain('login');
    });

    it('provides actionable hint for socket connection refused', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.Net.Sockets.SocketException',
          value: {
            Message: { type: 'string', value: 'Connection refused' },
            NativeErrorCode: { type: 'int', value: 10061 },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.rootCause.actionableHint).toContain('refused');
    });

    it('provides actionable hint for null reference', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.NullReferenceException',
          value: {
            Message: { type: 'string', value: 'Object reference not set' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.rootCause.actionableHint).toContain('null');
    });

    it('provides generic hint when no specific hint available', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'CustomNamespace.VeryCustomException',
          value: {
            Message: { type: 'string', value: 'Something went wrong' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result!.rootCause.actionableHint).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('handles exception with string value instead of object', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.Exception {NetworkException}',
          value: '{NetworkException: Connection refused to host 10.0.0.1}',
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result).not.toBeNull();
      expect(result!.chain[0].type).toBe('NetworkException');
      expect(result!.chain[0].message).toContain('Connection refused');
    });

    it('handles null Source gracefully', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.Exception',
          value: {
            Message: { type: 'string', value: 'Error' },
            Source: { type: 'string', value: 'null' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result).not.toBeNull();
      expect(result!.chain[0].source).toBeUndefined();
    });

    it('extracts TargetSite for throw location', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: 'System.Exception',
          value: {
            Message: { type: 'string', value: 'Error' },
            TargetSite: { type: 'MethodBase', value: '{Void ValidateOrder(Order)}' },
            InnerException: { type: 'null', value: null },
          },
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result).not.toBeNull();
      expect(result!.chain[0].throwSite).toBe('Void ValidateOrder(Order)');
    });

    it('returns null for empty exception variable', () => {
      const locals: Record<string, VariableValue> = {
        $exception: {
          type: '',
          value: null,
        },
      };

      const result = flattenExceptionChainFromLocals(locals);

      expect(result).toBeNull();
    });
  });
});
