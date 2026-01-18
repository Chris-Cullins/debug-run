/**
 * Unit tests for debug adapter configurations
 */

import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { nodeAdapter } from './node.js';
import { debugpyAdapter } from './debugpy.js';
import { netcoredbgAdapter } from './netcoredbg.js';
import type { LaunchOptions, AttachOptions } from './base.js';

describe('Node.js Adapter', () => {
  describe('properties', () => {
    it('has correct adapter ID', () => {
      expect(nodeAdapter.id).toBe('pwa-node');
    });

    it('has correct adapter name', () => {
      expect(nodeAdapter.name).toBe('node');
    });

    it('uses socket transport', () => {
      expect(nodeAdapter.transport).toBe('socket');
    });

    it('has exception filters defined', () => {
      expect(nodeAdapter.exceptionFilters).toBeDefined();
      expect(nodeAdapter.exceptionFilters).toContain('all');
      expect(nodeAdapter.exceptionFilters).toContain('uncaught');
    });
  });

  describe('launchConfig', () => {
    it('creates basic launch configuration', () => {
      const options: LaunchOptions = {
        program: 'test.js',
      };

      const config = nodeAdapter.launchConfig(options);

      expect(config.type).toBe('pwa-node');
      expect(config.request).toBe('launch');
      expect(config.program).toContain('test.js');
    });

    it('resolves program path to absolute', () => {
      const options: LaunchOptions = {
        program: 'src/index.ts',
      };

      const config = nodeAdapter.launchConfig(options);

      expect(path.isAbsolute(config.program as string)).toBe(true);
    });

    it('includes args when provided', () => {
      const options: LaunchOptions = {
        program: 'test.js',
        args: ['--port', '3000'],
      };

      const config = nodeAdapter.launchConfig(options);

      expect(config.args).toEqual(['--port', '3000']);
    });

    it('uses cwd when provided', () => {
      const options: LaunchOptions = {
        program: 'test.js',
        cwd: '/custom/working/dir',
      };

      const config = nodeAdapter.launchConfig(options);

      expect(config.cwd).toBe('/custom/working/dir');
    });

    it('defaults cwd to program directory', () => {
      const options: LaunchOptions = {
        program: '/app/src/index.js',
      };

      const config = nodeAdapter.launchConfig(options);

      expect(config.cwd).toBe('/app/src');
    });

    it('includes environment variables', () => {
      const options: LaunchOptions = {
        program: 'test.js',
        env: { NODE_ENV: 'development', DEBUG: 'true' },
      };

      const config = nodeAdapter.launchConfig(options);

      expect(config.env).toEqual({ NODE_ENV: 'development', DEBUG: 'true' });
    });

    it('sets stopOnEntry when requested', () => {
      const options: LaunchOptions = {
        program: 'test.js',
        stopAtEntry: true,
      };

      const config = nodeAdapter.launchConfig(options);

      expect(config.stopOnEntry).toBe(true);
    });

    it('includes js-debug specific options', () => {
      const options: LaunchOptions = {
        program: 'test.js',
      };

      const config = nodeAdapter.launchConfig(options);

      expect(config.skipFiles).toBeDefined();
      expect(config.resolveSourceMapLocations).toBeDefined();
      expect(config.autoAttachChildProcesses).toBe(false);
    });
  });

  describe('attachConfig', () => {
    it('creates basic attach configuration', () => {
      const options: AttachOptions = {
        pid: 12345,
      };

      const config = nodeAdapter.attachConfig(options);

      expect(config.type).toBe('pwa-node');
      expect(config.request).toBe('attach');
      expect(config.processId).toBe(12345);
    });

    it('uses default port when not specified', () => {
      const options: AttachOptions = {};

      const config = nodeAdapter.attachConfig(options);

      expect(config.port).toBe(9229);
    });

    it('uses custom port when provided', () => {
      const options: AttachOptions = {
        port: 9230,
      };

      const config = nodeAdapter.attachConfig(options);

      expect(config.port).toBe(9230);
    });

    it('uses default host when not specified', () => {
      const options: AttachOptions = {};

      const config = nodeAdapter.attachConfig(options);

      expect(config.host).toBe('localhost');
    });

    it('uses custom host when provided', () => {
      const options: AttachOptions = {
        host: '192.168.1.100',
      };

      const config = nodeAdapter.attachConfig(options);

      expect(config.host).toBe('192.168.1.100');
    });
  });
});

