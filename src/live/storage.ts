import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { getDebugRunHome } from '../util/adapter-installer.js';
import { ControlError } from './controller.js';

export interface ConnectionInfo {
  sessionId: string;
  port: number;
  token: string;
}

export function sessionDirectory(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new ControlError('INVALID_SESSION', 'Expected a session ID returned by debug-run start.');
  }
  return join(getDebugRunHome(), 'sessions', id);
}

export async function createSessionDirectory(id: string): Promise<string> {
  const directory = sessionDirectory(id);
  await mkdir(join(getDebugRunHome(), 'sessions'), { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 });
  return directory;
}

export async function readSessionFile(
  id: string,
  file: 'connection.json' | 'result.json'
): Promise<unknown> {
  const directory = sessionDirectory(id);
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.platform !== 'win32' && (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0))
  ) {
    throw new ControlError(
      'INSECURE_SESSION',
      'Session directory must be owned by the current user and private.'
    );
  }
  return JSON.parse(await readFile(join(directory, file), 'utf8'));
}

export async function writeSessionFile(
  directory: string,
  file: string,
  value: unknown
): Promise<void> {
  await writeFile(join(directory, file), JSON.stringify(value), { mode: 0o600, flag: 'wx' });
}
