import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getAdapter, getAdapterNames } from '../adapters/index.js';
import { parseBreakpointSpec, validateBreakpointSpec } from '../session/breakpoints.js';
import { analyzeSourceMap } from '../sourcemaps/diagnose.js';
import { parseSourceMapOverrides } from '../sourcemaps/overrides.js';
import { probeAdapter } from './probe.js';

export interface DoctorCheck {
  code: string;
  status: 'pass' | 'warn' | 'fail' | 'skipped';
  evidence: 'preflight' | 'handshake';
  message: string;
  remediation?: string;
  details?: unknown;
}
export interface DoctorOptions {
  adapter: string;
  cwd?: string;
  breakpoint?: string[];
  sourceMapOverrides?: string;
  probe?: boolean;
}
export interface DoctorReport {
  schemaVersion: 1;
  ok: boolean;
  adapter: string;
  cwd: string;
  program?: string;
  checks: DoctorCheck[];
}
const execute = promisify(execFile);
const MAX_FILE_BYTES = 8 * 1024 * 1024;

async function readableFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile() && (await access(file, constants.R_OK).then(() => true));
  } catch {
    return false;
  }
}
async function readSmall(file: string): Promise<string> {
  if ((await stat(file)).size > MAX_FILE_BYTES)
    throw new Error('File exceeds the 8 MiB diagnostic limit.');
  return readFile(file, 'utf8');
}

