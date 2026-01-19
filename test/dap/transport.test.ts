/**
 * Unit tests for DAP Transport Layer
 *
 * Tests the wire protocol handling including:
 * - Content-Length framing
 * - Request/response correlation
 * - Event dispatching
 * - Error handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DapTransport } from '../../src/dap/transport.js';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// Create a mock ChildProcess with the necessary streams
function createMockProcess(): {
  process: ChildProcess;
  stdin: { write: ReturnType<typeof vi.fn>; writable: boolean };
  stdout: EventEmitter;
  stderr: EventEmitter;
  emit: (event: string, ...args: unknown[]) => boolean;
} {
  const stdin = { write: vi.fn(), writable: true };
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const processEmitter = new EventEmitter();

  const mockProcess = {
    stdin,
    stdout,
    stderr,
    on: processEmitter.on.bind(processEmitter),
    once: processEmitter.once.bind(processEmitter),
    emit: processEmitter.emit.bind(processEmitter),
    kill: vi.fn(),
    pid: 12345,
  } as unknown as ChildProcess;

  return {
    process: mockProcess,
    stdin,
    stdout,
    stderr,
    emit: processEmitter.emit.bind(processEmitter),
  };
}

// Helper to create a DAP message with Content-Length framing
function createDapMessage(message: object): Buffer {
  const json = JSON.stringify(message);
  const contentLength = Buffer.byteLength(json, 'utf-8');
  const header = `Content-Length: ${contentLength}\r\n\r\n`;
  return Buffer.from(header + json);
}

describe('DapTransport', () => {
  let mock: ReturnType<typeof createMockProcess>;
  let transport: DapTransport;

  beforeEach(() => {
    mock = createMockProcess();
    transport = new DapTransport(mock.process);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('throws if process has no stdout', () => {
      const badProcess = { stdin: { writable: true }, stdout: null } as unknown as ChildProcess;
      expect(() => new DapTransport(badProcess)).toThrow('Process must have stdout and stdin');
    });

    it('throws if process has no stdin', () => {
      const badProcess = { stdin: null, stdout: new EventEmitter() } as unknown as ChildProcess;
      expect(() => new DapTransport(badProcess)).toThrow('Process must have stdout and stdin');
    });

    it('initializes with default timeout', () => {
      expect(transport.isOpen()).toBe(true);
    });

    it('accepts custom timeout', () => {
      const customTransport = new DapTransport(mock.process, 5000);
      expect(customTransport.isOpen()).toBe(true);
    });
  });

  describe('send', () => {
    it('formats messages with Content-Length header', () => {
      const message = { seq: 1, type: 'request' as const, command: 'initialize' };
      transport.send(message);

      const json = JSON.stringify(message);
      const expectedHeader = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n`;
      expect(mock.stdin.write).toHaveBeenCalledWith(expectedHeader + json);
    });

    it('emits sent event', () => {
      const sentHandler = vi.fn();
      transport.on('sent', sentHandler);

      const message = { seq: 1, type: 'request' as const, command: 'test' };
      transport.send(message);

      expect(sentHandler).toHaveBeenCalledWith(message);
    });

    it('does nothing when transport is closed', () => {
      transport.close();
      const message = { seq: 1, type: 'request' as const, command: 'test' };
      transport.send(message);

      // Should not call write after close
      expect(mock.stdin.write).not.toHaveBeenCalled();
    });
  });

  describe('message parsing', () => {
    it('parses complete DAP messages', () => {
      const messageHandler = vi.fn();
      transport.on('message', messageHandler);

      const message = { seq: 1, type: 'event', event: 'initialized' };
      mock.stdout.emit('data', createDapMessage(message));

      expect(messageHandler).toHaveBeenCalledWith(message);
    });

    it('handles fragmented messages across multiple chunks', () => {
      const messageHandler = vi.fn();
      transport.on('message', messageHandler);

      const message = { seq: 1, type: 'event', event: 'stopped', body: { reason: 'breakpoint' } };
      const fullData = createDapMessage(message);

      // Split into multiple chunks
      const chunk1 = fullData.subarray(0, 10);
      const chunk2 = fullData.subarray(10, 30);
      const chunk3 = fullData.subarray(30);

      mock.stdout.emit('data', chunk1);
      expect(messageHandler).not.toHaveBeenCalled();

      mock.stdout.emit('data', chunk2);
      expect(messageHandler).not.toHaveBeenCalled();

      mock.stdout.emit('data', chunk3);
      expect(messageHandler).toHaveBeenCalledWith(message);
    });

    it('handles multiple messages in single chunk', () => {
      const messageHandler = vi.fn();
      transport.on('message', messageHandler);

      const msg1 = { seq: 1, type: 'event', event: 'initialized' };
      const msg2 = { seq: 2, type: 'event', event: 'stopped' };

      const combinedData = Buffer.concat([createDapMessage(msg1), createDapMessage(msg2)]);
      mock.stdout.emit('data', combinedData);

      expect(messageHandler).toHaveBeenCalledTimes(2);
      expect(messageHandler).toHaveBeenCalledWith(msg1);
      expect(messageHandler).toHaveBeenCalledWith(msg2);
    });

    it('emits parseError for invalid JSON', () => {
      const errorHandler = vi.fn();
      transport.on('parseError', errorHandler);

      const invalidMessage = Buffer.from('Content-Length: 11\r\n\r\n{invalid:}!');
      mock.stdout.emit('data', invalidMessage);

      expect(errorHandler).toHaveBeenCalled();
    });

    it('handles missing Content-Length header gracefully', () => {
      const messageHandler = vi.fn();
      transport.on('message', messageHandler);

      // Invalid header without Content-Length - transport skips past it
      const invalidHeader = Buffer.from('Invalid-Header: xxx\r\n\r\n{}');
      mock.stdout.emit('data', invalidHeader);

      // The invalid header is consumed and message handler is not called
      // because Content-Length is required for parsing
      expect(messageHandler).not.toHaveBeenCalled();

      // A subsequent valid message should still be parsed correctly
      const validMessage = createDapMessage({ seq: 1, type: 'event', event: 'test' });
      mock.stdout.emit('data', validMessage);

      expect(messageHandler).toHaveBeenCalledWith({ seq: 1, type: 'event', event: 'test' });
    });
  });

  describe('event handling', () => {
    it('emits typed events for DAP events', () => {
      const stoppedHandler = vi.fn();
      transport.on('event:stopped', stoppedHandler);

      const eventBody = { reason: 'breakpoint', threadId: 1 };
      const message = { seq: 1, type: 'event', event: 'stopped', body: eventBody };
      mock.stdout.emit('data', createDapMessage(message));

      expect(stoppedHandler).toHaveBeenCalledWith(eventBody);
    });

    it('emits generic event for all events', () => {
      const eventHandler = vi.fn();
      transport.on('event', eventHandler);

      const message = { seq: 1, type: 'event', event: 'output', body: { output: 'hello' } };
      mock.stdout.emit('data', createDapMessage(message));

      expect(eventHandler).toHaveBeenCalledWith(message);
    });

    it('emits reverseRequest for adapter requests', () => {
      const reverseHandler = vi.fn();
      const specificHandler = vi.fn();
      transport.on('reverseRequest', reverseHandler);
      transport.on('reverseRequest:handshake', specificHandler);

      const message = {
        seq: 1,
        type: 'request',
        command: 'handshake',
        arguments: { value: 'test' },
      };
      mock.stdout.emit('data', createDapMessage(message));

      expect(reverseHandler).toHaveBeenCalledWith(message);
      expect(specificHandler).toHaveBeenCalledWith(message);
    });
  });

  describe('sendRequest', () => {
    it('sends request and resolves on success response', async () => {
      const promise = transport.sendRequest<{ result: string }>('initialize', { clientID: 'test' });

      // Verify request was sent
      expect(mock.stdin.write).toHaveBeenCalled();
      const sentData = mock.stdin.write.mock.calls[0][0];
      expect(sentData).toContain('"command":"initialize"');

      // Simulate response
      const response = {
        seq: 1,
        type: 'response',
        request_seq: 1,
        command: 'initialize',
        success: true,
        body: { result: 'ok' },
      };
      mock.stdout.emit('data', createDapMessage(response));

      const result = await promise;
      expect(result).toEqual({ result: 'ok' });
    });

    it('rejects on failure response', async () => {
      const promise = transport.sendRequest('launch', {});

      const response = {
        seq: 1,
        type: 'response',
        request_seq: 1,
        command: 'launch',
        success: false,
        message: 'Failed to launch',
      };
      mock.stdout.emit('data', createDapMessage(response));

      await expect(promise).rejects.toThrow('Failed to launch');
    });

    it('rejects with generic message when no error message provided', async () => {
      const promise = transport.sendRequest('test', {});

      const response = {
        seq: 1,
        type: 'response',
        request_seq: 1,
        command: 'test',
        success: false,
      };
      mock.stdout.emit('data', createDapMessage(response));

      await expect(promise).rejects.toThrow("Request 'test' failed");
    });

    it('rejects when transport is closed', async () => {
      transport.close();
      await expect(transport.sendRequest('test')).rejects.toThrow('Transport is closed');
    });

    it('times out after configured duration', async () => {
      const fastTransport = new DapTransport(mock.process, 50); // 50ms timeout

      const promise = fastTransport.sendRequest('slowCommand');

      // Don't send response - let it timeout
      await expect(promise).rejects.toThrow("Request 'slowCommand' timed out after 50ms");
    });

    it('correlates responses by sequence number', async () => {
      const promise1 = transport.sendRequest<{ id: number }>('first');
      const promise2 = transport.sendRequest<{ id: number }>('second');

      // Send responses out of order
      const response2 = {
        seq: 2,
        type: 'response',
        request_seq: 2,
        command: 'second',
        success: true,
        body: { id: 2 },
      };
      const response1 = {
        seq: 1,
        type: 'response',
        request_seq: 1,
        command: 'first',
        success: true,
        body: { id: 1 },
      };

      mock.stdout.emit('data', createDapMessage(response2));
      mock.stdout.emit('data', createDapMessage(response1));

      expect(await promise1).toEqual({ id: 1 });
      expect(await promise2).toEqual({ id: 2 });
    });
  });

  describe('close', () => {
    it('kills the process', () => {
      transport.close();
      expect(mock.process.kill).toHaveBeenCalled();
    });

    it('marks transport as closed', () => {
      expect(transport.isOpen()).toBe(true);
      transport.close();
      expect(transport.isOpen()).toBe(false);
    });

    it('rejects all pending requests', async () => {
      const promise1 = transport.sendRequest('pending1');
      const promise2 = transport.sendRequest('pending2');

      transport.close();

      await expect(promise1).rejects.toThrow('Transport closed');
      await expect(promise2).rejects.toThrow('Transport closed');
    });

    it('is idempotent', () => {
      transport.close();
      transport.close(); // Should not throw
      expect(mock.process.kill).toHaveBeenCalledTimes(1);
    });
  });

  describe('process events', () => {
    it('emits exit event and closes on process exit', () => {
      const exitHandler = vi.fn();
      transport.on('exit', exitHandler);

      mock.emit('exit', 0, null);

      expect(exitHandler).toHaveBeenCalledWith(0, null);
      expect(transport.isOpen()).toBe(false);
    });

    it('emits error event on process error', () => {
      const errorHandler = vi.fn();
      transport.on('error', errorHandler);

      const error = new Error('Process failed');
      mock.emit('error', error);

      expect(errorHandler).toHaveBeenCalledWith(error);
      expect(transport.isOpen()).toBe(false);
    });

    it('emits stderr data', () => {
      const stderrHandler = vi.fn();
      transport.on('stderr', stderrHandler);

      mock.stderr.emit('data', Buffer.from('debug output'));

      expect(stderrHandler).toHaveBeenCalledWith('debug output');
    });

    it('rejects pending requests on process exit', async () => {
      const promise = transport.sendRequest('test');

      mock.emit('exit', 1, 'SIGTERM');

      await expect(promise).rejects.toThrow('Debug adapter exited');
    });
  });
});
