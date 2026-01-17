/**
 * LLDB Debug Adapter Configuration
 *
 * Debug adapter for C/C++/Rust/Swift applications using LLDB.
 * Supports both lldb-dap (official LLVM adapter) and CodeLLDB (VS Code extension).
 */

import * as path from "node:path";
import * as fs from "node:fs";
import type { AdapterConfig, LaunchOptions, AttachOptions } from "./base.js";
import { commandExists } from "./base.js";
import { findCodeLLDB } from "../util/vscode-adapters.js";

/**
 * Check common Homebrew LLVM installation paths on macOS.
 * Homebrew LLVM is "keg-only" and not symlinked to PATH by default.
 */
function findHomebrewLLDB(): string | null {
  if (process.platform !== "darwin") {
    return null;
  }

  // Homebrew paths: Apple Silicon vs Intel
  const homebrewPaths = [
    "/opt/homebrew/opt/llvm/bin/lldb-dap",  // Apple Silicon
    "/usr/local/opt/llvm/bin/lldb-dap",      // Intel Mac
  ];

  for (const p of homebrewPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

// Cache the detected path and type
let cachedPath: string | null = null;
let cachedType: "lldb-dap" | "codelldb" | null = null;

export const lldbAdapter: AdapterConfig = {
  id: "lldb",
  name: "lldb",

  get command() {
    return cachedPath || "lldb-dap";
  },

  get args() {
    // CodeLLDB requires specific args
    if (cachedType === "codelldb") {
      return [];
    }
    return [];
  },

  detect: async () => {
    // Try lldb-dap first (official LLVM DAP adapter, previously lldb-vscode)
    const lldbDap = await commandExists("lldb-dap");
    if (lldbDap) {
      cachedPath = lldbDap;
      cachedType = "lldb-dap";
      return lldbDap;
    }

    // Try the older name lldb-vscode (for older LLVM versions)
    const lldbVscode = await commandExists("lldb-vscode");
    if (lldbVscode) {
      cachedPath = lldbVscode;
      cachedType = "lldb-dap";
      return lldbVscode;
    }

    // Try Homebrew LLVM on macOS (keg-only, not in PATH by default)
    const homebrewLldb = findHomebrewLLDB();
    if (homebrewLldb) {
      cachedPath = homebrewLldb;
      cachedType = "lldb-dap";
      return homebrewLldb;
    }

    // Try CodeLLDB from VS Code extension
    const codeLldbPath = findCodeLLDB();
    if (codeLldbPath) {
      cachedPath = codeLldbPath;
      cachedType = "codelldb";
      return codeLldbPath;
    }

    return null;
  },

  installHint: `
LLDB debugger not found.

Options:

  1. Install LLVM via Homebrew (macOS, recommended):
     brew install llvm
     (debug-run auto-detects Homebrew LLVM, no PATH changes needed)

  2. Install CodeLLDB VS Code extension:
     - Open VS Code
     - Install "CodeLLDB" extension (vadimcn.vscode-lldb)
     - debug-run will use the bundled adapter

  3. Install LLVM system-wide:
     - Ubuntu/Debian: apt install lldb llvm
     - Fedora: dnf install lldb llvm
     - Ensure lldb-dap is in your PATH

  4. Build from source:
     - Download LLVM from https://releases.llvm.org
     - Build with -DLLDB_ENABLE_DAP=ON
`.trim(),

  launchConfig: (options: LaunchOptions) => {
    const config: Record<string, unknown> = {
      name: "LLDB Launch",
      type: cachedType === "codelldb" ? "lldb" : "lldb-dap",
      request: "launch",
      program: path.resolve(options.program),
      args: options.args || [],
      cwd: options.cwd || path.dirname(path.resolve(options.program)),
      env: options.env || {},
      stopOnEntry: options.stopAtEntry || false,
    };

    // CodeLLDB-specific options
    if (cachedType === "codelldb") {
      config.terminal = "console";
    }

    return config;
  },

  attachConfig: (options: AttachOptions) => ({
    name: "LLDB Attach",
    type: cachedType === "codelldb" ? "lldb" : "lldb-dap",
    request: "attach",
    pid: options.pid,
  }),

  exceptionFilters: [
    "cpp_throw",    // Break on C++ throw
    "cpp_catch",    // Break on C++ catch
    "objc_throw",   // Break on Objective-C @throw
    "objc_catch",   // Break on Objective-C @catch
    "swift_throw",  // Break on Swift throw
  ],
};
