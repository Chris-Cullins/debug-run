/**
 * LLDB Debug Adapter Configuration
 *
 * Debug adapter for C/C++/Rust/Swift applications using LLDB.
 * Supports both lldb-dap (official LLVM adapter) and CodeLLDB (VS Code extension).
 */

import * as path from "node:path";
import type { AdapterConfig, LaunchOptions, AttachOptions } from "./base.js";
import { commandExists } from "./base.js";
import { findCodeLLDB } from "../util/vscode-adapters.js";

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

  1. Install LLVM/LLDB (includes lldb-dap):
     - macOS: xcode-select --install (or brew install llvm)
     - Ubuntu/Debian: apt install lldb
     - Fedora: dnf install lldb
     - The lldb-dap binary should be in your PATH

  2. Install CodeLLDB VS Code extension:
     - Open VS Code
     - Install "CodeLLDB" extension (vadimcn.vscode-lldb)
     - debug-run will use the bundled adapter

  3. Build from source:
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
