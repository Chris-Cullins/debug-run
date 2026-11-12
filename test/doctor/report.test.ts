import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnose } from '../../src/doctor/report.js';

const mocks = vi.hoisted(() => ({
  adapter: {
    name: 'node',
    id: 'pwa-node',
    command: 'node',
    args: [] as string[],
    installHint: 'Install js-debug.',
    detect: vi.fn(),
  },
  runtimeFailure: false,
  probe: vi.fn(),
}));
vi.mock('../../src/adapters/index.js', () => ({
  getAdapter: (name: string) => (name === 'unknown' ? undefined : mocks.adapter),
  getAdapterNames: () => ['node'],
}));
vi.mock('../../src/doctor/probe.js', () => ({ probeAdapter: mocks.probe }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: async () => {
      if (mocks.runtimeFailure) throw new Error('Runtime missing');
      return { stdout: 'v22.22.1', stderr: '' };
    },
  });
  return { execFile };
});
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'debug-run-doctor-'));
  await writeFile(join(directory, 'app.js'), 'console.log(1);\n');
  mocks.adapter.name = 'node';
  mocks.adapter.detect.mockResolvedValue('/adapter');
  mocks.runtimeFailure = false;
  mocks.probe.mockReset().mockResolvedValue({ supportsConditionalBreakpoints: true });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
const options = () => ({ adapter: 'node', cwd: directory });
const check = (report: Awaited<ReturnType<typeof diagnose>>, code: string) =>
  report.checks.find((c) => c.code === code);

describe('doctor evidence', () => {
  it('checks paths relative to cwd without probing or claiming binding', async () => {
    const report = await diagnose('app.js', { ...options(), breakpoint: ['app.js:1'] });
    expect(report.ok).toBe(true);
    expect(report.program).toBe(join(directory, 'app.js'));
    expect(check(report, 'BREAKPOINT_SOURCE')?.details).toMatchObject({ binding: 'unchecked' });
    expect(check(report, 'ADAPTER_HANDSHAKE')?.status).toBe('skipped');
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it('reports missing targets and invalid breakpoint syntax as failures', async () => {
    const report = await diagnose('missing.js', {
      ...options(),
      breakpoint: ['app.js:nope', 'app.js:9007199254740992'],
    });
    expect(report.ok).toBe(false);
    expect(check(report, 'TARGET_FILE')?.status).toBe('fail');
    expect(report.checks.filter((c) => c.code === 'INVALID_BREAKPOINT')).toHaveLength(2);
  });
  it('does not label missing virtual sources a proven binding failure', async () => {
    const report = await diagnose('app.js', { ...options(), breakpoint: ['virtual.ts:10'] });
    expect(report.ok).toBe(true);
    expect(check(report, 'BREAKPOINT_SOURCE')).toMatchObject({
      status: 'warn',
      details: { binding: 'unchecked' },
    });
  });
  it('reports an unavailable adapter and skips its probe', async () => {
    mocks.adapter.detect.mockResolvedValue(null);
    const report = await diagnose(undefined, { ...options(), probe: true });
    expect(report.ok).toBe(false);
    expect(check(report, 'ADAPTER_AVAILABLE')).toMatchObject({
      status: 'fail',
      remediation: 'Install js-debug.',
    });
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it('reports unknown adapters without invoking detection', async () => {
    mocks.adapter.detect.mockClear();
    const report = await diagnose(undefined, { ...options(), adapter: 'unknown' });
    expect(check(report, 'UNKNOWN_ADAPTER')?.status).toBe('fail');
    expect(mocks.adapter.detect).not.toHaveBeenCalled();
  });
  it('includes capabilities only as explicit handshake evidence', async () => {
    const report = await diagnose('app.js', { ...options(), probe: true });
    expect(check(report, 'ADAPTER_HANDSHAKE')).toMatchObject({
      evidence: 'handshake',
      status: 'pass',
      details: { capabilities: { supportsConditionalBreakpoints: true } },
    });
    expect(mocks.probe).toHaveBeenCalledOnce();
  });
  it('reports failed handshakes and runtime queries with remediation', async () => {
    mocks.runtimeFailure = true;
    mocks.probe.mockRejectedValue(new Error('Handshake refused'));
    const report = await diagnose('app.js', { ...options(), probe: true });
    expect(report.ok).toBe(false);
    expect(check(report, 'RUNTIME_UNAVAILABLE')?.status).toBe('fail');
    expect(check(report, 'ADAPTER_HANDSHAKE_FAILED')).toMatchObject({
      status: 'fail',
      message: 'Handshake refused',
    });
  });
  it('inspects referenced external maps and embedded source content', async () => {
    await writeFile(join(directory, 'app.js'), 'console.log(1);\n//# sourceMappingURL=custom.map');
    await writeFile(
      join(directory, 'custom.map'),
      JSON.stringify({
        version: 3,
        sources: ['missing.ts'],
        sourcesContent: ['let n = 1'],
        mappings: '',
      })
    );
    const report = await diagnose('app.js', options());
    expect(check(report, 'SOURCE_MAP')).toMatchObject({
      status: 'pass',
      details: { sourcesWithContent: 1, sourcesMissing: 0 },
    });
  });
  it('handles malformed maps and invalid overrides without crashing', async () => {
    await writeFile(join(directory, 'app.js.map'), 'null');
    const report = await diagnose('app.js', { ...options(), sourceMapOverrides: '[1]' });
    expect(report.ok).toBe(false);
    expect(check(report, 'INVALID_PATH_MAPPINGS')?.status).toBe('fail');
    expect(check(report, 'SOURCE_MAP_UNCHECKED')?.status).toBe('warn');
  });
  it('does not fetch remote source maps', async () => {
    await writeFile(join(directory, 'app.js'), '//# sourceMappingURL=https://example.com/a.map');
    const report = await diagnose('app.js', options());
    expect(check(report, 'SOURCE_MAP_UNCHECKED')?.status).toBe('warn');
  });
  it('does not start an adapter when cwd is inaccessible', async () => {
    const report = await diagnose('app.js', {
      ...options(),
      cwd: join(directory, 'absent'),
      probe: true,
    });
    expect(check(report, 'WORKING_DIRECTORY')?.status).toBe('fail');
    expect(mocks.probe).not.toHaveBeenCalled();
  });
});
