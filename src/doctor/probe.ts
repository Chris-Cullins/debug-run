import type { AdapterConfig } from '../adapters/base.js';
import { DapClient } from '../dap/client.js';
import { SocketDapClient } from '../dap/socket-client.js';
import type { Capabilities } from '../dap/protocol.js';

/** Initialize and disconnect only: never launch, attach, or configure a target. */
export async function probeAdapter(adapter: AdapterConfig, cwd: string): Promise<Capabilities> {
  const client =
    adapter.transport === 'socket'
      ? new SocketDapClient({
          command: adapter.command,
          args: [adapter.args![0], '0', '127.0.0.1'],
          env: adapter.env,
          cwd,
          port: 0,
          host: '127.0.0.1',
          timeout: 2000,
        })
      : new DapClient({
          command: adapter.command,
          args: adapter.args,
          env: adapter.env,
          cwd,
          timeout: 2000,
        });
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectFailure!: (error: Error) => void;
  const failure = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  const onError = (error: Error) => rejectFailure(error);
  const onExit = () => rejectFailure(new Error('Adapter exited during initialization.'));
  client.on('error', onError);
  client.on('exit', onExit);
  try {
    const operation = async () => {
      await client.connect();
      if (cancelled) throw new Error('Adapter probe cancelled.');
      return client.initialize({ adapterID: adapter.id });
    };
    return await Promise.race([
      operation(),
      failure,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Adapter handshake exceeded 10 seconds.')),
          10000
        );
      }),
    ]);
  } finally {
    cancelled = true;
    clearTimeout(timer);
    // No target was started. Disconnect must never request termination of another process.
    await client.disconnect(false);
    client.removeListener('error', onError);
    client.removeListener('exit', onExit);
  }
}
