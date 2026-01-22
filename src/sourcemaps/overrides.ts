/**
 * Source Map Path Overrides
 *
 * Parses and expands source map path override patterns for debuggers.
 * Supports preset names (webpack, vite) and custom JSON mappings.
 */

/**
 * Standard preset overrides for common bundlers.
 * These patterns match VS Code's default sourceMapPathOverrides.
 */
const PRESETS: Record<string, Record<string, string>> = {
  webpack: {
    'webpack:///./*': '${workspaceFolder}/*',
    'webpack:///*': '/*',
    'webpack:///src/*': '${workspaceFolder}/src/*',
    'webpack://./src/*': '${workspaceFolder}/src/*',
  },
  vite: {
    '/@fs/*': '/*',
    '/node_modules/*': '${workspaceFolder}/node_modules/*',
  },
  esbuild: {
    'file:///*': '/*',
  },
};

/**
 * Parse source map overrides from CLI input.
 *
 * Accepts:
 * - Preset name: "webpack", "vite", "esbuild"
 * - JSON object: '{"pattern": "replacement"}'
 * - File path with @ prefix: "@./overrides.json"
 *
 * @param input - CLI flag value
 * @param workspaceFolder - Workspace folder for ${workspaceFolder} expansion
 * @returns Parsed overrides with placeholders expanded
 */
export function parseSourceMapOverrides(
  input: string,
  workspaceFolder: string
): Record<string, string> {
  const trimmed = input.trim();

  // Check for file path (@ prefix)
  if (trimmed.startsWith('@')) {
    const fs = require('node:fs');
    const filePath = trimmed.slice(1);
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    return expandPlaceholders(validateOverrides(parsed), workspaceFolder);
  }

  // Check for preset name
  const presetName = trimmed.toLowerCase();
  if (PRESETS[presetName]) {
    return expandPlaceholders(PRESETS[presetName], workspaceFolder);
  }

  // Try parsing as JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      `Invalid source map overrides: "${input}". ` +
        `Expected a preset name (${Object.keys(PRESETS).join(', ')}), ` +
        `JSON object, or @filepath.`
    );
  }
  return expandPlaceholders(validateOverrides(parsed), workspaceFolder);
}

/**
 * Validate that overrides is a Record<string, string>
 */
function validateOverrides(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Source map overrides must be an object with string keys and values');
  }

  const obj = value as Record<string, unknown>;
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val !== 'string') {
      throw new Error(`Source map override value for "${key}" must be a string, got ${typeof val}`);
    }
  }

  return obj as Record<string, string>;
}

/**
 * Expand ${workspaceFolder} and other placeholders in override values.
 */
function expandPlaceholders(
  overrides: Record<string, string>,
  workspaceFolder: string
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [pattern, replacement] of Object.entries(overrides)) {
    result[pattern] = replacement
      .replace(/\$\{workspaceFolder\}/g, workspaceFolder)
      .replace(/\$\{cwd\}/g, workspaceFolder);
  }

  return result;
}

/**
 * Apply source map overrides to a source path.
 * Used by diagnose-sources to test path resolution.
 *
 * @param sourcePath - Original source path from source map
 * @param overrides - Expanded overrides
 * @returns Resolved path or null if no override matched
 */
export function applyOverrides(
  sourcePath: string,
  overrides: Record<string, string>
): string | null {
  for (const [pattern, replacement] of Object.entries(overrides)) {
    const match = matchPattern(sourcePath, pattern);
    if (match !== null) {
      return replacement.replace('*', match);
    }
  }
  return null;
}

/**
 * Match a path against a pattern with a single * wildcard.
 * Returns the captured portion or null if no match.
 */
function matchPattern(path: string, pattern: string): string | null {
  const starIndex = pattern.indexOf('*');
  if (starIndex === -1) {
    return path === pattern ? '' : null;
  }

  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);

  if (!path.startsWith(prefix)) {
    return null;
  }
  if (suffix && !path.endsWith(suffix)) {
    return null;
  }

  const capturedStart = prefix.length;
  const capturedEnd = suffix ? path.length - suffix.length : path.length;
  return path.slice(capturedStart, capturedEnd);
}

/**
 * Get the list of available preset names.
 */
export function getPresetNames(): string[] {
  return Object.keys(PRESETS);
}
