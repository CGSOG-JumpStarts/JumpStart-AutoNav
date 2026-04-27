/**
 * test-ipc.test.ts — T4.1.8 unit tests for the shared IPC helper.
 *
 * Coverage of the runIpc + isDirectRun contract:
 *   - isDirectRun returns true/false correctly across argv1 shapes
 *   - runIpc reads stdin, parses v0/v1, validates via Zod, writes
 *     v0/v1 envelope, exits with the right code on each typed error
 *
 * Tests use vi.spyOn on process.stdin/stdout/stderr/exit so the suite
 * runs in-process without spawning subprocesses.
 *
 * @see bin/lib-ts/ipc.ts
 * @see specs/decisions/adr-006-error-model.md
 * @see specs/decisions/adr-007-ipc-envelope-versioning.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { JumpstartError, ValidationError } from '../bin/lib-ts/errors.js';
import { isDirectRun, runIpc } from '../bin/lib-ts/ipc.js';

const ORIGINAL_IS_TTY = process.stdin.isTTY;

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

interface ExitCall {
  code: number;
}

function captureRunIpc(): {
  stdout: string[];
  stderr: string[];
  exitCalls: ExitCall[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCalls: ExitCall[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString());
    return true;
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push({ code: code ?? 0 });
    // Throw to short-circuit the test; the spy itself records the
    // intent. Without this, runIpc returns and the test's awaiter
    // continues normally — fine, but the throw makes assertion order
    // explicit.
    throw new Error(`process.exit(${code}) intercepted`);
  }) as never);
  return { stdout, stderr, exitCalls };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdin, 'isTTY', {
    value: ORIGINAL_IS_TTY,
    configurable: true,
  });
});

describe('isDirectRun', () => {
  it('returns true when import.meta.url matches process.argv[1] exactly', () => {
    const fakeUrl = `file://${process.argv[1]}`;
    expect(isDirectRun(fakeUrl)).toBe(true);
  });

  it('returns true when argv[1] suffix-matches the module path (npm-bin shim case)', () => {
    const fakeUrl = `file://${process.argv[1]}`;
    expect(isDirectRun(fakeUrl)).toBe(true);
  });

  it('returns false for a clearly different module', () => {
    expect(isDirectRun('file:///tmp/some-other-module.ts')).toBe(false);
  });

  it('returns false when argv[1] is undefined', () => {
    const original = process.argv[1];
    process.argv[1] = '';
    try {
      expect(isDirectRun('file:///anything.ts')).toBe(false);
    } finally {
      process.argv[1] = original;
    }
  });
});

describe('runIpc — v0 envelope (no version field)', () => {
  it('parses raw stdin → handler → result envelope (legacy v0 shape)', async () => {
    const { stdout, exitCalls } = captureRunIpc();
    setTTY(false);

    const handlerPromise = runIpc(async (input: { x: number }) => ({ doubled: input.x * 2 }));
    process.stdin.emit('data', '{"x":21}');
    process.stdin.emit('end');

    await handlerPromise.catch(() => {
      /* expected — exit spy throws */
    });

    expect(exitCalls).toEqual([{ code: 0 }]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.ok).toBe(true);
    expect(parsed.doubled).toBe(42);
    // v0: no `version` field on the wrapper.
    expect(parsed.version).toBeUndefined();
  });

  it('exits 0 when handler returns successfully', async () => {
    const { exitCalls } = captureRunIpc();
    setTTY(false);
    const p = runIpc(async () => ({ ok: true }));
    process.stdin.emit('data', '{}');
    process.stdin.emit('end');
    await p.catch(() => {
      /* exit spy throws — expected */
    });
    expect(exitCalls[0].code).toBe(0);
  });
});

