/**
 * Adapter Registry
 *
 * Central registry for all supported debug adapters.
 */

export * from "./base.js";
export * from "./netcoredbg.js";
export * from "./debugpy.js";

import type { AdapterConfig } from "./base.js";
import { netcoredbgAdapter } from "./netcoredbg.js";
import { debugpyAdapter } from "./debugpy.js";

const adapters: Map<string, AdapterConfig> = new Map([
  ["netcoredbg", netcoredbgAdapter],
  ["coreclr", netcoredbgAdapter],
  ["dotnet", netcoredbgAdapter],
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
 * Get all available adapter names
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
      const path = await adapter.detect();
      if (path) {
        installed.set(name, path);
      }
    }
  }

  return installed;
}
