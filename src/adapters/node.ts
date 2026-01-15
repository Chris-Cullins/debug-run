/**
 * Node.js Debug Adapter Configuration
 *
 * Debug adapter for Node.js applications using VS Code's js-debug.
 * https://github.com/microsoft/vscode-js-debug
 */

import * as path from "node:path";
import type { AdapterConfig, LaunchOptions, AttachOptions } from "./base.js";
import { commandExists } from "./base.js";
import { findJsDebug } from "../util/vscode-adapters.js";

// Cache the detected path and type
let cachedPath: string | null = null;
let cachedType: "js-debug" | "node" | null = null;

export const nodeAdapter: AdapterConfig = {
  id: "pwa-node",
  name: "node",

  get command() {
    if (cachedType === "js-debug" && cachedPath) {
      return "node";
    }
    return cachedPath || "node";
  },

  get args() {
    if (cachedType === "js-debug" && cachedPath) {
      return [cachedPath];
    }
    return [];
  },

  detect: async () => {
    // Try to find js-debug from VS Code extension
    const jsDebugPath = findJsDebug();
    if (jsDebugPath) {
      cachedPath = jsDebugPath;
      cachedType = "js-debug";
      return jsDebugPath;
    }

    // Check if node is available (we can use the built-in inspector)
    const nodePath = await commandExists("node");
    if (nodePath) {
      cachedPath = nodePath;
      cachedType = "node";
      // For basic Node.js debugging without js-debug, we'd need additional setup
      // Return null to indicate js-debug is preferred
      return null;
    }

    return null;
  },

  installHint: `
Node.js debugger (js-debug) not found.

Options:

  1. Install VS Code (recommended):
     - js-debug is built into VS Code
     - Install VS Code from https://code.visualstudio.com

  2. Install the js-debug extension manually:
     - Open VS Code
     - The JavaScript Debugger (ms-vscode.js-debug) is built-in

  3. For basic debugging without js-debug:
     - Ensure Node.js is installed: https://nodejs.org
     - Note: Some features may be limited without js-debug
`.trim(),

  launchConfig: (options: LaunchOptions) => ({
    name: "Node.js Launch",
    type: "pwa-node",
    request: "launch",
    program: path.resolve(options.program),
    args: options.args || [],
    cwd: options.cwd || path.dirname(path.resolve(options.program)),
    env: options.env || {},
    stopOnEntry: options.stopAtEntry || false,
    console: "internalConsole",
    // js-debug specific options
    skipFiles: ["<node_internals>/**"],
    resolveSourceMapLocations: ["**", "!**/node_modules/**"],
  }),

  attachConfig: (options: AttachOptions) => ({
    name: "Node.js Attach",
    type: "pwa-node",
    request: "attach",
    processId: options.pid,
    port: options.port || 9229,
    host: options.host || "localhost",
  }),

  exceptionFilters: [
    "all",       // Break on all exceptions
    "uncaught",  // Break on uncaught exceptions only
  ],
};
