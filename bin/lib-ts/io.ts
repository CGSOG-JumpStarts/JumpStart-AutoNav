/**
 * io.ts — CLI-first IO primitives. T4.1.1 port (first leaf-utility, M2).
 *
 * Behavior is byte-identical to `bin/lib/io.js` for every successful
 * code path. The ONLY divergence is the error contract:
 *
 *   - Legacy `bin/lib/io.js`: `wrapTool` and `writeError(exit=true)`
 *     call `process.exit(1)` directly.
 *   - TS port `bin/lib-ts/io.ts`: throws `JumpstartError` (ADR-006
 *     library-body exit decision tree). The eventual `runIpc()` in
 *     `bin/lib-ts/ipc.ts` (M5) catches typed errors and converts
 *     them into the appropriate exit code; library callers handle
 *     locally or rethrow.
 *
 * This divergence is opt-in: legacy `bin/lib/io.js` stays unchanged,
 * so every existing JS caller continues to get exit-based semantics.
 * A caller only inherits the throw-based contract by switching from
 * `require('./io.js')` to `import from '@lib/io'`. The strangler-
 * fig (ADR-005) keeps both files alive in parallel until M9 cutover.
 *
 * Output shape preserved verbatim so v0 IPC envelope consumers (every
 * existing caller of `writeResult`/`writeError`) see byte-identical
 * stdout/stderr:
 *
 *   writeResult({ x: 1 }) →  '{"ok":true,"timestamp":"...","x":1}\n'
 *   writeError('CODE','msg') → '{"ok":false,"timestamp":"...","error":{"code":"CODE","message":"msg"}}\n'
 *
 * @see specs/decisions/adr-005-module-layout.md (strangler-fig)
 * @see specs/decisions/adr-006-error-model.md (exit / throw policy)
 * @see specs/implementation-plan.md T4.1.1, per-module port recipe
 * @see bin/lib/io.js (legacy — kept unchanged during strangler)
 */

import { JumpstartError } from './errors.js';

// ─────────────────────────────────────────────────────────────────────────
// Public types — match the legacy module shape with sharper TS types
// ─────────────────────────────────────────────────────────────────────────

/** Catch-all type for tool input; specific tools refine this with Zod. */
export type ToolInput = Record<string, unknown>;

/** Catch-all type for tool result before the io wrapper folds in `ok`/`timestamp`. */
export type ToolResult = Record<string, unknown>;

/** Parsed CLI args. Each value is either the next non-flag token or `true`. */
export type ToolArgs = Record<string, string | true>;

export interface WriteResultOptions {
  /** Pretty-print the JSON output. Default false (matches legacy). */
  pretty?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read JSON from stdin. Resolves with the parsed object, or `{}` if stdin
 * is a TTY or empty. Rejects with `ValidationError` on malformed JSON.
 *
 * Behavior matches `bin/lib/io.js`'s `readStdin()` for both success
 * paths; the divergence is the rejection error class — legacy throws
 * a generic `Error("Invalid JSON on stdin: ...")`, the TS port throws
 * the same shape (matching message prefix preserved verbatim) but as a
 * typed `JumpstartError` so `runIpc()` can map it to exit 99.
 */
export function readStdin(): Promise<ToolInput> {
  if (process.stdin.isTTY) {
    return Promise.resolve({});
  }

  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      if (!data.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data) as ToolInput);
      } catch (err) {
        reject(new JumpstartError(`Invalid JSON on stdin: ${(err as Error).message}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

/**
 * Write a structured success result to stdout. The output object is
 * `{ ok: true, timestamp: <ISO>, ...result }` — `ok` and `timestamp`
 * always emit before any caller-supplied fields, matching the legacy
 * `writeResult()` byte ordering exactly.
 */
export function writeResult(result: ToolResult, options: WriteResultOptions = {}): void {
  const { pretty = false } = options;
  const output = {
    ok: true,
    timestamp: new Date().toISOString(),
    ...result,
  };
  const json = pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);
  process.stdout.write(`${json}\n`);
}

/**
 * Write a structured error to stderr. The output object is
 * `{ ok: false, timestamp: <ISO>, error: { code, message, ...details } }`.
 *
 * Behavior change vs `bin/lib/io.js`:
 *   - The legacy 4th boolean parameter `exit` (which called
 *     `process.exit(1)` if true) is REMOVED. The new contract: callers
 *     that want process termination throw an error; `runIpc()` catches
 *     and exits with the right code.
 *
 * Migration note: legacy callers passing `writeError(code, msg, details, true)`
 * become `writeError(code, msg, details); throw new JumpstartError(msg);`
 * at port time.
 */
export function writeError(
  code: string,
  message: string,
  details: Record<string, unknown> = {}
): void {
  const output = {
    ok: false,
    timestamp: new Date().toISOString(),
    error: { code, message, ...details },
  };
  process.stderr.write(`${JSON.stringify(output)}\n`);
}

/**
 * Wrap a tool handler with the standard stdin/stdout JSON contract.
 * The wrapped function reads stdin, merges in `cliArgs`, awaits the
 * handler, and writes the result via `writeResult`.
 *
 * On thrown error: writes a `TOOL_ERROR` envelope to stderr (matching
 * legacy shape) and **rethrows** rather than calling `process.exit(1)`.
 * The outer subprocess runner (`runIpc`, M5+) catches the rethrown
 * error and translates it to the right exit code per ADR-006:
 *   - `ValidationError` → exit 2
 *   - `LLMError` → exit 3
 *   - other `JumpstartError` → exit 99
 *   - unknown → exit 99 (uncaught crash; same as legacy `process.exit(1)`
 *     but with a real stack instead of swallowed-then-exit)
 *
 * For library callers (test harnesses, in-proc consumers), the throw
 * surfaces directly — no subprocess involvement.
 */
export function wrapTool<
  TInput extends ToolInput = ToolInput,
  TResult extends ToolResult = ToolResult,
>(
  handler: (input: TInput) => Promise<TResult> | TResult
): (cliArgs?: Partial<TInput>) => Promise<void> {
  return async function wrappedTool(cliArgs: Partial<TInput> = {} as Partial<TInput>) {
    try {
      const stdinInput = await readStdin();
      const input = { ...stdinInput, ...cliArgs } as TInput;
      const result = await handler(input);
      writeResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      writeError('TOOL_ERROR', message, stack ? { stack } : {});
      // Per ADR-006: rethrow as typed error so runIpc can route exit
      // codes. If the caught value is already a JumpstartError, preserve
      // its subclass + exitCode.
      if (err instanceof JumpstartError) throw err;
      throw new JumpstartError(message);
    }
  };
}

/**
 * Parse CLI arguments into a key-value object. Supports `--key value`
 * (string) and `--flag` (boolean true) shapes. Behavior matches legacy
 * `parseToolArgs(argv)` exactly — same ordering, same handling of a
 * trailing `--flag`, same key-name extraction.
 */
export function parseToolArgs(argv: string[]): ToolArgs {
  const args: ToolArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}
