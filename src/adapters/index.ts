/**
 * Adapter Registry
 *
 * Central registry for all supported debug adapters.
 */

export * from "./base.js";
export * from "./netcoredbg.js";
export * from "./vsdbg.js";
export * from "./debugpy.js";

import * as path from "node:path";
import type { AdapterConfig, LaunchOptions, AttachOptions } from "./base.js";
import { netcoredbgAdapter } from "./netcoredbg.js";
import { vsdbgAdapter } from "./vsdbg.js";
import { debugpyAdapter } from "./debugpy.js";
import { findVsdbg } from "../util/vscode-adapters.js";
import { isNetcoredbgInstalled, getNetcoredbgPath } from "../util/adapter-installer.js";
import { commandExists } from "./base.js";

/**
 * Smart .NET adapter that tries multiple debuggers in order:
 * 1. vsdbg from VS Code C# extension
 * 2. netcoredbg (bundled)
 * 3. netcoredbg (system PATH)
 */
let dotnetCachedPath: string | null = null;

const dotnetAdapter: AdapterConfig = {
  id: "coreclr",
  name: "dotnet",

  get command() {
    return dotnetCachedPath || "vsdbg";
  },

  get args() {
    return ["--interpreter=vscode"];
  },

  detect: async () => {
    // Try vsdbg first (from VS Code)
    const vsdbgPath = findVsdbg();
    if (vsdbgPath) {
      dotnetCachedPath = vsdbgPath;
      return vsdbgPath;
    }

    // Try bundled netcoredbg
    if (isNetcoredbgInstalled()) {
      dotnetCachedPath = getNetcoredbgPath();
      return dotnetCachedPath;
    }

    // Try system netcoredbg
    const systemPath = await commandExists("netcoredbg");
    if (systemPath) {
      dotnetCachedPath = systemPath;
      return systemPath;
    }

    return null;
  },

  installHint: `
.NET debugger not found. Options:

  1. Install VS Code C# extension (recommended):
     - Opens VS Code and install "C#" (ms-dotnettools.csharp)
     - debug-run will use VS Code's bundled debugger

  2. Install netcoredbg:
     debug-run install-adapter netcoredbg

  3. Manual netcoredbg install:
     - Ubuntu/Debian: apt install netcoredbg
     - macOS: brew install netcoredbg
     - Download: https://github.com/Samsung/netcoredbg/releases
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
    // vsdbg-specific options (ignored by netcoredbg)
    justMyCode: true,
    enableStepFiltering: true,
    symbolOptions: {
      searchMicrosoftSymbolServer: false,
      searchNuGetOrgSymbolServer: false,
    },
  }),

  attachConfig: (options: AttachOptions) => ({
    name: ".NET Core Attach",
    type: "coreclr",
    request: "attach",
    processId: options.pid,
  }),

  exceptionFilters: [
    "all",
    "user-unhandled",
  ],
};

const adapters: Map<string, AdapterConfig> = new Map([
  // Smart .NET adapter (tries vsdbg, then netcoredbg)
  ["dotnet", dotnetAdapter],
  ["coreclr", dotnetAdapter],

  // Specific .NET adapters
  ["netcoredbg", netcoredbgAdapter],
  ["vsdbg", vsdbgAdapter],

  // Python
  ["debugpy", debugpyAdapter],
  ["python", debugpyAdapter],
]);

/**
 * Get an adapter configuration by name
 */
export function getAdapter(name: string): AdapterConfig | undefined {
  return adapters.get(name.toLowerCase());
}

/**
 * Get all available adapter names (primary names only, not aliases)
 */
export function getAdapterNames(): string[] {
  // Return unique adapter names (not aliases)
  const unique = new Set<string>();
  for (const adapter of adapters.values()) {
    unique.add(adapter.name);
  }
  return Array.from(unique);
}

/**
 * Check which adapters are installed
 */
export async function detectInstalledAdapters(): Promise<Map<string, string>> {
  const installed = new Map<string, string>();

  for (const name of getAdapterNames()) {
    const adapter = adapters.get(name);
    if (adapter) {
      const detectedPath = await adapter.detect();
      if (detectedPath) {
        installed.set(name, detectedPath);
      }
    }
  }

  return installed;
}
