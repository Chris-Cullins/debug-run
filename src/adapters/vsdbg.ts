/**
 * vsdbg Adapter Configuration
 *
 * Microsoft's .NET Core debugger, bundled with VS Code's C# extension.
 * This allows debug-run to use existing VS Code installations.
 */

import * as path from "node:path";
import type { AdapterConfig, LaunchOptions, AttachOptions } from "./base.js";
import { findVsdbg } from "../util/vscode-adapters.js";

// Cache the detected path
let cachedPath: string | null = null;

export const vsdbgAdapter: AdapterConfig = {
  id: "coreclr",
  name: "vsdbg",

  get command() {
    return cachedPath || "vsdbg";
  },

  args: ["--interpreter=vscode"],

  detect: async () => {
    cachedPath = findVsdbg();
    return cachedPath;
  },

  installHint: `
vsdbg is installed automatically with VS Code's C# extension.

To install:
  1. Open VS Code
  2. Install the "C#" extension (ms-dotnettools.csharp)
  3. Open any .cs file to trigger debugger download

Or install the C# Dev Kit extension for additional features.
`.trim(),

  launchConfig: (options: LaunchOptions) => ({
    name: ".NET Core Launch",
    type: "coreclr",
    request: "launch",
    program: path.resolve(options.program),
    args: options.args || [],
    cwd: options.cwd || path.dirname(path.resolve(options.program)),
    env: options.env || {},
    stopAtEntry: options.stopAtEntry || false,
    console: "internalConsole",
    // vsdbg-specific options
    justMyCode: true,
    enableStepFiltering: true,
    symbolOptions: {
      searchMicrosoftSymbolServer: false,
      searchNuGetOrgSymbolServer: false,
    },
    logging: {
      moduleLoad: false,
      programOutput: true,
      engineLogging: false,
    },
  }),

  attachConfig: (options: AttachOptions) => ({
    name: ".NET Core Attach",
    type: "coreclr",
    request: "attach",
    processId: options.pid,
    // justMyCode must be false for test debugging to work properly
    // (testhost runs in optimized mode, breakpoints won't hit otherwise)
    justMyCode: false,
  }),

  exceptionFilters: [
    "all",
    "user-unhandled",
  ],
};
