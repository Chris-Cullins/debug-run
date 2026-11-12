import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFile } from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(JSON.stringify({ name: 'debug-run', version: '0.6.0' })),
  appendFile: vi.fn().mockResolvedValue(undefined),
}));

describe('release eligibility', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('GITHUB_OUTPUT', '/tmp/github-output');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    [{ '0.5.10': {} }, 'true'],
    [{ '0.5.10': {}, '0.6.0': {} }, 'false'],
  ])('checks whether the exact version is published', async (versions, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ versions }),
      })
    );
    await import('../../scripts/check-release.mjs');
    expect(appendFile).toHaveBeenCalledWith('/tmp/github-output', `should_publish=${expected}\n`);
  });

  it.each([404, 403, 503])('fails closed on HTTP %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
    await expect(import('../../scripts/check-release.mjs')).rejects.toThrow(`HTTP ${status}`);
    expect(appendFile).not.toHaveBeenCalled();
  });

  it('fails closed on invalid metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await expect(import('../../scripts/check-release.mjs')).rejects.toThrow(
      'invalid package metadata'
    );
    expect(appendFile).not.toHaveBeenCalled();
  });

  it('fails closed on network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    await expect(import('../../scripts/check-release.mjs')).rejects.toThrow('network unavailable');
    expect(appendFile).not.toHaveBeenCalled();
  });
});
