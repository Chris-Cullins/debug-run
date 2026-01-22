/**
 * Source Map Diagnostics
 *
 * Scans directories for source map files, validates them, and reports
 * on source file resolution to help diagnose breakpoint binding issues.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyOverrides } from './overrides.js';

export interface SourceMapInfo {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  mappings: string;
  names?: string[];
}

export interface SourceResolution {
  original: string;
  resolved: string | null;
  exists: boolean;
  hasContent: boolean;
}

export interface SourceMapDiagnostic {
  mapPath: string;
  generatedFile: string | null;
  valid: boolean;
  error?: string;
  version?: number;
  sourcesTotal: number;
  sourcesWithContent: number;
  sourcesResolved: number;
  sourcesMissing: number;
  sources: SourceResolution[];
}

export interface DiagnosticSummary {
  mapsScanned: number;
  mapsValid: number;
  mapsInvalid: number;
  totalSources: number;
  sourcesResolved: number;
  sourcesMissing: number;
  sourcesWithContent: number;
  topIssues: string[];
}

export interface DiagnoseResult {
  summary: DiagnosticSummary;
  maps: SourceMapDiagnostic[];
}

export interface DiagnoseOptions {
  sourceMapOverrides?: Record<string, string>;
  includeNodeModules?: boolean;
  verbose?: boolean;
}

const DEFAULT_EXCLUDE_DIRS = ['node_modules', '.git', '.svn', '.hg'];

export function diagnoseSourceMaps(
  directory: string,
  options: DiagnoseOptions = {}
): DiagnoseResult {
  const excludeDirs = options.includeNodeModules
    ? DEFAULT_EXCLUDE_DIRS.filter((d) => d !== 'node_modules')
    : DEFAULT_EXCLUDE_DIRS;

  const mapFiles = findMapFiles(directory, excludeDirs);
  const maps: SourceMapDiagnostic[] = [];

  const summary: DiagnosticSummary = {
    mapsScanned: 0,
    mapsValid: 0,
    mapsInvalid: 0,
    totalSources: 0,
    sourcesResolved: 0,
    sourcesMissing: 0,
    sourcesWithContent: 0,
    topIssues: [],
  };

  const issueCounters: Record<string, number> = {};

  for (const mapPath of mapFiles) {
    summary.mapsScanned++;
    const diagnostic = analyzeSourceMap(mapPath, directory, options);
    maps.push(diagnostic);

    if (diagnostic.valid) {
      summary.mapsValid++;
    } else {
      summary.mapsInvalid++;
      if (diagnostic.error) {
        issueCounters[diagnostic.error] = (issueCounters[diagnostic.error] || 0) + 1;
      }
    }

    summary.totalSources += diagnostic.sourcesTotal;
    summary.sourcesResolved += diagnostic.sourcesResolved;
    summary.sourcesMissing += diagnostic.sourcesMissing;
    summary.sourcesWithContent += diagnostic.sourcesWithContent;

    for (const source of diagnostic.sources) {
      if (!source.exists && !source.hasContent) {
        const issue = `Source not found: ${source.original}`;
        issueCounters[issue] = (issueCounters[issue] || 0) + 1;
      }
    }
  }

  summary.topIssues = Object.entries(issueCounters)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([issue, count]) => `${issue} (${count}x)`);

  return { summary, maps };
}

function findMapFiles(directory: string, excludeDirs: string[]): string[] {
  const mapFiles: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith('.map')) {
        mapFiles.push(fullPath);
      }
    }
  }

  walk(directory);
  return mapFiles;
}

function analyzeSourceMap(
  mapPath: string,
  workspaceRoot: string,
  options: DiagnoseOptions
): SourceMapDiagnostic {
  const mapDir = path.dirname(mapPath);

  let content: string;
  try {
    content = fs.readFileSync(mapPath, 'utf8');
  } catch (error) {
    return {
      mapPath,
      generatedFile: null,
      valid: false,
      error: `Failed to read file: ${error instanceof Error ? error.message : error}`,
      sourcesTotal: 0,
      sourcesWithContent: 0,
      sourcesResolved: 0,
      sourcesMissing: 0,
      sources: [],
    };
  }

  let sourceMap: SourceMapInfo;
  try {
    sourceMap = JSON.parse(content);
  } catch (error) {
    return {
      mapPath,
      generatedFile: null,
      valid: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : error}`,
      sourcesTotal: 0,
      sourcesWithContent: 0,
      sourcesResolved: 0,
      sourcesMissing: 0,
      sources: [],
    };
  }

  if (sourceMap.version !== 3) {
    return {
      mapPath,
      generatedFile: sourceMap.file || null,
      valid: false,
      error: `Unsupported source map version: ${sourceMap.version} (expected 3)`,
      version: sourceMap.version,
      sourcesTotal: 0,
      sourcesWithContent: 0,
      sourcesResolved: 0,
      sourcesMissing: 0,
      sources: [],
    };
  }

  if (!Array.isArray(sourceMap.sources)) {
    return {
      mapPath,
      generatedFile: sourceMap.file || null,
      valid: false,
      error: 'Missing or invalid "sources" array',
      version: sourceMap.version,
      sourcesTotal: 0,
      sourcesWithContent: 0,
      sourcesResolved: 0,
      sourcesMissing: 0,
      sources: [],
    };
  }

  const generatedFile = sourceMap.file
    ? path.resolve(mapDir, sourceMap.file)
    : mapPath.replace(/\.map$/, '');

  const sources: SourceResolution[] = [];
  let sourcesWithContent = 0;
  let sourcesResolved = 0;
  let sourcesMissing = 0;

  for (let i = 0; i < sourceMap.sources.length; i++) {
    const original = sourceMap.sources[i];
    const hasContent = !!(sourceMap.sourcesContent && sourceMap.sourcesContent[i]);

    if (hasContent) {
      sourcesWithContent++;
    }

    const resolved = resolveSourcePath(
      original,
      mapDir,
      sourceMap.sourceRoot,
      workspaceRoot,
      options.sourceMapOverrides
    );

    const exists = resolved ? fs.existsSync(resolved) : false;

    if (exists || hasContent) {
      sourcesResolved++;
    } else {
      sourcesMissing++;
    }

    sources.push({
      original,
      resolved,
      exists,
      hasContent,
    });
  }

  return {
    mapPath,
    generatedFile,
    valid: true,
    version: sourceMap.version,
    sourcesTotal: sourceMap.sources.length,
    sourcesWithContent,
    sourcesResolved,
    sourcesMissing,
    sources,
  };
}

function resolveSourcePath(
  source: string,
  mapDir: string,
  sourceRoot: string | undefined,
  workspaceRoot: string,
  overrides?: Record<string, string>
): string | null {
  if (overrides) {
    const overridden = applyOverrides(source, overrides);
    if (overridden) {
      return path.isAbsolute(overridden) ? overridden : path.resolve(workspaceRoot, overridden);
    }
  }

  if (source.startsWith('webpack://') || source.startsWith('file://')) {
    const stripped = source.replace(/^webpack:\/\/[^/]*\//, '').replace(/^file:\/\//, '');
    return path.resolve(workspaceRoot, stripped);
  }

  if (source.startsWith('/@fs/')) {
    return source.slice(4);
  }

  if (path.isAbsolute(source)) {
    return source;
  }

  const basePath = sourceRoot ? path.resolve(mapDir, sourceRoot) : mapDir;
  return path.resolve(basePath, source);
}

export function formatDiagnoseReport(result: DiagnoseResult, verbose: boolean): string {
  const lines: string[] = [];

  lines.push('Source Map Diagnostic Report');
  lines.push('='.repeat(40));
  lines.push('');

  const { summary } = result;
  lines.push('Summary:');
  lines.push(`  Maps scanned:        ${summary.mapsScanned}`);
  lines.push(`  Maps valid:          ${summary.mapsValid}`);
  lines.push(`  Maps invalid:        ${summary.mapsInvalid}`);
  lines.push(`  Total sources:       ${summary.totalSources}`);
  lines.push(`  Sources resolved:    ${summary.sourcesResolved}`);
  lines.push(`  Sources missing:     ${summary.sourcesMissing}`);
  lines.push(`  Sources w/ content:  ${summary.sourcesWithContent}`);
  lines.push('');

  if (summary.topIssues.length > 0) {
    lines.push('Top Issues:');
    for (const issue of summary.topIssues) {
      lines.push(`  - ${issue}`);
    }
    lines.push('');
  }

  if (verbose && result.maps.length > 0) {
    lines.push('Details:');
    lines.push('-'.repeat(40));

    for (const map of result.maps) {
      lines.push('');
      lines.push(`Map: ${map.mapPath}`);
      lines.push(`  Generated: ${map.generatedFile || 'unknown'}`);
      lines.push(`  Valid: ${map.valid}`);
      if (map.error) {
        lines.push(`  Error: ${map.error}`);
      }
      lines.push(
        `  Sources: ${map.sourcesTotal} total, ${map.sourcesResolved} resolved, ${map.sourcesMissing} missing`
      );

      if (map.sourcesMissing > 0) {
        lines.push('  Missing sources:');
        for (const src of map.sources) {
          if (!src.exists && !src.hasContent) {
            lines.push(`    - ${src.original}`);
            if (src.resolved) {
              lines.push(`      (tried: ${src.resolved})`);
            }
          }
        }
      }
    }
  }

  return lines.join('\n');
}
