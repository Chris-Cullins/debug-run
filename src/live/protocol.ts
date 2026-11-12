import { ControlError, type LiveCommand } from './controller.js';

export const MAX_REQUEST_BYTES = 16 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 15000;
export const DEFAULT_LIFETIME_MS = 10 * 60 * 1000;

export function parseCommand(input: unknown): LiveCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ControlError('INVALID_COMMAND', 'Expected a command object.');
  }
  const value = input as Record<string, unknown>;
  const actions = ['status', 'inspect', 'step', 'continue', 'pause', 'stop'];
  if (!actions.includes(value.action as string)) {
    throw new ControlError('INVALID_COMMAND', 'Unknown session command.');
  }
  const allowed = new Set([
    'action',
    'stopId',
    'frameId',
    'threadId',
    'expression',
    'depth',
    'kind',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ControlError('INVALID_COMMAND', `Unknown field: ${key}`);
  }
  for (const key of ['stopId', 'frameId', 'threadId', 'depth']) {
    if (
      value[key] !== undefined &&
      (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0)
    ) {
      throw new ControlError('INVALID_COMMAND', `${key} must be a nonnegative integer.`);
    }
  }
  if (value.depth !== undefined && (value.depth as number) > 4) {
    throw new ControlError('INVALID_COMMAND', 'Maximum inspection depth is 4.');
  }
  if (
    value.expression !== undefined &&
    (typeof value.expression !== 'string' ||
      value.expression.length === 0 ||
      value.expression.length > 8192)
  ) {
    throw new ControlError('INVALID_COMMAND', 'Expression must contain 1 to 8192 characters.');
  }
  if (value.kind !== undefined && !['over', 'into', 'out'].includes(value.kind as string)) {
    throw new ControlError('INVALID_COMMAND', 'Step kind must be over, into, or out.');
  }
  return value as unknown as LiveCommand;
}

export function errorResult(error: unknown): {
  ok: false;
  error: { code: string; message: string };
} {
  return {
    ok: false,
    error: {
      code: error instanceof ControlError ? error.code : 'ADAPTER_ERROR',
      message: error instanceof Error ? error.message : String(error),
    },
  };
}
