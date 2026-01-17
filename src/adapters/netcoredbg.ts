/**
 * netcoredbg Adapter Configuration
 *
 * Debug adapter for .NET Core applications.
 * https://github.com/Samsung/netcoredbg
 */

import * as path from 'node:path';
import type { AdapterConfig, LaunchOptions, AttachOptions } from './base.js';
import { commandExists } from './base.js';
import { getNetcoredbgPath, isNetcoredbgInstalled } from '../util/adapter-installer.js';

/**
 * Find the netcoredbg executable, checking bundled location first
 */
async function findNetcoredbg(): Promise<string | null> {
  // Check bundled location first
  if (isNetcoredbgInstalled()) {
    return getNetcoredbgPath();
  }

  // Fall back to system PATH
  return await commandExists('netcoredbg');
}

// Cache the detected path
let cachedPath: string | null = null;

export const netcoredbgAdapter: AdapterConfig = {
  id: 'coreclr',
  name: 'netcoredbg',

  // This will be updated by detect()
  get command() {
    return cachedPath || 'netcoredbg';
  },

  args: ['--interpreter=vscode'],

  detect: async () => {
    cachedPath = await findNetcoredbg();
    return cachedPath;
  },

  installHint: `
Install netcoredbg:

  Auto-install (recommended):
    debug-run install-adapter netcoredbg

  Ubuntu/Debian:
    apt install netcoredbg

  macOS:
    brew install netcoredbg

  Windows (scoop):
    scoop install netcoredbg

  Manual download:
    https://github.com/Samsung/netcoredbg/releases
`.trim(),

  launchConfig: (options: LaunchOptions) => ({
    name: '.NET Core Launch',
    type: 'coreclr',
    request: 'launch',
    program: path.resolve(options.program),
    args: options.args || [],
    cwd: options.cwd || path.dirname(options.program),
    env: options.env || {},
    stopAtEntry: options.stopAtEntry || false,
    console: 'internalConsole',
  }),

  attachConfig: (options: AttachOptions) => ({
    name: '.NET Core Attach',
    type: 'coreclr',
    request: 'attach',
    processId: options.pid,
  }),

  exceptionFilters: [
    'all', // Break on all exceptions
    'user-unhandled', // Break on user-unhandled exceptions
  ],
};
