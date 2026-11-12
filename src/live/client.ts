import { readSessionFile, type ConnectionInfo } from './storage.js';
import { ControlError, type LiveCommand } from './controller.js';
import { MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, parseCommand } from './protocol.js';

export async function sendCommand(id: string, input: LiveCommand): Promise<unknown> {
  const command = parseCommand(input);
  try {
    const terminal = await readSessionFile(id, 'result.json');
    if (command.action === 'status' || command.action === 'stop') return terminal;
    throw new ControlError('SESSION_ENDED', 'This session has ended. Start a new session.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let connection: ConnectionInfo;
  try {
    connection = (await readSessionFile(id, 'connection.json')) as ConnectionInfo;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ControlError(
        'SESSION_NOT_FOUND',
        'No active or completed session exists with this ID.'
      );
    }
    throw error;
  }
  if (
    connection.sessionId !== id ||
    !Number.isInteger(connection.port) ||
    connection.port < 1 ||
    connection.port > 65535 ||
    !/^[0-9a-f]{64}$/.test(connection.token)
  ) {
    throw new ControlError('INVALID_SESSION', 'Invalid session connection information.');
  }
  try {
    const response = await fetch(`http://127.0.0.1:${connection.port}/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS + 2000),
      redirect: 'error',
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty session response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ControlError('RESPONSE_TOO_LARGE', 'Session response exceeded the size limit.');
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body.ok)
      throw new ControlError(
        body.error?.code ?? 'SESSION_ERROR',
        body.error?.message ?? 'Session command failed.'
      );
    return body.result;
  } catch (error) {
    if (error instanceof ControlError) throw error;
    // A command can race normal teardown. Only status/stop may use the terminal result.
    if (command.action === 'status' || command.action === 'stop') {
      try {
        return await readSessionFile(id, 'result.json');
      } catch {
        /* Report unavailable below. */
      }
    }
    throw new ControlError(
      'SESSION_UNAVAILABLE',
      'The session worker is unavailable; it may have exited. Start a new session.'
    );
  }
}
