/**
 * Unit tests for VS Code adapter detection utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';

// We need to mock fs before importing the module
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

// Import after mocking
import { existsSync, readdirSync } from 'node:fs';
import {
  getVSCodeExtensionsDir,
  findExtension,
  detectVSCodeAdapters,
} from '../../src/util/vscode-adapters.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);

describe('getVSCodeExtensionsDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when no extension directories exist', () => {
    mockExistsSync.mockReturnValue(false);

    const dirs = getVSCodeExtensionsDir();

    expect(dirs).toEqual([]);
  });

  it('returns existing VS Code extension directories', () => {
    const home = os.homedir();

    // Mock that only .vscode/extensions exists
    mockExistsSync.mockImplementation((path) => {
      return path === `${home}/.vscode/extensions`;
    });

    const dirs = getVSCodeExtensionsDir();

    expect(dirs).toContain(`${home}/.vscode/extensions`);
    expect(dirs.length).toBe(1);
  });

  it('includes multiple editors when they exist', () => {
    const home = os.homedir();

    // Mock that VS Code and Cursor both exist
    mockExistsSync.mockImplementation((path) => {
      return path === `${home}/.vscode/extensions` || path === `${home}/.cursor/extensions`;
    });

    const dirs = getVSCodeExtensionsDir();

    expect(dirs).toContain(`${home}/.vscode/extensions`);
    expect(dirs).toContain(`${home}/.cursor/extensions`);
    expect(dirs.length).toBe(2);
  });
});

describe('findExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no extension directories exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = findExtension('ms-dotnettools.csharp');

    expect(result).toBeNull();
  });

  it('finds extension by publisher.name pattern', () => {
    const home = os.homedir();
    const extDir = `${home}/.vscode/extensions`;

    mockExistsSync.mockImplementation((path) => {
      return path === extDir;
    });

    mockReaddirSync.mockReturnValue([
      'ms-dotnettools.csharp-2.0.0',
      'ms-python.python-2024.1.0',
      'other-extension-1.0.0',
    ] as unknown as ReturnType<typeof readdirSync>);

    const result = findExtension('ms-dotnettools.csharp');

    expect(result).toBe(`${extDir}/ms-dotnettools.csharp-2.0.0`);
  });

  it('returns latest version when multiple versions exist', () => {
    const home = os.homedir();
    const extDir = `${home}/.vscode/extensions`;

    mockExistsSync.mockImplementation((path) => {
      return path === extDir;
    });

    // Multiple versions - should return highest (reverse sorted)
    mockReaddirSync.mockReturnValue([
      'ms-dotnettools.csharp-1.0.0',
      'ms-dotnettools.csharp-2.5.0',
      'ms-dotnettools.csharp-2.0.0',
    ] as unknown as ReturnType<typeof readdirSync>);

    const result = findExtension('ms-dotnettools.csharp');

    // After reverse sort: 2.5.0, 2.0.0, 1.0.0 - returns first (2.5.0)
    expect(result).toBe(`${extDir}/ms-dotnettools.csharp-2.5.0`);
  });

  it('returns null when extension not found', () => {
    const home = os.homedir();
    const extDir = `${home}/.vscode/extensions`;

    mockExistsSync.mockImplementation((path) => {
      return path === extDir;
    });

    mockReaddirSync.mockReturnValue(['other-extension-1.0.0'] as unknown as ReturnType<
      typeof readdirSync
    >);

    const result = findExtension('ms-dotnettools.csharp');

    expect(result).toBeNull();
  });

  it('handles case-insensitive matching', () => {
    const home = os.homedir();
    const extDir = `${home}/.vscode/extensions`;

    mockExistsSync.mockImplementation((path) => {
      return path === extDir;
    });

    mockReaddirSync.mockReturnValue(['MS-DotNetTools.CSharp-2.0.0'] as unknown as ReturnType<
      typeof readdirSync
    >);

    const result = findExtension('ms-dotnettools.csharp');

    expect(result).toBe(`${extDir}/MS-DotNetTools.CSharp-2.0.0`);
  });

  it('handles unreadable directories gracefully', () => {
    const home = os.homedir();
    const extDir = `${home}/.vscode/extensions`;

    mockExistsSync.mockImplementation((path) => {
      return path === extDir;
    });

    mockReaddirSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    // Should not throw, returns null
    const result = findExtension('ms-dotnettools.csharp');

    expect(result).toBeNull();
  });
});

describe('detectVSCodeAdapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns object with all adapter detection results', () => {
    mockExistsSync.mockReturnValue(false);

    const result = detectVSCodeAdapters();

    expect(result).toHaveProperty('vsdbg');
    expect(result).toHaveProperty('debugpy');
    expect(result).toHaveProperty('codelldb');
    expect(result).toHaveProperty('jsDebug');
  });

  it('returns null for all adapters when no extensions installed', () => {
    mockExistsSync.mockReturnValue(false);

    const result = detectVSCodeAdapters();

    expect(result.vsdbg).toBeNull();
    expect(result.debugpy).toBeNull();
    expect(result.codelldb).toBeNull();
    expect(result.jsDebug).toBeNull();
  });
});
