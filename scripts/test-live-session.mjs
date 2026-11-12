import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

// Integration test: real CLI subprocesses, local HTTP, and the installed js-debug adapter.
// Unit tests remain adapter-independent and do not launch processes.
const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/index.cjs', import.meta.url));
const sourceHome = process.env.DEBUG_RUN_HOME ?? join(homedir(), '.debug-run');
const directory = await mkdtemp(join(tmpdir(), 'debug-run-live-test-'));
const env = { ...process.env, DEBUG_RUN_HOME: directory };
const sessions = new Set();
let attached;

async function command(...args) {
  let stdout;
  let code = 0;
  try {
    ({ stdout } = await exec(process.execPath, [cli, ...args], {
      env,
      timeout: 40000,
      maxBuffer: 2 * 1024 * 1024,
    }));
  } catch (error) {
    if (!error.stdout) throw error;
    stdout = error.stdout;
    code = error.code;
  }
  const result = JSON.parse(stdout);
  assert.equal(result.schemaVersion, 1);
  assert.equal(code, result.ok ? 0 : 1, stdout);
  return result;
}

async function start(...args) {
  const result = await command('start', ...args, '-a', 'node');
  if (result.sessionId) sessions.add(result.sessionId);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(JSON.stringify(result).includes('token'), false);
  return result.sessionId;
}

