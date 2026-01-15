/**
 * VSDA Handshake Signer
 *
 * Uses VS Code's native VSDA module to sign vsdbg handshake challenges.
 * This is required for vsdbg authentication.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as os from "node:os";

// Create a require function for loading native modules in ESM context
const require = createRequire(import.meta.url);

// Possible locations of VS Code's VSDA native module (.node file)
const VSDA_PATHS = [
  // macOS
  "/Applications/Visual Studio Code.app/Contents/Resources/app/node_modules.asar.unpacked/vsda/build/Release/vsda.node",
  "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/node_modules.asar.unpacked/vsda/build/Release/vsda.node",
  // Linux
  "/usr/share/code/resources/app/node_modules.asar.unpacked/vsda/build/Release/vsda.node",
  "/usr/share/code-insiders/resources/app/node_modules.asar.unpacked/vsda/build/Release/vsda.node",
  // Windows (common install locations)
  path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "resources", "app", "node_modules.asar.unpacked", "vsda", "build", "Release", "vsda.node"),
  path.join(process.env.PROGRAMFILES || "", "Microsoft VS Code", "resources", "app", "node_modules.asar.unpacked", "vsda", "build", "Release", "vsda.node"),
];

interface VsdaModule {
  signer(): {
    sign(value: string): string;
  };
}

let vsdaModule: VsdaModule | null = null;
let vsdaLoadAttempted = false;

/**
 * Find and load the VSDA module from VS Code installation
 */
export function loadVsda(): VsdaModule | null {
  if (vsdaLoadAttempted) {
    return vsdaModule;
  }
  vsdaLoadAttempted = true;

  // Also check user-specific locations
  const home = os.homedir();
  const additionalPaths = [
    // Cursor (VS Code fork) on macOS
    "/Applications/Cursor.app/Contents/Resources/app/node_modules.asar.unpacked/vsda/build/Release/vsda.node",
    // User-installed VS Code on Linux
    path.join(home, ".vscode-server", "bin", "*", "node_modules.asar.unpacked", "vsda", "build", "Release", "vsda.node"),
  ];

  const allPaths = [...VSDA_PATHS, ...additionalPaths];

  for (const vsdaPath of allPaths) {
    try {
      if (existsSync(vsdaPath)) {
        // Try to require the native module
        vsdaModule = require(vsdaPath) as VsdaModule;
        return vsdaModule;
      }
    } catch {
      // Continue to next path
    }
  }

  return null;
}

/**
 * Sign a vsdbg handshake challenge
 */
export function signHandshake(challenge: string): string | null {
  const vsda = loadVsda();
  if (!vsda) {
    return null;
  }

  try {
    const signer = vsda.signer();
    return signer.sign(challenge);
  } catch {
    return null;
  }
}

/**
 * Check if VSDA signing is available
 */
export function isVsdaAvailable(): boolean {
  return loadVsda() !== null;
}
