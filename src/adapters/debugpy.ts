/**
 * debugpy Adapter Configuration
 *
 * Debug adapter for Python applications.
 * https://github.com/microsoft/debugpy
 */

import * as path from "node:path";
import type { AdapterConfig, LaunchOptions, AttachOptions } from "./base.js";

export const debugpyAdapter: AdapterConfig = {
  id: "python",
  name: "debugpy",
  command: "python",
  args: ["-m", "debugpy.adapter"],

  detect: async () => {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    try {
      await execAsync('python -c "import debugpy"');
      return "python";
    } catch {
      try {
        await execAsync('python3 -c "import debugpy"');
        return "python3";
      } catch {
        return null;
      }
    }
  },

  installHint: `
Install debugpy:

  pip install debugpy

  or

  pip3 install debugpy
`.trim(),

  launchConfig: (options: LaunchOptions) => ({
    name: "Python Launch",
    type: "python",
    request: "launch",
    program: path.resolve(options.program),
    args: options.args || [],
    cwd: options.cwd || path.dirname(options.program),
    env: options.env || {},
    stopOnEntry: options.stopAtEntry || false,
    console: "internalConsole",
    justMyCode: true,
  }),

  attachConfig: (options: AttachOptions) => ({
    name: "Python Attach",
    type: "python",
    request: "attach",
    processId: options.pid,
    host: options.host || "localhost",
    port: options.port || 5678,
  }),

  exceptionFilters: [
    "raised",   // Break on raised exceptions
    "uncaught", // Break on uncaught exceptions
  ],
};
