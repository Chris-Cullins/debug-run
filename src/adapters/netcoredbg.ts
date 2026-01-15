/**
 * netcoredbg Adapter Configuration
 *
 * Debug adapter for .NET Core applications.
 * https://github.com/Samsung/netcoredbg
 */

import * as path from "node:path";
import type { AdapterConfig, LaunchOptions, AttachOptions } from "./base.js";
import { commandExists } from "./base.js";

export const netcoredbgAdapter: AdapterConfig = {
  id: "coreclr",
  name: "netcoredbg",
  command: "netcoredbg",
  args: ["--interpreter=vscode"],

  detect: async () => {
    return await commandExists("netcoredbg");
  },

  installHint: `
Install netcoredbg:

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
    name: ".NET Core Launch",
    type: "coreclr",
    request: "launch",
    program: path.resolve(options.program),
    args: options.args || [],
    cwd: options.cwd || path.dirname(options.program),
    env: options.env || {},
    stopAtEntry: options.stopAtEntry || false,
    console: "internalConsole",
  }),

  attachConfig: (options: AttachOptions) => ({
    name: ".NET Core Attach",
    type: "coreclr",
    request: "attach",
    processId: options.pid,
  }),

  exceptionFilters: [
    "all",           // Break on all exceptions
    "user-unhandled", // Break on user-unhandled exceptions
  ],
};
