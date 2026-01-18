/**
 * Unit tests for breakpoint parsing functionality
 */

import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseBreakpointSpec, parseLogpointSpec } from './breakpoints.js';

describe('parseBreakpointSpec', () => {
  describe('basic parsing', () => {
    it('parses file:line format', () => {
      const result = parseBreakpointSpec('test.ts:45');
      expect(result.line).toBe(45);
      expect(result.file).toContain('test.ts');
    });

    it('parses file:line?condition format', () => {
      const result = parseBreakpointSpec('test.ts:10?x > 5');
      expect(result.line).toBe(10);
      expect(result.condition).toBe('x > 5');
    });

    it('parses file:line#hitCount format', () => {
      const result = parseBreakpointSpec('test.ts:20#3');
      expect(result.line).toBe(20);
      expect(result.hitCondition).toBe('3');
    });

    it('throws on invalid format', () => {
      expect(() => parseBreakpointSpec('invalid')).toThrow('Invalid breakpoint format');
    });

    it('throws on invalid line number', () => {
      expect(() => parseBreakpointSpec('test.ts:0')).toThrow('Invalid line number');
      expect(() => parseBreakpointSpec('test.ts:-1')).toThrow('Invalid breakpoint format');
    });
  });

  describe('path resolution without programPath', () => {
    it('resolves relative paths against cwd when no programPath', () => {
      const result = parseBreakpointSpec('src/file.ts:10');
      // Should resolve against cwd
      expect(result.file).toBe(path.resolve('src/file.ts'));
    });

    it('preserves absolute paths', () => {
      const result = parseBreakpointSpec('/tmp/test.js:5');
      expect(result.file).toBe('/tmp/test.js');
    });
  });

  describe('path resolution with programPath', () => {
    it('resolves relative path against program directory when basename matches', () => {
      const result = parseBreakpointSpec('test.js:3', '/tmp/test.js');
      expect(result.file).toBe('/tmp/test.js');
    });

    it('resolves relative path with subdirectory against program directory', () => {
      const result = parseBreakpointSpec('src/utils.ts:10', '/home/user/project/main.ts');
      expect(result.file).toBe('/home/user/project/src/utils.ts');
    });

    it('preserves absolute paths even with programPath', () => {
      const result = parseBreakpointSpec('/other/path.js:5', '/tmp/test.js');
      expect(result.file).toBe('/other/path.js');
    });

    it('resolves relative path against program directory for different filename', () => {
      const result = parseBreakpointSpec('helper.ts:15', '/home/user/project/main.ts');
      expect(result.file).toBe('/home/user/project/helper.ts');
    });
  });
});

describe('parseLogpointSpec', () => {
  describe('basic parsing', () => {
    it('parses file:line|message format', () => {
      const result = parseLogpointSpec('test.ts:10|value is {x}');
      expect(result.line).toBe(10);
      expect(result.logMessage).toBe('value is {x}');
    });

    it('throws on invalid format', () => {
      expect(() => parseLogpointSpec('test.ts:10')).toThrow('Invalid logpoint format');
    });
  });

  describe('path resolution with programPath', () => {
    it('resolves relative path against program directory', () => {
      const result = parseLogpointSpec('test.js:5|logging', '/tmp/test.js');
      expect(result.file).toBe('/tmp/test.js');
    });
  });
});