describe('Python (debugpy) Adapter', () => {
  describe('properties', () => {
    it('has correct adapter ID', () => {
      expect(debugpyAdapter.id).toBe('debugpy');
    });

    it('has correct adapter name', () => {
      expect(debugpyAdapter.name).toBe('debugpy');
    });

    it('requires launch first (for DAP flow)', () => {
      expect(debugpyAdapter.requiresLaunchFirst).toBe(true);
    });

    it('has exception filters defined', () => {
      expect(debugpyAdapter.exceptionFilters).toBeDefined();
      expect(debugpyAdapter.exceptionFilters).toContain('raised');
      expect(debugpyAdapter.exceptionFilters).toContain('uncaught');
      expect(debugpyAdapter.exceptionFilters).toContain('userUnhandled');
    });
  });

  describe('launchConfig', () => {
    it('creates basic launch configuration', () => {
      const options: LaunchOptions = {
        program: 'test.py',
      };

      const config = debugpyAdapter.launchConfig(options);

      expect(config.type).toBe('debugpy');
      expect(config.request).toBe('launch');
      expect(config.program).toContain('test.py');
    });

    it('resolves program path to absolute', () => {
      const options: LaunchOptions = {
        program: 'src/main.py',
      };

      const config = debugpyAdapter.launchConfig(options);

      expect(path.isAbsolute(config.program as string)).toBe(true);
    });

    it('includes args when provided', () => {
      const options: LaunchOptions = {
        program: 'test.py',
        args: ['--config', 'settings.json'],
      };

      const config = debugpyAdapter.launchConfig(options);

      expect(config.args).toEqual(['--config', 'settings.json']);
    });

    it('sets justMyCode to false by default', () => {
      const options: LaunchOptions = {
        program: 'test.py',
      };

      const config = debugpyAdapter.launchConfig(options);

      expect(config.justMyCode).toBe(false);
    });

    it('uses cwd when provided', () => {
      const options: LaunchOptions = {
        program: 'test.py',
        cwd: '/project/src',
      };

      const config = debugpyAdapter.launchConfig(options);

      expect(config.cwd).toBe('/project/src');
    });
  });

  describe('attachConfig', () => {
    it('creates basic attach configuration', () => {
      const options: AttachOptions = {
        pid: 54321,
      };

      const config = debugpyAdapter.attachConfig(options);

      expect(config.type).toBe('debugpy');
      expect(config.request).toBe('attach');
      expect(config.processId).toBe(54321);
    });

    it('uses default port when not specified', () => {
      const options: AttachOptions = {};

      const config = debugpyAdapter.attachConfig(options);

      expect(config.port).toBe(5678);
    });

    it('uses custom port when provided', () => {
      const options: AttachOptions = {
        port: 5679,
      };

      const config = debugpyAdapter.attachConfig(options);

      expect(config.port).toBe(5679);
    });
  });
});

describe('.NET (netcoredbg) Adapter', () => {
  describe('properties', () => {
    it('has correct adapter ID', () => {
      expect(netcoredbgAdapter.id).toBe('coreclr');
    });

    it('has correct adapter name', () => {
      expect(netcoredbgAdapter.name).toBe('netcoredbg');
    });

    it('uses vscode interpreter mode', () => {
      expect(netcoredbgAdapter.args).toContain('--interpreter=vscode');
    });

    it('has exception filters defined', () => {
      expect(netcoredbgAdapter.exceptionFilters).toBeDefined();
      expect(netcoredbgAdapter.exceptionFilters).toContain('all');
      expect(netcoredbgAdapter.exceptionFilters).toContain('user-unhandled');
    });
  });

  describe('launchConfig', () => {
    it('creates basic launch configuration', () => {
      const options: LaunchOptions = {
        program: 'bin/Debug/net8.0/MyApp.dll',
      };

      const config = netcoredbgAdapter.launchConfig(options);

      expect(config.type).toBe('coreclr');
      expect(config.request).toBe('launch');
      expect(config.program).toContain('MyApp.dll');
    });

    it('resolves program path to absolute', () => {
      const options: LaunchOptions = {
        program: 'bin/Debug/MyApp.dll',
      };

      const config = netcoredbgAdapter.launchConfig(options);

      expect(path.isAbsolute(config.program as string)).toBe(true);
    });

    it('includes args when provided', () => {
      const options: LaunchOptions = {
        program: 'MyApp.dll',
        args: ['--environment', 'Development'],
      };

      const config = netcoredbgAdapter.launchConfig(options);

      expect(config.args).toEqual(['--environment', 'Development']);
    });

    it('uses cwd when provided', () => {
      const options: LaunchOptions = {
        program: 'MyApp.dll',
        cwd: '/app/bin',
      };

      const config = netcoredbgAdapter.launchConfig(options);

      expect(config.cwd).toBe('/app/bin');
    });

    it('defaults cwd to program directory', () => {
      const options: LaunchOptions = {
        program: '/app/bin/Debug/MyApp.dll',
      };

      const config = netcoredbgAdapter.launchConfig(options);

      expect(config.cwd).toBe('/app/bin/Debug');
    });

    it('sets stopAtEntry when requested', () => {
      const options: LaunchOptions = {
        program: 'MyApp.dll',
        stopAtEntry: true,
      };

      const config = netcoredbgAdapter.launchConfig(options);

      expect(config.stopAtEntry).toBe(true);
    });
  });

  describe('attachConfig', () => {
    it('creates basic attach configuration', () => {
      const options: AttachOptions = {
        pid: 99999,
      };

      const config = netcoredbgAdapter.attachConfig(options);

      expect(config.type).toBe('coreclr');
      expect(config.request).toBe('attach');
      expect(config.processId).toBe(99999);
    });
  });
});
