/**
 * VS Code Extension Adapter Detection
 *
 * Finds debug adapters installed by VS Code extensions.
 * This allows debug-run to piggyback on existing VS Code installations
 * without requiring separate adapter downloads.
 */

import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Get the VS Code extensions directory
 */
export function getVSCodeExtensionsDir(): string[] {
  const home = os.homedir();
  const dirs: string[] = [];

  // Standard VS Code
  dirs.push(path.join(home, '.vscode', 'extensions'));

  // VS Code Insiders
  dirs.push(path.join(home, '.vscode-insiders', 'extensions'));

  // VSCodium
  dirs.push(path.join(home, '.vscode-oss', 'extensions'));

  // Cursor (VS Code fork)
  dirs.push(path.join(home, '.cursor', 'extensions'));

  // On macOS, also check Application Support
  if (os.platform() === 'darwin') {
    dirs.push(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage'));
  }

  return dirs.filter(existsSync);
}

/**
 * Find an extension directory by publisher.name pattern
 */
export function findExtension(publisherName: string): string | null {
  const extensionDirs = getVSCodeExtensionsDir();

  for (const extDir of extensionDirs) {
    try {
      const entries = readdirSync(extDir);
      // Sort descending to get the latest version first
      const matches = entries
        .filter((e) => e.toLowerCase().startsWith(publisherName.toLowerCase()))
        .sort()
        .reverse();

      if (matches.length > 0) {
        return path.join(extDir, matches[0]);
      }
    } catch {
      // Directory not readable
    }
  }

  return null;
}

/**
 * Find vsdbg (Microsoft's .NET debugger) from the C# extension
 */
export function findVsdbg(): string | null {
  // Try the C# extension (ms-dotnettools.csharp)
  const csharpExt = findExtension('ms-dotnettools.csharp');
  if (csharpExt) {
    // vsdbg location varies by platform
    const platform = os.platform();
    const arch = os.arch();

    // Build list of possible directory names for vsdbg
    const vsdbgDirs: string[] = [];

    if (platform === 'win32') {
      vsdbgDirs.push('vsdbg', 'win32', 'x64', 'x86');
    } else if (platform === 'darwin') {
      // Newer extensions use just "arm64" or "x86_64"
      vsdbgDirs.push(
        arch === 'arm64' ? 'arm64' : 'x86_64',
        arch === 'arm64' ? 'vsdbg-osx-arm64' : 'vsdbg-osx-x64',
        'vsdbg'
      );
    } else {
      // Linux
      vsdbgDirs.push(
        arch === 'arm64' ? 'arm64' : 'x86_64',
        arch === 'arm64' ? 'vsdbg-linux-arm64' : 'vsdbg-linux-x64',
        'vsdbg'
      );
    }

    const possiblePaths: string[] = [];
    for (const vsdbgDir of vsdbgDirs) {
      possiblePaths.push(
        path.join(csharpExt, '.debugger', vsdbgDir, 'vsdbg'),
        path.join(csharpExt, '.debugger', vsdbgDir, 'vsdbg.exe')
      );
    }
    // Alternative locations
    possiblePaths.push(path.join(csharpExt, 'debugAdapters', 'vsdbg', 'vsdbg'));

    for (const p of possiblePaths) {
      if (existsSync(p)) {
        return p;
      }
    }

    // Try to find any vsdbg in the extension
    const debuggerDir = path.join(csharpExt, '.debugger');
    if (existsSync(debuggerDir)) {
      try {
        const entries = readdirSync(debuggerDir);
        for (const entry of entries) {
          if (entry.startsWith('vsdbg')) {
            const vsdbgPath = path.join(debuggerDir, entry, 'vsdbg');
            if (existsSync(vsdbgPath)) return vsdbgPath;
            const vsdbgExe = path.join(debuggerDir, entry, 'vsdbg.exe');
            if (existsSync(vsdbgExe)) return vsdbgExe;
          }
        }
      } catch {
        // Ignore
      }
    }
  }

  // Also try the C# Dev Kit extension
  const devKitExt = findExtension('ms-dotnettools.csdevkit');
  if (devKitExt) {
    const debuggerDir = path.join(devKitExt, '.debugger');
    if (existsSync(debuggerDir)) {
      try {
        const entries = readdirSync(debuggerDir);
        for (const entry of entries) {
          if (entry.startsWith('vsdbg')) {
            const vsdbgPath = path.join(debuggerDir, entry, 'vsdbg');
            if (existsSync(vsdbgPath)) return vsdbgPath;
          }
        }
      } catch {
        // Ignore
      }
    }
  }

  return null;
}

/**
 * Find debugpy from the Python or debugpy extension
 */
export function findDebugpy(): string | null {
  // Try the dedicated debugpy extension first (newer VS Code setup)
  const debugpyExt = findExtension('ms-python.debugpy');
  if (debugpyExt) {
    const debugpyPath = path.join(debugpyExt, 'bundled', 'libs', 'debugpy');
    if (existsSync(debugpyPath)) {
      return debugpyPath;
    }
  }

  // Try the Python extension (older VS Code setup had debugpy bundled)
  const pythonExt = findExtension('ms-python.python');
  if (pythonExt) {
    // debugpy may be bundled with the extension
    const possiblePaths = [
      path.join(pythonExt, 'pythonFiles', 'lib', 'python', 'debugpy'),
      path.join(pythonExt, 'bundled', 'libs', 'debugpy'),
    ];

    for (const p of possiblePaths) {
      if (existsSync(p)) {
        return p;
      }
    }
  }

  // Also check if debugpy is installed as a Python package
  // This is handled by the adapter's detect() function

  return null;
}

/**
 * Find CodeLLDB debugger
 */
export function findCodeLLDB(): string | null {
  const lldbExt = findExtension('vadimcn.vscode-lldb');
  if (lldbExt) {
    const possiblePaths = [
      path.join(lldbExt, 'adapter', 'codelldb'),
      path.join(lldbExt, 'adapter', 'codelldb.exe'),
      path.join(lldbExt, 'lldb', 'bin', 'lldb-vscode'),
    ];

    for (const p of possiblePaths) {
      if (existsSync(p)) {
        return p;
      }
    }
  }

  return null;
}

/**
 * Find js-debug (VS Code's JavaScript/Node.js debugger)
 */
export function findJsDebug(): string | null {
  // js-debug is a built-in VS Code extension, but can also be installed standalone
  // Check for the ms-vscode.js-debug extension
  const jsDebugExt = findExtension('ms-vscode.js-debug');
  if (jsDebugExt) {
    const possiblePaths = [
      path.join(jsDebugExt, 'src', 'dapDebugServer.js'),
      path.join(jsDebugExt, 'dist', 'dapDebugServer.js'),
    ];

    for (const p of possiblePaths) {
      if (existsSync(p)) {
        return p;
      }
    }
  }

  // Also check for the nightly version
  const jsDebugNightly = findExtension('ms-vscode.js-debug-nightly');
  if (jsDebugNightly) {
    const possiblePaths = [
      path.join(jsDebugNightly, 'src', 'dapDebugServer.js'),
      path.join(jsDebugNightly, 'dist', 'dapDebugServer.js'),
    ];

    for (const p of possiblePaths) {
      if (existsSync(p)) {
        return p;
      }
    }
  }

  return null;
}

/**
 * Summary of all detected VS Code adapters
 */
export function detectVSCodeAdapters(): Record<string, string | null> {
  return {
    vsdbg: findVsdbg(),
    debugpy: findDebugpy(),
    codelldb: findCodeLLDB(),
    jsDebug: findJsDebug(),
  };
}
