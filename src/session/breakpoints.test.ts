/**
 * Unit tests for breakpoint parsing functionality
 */

import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  parseBreakpointSpec,
  parseLogpointSpec,
  validateBreakpointSpec,
  validateLogpointSpec,
  validateAllBreakpoints,
} from './breakpoints.js';

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

  describe('path resolution with programPath (no longer used as fallback)', () => {
    it('resolves relative path against process.cwd when no cwd provided', () => {
      const programPath = makeAbsolutePath('test.js');
      const result = parseBreakpointSpec('test.js:3', { programPath });
      // programPath is no longer used; paths resolve against process.cwd()
      const expected = path.resolve('test.js');
      expect(path.normalize(result.file)).toBe(path.normalize(expected));
    });

    it('resolves relative path with subdirectory against process.cwd', () => {
      const programPath = makeAbsolutePath('project', 'main.ts');
      const result = parseBreakpointSpec('src/utils.ts:10', { programPath });
      // programPath is no longer used; paths resolve against process.cwd()
      const expected = path.resolve('src/utils.ts');
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

describe('validateBreakpointSpec', () => {
  describe('valid breakpoints', () => {
    it('accepts file:line format', () => {
      const result = validateBreakpointSpec('Program.cs:42');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts file:line?condition format', () => {
      const result = validateBreakpointSpec('test.ts:10?x > 5');
      expect(result.valid).toBe(true);
    });

    it('accepts file:line#hitCount format', () => {
      const result = validateBreakpointSpec('test.ts:20#3');
      expect(result.valid).toBe(true);
    });

    it('accepts paths with subdirectories', () => {
      const result = validateBreakpointSpec('src/utils/helper.ts:100');
      expect(result.valid).toBe(true);
    });

    it('trims whitespace', () => {
      const result = validateBreakpointSpec('  Program.cs:42  ');
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid breakpoints - missing colon', () => {
    it('rejects missing colon separator', () => {
      const result = validateBreakpointSpec('Program.cs134');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Expected "file:line"');
      expect(result.error).toContain('Program.cs:42');
    });

    it('rejects just a filename', () => {
      const result = validateBreakpointSpec('test.ts');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Expected "file:line"');
    });
  });

  describe('invalid breakpoints - bad line number', () => {
    it('rejects non-numeric line number', () => {
      const result = validateBreakpointSpec('Program.cs:abc');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid line number "abc"');
      expect(result.error).toContain('positive integer');
    });

    it('rejects negative line number', () => {
      const result = validateBreakpointSpec('Program.cs:-5');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid line number "-5"');
    });

    it('rejects zero line number', () => {
      const result = validateBreakpointSpec('Program.cs:0');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid line number "0"');
    });

    it('rejects missing line number after colon', () => {
      const result = validateBreakpointSpec('Program.cs:');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing line number');
    });
  });

  describe('invalid breakpoints - empty/missing file', () => {
    it('rejects empty specification', () => {
      const result = validateBreakpointSpec('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });

    it('rejects whitespace-only specification', () => {
      const result = validateBreakpointSpec('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });
  });
});

describe('validateLogpointSpec', () => {
  describe('valid logpoints', () => {
    it('accepts file:line|message format', () => {
      const result = validateLogpointSpec('test.ts:10|value is {x}');
      expect(result.valid).toBe(true);
    });

    it('accepts simple message', () => {
      const result = validateLogpointSpec('app.py:5|checkpoint reached');
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid logpoints', () => {
    it('rejects missing pipe separator', () => {
      const result = validateLogpointSpec('test.ts:10');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Expected "file:line|message"');
    });

    it('rejects missing colon', () => {
      const result = validateLogpointSpec('test.ts10|message');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Expected "file:line|message"');
    });

    it('rejects non-numeric line number', () => {
      const result = validateLogpointSpec('test.ts:abc|message');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid line number');
    });

    it('rejects empty specification', () => {
      const result = validateLogpointSpec('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });
  });
});

describe('validateAllBreakpoints', () => {
  it('returns empty array for valid breakpoints', () => {
    const errors = validateAllBreakpoints(
      ['Program.cs:42', 'test.ts:10?x > 5'],
      ['app.py:5|logging']
    );
    expect(errors).toEqual([]);
  });

  it('returns errors for invalid breakpoints', () => {
    const errors = validateAllBreakpoints(['Program.cs134', 'test.ts:abc']);
    expect(errors.length).toBe(2);
    expect(errors[0]).toContain('Program.cs134');
    expect(errors[1]).toContain('abc');
  });

  it('returns errors for invalid logpoints', () => {
    const errors = validateAllBreakpoints([], ['test.ts:10']);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('file:line|message');
  });

  it('combines breakpoint and logpoint errors', () => {
    const errors = validateAllBreakpoints(['invalid'], ['also_invalid']);
    expect(errors.length).toBe(2);
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
    it('resolves relative path against process.cwd when no cwd provided', () => {
      const programPath = makeAbsolutePath('test.js');
      const result = parseLogpointSpec('test.js:5|logging', { programPath });
      // programPath is no longer used; paths resolve against process.cwd()
      const expected = path.resolve('test.js');
      expect(path.normalize(result.file)).toBe(path.normalize(expected));
    });
  });
});
