/**
 * Tests for source map path overrides parsing
 */

import { describe, it, expect } from 'vitest';
import { parseSourceMapOverrides, applyOverrides, getPresetNames } from '../../src/sourcemaps/overrides.js';

describe('Source Map Overrides', () => {
  describe('parseSourceMapOverrides', () => {
    const workspaceFolder = '/Users/test/project';

    it('should parse webpack preset', () => {
      const result = parseSourceMapOverrides('webpack', workspaceFolder);
      expect(result).toHaveProperty('webpack:///./*');
      expect(result['webpack:///./*']).toBe('/Users/test/project/*');
    });

    it('should parse vite preset', () => {
      const result = parseSourceMapOverrides('vite', workspaceFolder);
      expect(result).toHaveProperty('/@fs/*');
      expect(result['/@fs/*']).toBe('/*');
    });

    it('should parse esbuild preset', () => {
      const result = parseSourceMapOverrides('esbuild', workspaceFolder);
      expect(result).toHaveProperty('file:///*');
    });

    it('should be case-insensitive for presets', () => {
      const result = parseSourceMapOverrides('WEBPACK', workspaceFolder);
      expect(result).toHaveProperty('webpack:///./*');
    });

    it('should parse JSON object', () => {
      const json = '{"custom://*": "/src/*"}';
      const result = parseSourceMapOverrides(json, workspaceFolder);
      expect(result).toEqual({ 'custom://*': '/src/*' });
    });

    it('should expand ${workspaceFolder} in JSON values', () => {
      const json = '{"pattern/*": "${workspaceFolder}/src/*"}';
      const result = parseSourceMapOverrides(json, workspaceFolder);
      expect(result).toEqual({ 'pattern/*': '/Users/test/project/src/*' });
    });

    it('should expand ${cwd} in JSON values', () => {
      const json = '{"pattern/*": "${cwd}/dist/*"}';
      const result = parseSourceMapOverrides(json, workspaceFolder);
      expect(result).toEqual({ 'pattern/*': '/Users/test/project/dist/*' });
    });

    it('should throw on invalid JSON', () => {
      expect(() => parseSourceMapOverrides('not-valid-json', workspaceFolder)).toThrow(
        /Invalid source map overrides/
      );
    });

    it('should throw on non-object JSON', () => {
      expect(() => parseSourceMapOverrides('["array"]', workspaceFolder)).toThrow(
        /must be an object/
      );
    });

    it('should throw on non-string values', () => {
      expect(() => parseSourceMapOverrides('{"key": 123}', workspaceFolder)).toThrow(
        /must be a string/
      );
    });
  });

  describe('applyOverrides', () => {
    it('should apply matching override with wildcard', () => {
      const overrides = { 'webpack:///./*': '/src/*' };
      const result = applyOverrides('webpack:///./path/to/file.ts', overrides);
      expect(result).toBe('/src/path/to/file.ts');
    });

    it('should return null when no override matches', () => {
      const overrides = { 'webpack:///*': '/src/*' };
      const result = applyOverrides('other://path', overrides);
      expect(result).toBeNull();
    });

    it('should handle exact match without wildcard', () => {
      const overrides = { 'exact/path': '/replaced/path' };
      const result = applyOverrides('exact/path', overrides);
      expect(result).toBe('/replaced/path');
    });

    it('should apply first matching override', () => {
      const overrides = {
        'webpack:///./*': '/first/*',
        'webpack:///*': '/second/*',
      };
      const result = applyOverrides('webpack:///./file.ts', overrides);
      expect(result).toBe('/first/file.ts');
    });

    it('should handle vite /@fs/ paths', () => {
      const overrides = { '/@fs/*': '/*' };
      const result = applyOverrides('/@fs/Users/dev/project/src/file.ts', overrides);
      expect(result).toBe('/Users/dev/project/src/file.ts');
    });
  });

  describe('getPresetNames', () => {
    it('should return available preset names', () => {
      const presets = getPresetNames();
      expect(presets).toContain('webpack');
      expect(presets).toContain('vite');
      expect(presets).toContain('esbuild');
    });
  });
});
