/**
 * Unit tests for breakpoint parsing functionality
 */

import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseBreakpointSpec, parseLogpointSpec } from './breakpoints.js';

/**
 * Helper to create a platform-independent absolute path for testing.
 * On Windows, uses C:\tmp\..., on POSIX uses /tmp/...
 */
function makeAbsolutePath(...parts: string[]): string {
  const root = path.parse(process.cwd()).root;
  return path.join(root, 'tmp', ...parts);
}

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

  describe('path resolution without options', () => {
    it('resolves relative paths against cwd when no options', () => {
      const result = parseBreakpointSpec('src/file.ts:10');
      expect(path.normalize(result.file)).toBe(path.normalize(path.resolve('src/file.ts')));
    });

    it('preserves absolute paths', () => {
      const absPath = makeAbsolutePath('test.js');
      const result = parseBreakpointSpec(`${absPath}:5`);
      expect(path.normalize(result.file)).toBe(path.normalize(absPath));
    });
  });

  describe('path resolution with cwd (preferred)', () => {
    it('resolves relative path against cwd when provided', () => {
      const cwd = makeAbsolutePath('project');
      const result = parseBreakpointSpec('src/utils.ts:10', { cwd });
      const expected = path.join(cwd, 'src/utils.ts');
      expect(path.normalize(result.file)).toBe(path.normalize(expected));
    });

    it('cwd takes precedence over programPath', () => {
      const cwd = makeAbsolutePath('project');
      const programPath = makeAbsolutePath('other', 'main.ts');
      const result = parseBreakpointSpec('test.js:3', { cwd, programPath });
      const expected = path.join(cwd, 'test.js');
      expect(path.normalize(result.file)).toBe(path.normalize(expected));
    });

    it('preserves absolute paths even with cwd', () => {
      const cwd = makeAbsolutePath('project');
      const absPath = makeAbsolutePath('other', 'path.js');
      const result = parseBreakpointSpec(`${absPath}:5`, { cwd });
      expect(path.normalize(result.file)).toBe(path.normalize(absPath));
    });
  });

  describe('path resolution with programPath (fallback)', () => {
    it('resolves relative path against program directory when no cwd', () => {
      const programPath = makeAbsolutePath('test.js');
      const result = parseBreakpointSpec('test.js:3', { programPath });
      expect(path.normalize(result.file)).toBe(path.normalize(programPath));
    });

    it('resolves relative path with subdirectory against program directory', () => {
      const programPath = makeAbsolutePath('project', 'main.ts');
      const result = parseBreakpointSpec('src/utils.ts:10', { programPath });
      const expected = makeAbsolutePath('project', 'src', 'utils.ts');
      expect(path.normalize(result.file)).toBe(path.normalize(expected));
    });

    it('preserves absolute paths even with programPath', () => {
      const programPath = makeAbsolutePath('test.js');
      const absPath = makeAbsolutePath('other', 'path.js');
      const result = parseBreakpointSpec(`${absPath}:5`, { programPath });
      expect(path.normalize(result.file)).toBe(path.normalize(absPath));
    });
  });

  describe('Windows drive letter handling', () => {
    it('correctly parses Windows-style absolute paths', () => {
      // This tests that the regex correctly handles the colon in drive letters
      // The last colon should be the line separator
      if (process.platform === 'win32') {
        const result = parseBreakpointSpec('C:\\proj\\test.ts:10');
        expect(result.line).toBe(10);
        expect(result.file).toBe('C:\\proj\\test.ts');
      } else {
        // On non-Windows, just verify normal absolute paths work
        const absPath = makeAbsolutePath('proj', 'test.ts');
        const result = parseBreakpointSpec(`${absPath}:10`);
        expect(result.line).toBe(10);
        expect(path.normalize(result.file)).toBe(path.normalize(absPath));
      }
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

  describe('path resolution with cwd', () => {
    it('resolves relative path against cwd when provided', () => {
      const cwd = makeAbsolutePath('project');
      const result = parseLogpointSpec('test.js:5|logging', { cwd });
      const expected = path.join(cwd, 'test.js');
      expect(path.normalize(result.file)).toBe(path.normalize(expected));
    });
  });

  describe('path resolution with programPath', () => {
    it('resolves relative path against program directory when no cwd', () => {
      const programPath = makeAbsolutePath('test.js');
      const result = parseLogpointSpec('test.js:5|logging', { programPath });
      expect(path.normalize(result.file)).toBe(path.normalize(programPath));
    });
  });
});
