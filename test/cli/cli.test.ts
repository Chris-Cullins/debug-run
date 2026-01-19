/**
 * Unit tests for CLI module
 */

import { describe, it, expect } from 'vitest';
import { parseTimeout, createCli } from '../../src/cli.js';

describe('parseTimeout', () => {
  describe('milliseconds', () => {
    it('parses explicit milliseconds', () => {
      expect(parseTimeout('5000ms')).toBe(5000);
    });

    it('parses bare numbers as milliseconds', () => {
      expect(parseTimeout('3000')).toBe(3000);
    });

    it('parses zero milliseconds', () => {
      expect(parseTimeout('0ms')).toBe(0);
    });
  });

  describe('seconds', () => {
    it('parses seconds to milliseconds', () => {
      expect(parseTimeout('30s')).toBe(30000);
    });

    it('parses single digit seconds', () => {
      expect(parseTimeout('5s')).toBe(5000);
    });

    it('parses zero seconds', () => {
      expect(parseTimeout('0s')).toBe(0);
    });

    it('parses large seconds', () => {
      expect(parseTimeout('120s')).toBe(120000);
    });
  });

  describe('minutes', () => {
    it('parses minutes to milliseconds', () => {
      expect(parseTimeout('2m')).toBe(120000);
    });

    it('parses single minute', () => {
      expect(parseTimeout('1m')).toBe(60000);
    });

    it('parses zero minutes', () => {
      expect(parseTimeout('0m')).toBe(0);
    });

    it('parses large minutes', () => {
      expect(parseTimeout('10m')).toBe(600000);
    });
  });

  describe('error handling', () => {
    it('throws on invalid format with letters', () => {
      expect(() => parseTimeout('abc')).toThrow('Invalid timeout format');
    });

    it('throws on invalid unit', () => {
      expect(() => parseTimeout('30h')).toThrow('Invalid timeout format');
    });

    it('throws on empty string', () => {
      expect(() => parseTimeout('')).toThrow('Invalid timeout format');
    });

    it('throws on negative numbers', () => {
      expect(() => parseTimeout('-5s')).toThrow('Invalid timeout format');
    });

    it('throws on decimal numbers', () => {
      expect(() => parseTimeout('5.5s')).toThrow('Invalid timeout format');
    });

    it('throws on spaces', () => {
      expect(() => parseTimeout('30 s')).toThrow('Invalid timeout format');
    });

    it('includes original value in error message', () => {
      expect(() => parseTimeout('invalid')).toThrow('invalid');
    });
  });

  describe('edge cases', () => {
    it('handles leading zeros', () => {
      expect(parseTimeout('001s')).toBe(1000);
    });

    it('handles very large numbers', () => {
      expect(parseTimeout('999999ms')).toBe(999999);
    });
  });
});

describe('createCli', () => {
  it('returns a Commander instance', () => {
    const cli = createCli();
    expect(cli).toBeDefined();
    expect(cli.name()).toBe('debug-run');
  });

  it('has the expected subcommands', () => {
    const cli = createCli();
    const commands = cli.commands.map((cmd) => cmd.name());

    expect(commands).toContain('list-adapters');
    expect(commands).toContain('install-adapter');
    expect(commands).toContain('install-skill');
  });

  it('has the expected main options', () => {
    const cli = createCli();
    const optionNames = cli.options.map((opt) => opt.long);

    expect(optionNames).toContain('--adapter');
    expect(optionNames).toContain('--breakpoint');
    expect(optionNames).toContain('--eval');
    expect(optionNames).toContain('--timeout');
    expect(optionNames).toContain('--pretty');
    expect(optionNames).toContain('--trace');
    expect(optionNames).toContain('--attach');
    expect(optionNames).toContain('--pid');
  });

  it('has test runner options', () => {
    const cli = createCli();
    const optionNames = cli.options.map((opt) => opt.long);

    expect(optionNames).toContain('--test-project');
    expect(optionNames).toContain('--test-filter');
  });

  it('has token efficiency options', () => {
    const cli = createCli();
    const optionNames = cli.options.map((opt) => opt.long);

    expect(optionNames).toContain('--expand-services');
    expect(optionNames).toContain('--show-null-props');
    expect(optionNames).toContain('--no-dedupe');
  });

  it('has exception handling options', () => {
    const cli = createCli();
    const optionNames = cli.options.map((opt) => opt.long);

    expect(optionNames).toContain('--flatten-exceptions');
    expect(optionNames).toContain('--exception-chain-depth');
  });

  it('has compact output options', () => {
    const cli = createCli();
    const optionNames = cli.options.map((opt) => opt.long);

    expect(optionNames).toContain('--compact');
    expect(optionNames).toContain('--stack-limit');
  });
});