async function waitFor(id, predicate) {
  const deadline = Date.now() + 15000;
  let result;
  do {
    result = await command('status', id);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (predicate(result.result)) return result.result;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Session did not reach expected state: ${JSON.stringify(result)}`);
}

async function connection(id) {
  return JSON.parse(await readFile(join(directory, 'sessions', id, 'connection.json'), 'utf8'));
}

async function waitForCleanup(id) {
  const file = join(directory, 'sessions', id, 'connection.json');
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await stat(file);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    await delay(100);
  }
  throw new Error(`Session ${id} did not remove its credentials`);
}

async function waitForProcessExit(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(100);
  }
  throw new Error(`Launched target ${pid} is still alive after cleanup`);
}

try {
  await symlink(join(sourceHome, 'adapters'), join(directory, 'adapters'), 'junction');
  const fixture = join(directory, 'app.cjs');
  await writeFile(fixture, 'let total = 1;\ntotal += 2;\ntotal *= 3;\nconsole.log(total);\n');
  const id = await start(fixture, '-b', `${fixture}:3`, '--timeout', '30s');
  const first = await waitFor(id, (status) => status.state === 'paused' && status.stop.ready);
  assert.equal(first.stop.stack[0].line, 3);
  const inspected = await command('inspect', id, '--expr', 'total');
  assert.equal(inspected.result.value.value, 3);
  assert.equal(inspected.result.stopId, first.stop.id);
  const frame = String(first.stop.stack[0].id);
  const explicit = await command('inspect', id, '--frame', frame, '--stop', String(first.stop.id));
  assert.equal(explicit.ok, true);
  assert.equal((await command('inspect', id, '--frame', frame)).error.code, 'STOP_REQUIRED');

  const info = await connection(id);
  const endpoint = `http://127.0.0.1:${info.port}/`;
  const badAuth = await fetch(endpoint, { method: 'POST', body: '{"action":"stop"}' });
  assert.equal(badAuth.status, 401);
  const origin = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${info.token}`, Origin: 'https://example.com' },
    body: '{"action":"stop"}',
  });
  assert.equal(origin.status, 401);
  const malformed = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${info.token}` },
    body: '{"action":"unknown"}',
  });
  assert.equal((await malformed.json()).error.code, 'INVALID_COMMAND');
  const huge = await command('inspect', id, '--expr', '"x".repeat(1100000)');
  assert.ok(huge.ok || huge.error.code === 'RESPONSE_TOO_LARGE'); // Adapters may truncate first.
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(directory, 'sessions', id))).mode & 0o077, 0);
    assert.equal((await stat(join(directory, 'sessions', id, 'connection.json'))).mode & 0o077, 0);
  }

  assert.equal((await command('step', id, '--stop', String(first.stop.id))).ok, true);
  const second = await waitFor(
    id,
    (status) => status.state === 'paused' && status.stop.id > first.stop.id && status.stop.ready
  );
  assert.equal((await command('inspect', id, '--expr', 'total')).result.value.value, 9);
  assert.equal(
    (await command('inspect', id, '--expr', 'total', '--stop', String(first.stop.id))).error.code,
    'STALE_STOP'
  );
  assert.equal((await command('continue', id, '--stop', String(second.stop.id))).ok, true);
  const ended = await waitFor(id, (status) => status.state === 'ended');
  assert.ok(['exited', 'terminated'].includes(ended.outcome));
  if (ended.outcome === 'exited') assert.equal(ended.exitCode, 0);
  await waitForCleanup(id);
  assert.equal((await command('inspect', id)).error.code, 'SESSION_ENDED');
  sessions.delete(id);
  console.log(
    'PASS: separate CLI calls inspect, step, reject stale references, continue, and clean up'
  );
  console.log(
    'PASS: authentication, browser-origin rejection, protocol validation, private files, and output limits'
  );

  const loop = join(directory, 'loop.cjs');
  await writeFile(loop, 'let counter = 0;\nsetInterval(() => { counter += 1; }, 10);\n');
  const left = await start(loop, '--timeout', '30s');
  const right = await start(loop, '--timeout', '30s');
  await waitFor(left, (status) => status.state === 'paused' && status.stop.ready);
  await waitFor(right, (status) => status.state === 'paused' && status.stop.ready);
  const leftPid = (await command('inspect', left, '--expr', 'process.pid')).result.value.value;
  const rightPid = (await command('inspect', right, '--expr', 'process.pid')).result.value.value;
  assert.notEqual(leftPid, rightPid);
  assert.equal((await command('stop', left)).ok, true);
  await waitForCleanup(left);
  await waitForProcessExit(leftPid);
  assert.equal((await command('status', right)).result.state, 'paused');
  assert.equal((await command('stop', right)).ok, true);
  await waitForCleanup(right);
  await waitForProcessExit(rightPid);
  sessions.delete(left);
  sessions.delete(right);
  console.log(
    'PASS: concurrent sessions use independent debugger targets; stop terminates launched targets'
  );

  const timed = await start(loop, '--timeout', '3s');
  await waitFor(timed, (status) => status.state === 'paused' && status.stop.ready);
  const timedPid = (await command('inspect', timed, '--expr', 'process.pid')).result.value.value;
  const timedOut = await waitFor(timed, (status) => status.state === 'failed');
  assert.equal(timedOut.outcome, 'timeout');
  await waitForCleanup(timed);
  await waitForProcessExit(timedPid);
  sessions.delete(timed);
  console.log('PASS: lifetime includes paused time and cleans up on timeout');

  const throws = join(directory, 'throws.cjs');
  await writeFile(throws, 'const detail = "expected";\nthrow new Error(detail);\n');
  const exception = await start(throws, '--break-on-exception', 'uncaught', '--timeout', '15s');
  const exceptionStop = await waitFor(
    exception,
    (status) => status.state === 'paused' && status.stop.ready
  );
  assert.equal(exceptionStop.stop.reason, 'exception');
  assert.equal(
    (await command('inspect', exception, '--expr', 'detail')).result.value.value,
    'expected'
  );
  await command('stop', exception);
  await waitForCleanup(exception);
  sessions.delete(exception);
  console.log('PASS: exception stops remain available for follow-up inspection');

  attached = spawn(process.execPath, ['--inspect=127.0.0.1:0', loop], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const inspectorPort = await new Promise((resolvePort, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Inspector did not start')), 5000);
    attached.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/ws:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolvePort(match[1]);
      }
    });
    attached.once('error', reject);
  });
  const attach = await start('--attach', '--port', inspectorPort, '--timeout', '15s');
  const pausedAttach = await command('pause', attach);
  assert.equal(pausedAttach.ok, true, JSON.stringify(pausedAttach));
  await waitFor(attach, (status) => status.state === 'paused' && status.stop.ready);
  assert.equal(
    (await command('inspect', attach, '--expr', 'process.pid')).result.value.value,
    attached.pid
  );
  await command('stop', attach);
  await waitForCleanup(attach);
  process.kill(attached.pid, 0);
  sessions.delete(attach);
  console.log('PASS: pause and inspect an attached target; disconnect leaves it alive');
} finally {
  for (const id of sessions) {
    try {
      await command('stop', id);
      await waitForCleanup(id);
    } catch {
      /* Bounded lifetime is the fallback. */
    }
  }
  attached?.kill();
  await rm(directory, { recursive: true, force: true });
}
