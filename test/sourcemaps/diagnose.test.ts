/**
 * Tests for source map diagnostics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { diagnoseSourceMaps, formatDiagnoseReport } from '../../src/sourcemaps/diagnose.js';

describe('Source Map Diagnostics', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnose-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(relativePath: string, content: string): string {
    const fullPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    return fullPath;
  }

  describe('diagnoseSourceMaps', () => {
    it('should find and parse valid source maps', () => {
      writeFile('src/index.ts', 'export const x = 1;');
      writeFile(
        'dist/index.js.map',
        JSON.stringify({
          version: 3,
          file: 'index.js',
          sources: ['../src/index.ts'],
          mappings: 'AAAA',
        })
      );

      const result = diagnoseSourceMaps(tmpDir);

      expect(result.summary.mapsScanned).toBe(1);
      expect(result.summary.mapsValid).toBe(1);
      expect(result.summary.mapsInvalid).toBe(0);
      expect(result.summary.sourcesResolved).toBe(1);
      expect(result.summary.sourcesMissing).toBe(0);
    });

    it('should report missing source files', () => {
      writeFile(
        'dist/index.js.map',
        JSON.stringify({
          version: 3,
          file: 'index.js',
          sources: ['../src/missing.ts'],
          mappings: 'AAAA',
        })
      );

      const result = diagnoseSourceMaps(tmpDir);

      expect(result.summary.mapsValid).toBe(1);
      expect(result.summary.sourcesMissing).toBe(1);
      expect(result.summary.topIssues.length).toBeGreaterThan(0);
    });

    it('should handle sources with embedded content', () => {
      writeFile(
        'dist/bundle.js.map',
        JSON.stringify({
          version: 3,
          file: 'bundle.js',
          sources: ['nonexistent.ts'],
          sourcesContent: ['// Original source code'],
          mappings: 'AAAA',
        })
      );

      const result = diagnoseSourceMaps(tmpDir);

      expect(result.summary.sourcesWithContent).toBe(1);
      expect(result.summary.sourcesResolved).toBe(1);
      expect(result.summary.sourcesMissing).toBe(0);
    });

    it('should report invalid JSON', () => {
      writeFile('dist/broken.js.map', 'not valid json');

      const result = diagnoseSourceMaps(tmpDir);

      expect(result.summary.mapsInvalid).toBe(1);
      expect(result.maps[0].error).toMatch(/Invalid JSON/);
    });

    it('should report unsupported version', () => {
      writeFile(
        'dist/old.js.map',
        JSON.stringify({
          version: 2,
          file: 'old.js',
          sources: [],
          mappings: '',
        })
      );

      const result = diagnoseSourceMaps(tmpDir);

      expect(result.summary.mapsInvalid).toBe(1);
      expect(result.maps[0].error).toMatch(/Unsupported source map version/);
    });

    it('should skip node_modules by default', () => {
      writeFile(
        'node_modules/lib/index.js.map',
        JSON.stringify({
          version: 3,
          sources: [],
          mappings: '',
        })
      );

      const result = diagnoseSourceMaps(tmpDir);

      expect(result.summary.mapsScanned).toBe(0);
    });

    it('should include node_modules when requested', () => {
      writeFile(
        'node_modules/lib/index.js.map',
        JSON.stringify({
          version: 3,
          sources: [],
          mappings: '',
        })
      );

      const result = diagnoseSourceMaps(tmpDir, { includeNodeModules: true });

      expect(result.summary.mapsScanned).toBe(1);
    });

    it('should apply source map overrides', () => {
      writeFile('src/file.ts', 'export const x = 1;');
      writeFile(
        'dist/bundle.js.map',
        JSON.stringify({
          version: 3,
          file: 'bundle.js',
          sources: ['webpack:///./src/file.ts'],
          mappings: 'AAAA',
        })
      );

      const result = diagnoseSourceMaps(tmpDir, {
        sourceMapOverrides: {
          'webpack:///./*': `${tmpDir}/*`,
        },
      });

      expect(result.summary.sourcesResolved).toBe(1);
      expect(result.summary.sourcesMissing).toBe(0);
    });
  });

  describe('formatDiagnoseReport', () => {
    it('should format summary in human-readable format', () => {
      writeFile('src/index.ts', 'export const x = 1;');
      writeFile(
        'dist/index.js.map',
        JSON.stringify({
          version: 3,
          file: 'index.js',
          sources: ['../src/index.ts'],
          mappings: 'AAAA',
        })
      );

      const result = diagnoseSourceMaps(tmpDir);
      const report = formatDiagnoseReport(result, false);

      expect(report).toContain('Source Map Diagnostic Report');
      expect(report).toContain('Maps scanned:');
      expect(report).toContain('Sources resolved:');
    });

    it('should include details in verbose mode', () => {
      writeFile(
        'dist/index.js.map',
        JSON.stringify({
          version: 3,
          file: 'index.js',
          sources: ['../src/missing.ts'],
          mappings: 'AAAA',
        })
      );

      const result = diagnoseSourceMaps(tmpDir);
      const report = formatDiagnoseReport(result, true);

      expect(report).toContain('Details:');
      expect(report).toContain('Missing sources:');
      expect(report).toContain('missing.ts');
    });
  });
});
