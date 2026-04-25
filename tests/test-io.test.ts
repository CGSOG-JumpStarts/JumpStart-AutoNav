/**
 * test-io.test.ts — T4.1.1 unit tests for the io.ts port.
 *
 * Scope per the per-module port recipe step 9:
 *   - Behavior parity with `bin/lib/io.js` for every successful path.
 *   - The documented error-contract divergence (throw instead of
 *     process.exit) is asserted explicitly.
 *
 * stdout/stderr capture uses Vitest's `vi.spyOn` on `process.stdout.write`
 * and `process.stderr.write` rather than spawning a subprocess — that
 * way the test runs inside the existing worker pool without OS overhead,
 * AND it locks down the EXACT byte sequence the legacy module produced
 * (the v0 IPC envelope contract).
 *
 * @see bin/lib-ts/io.ts
 * @see bin/lib/io.js (legacy reference implementation)
 * @see specs/decisions/adr-006-error-model.md
 * @see specs/implementation-plan.md T4.1.1
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JumpstartError } from '../bin/lib-ts/errors.js';
import { parseToolArgs, readStdin, wrapTool, writeError, writeResult } from '../bin/lib-ts/io.js';

interface CapturedIO {
  stdout: string[];
  stderr: string[];
}

function captureIO(): CapturedIO {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString());
    return true;
  });
  return { stdout, stderr };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('writeResult — byte-identical envelope vs legacy bin/lib/io.js', () => {
  it('writes single-line JSON with ok=true + timestamp + caller fields', () => {
    const { stdout } = captureIO();
    writeResult({ x: 1, y: 'two' });
    expect(stdout).toHaveLength(1);
    const line = stdout[0];
    expect(line.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(line);
    expect(parsed.ok).toBe(true);
    expect(typeof parsed.timestamp).toBe('string');
    expect(parsed.x).toBe(1);
    expect(parsed.y).toBe('two');
    // Field ordering: ok, timestamp, then caller fields (matches legacy
    // shape; some downstream consumers parse with order-sensitive code).
    expect(line).toMatch(/^\{"ok":true,"timestamp":"[^"]+",/);
  });

  it('honors pretty=true by indenting with 2 spaces', () => {
    const { stdout } = captureIO();
    writeResult({ x: 1 }, { pretty: true });
    expect(stdout[0]).toContain('\n  "ok": true,');
    expect(stdout[0].endsWith('}\n')).toBe(true);
  });

  it('lets caller fields shadow ok/timestamp without crashing (legacy behavior)', () => {
    const { stdout } = captureIO();
    // Spreading after ok+timestamp means caller fields override —
    // matches legacy `{ ok: true, timestamp: ..., ...result }`.
    writeResult({ ok: false } as Record<string, unknown>);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.ok).toBe(false);
  });
});

describe('writeError — byte-identical envelope vs legacy bin/lib/io.js', () => {
  it('emits the {ok:false, timestamp, error:{code,message,...}} shape on stderr', () => {
    const { stdout, stderr } = captureIO();
    writeError('VALIDATION', 'bad input', { field: 'root' });
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(1);
    const parsed = JSON.parse(stderr[0]);
    expect(parsed.ok).toBe(false);
    expect(typeof parsed.timestamp).toBe('string');
    expect(parsed.error).toEqual({ code: 'VALIDATION', message: 'bad input', field: 'root' });
  });

  it('terminates with a single newline (not two, not zero)', () => {
    const { stderr } = captureIO();
    writeError('X', 'y');
    expect(stderr[0].endsWith('\n')).toBe(true);
    expect(stderr[0].endsWith('\n\n')).toBe(false);
  });

  it('does NOT call process.exit (T4.1.1 behavior change vs legacy)', () => {
    captureIO();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) was called — should not happen`);
    }) as never);
    expect(() => writeError('X', 'y', {})).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('readStdin — TTY short-circuit and JSON parse', () => {
  it('returns {} when stdin is a TTY (no read attempted)', async () => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      const result = await readStdin();
      expect(result).toEqual({});
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: original, configurable: true });
    }
  });
});

describe('parseToolArgs — full parity with legacy', () => {
  it('parses --key value pairs into strings', () => {
    expect(parseToolArgs(['--root', '.', '--name', 'foo'])).toEqual({
      root: '.',
      name: 'foo',
    });
  });

  it('treats --flag with no following token as boolean true', () => {
    expect(parseToolArgs(['--verbose'])).toEqual({ verbose: true });
  });

  it('treats --flag1 --flag2 as two booleans', () => {
    expect(parseToolArgs(['--a', '--b'])).toEqual({ a: true, b: true });
  });

  it('ignores tokens that do not start with --', () => {
    expect(parseToolArgs(['positional', '--key', 'val', 'other'])).toEqual({ key: 'val' });
  });

  it('treats trailing --flag at end of argv as boolean', () => {
    expect(parseToolArgs(['--a', 'x', '--b'])).toEqual({ a: 'x', b: true });
  });

  it('returns empty object on empty argv', () => {
    expect(parseToolArgs([])).toEqual({});
  });
});

describe('wrapTool — error contract divergence vs legacy', () => {
  it('writes the result envelope on success', async () => {
    const { stdout } = captureIO();
    const tool = wrapTool(async (input: { name?: string }) => ({
      greeting: `hi ${input.name ?? 'world'}`,
    }));
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    await tool({ name: 'Samuel' });
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.ok).toBe(true);
    expect(parsed.greeting).toBe('hi Samuel');
  });

  it('writes a TOOL_ERROR envelope to stderr AND throws JumpstartError on handler failure (NOT process.exit)', async () => {
    const { stdout, stderr } = captureIO();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) was called — should not happen`);
    }) as never);
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    const tool = wrapTool(async () => {
      throw new Error('handler boom');
    });

    await expect(tool({})).rejects.toBeInstanceOf(JumpstartError);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(1);
    const parsed = JSON.parse(stderr[0]);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('TOOL_ERROR');
    expect(parsed.error.message).toBe('handler boom');
    expect(typeof parsed.error.stack).toBe('string');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('preserves the JumpstartError subclass when handler throws a typed error', async () => {
    captureIO();
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    class MyError extends JumpstartError {
      override exitCode = 7;
    }

    const tool = wrapTool(async () => {
      throw new MyError('typed boom');
    });

    let caught: unknown;
    try {
      await tool({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MyError);
    expect((caught as MyError).exitCode).toBe(7);
  });
});