describe('runIpc — v1 envelope', () => {
  it('parses v1 wrapper → handler sees `input` field → result wrapped in v1 envelope', async () => {
    const { stdout, exitCalls } = captureRunIpc();
    setTTY(false);

    const handlerPromise = runIpc(async (input: { name: string }) => ({
      greeting: `hi ${input.name}`,
    }));
    process.stdin.emit('data', '{"version":1,"input":{"name":"Samuel"}}');
    process.stdin.emit('end');
    await handlerPromise.catch(() => {
      /* exit spy throws — expected */
    });

    expect(exitCalls[0].code).toBe(0);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.ok).toBe(true);
    expect(parsed.version).toBe(1);
    expect(parsed.result).toEqual({ greeting: 'hi Samuel' });
  });
});

describe('runIpc — typed-error → exit-code translation (ADR-006)', () => {
  it('ValidationError → exit 2', async () => {
    const { exitCalls, stderr } = captureRunIpc();
    setTTY(false);
    const p = runIpc(async () => {
      throw new ValidationError('bad input', 'test.schema', []);
    });
    process.stdin.emit('data', '{}');
    process.stdin.emit('end');
    await p.catch(() => {
      /* exit spy throws — expected */
    });
    expect(exitCalls[0].code).toBe(2);
    const parsed = JSON.parse(stderr[0]);
    expect(parsed.error.code).toBe('VALIDATION');
    expect(parsed.error.message).toBe('bad input');
  });

  it('JumpstartError with default exitCode → exit 99', async () => {
    const { exitCalls } = captureRunIpc();
    setTTY(false);
    const p = runIpc(async () => {
      throw new JumpstartError('generic boom');
    });
    process.stdin.emit('data', '{}');
    process.stdin.emit('end');
    await p.catch(() => {
      /* exit spy throws — expected */
    });
    expect(exitCalls[0].code).toBe(99);
  });

  it('JumpstartError subclass with explicit exitCode is honored', async () => {
    class MyError extends JumpstartError {
      override exitCode = 7;
    }
    const { exitCalls } = captureRunIpc();
    setTTY(false);
    const p = runIpc(async () => {
      throw new MyError('typed boom');
    });
    process.stdin.emit('data', '{}');
    process.stdin.emit('end');
    await p.catch(() => {
      /* exit spy throws — expected */
    });
    expect(exitCalls[0].code).toBe(7);
  });

  it('untyped Error → exit 99', async () => {
    const { exitCalls, stderr } = captureRunIpc();
    setTTY(false);
    const p = runIpc(async () => {
      throw new Error('plain js error');
    });
    process.stdin.emit('data', '{}');
    process.stdin.emit('end');
    await p.catch(() => {
      /* exit spy throws — expected */
    });
    expect(exitCalls[0].code).toBe(99);
    const parsed = JSON.parse(stderr[0]);
    expect(parsed.error.message).toBe('plain js error');
  });
});

describe('runIpc — Zod schema validation', () => {
  it('rejects invalid input with ValidationError + Zod issues attached', async () => {
    const { exitCalls, stderr } = captureRunIpc();
    setTTY(false);
    const Schema = z.object({ count: z.number().min(0) });
    const p = runIpc(async (_input: z.infer<typeof Schema>) => ({ ok: true }), Schema);
    process.stdin.emit('data', '{"count":-5}');
    process.stdin.emit('end');
    await p.catch(() => {
      /* exit spy throws — expected */
    });
    expect(exitCalls[0].code).toBe(2);
    const parsed = JSON.parse(stderr[0]);
    expect(parsed.error.code).toBe('VALIDATION');
    expect(Array.isArray(parsed.error.issues)).toBe(true);
    expect(parsed.error.issues.length).toBeGreaterThan(0);
  });

  it('passes typed input to handler when validation succeeds', async () => {
    const { stdout, exitCalls } = captureRunIpc();
    setTTY(false);
    const Schema = z.object({ count: z.number() });
    let receivedCount = 0;
    const p = runIpc(async (input: z.infer<typeof Schema>) => {
      receivedCount = input.count;
      return { received: input.count };
    }, Schema);
    process.stdin.emit('data', '{"count":42}');
    process.stdin.emit('end');
    await p.catch(() => {
      /* exit spy throws — expected */
    });
    expect(exitCalls[0].code).toBe(0);
    expect(receivedCount).toBe(42);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.received).toBe(42);
  });
});
