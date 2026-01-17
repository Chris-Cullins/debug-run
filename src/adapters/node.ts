/**
 * Node.js Debug Adapter Configuration
 *
 * Debug adapter for Node.js applications using VS Code's js-debug.
 * https://github.com/microsoft/vscode-js-debug
 */

import * as path from 'node:path';
import type { AdapterConfig, LaunchOptions, AttachOptions } from './base.js';
import { commandExists } from './base.js';
import { findJsDebug } from '../util/vscode-adapters.js';
import { isJsDebugInstalled, getJsDebugPath } from '../util/adapter-installer.js';

// Cache the detected path and type
let cachedPath: string | null = null;
let cachedType: 'js-debug' | 'node' | null = null;

// Default port for js-debug DAP server
const JSDEBUG_PORT = 8177;

export const nodeAdapter: AdapterConfig = {
  id: 'pwa-node',
  name: 'node',

  // js-debug uses socket transport
  transport: 'socket',
  socketPort: JSDEBUG_PORT,

  get command() {
    if (cachedType === 'js-debug' && cachedPath) {
      return 'node';
    }
    return cachedPath || 'node';
  },

  get args() {
    if (cachedType === 'js-debug' && cachedPath) {
      // js-debug dapDebugServer takes port as first argument
      return [cachedPath, String(JSDEBUG_PORT)];
    }
    return [];
  },

  detect: async () => {
    // First, check if js-debug is installed via debug-run installer
    if (isJsDebugInstalled()) {
      cachedPath = getJsDebugPath();
      cachedType = 'js-debug';
      return cachedPath;
    }

    // Try to find js-debug from VS Code extension (user extensions dir)
    const jsDebugPath = findJsDebug();
    if (jsDebugPath) {
      cachedPath = jsDebugPath;
      cachedType = 'js-debug';
      return jsDebugPath;
    }

    // Check if node is available (we can use the built-in inspector)
    const nodePath = await commandExists('node');
    if (nodePath) {
      cachedPath = nodePath;
      cachedType = 'node';
      // For basic Node.js debugging without js-debug, we'd need additional setup
      // Return null to indicate js-debug is preferred
      return null;
    }

    return null;
  },

  installHint: `
Node.js debugger (js-debug) not found.

Install with:
  debug-run install-adapter node

Alternative options:

  1. Install the js-debug extension in VS Code:
     - Open VS Code Extensions
     - Install "JavaScript Debugger (Nightly)" (ms-vscode.js-debug-nightly)

  2. Ensure Node.js is installed: https://nodejs.org
`.trim(),

  launchConfig: (options: LaunchOptions) => ({
    name: 'Node.js Launch',
    type: 'pwa-node',
    request: 'launch',
    program: path.resolve(options.program),
    args: options.args || [],
    cwd: options.cwd || path.dirname(path.resolve(options.program)),
    env: options.env || {},
    stopOnEntry: options.stopAtEntry || false,
    console: 'internalConsole',
    // js-debug specific options
    skipFiles: ['<node_internals>/**'],
    resolveSourceMapLocations: ['**', '!**/node_modules/**'],
    // Disable child process auto-attach to avoid multi-session complexity
    autoAttachChildProcesses: false,
    // Wait for source maps to load before running
    pauseForSourceMap: true,
  }),

  attachConfig: (options: AttachOptions) => ({
    name: 'Node.js Attach',
    type: 'pwa-node',
    request: 'attach',
    processId: options.pid,
    port: options.port || 9229,
    host: options.host || 'localhost',
  }),

  exceptionFilters: [
    'all', // Break on all exceptions
    'uncaught', // Break on uncaught exceptions only
  ],
};
