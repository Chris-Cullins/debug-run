import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ControlError, type SessionController } from './controller.js';
import {
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  errorResult,
  parseCommand,
} from './protocol.js';

export async function startControlServer(
  controller: SessionController,
  onTimeout: () => void,
  statusExtras: () => object = () => ({})
): Promise<{
  server: Server;
  port: number;
  token: string;
}> {
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  const server = createServer(async (request, response) => {
    request.setTimeout(5000, () => request.destroy());
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    const send = (body: unknown, code = 200) => {
      let json = JSON.stringify(body);
      if (Buffer.byteLength(json) > MAX_RESPONSE_BYTES) {
        code = 413;
        json = JSON.stringify(
          errorResult(
            new ControlError(
              'RESPONSE_TOO_LARGE',
              'Inspect a narrower expression or reduce --depth.'
            )
          )
        );
      }
      if (!response.destroyed) {
        response.writeHead(code);
        response.end(json);
      }
    };
    const auth = Buffer.from(request.headers.authorization ?? '');
    if (
      request.headers.origin ||
      auth.length !== expected.length ||
      !timingSafeEqual(auth, expected)
    ) {
      send(errorResult(new ControlError('UNAUTHORIZED', 'Session authentication required.')), 401);
      return;
    }
    if (request.method !== 'POST' || request.url !== '/') {
      send(errorResult(new ControlError('INVALID_REQUEST', 'Use POST /.')), 404);
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES)
          throw new ControlError('REQUEST_TOO_LARGE', 'Session request exceeds 16 KiB.');
        chunks.push(chunk);
      }
      request.setTimeout(0);
      let input: unknown;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new ControlError('INVALID_COMMAND', 'Request body must be valid JSON.');
      }
      const command = parseCommand(input);
      const result = await Promise.race([
        controller.execute(command),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            onTimeout();
            reject(
              new ControlError('REQUEST_TIMEOUT', 'Command timed out; the session is being closed.')
            );
          }, REQUEST_TIMEOUT_MS);
        }),
      ]);
      send({
        ok: true,
        result: command.action === 'status' ? { ...(result as object), ...statusExtras() } : result,
      });
    } catch (error) {
      send(errorResult(error), 400);
    } finally {
      clearTimeout(timeout);
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not create session endpoint.');
  return { server, port: address.port, token };
}