export async function diagnose(
  program: string | undefined,
  options: DoctorOptions
): Promise<DoctorReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const target = program ? resolve(cwd, program) : undefined;
  const report: DoctorReport = {
    schemaVersion: 1,
    ok: true,
    adapter: options.adapter,
    cwd,
    program: target,
    checks: [],
  };
  const add = (
    code: string,
    status: DoctorCheck['status'],
    message: string,
    remediation?: string,
    details?: unknown,
    evidence: DoctorCheck['evidence'] = 'preflight'
  ) => {
    report.checks.push({
      code,
      status,
      evidence,
      message,
      ...(remediation ? { remediation } : {}),
      ...(details === undefined ? {} : { details }),
    });
    if (status === 'fail') report.ok = false;
  };
  let validCwd = false;
  try {
    validCwd = (await stat(cwd)).isDirectory();
    await access(cwd, constants.R_OK | constants.X_OK);
  } catch {
    validCwd = false;
  }
  add(
    'WORKING_DIRECTORY',
    validCwd ? 'pass' : 'fail',
    validCwd ? 'Working directory is accessible.' : 'Working directory is missing or inaccessible.',
    validCwd ? undefined : 'Set --cwd to an accessible directory.'
  );
  const adapter = getAdapter(options.adapter);
  if (!adapter) {
    add(
      'UNKNOWN_ADAPTER',
      'fail',
      `Unknown adapter: ${options.adapter}`,
      `Choose one of: ${getAdapterNames().join(', ')}`
    );
    return report;
  }
  report.adapter = adapter.name;
  let detected: string | null = null;
  try {
    detected = await adapter.detect();
  } catch (error) {
    add('ADAPTER_DETECTION_FAILED', 'fail', String(error), adapter.installHint);
  }
  add(
    'ADAPTER_AVAILABLE',
    detected ? 'pass' : 'fail',
    detected
      ? 'Adapter installation detected; this does not verify a DAP connection.'
      : 'Adapter was not detected.',
    detected ? undefined : adapter.installHint,
    detected
      ? { installation: detected, command: adapter.command, args: adapter.args ?? [] }
      : undefined
  );
  // js-debug distributes version metadata; do not invoke arbitrary adapters with guessed version flags.
  let adapterVersion: string | undefined;
  if (detected && adapter.name === 'node' && adapter.args?.[0]) {
    try {
      const metadata = JSON.parse(
        await readSmall(join(dirname(adapter.args[0]), '..', 'package.json'))
      );
      if (typeof metadata.version === 'string') adapterVersion = metadata.version;
    } catch {
      /* Installation layouts vary. */
    }
  }
  add(
    'ADAPTER_VERSION',
    adapterVersion ? 'pass' : 'skipped',
    adapterVersion
      ? `Adapter version: ${adapterVersion}`
      : 'Adapter version is not available from supported local metadata.'
  );

  const runtime =
    adapter.name === 'node'
      ? 'node'
      : adapter.name === 'debugpy'
        ? adapter.command
        : ['dotnet', 'vsdbg', 'netcoredbg'].includes(adapter.name)
          ? 'dotnet'
          : undefined;
  if (runtime) {
    try {
      const { stdout, stderr } = await execute(
        runtime,
        runtime === 'dotnet' ? ['--list-runtimes'] : ['--version'],
        { cwd: validCwd ? cwd : undefined, timeout: 5000, maxBuffer: 65536, windowsHide: true }
      );
      const version = (stdout || stderr).trim();
      if (!version) throw new Error('Runtime returned no version information.');
      add(
        'RUNTIME_AVAILABLE',
        'pass',
        'Runtime command is available; target runtime compatibility has not been verified.',
        undefined,
        { command: runtime, version }
      );
    } catch (error) {
      add(
        'RUNTIME_UNAVAILABLE',
        'fail',
        `Could not query ${runtime}: ${error instanceof Error ? error.message : error}`,
        `Install or select the runtime for this target and check PATH.`
      );
    }
  } else
    add('RUNTIME_AVAILABLE', 'skipped', 'Native targets have no managed runtime command to check.');

  const targetReadable = target ? await readableFile(target) : false;
  add(
    'TARGET_FILE',
    target ? (targetReadable ? 'pass' : 'fail') : 'skipped',
    target
      ? targetReadable
        ? 'Target file is readable.'
        : 'Target is missing, unreadable, or not a file.'
      : 'No target supplied; target-specific checks were skipped.',
    target && !targetReadable
      ? 'Build the target and provide its path relative to --cwd.'
      : undefined
  );
  let overrides: Record<string, string> | undefined;
  if (options.sourceMapOverrides) {
    try {
      overrides = parseSourceMapOverrides(options.sourceMapOverrides, cwd);
      add(
        'PATH_MAPPINGS',
        'pass',
        'Source-map overrides parsed. Binding still requires a target session.',
        undefined,
        overrides
      );
    } catch (error) {
      add(
        'INVALID_PATH_MAPPINGS',
        'fail',
        String(error),
        'Use a supported preset or a JSON object of string path mappings.'
      );
    }
  }
  if (target && targetReadable && adapter.name === 'node') {
    try {
      const source = await readSmall(target);
      const references = [
        ...source.matchAll(
          /\/\/[#@]\s*sourceMappingURL=([^\s]+)|\/\*[#@]\s*sourceMappingURL=([^\s*]+)\s*\*\//g
        ),
      ];
      const last = references.at(-1);
      const reference = last ? (last[1] ?? last[2]) : undefined;
      if (reference && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) {
        add(
          'SOURCE_MAP_UNCHECKED',
          'warn',
          'Inline, URL, or virtual source map reference was not inspected.',
          'Use diagnose-sources on local external maps, or verify binding in a debug session.'
        );
      } else {
        const mapPath = reference
          ? resolve(dirname(target), decodeURIComponent(reference))
          : `${target}.map`;
        if (await readableFile(mapPath)) {
          await readSmall(mapPath);
          const map = analyzeSourceMap(mapPath, cwd, { sourceMapOverrides: overrides });
          add(
            'SOURCE_MAP',
            map.valid && map.sourcesMissing === 0 ? 'pass' : 'warn',
            map.error ??
              (map.sourcesMissing
                ? `${map.sourcesMissing} source(s) cannot be resolved locally or from embedded content.`
                : 'External source map and source paths are readable; binding has not been verified.'),
            map.valid && !map.sourcesMissing
              ? undefined
              : 'Rebuild source maps or correct --source-map-overrides; run diagnose-sources for details.',
            { ...map, sources: map.sources.slice(0, 20), sourcesTruncated: map.sources.length > 20 }
          );
        } else
          add(
            'SOURCE_MAP_MISSING',
            'warn',
            'No readable external map was found for this entry point. Plain JavaScript may not need one.',
            'For TypeScript or bundled sources, rebuild with source maps; maps for imported modules can be checked with diagnose-sources.',
            { mapPath }
          );
      }
    } catch (error) {
      add(
        'SOURCE_MAP_UNCHECKED',
        'warn',
        `Could not inspect the entry-point map: ${error instanceof Error ? error.message : error}`,
        'Run diagnose-sources on the build directory.'
      );
    }
  }
  if (target && targetReadable && ['dotnet', 'vsdbg', 'netcoredbg'].includes(adapter.name)) {
    const pdb = target.slice(0, target.length - extname(target).length) + '.pdb';
    const exists = await readableFile(pdb);
    add(
      'SYMBOL_FILE',
      exists ? 'pass' : 'warn',
      exists
        ? 'Adjacent PDB exists; symbol identity and binding were not verified.'
        : 'No adjacent PDB found; symbols may be embedded or elsewhere.',
      exists
        ? undefined
        : 'Build with debug symbols and verify symbol loading in the target session.',
      { path: pdb }
    );
  }
  if (target && targetReadable && adapter.name === 'lldb' && process.platform !== 'win32') {
    try {
      await access(target, constants.X_OK);
      add(
        'TARGET_EXECUTABLE',
        'pass',
        'Native target is executable; debug symbols have not been inspected.'
      );
    } catch {
      add(
        'TARGET_EXECUTABLE',
        'fail',
        'Native target is not executable.',
        'Build an executable target and check its permissions.'
      );
    }
  }
  for (const spec of options.breakpoint ?? []) {
    const valid = validateBreakpointSpec(spec);
    if (!valid.valid) {
      add(
        'INVALID_BREAKPOINT',
        'fail',
        valid.error!,
        'Use file:line, file:line?condition, or file:line#count.',
        { spec, binding: 'invalid' }
      );
      continue;
    }
    const bp = parseBreakpointSpec(spec.trim(), { cwd });
    const exists = await readableFile(bp.file);
    add(
      'BREAKPOINT_SOURCE',
      exists ? 'pass' : 'warn',
      exists
        ? 'Breakpoint source is readable; executable line and binding are unchecked.'
        : 'Breakpoint source is not readable locally; generated or virtual sources may still bind.',
      exists ? undefined : 'Check --cwd, source-map paths, and symbols before running.',
      { requested: bp, binding: 'unchecked' }
    );
  }
  if (options.probe && detected && validCwd) {
    try {
      add(
        'ADAPTER_HANDSHAKE',
        'pass',
        'Adapter answered DAP initialize. No target was launched; launch, attach, and breakpoint binding remain unchecked.',
        undefined,
        { capabilities: await probeAdapter(adapter, cwd) },
        'handshake'
      );
    } catch (error) {
      add(
        'ADAPTER_HANDSHAKE_FAILED',
        'fail',
        error instanceof Error ? error.message : String(error),
        'Check adapter/runtime compatibility and reinstall the adapter if needed.',
        undefined,
        'handshake'
      );
    }
  } else
    add(
      'ADAPTER_HANDSHAKE',
      'skipped',
      options.probe
        ? 'Adapter probe skipped because prerequisites failed.'
        : 'Adapter was not started. Use --probe to test its DAP handshake.',
      undefined,
      undefined,
      'handshake'
    );
  return report;
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    `debug-run doctor: ${report.ok ? 'no blocking preflight errors' : 'checks failed'} (${report.adapter})`,
  ];
  for (const check of report.checks) {
    lines.push(`[${check.status}] ${check.code}: ${check.message}`);
    if (check.remediation) lines.push(`  Next: ${check.remediation}`);
  }
  lines.push(
    'Preflight and handshake checks do not prove that your target runs or its breakpoints bind.'
  );
  return lines.join('\n');
}
