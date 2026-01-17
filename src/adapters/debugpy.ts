/**
 * debugpy Adapter Configuration
 *
 * Debug adapter for Python applications.
 * Uses VS Code's bundled debugpy from the Python extension when available,
 * falls back to pip-installed debugpy.
 *
 * https://github.com/microsoft/debugpy
 */

import * as path from 'node:path';
import { existsSync } from 'node:fs';
import type { AdapterConfig, LaunchOptions, AttachOptions } from './base.js';
import { findDebugpy } from '../util/vscode-adapters.js';

// Cache the detected configuration
let cachedPythonCommand: string | null = null;
let cachedDebugpyPath: string | null = null;
let cachedSource: 'vscode' | 'pip' | null = null;

/**
 * Find the Python command that works on this system
 */
async function findPythonCommand(): Promise<string | null> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  // Try python3 first (more explicit on systems with both Python 2 and 3)
  try {
    await execAsync('python3 --version');
    return 'python3';
  } catch {
    // Fall through
  }

  // Try python
  try {
    await execAsync('python --version');
    return 'python';
  } catch {
    return null;
  }
}

/**
 * Check if pip-installed debugpy is available
 */
async function checkPipDebugpy(pythonCmd: string): Promise<boolean> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  try {
    await execAsync(`${pythonCmd} -c "import debugpy"`);
    return true;
  } catch {
    return false;
  }
}

export const debugpyAdapter: AdapterConfig = {
  id: 'debugpy',
  name: 'debugpy',

  // debugpy requires launch before breakpoints can be set
  // It doesn't send 'initialized' until the debuggee server is started
  requiresLaunchFirst: true,

  get command() {
    return cachedPythonCommand || 'python3';
  },

  get args() {
    // debugpy.adapter runs in stdio mode by default (no --host/--port needed)
    return ['-m', 'debugpy.adapter'];
  },

  detect: async () => {
    // Find a working Python command
    const pythonCmd = await findPythonCommand();
    if (!pythonCmd) {
      return null;
    }
    cachedPythonCommand = pythonCmd;

    // 1. Check for VS Code bundled debugpy first
    const vscodePath = findDebugpy();
    if (vscodePath && existsSync(vscodePath)) {
      cachedDebugpyPath = vscodePath;
      cachedSource = 'vscode';
      return `VS Code Python extension (${vscodePath})`;
    }

    // 2. Check for pip-installed debugpy
    if (await checkPipDebugpy(pythonCmd)) {
      cachedSource = 'pip';
      cachedDebugpyPath = null;
      return `pip (${pythonCmd} -m debugpy)`;
    }

    return null;
  },

  installHint: `
Python debugger (debugpy) not found.

Option 1 (Recommended): Install VS Code Python Extension
  - Install the Python extension in VS Code (ms-python.python)
  - debugpy is bundled with it

Option 2: Install via pip
  pip install debugpy
  or
  pip3 install debugpy

Make sure Python 3 is installed: https://www.python.org/downloads/
`.trim(),

  launchConfig: (options: LaunchOptions) => {
    const config: Record<string, unknown> = {
      name: 'Python Launch',
      type: 'debugpy',
      request: 'launch',
      program: path.resolve(options.program),
      args: options.args || [],
      cwd: options.cwd || path.dirname(path.resolve(options.program)),
      env: options.env || {},
      stopOnEntry: options.stopAtEntry || false,
      console: 'internalConsole',
      justMyCode: false, // Show all code, not just user code
    };

    // If using VS Code bundled debugpy, add its path to PYTHONPATH
    if (cachedSource === 'vscode' && cachedDebugpyPath) {
      const debugpyParentDir = path.dirname(cachedDebugpyPath);
      const existingPythonPath = options.env?.PYTHONPATH || process.env.PYTHONPATH || '';
      config.env = {
        ...options.env,
        PYTHONPATH: existingPythonPath
          ? `${debugpyParentDir}:${existingPythonPath}`
          : debugpyParentDir,
      };
    }

    return config;
  },

  attachConfig: (options: AttachOptions) => ({
    name: 'Python Attach',
    type: 'debugpy',
    request: 'attach',
    processId: options.pid,
    host: options.host || 'localhost',
    port: options.port || 5678,
  }),

  exceptionFilters: [
    'raised', // Break on raised exceptions
    'uncaught', // Break on uncaught exceptions
    'userUnhandled', // Break on user-unhandled exceptions
  ],
};
