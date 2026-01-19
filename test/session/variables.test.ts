/**
 * Unit tests for VariableInspector diffing functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VariableInspector } from '../../src/session/variables.js';
import type { VariableValue } from '../../src/output/events.js';
import type { IDapClient } from '../../src/dap/client-interface.js';
import type {
  ScopesResponse,
  VariablesResponse,
  EvaluateResponse,
} from '../../src/dap/protocol.js';

// Minimal mock interface for testing - only the methods VariableInspector actually uses
interface MockDapClient {
  scopes: () => Promise<ScopesResponse>;
  variables: () => Promise<VariablesResponse>;
  evaluate: () => Promise<EvaluateResponse>;
}

// Mock DapClient with minimal implementation for testing
const mockClient: MockDapClient = {
  scopes: async () => ({ scopes: [] }),
  variables: async () => ({ variables: [] }),
  evaluate: async () => ({ result: '', variablesReference: 0 }),
};

describe('VariableInspector', () => {
  let inspector: VariableInspector;

  beforeEach(() => {
    inspector = new VariableInspector(mockClient as unknown as IDapClient);
  });

  describe('valuesEqual', () => {
    it('returns true for identical primitive values', () => {
      const a: VariableValue = { type: 'int', value: 42 };
      const b: VariableValue = { type: 'int', value: 42 };
      expect(inspector.valuesEqual(a, b)).toBe(true);
    });

    it('returns false for different primitive values', () => {
      const a: VariableValue = { type: 'int', value: 42 };
      const b: VariableValue = { type: 'int', value: 100 };
      expect(inspector.valuesEqual(a, b)).toBe(false);
    });

    it('returns false for different types', () => {
      const a: VariableValue = { type: 'int', value: 42 };
      const b: VariableValue = { type: 'string', value: '42' };
      expect(inspector.valuesEqual(a, b)).toBe(false);
    });

    it('returns true for identical string values', () => {
      const a: VariableValue = { type: 'string', value: 'hello' };
      const b: VariableValue = { type: 'string', value: 'hello' };
      expect(inspector.valuesEqual(a, b)).toBe(true);
    });

    it('returns false for different string values', () => {
      const a: VariableValue = { type: 'string', value: 'hello' };
      const b: VariableValue = { type: 'string', value: 'world' };
      expect(inspector.valuesEqual(a, b)).toBe(false);
    });

    it('returns true for identical boolean values', () => {
      const a: VariableValue = { type: 'bool', value: true };
      const b: VariableValue = { type: 'bool', value: true };
      expect(inspector.valuesEqual(a, b)).toBe(true);
    });

    it('returns false for different boolean values', () => {
      const a: VariableValue = { type: 'bool', value: true };
      const b: VariableValue = { type: 'bool', value: false };
      expect(inspector.valuesEqual(a, b)).toBe(false);
    });

    it('returns true for identical null values', () => {
      const a: VariableValue = { type: 'object', value: null };
      const b: VariableValue = { type: 'object', value: null };
      expect(inspector.valuesEqual(a, b)).toBe(true);
    });

    it('returns true for identical object values', () => {
      const a: VariableValue = {
        type: 'Order',
        value: { id: { type: 'string', value: 'ORD-001' }, total: { type: 'int', value: 100 } },
      };
      const b: VariableValue = {
        type: 'Order',
        value: { id: { type: 'string', value: 'ORD-001' }, total: { type: 'int', value: 100 } },
      };
      expect(inspector.valuesEqual(a, b)).toBe(true);
    });

    it('returns false for different object values', () => {
      const a: VariableValue = {
        type: 'Order',
        value: { id: { type: 'string', value: 'ORD-001' }, total: { type: 'int', value: 100 } },
      };
      const b: VariableValue = {
        type: 'Order',
        value: { id: { type: 'string', value: 'ORD-001' }, total: { type: 'int', value: 200 } },
      };
      expect(inspector.valuesEqual(a, b)).toBe(false);
    });
  });

  describe('diffVariables', () => {
    it('detects created variables', () => {
      const prev: Record<string, VariableValue> = {};
      const curr: Record<string, VariableValue> = {
        x: { type: 'int', value: 1 },
      };

      const changes = inspector.diffVariables(prev, curr);

      expect(changes).toEqual([
        { name: 'x', changeType: 'created', newValue: { type: 'int', value: 1 } },
      ]);
    });

    it('detects deleted variables', () => {
      const prev: Record<string, VariableValue> = {
        x: { type: 'int', value: 1 },
      };
      const curr: Record<string, VariableValue> = {};

      const changes = inspector.diffVariables(prev, curr);

      expect(changes).toEqual([
        { name: 'x', changeType: 'deleted', oldValue: { type: 'int', value: 1 } },
      ]);
    });

    it('detects modified primitive variables (newValue only for token efficiency)', () => {
      const prev: Record<string, VariableValue> = {
        total: { type: 'int', value: 100 },
      };
      const curr: Record<string, VariableValue> = {
        total: { type: 'int', value: 150 },
      };

      const changes = inspector.diffVariables(prev, curr);

      // Modified variables only include newValue (not oldValue) for token efficiency
      expect(changes).toEqual([
        {
          name: 'total',
          changeType: 'modified',
          newValue: { type: 'int', value: 150 },
        },
      ]);
    });

    it('detects modified object variables (newValue only for token efficiency)', () => {
      const prev: Record<string, VariableValue> = {
        order: {
          type: 'Order',
          value: { total: { type: 'int', value: 100 } },
        },
      };
      const curr: Record<string, VariableValue> = {
        order: {
          type: 'Order',
          value: { total: { type: 'int', value: 200 } },
        },
      };

      const changes = inspector.diffVariables(prev, curr);

      // Modified variables only include newValue (not oldValue) for token efficiency
      expect(changes).toEqual([
        {
          name: 'order',
          changeType: 'modified',
          newValue: { type: 'Order', value: { total: { type: 'int', value: 200 } } },
        },
      ]);
    });

    it('ignores unchanged variables', () => {
      const prev: Record<string, VariableValue> = {
        unchanged: { type: 'int', value: 42 },
        changed: { type: 'int', value: 1 },
      };
      const curr: Record<string, VariableValue> = {
        unchanged: { type: 'int', value: 42 },
        changed: { type: 'int', value: 2 },
      };

      const changes = inspector.diffVariables(prev, curr);

      expect(changes).toHaveLength(1);
      expect(changes[0].name).toBe('changed');
    });

    it('handles multiple changes', () => {
      const prev: Record<string, VariableValue> = {
        deleted: { type: 'int', value: 1 },
        modified: { type: 'int', value: 10 },
        unchanged: { type: 'string', value: 'same' },
      };
      const curr: Record<string, VariableValue> = {
        created: { type: 'int', value: 99 },
        modified: { type: 'int', value: 20 },
        unchanged: { type: 'string', value: 'same' },
      };

      const changes = inspector.diffVariables(prev, curr);

      expect(changes).toHaveLength(3);
      expect(changes.find((c) => c.name === 'deleted')?.changeType).toBe('deleted');
      expect(changes.find((c) => c.name === 'modified')?.changeType).toBe('modified');
      expect(changes.find((c) => c.name === 'created')?.changeType).toBe('created');
    });

    it('returns empty array when nothing changed', () => {
      const prev: Record<string, VariableValue> = {
        x: { type: 'int', value: 1 },
        y: { type: 'string', value: 'hello' },
      };
      const curr: Record<string, VariableValue> = {
        x: { type: 'int', value: 1 },
        y: { type: 'string', value: 'hello' },
      };

      const changes = inspector.diffVariables(prev, curr);

      expect(changes).toEqual([]);
    });

    it('handles empty previous and current state', () => {
      const prev: Record<string, VariableValue> = {};
      const curr: Record<string, VariableValue> = {};

      const changes = inspector.diffVariables(prev, curr);

      expect(changes).toEqual([]);
    });

    it('detects type changes as modifications (newValue only for token efficiency)', () => {
      const prev: Record<string, VariableValue> = {
        value: { type: 'int', value: 42 },
      };
      const curr: Record<string, VariableValue> = {
        value: { type: 'string', value: '42' },
      };

      const changes = inspector.diffVariables(prev, curr);

      // Modified variables only include newValue (not oldValue) for token efficiency
      expect(changes).toEqual([
        {
          name: 'value',
          changeType: 'modified',
          newValue: { type: 'string', value: '42' },
        },
      ]);
    });
  });
});
