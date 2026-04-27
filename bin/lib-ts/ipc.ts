/**
 * ipc.ts — shared subprocess runner (T4.1.8).
 *
 * The canonical IPC adapter for every dual-mode (library + subprocess)
 * module per ADR-006 + ADR-007. Every IPC-eligible TS port pairs a
 * handler function with this runner via:
 *
 *   if (isDirectRun(import.meta.url)) {
 *     await runIpc(myHandler, MyInputSchema);
 *   }
 *
 * **One of the two `process.exit()` allowlisted sites (per ADR-006).**
 * The other is `src/cli/main.ts`. Every other lib module throws typed
 * errors into this runner; runIpc translates them to the right exit
 * code:
 *
 *   ValidationError  → exit 2
 *   LLMError         → exit 3
 *   GateFailureError → exit 1
 *   JumpstartError   → exit 99 (or err.exitCode)
 *   anything else    → exit 99
 *
 * **ADR-007 envelope versioning.** v0 envelopes (no `version` field)
 * are accepted as-is and produce v0-shaped output. v1 envelopes
 * (`{"version": 1, "input": {...}}`) produce v1-shaped output
 * (`{"version": 1, "ok": true, "timestamp": "...", "result": {...}}`).
 * The detection happens at envelope-parse time; the same handler
 * answers both versions. Per-module v0/v1 fixture pairs at
 * `tests/fixtures/ipc/<name>/v{0,1}/` lock down the contract.
 *
 * @see specs/decisions/adr-006-error-model.md
 * @see specs/decisions/adr-007-ipc-envelope-versioning.md
 * @see specs/architecture.md §IPC module contract
 * @see specs/implementation-plan.md T4.1.8
 */

import { fileURLToPath } from 'node:url';
import type { ZodType } from 'zod';
import { JumpstartError, ValidationError } from './errors.js';
import { readStdin, writeError, writeResult } from './io.js';

/**
 * Handler signature: takes typed input, returns typed result. Sync or
 * async — runIpc awaits either. Errors thrown bubble to the typed-
 * error → exit-code translation below.
 */
export type IpcHandler<TIn, TOut> = (input: TIn) => Promise<TOut> | TOut;

/**
 * V1 envelope shape for input. v0 has no wrapper — the entire payload
 * IS the input.
 */
interface V1Input {
  version: 1;
  input: unknown;
}

/**
 * Heuristic check: was THIS module loaded as the entry point of a
 * `node <path>` invocation? Used by IPC modules to opt into the
 * subprocess path only when they were the direct target.
 *
 * `import.meta.url` is `file:///abs/path/to/module.ts`. Compare to
 * `process.argv[1]`'s file URL form. Substring-suffix match because
 * tsdown emits to `dist/<name>.mjs` while sources live at
 * `bin/lib-ts/<name>.ts` — at runtime we match either.
 */
export function isDirectRun(fileUrl: string): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const modulePath = fileURLToPath(fileUrl);
  // Exact match for `node <path>` invocations; suffix match handles
  // package-bin shims (`npx jumpstart-mode` → `bin/cli.js` resolved
  // through symlinks).
  return modulePath === argv1 || argv1.endsWith(modulePath);
}

/**
 * Detect v1 envelope: `{"version": 1, "input": {...}}`. Anything else
 * (missing `version`, `version: 0`, `version: 2`+) is treated as v0
 * for forward-compat — a v1 consumer should NEVER reach a v2 producer
 * since the version is bumped only on breaking change. Per ADR-007 we
 * keep the door open for additive v1 → v1.x evolution.
 */
function isV1Envelope(payload: unknown): payload is V1Input {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'version' in payload &&
    (payload as { version: unknown }).version === 1 &&
    'input' in payload
  );
}

/**
 * Subprocess entry-point runner. Reads stdin, parses + version-detects,
 * validates input via the supplied Zod schema (if any), invokes the
 * handler, writes the result envelope, and **calls `process.exit()`**
 * with the appropriate code per ADR-006's typed-error → exit-code
 * mapping.
 *
 * The optional `schema` parameter is intentional for the strangler
 * phase: not every legacy module's input has a Zod schema yet. As the
 * config layer stabilizes (T4.1.8 → T4.1.12) we expect ~all callers
 * to pass one.
 */
export async function runIpc<TIn, TOut>(
  handler: IpcHandler<TIn, TOut>,
  schema?: ZodType<TIn>
): Promise<void> {
  let exitCode = 0;
  try {
    const raw = await readStdin();

    // Distinguish v0 (raw input) from v1 (wrapped input). The `as`
    // cast is necessary because TS can't narrow `Record<string,
    // unknown>` (readStdin's return) to V1Input through isV1Envelope
    // alone — but the runtime guard does the actual narrowing.
    const isV1 = isV1Envelope(raw);
    const rawInput = isV1 ? raw.input : raw;

    // Validate via Zod if a schema is supplied. Failure → ValidationError
    // with structured Zod issues for the IPC envelope renderer.
    let typedInput: TIn;
    if (schema) {
      const parsed = schema.safeParse(rawInput);
      if (!parsed.success) {
        throw new ValidationError(
          `Input validation failed: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          'runIpc.input',
          parsed.error.issues
        );
      }
      typedInput = parsed.data;
    } else {
      typedInput = rawInput as TIn;
    }

    const result = await handler(typedInput);

    // Envelope-version-aware emit. v0 callers get the raw result wrapped
    // in legacy {ok, timestamp, ...result}; v1 callers get the explicit
    // version-tagged wrapper.
    if (isV1) {
      writeResult({
        version: 1,
        result: result as Record<string, unknown>,
      });
    } else {
      writeResult(result as Record<string, unknown>);
    }
  } catch (err) {
    // Typed-error → exit-code translation per ADR-006.
    exitCode = computeExitCode(err);
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof ValidationError ? 'VALIDATION' : errorCode(err);
    const details: Record<string, unknown> = {};
    if (err instanceof ValidationError && err.issues.length > 0) {
      details.schemaId = err.schemaId;
      details.issues = err.issues;
    }
    if (err instanceof Error && err.stack) {
      details.stack = err.stack;
    }
    try {
      writeError(code, message, details);
    } catch {
      // stderr unavailable; nothing to do but exit.
    }
  }
  // Single allowlisted process.exit per ADR-006. The check-process-exit
  // gate scripts/check-process-exit.mjs has bin/lib-ts/ipc.ts on its
  // allowlist for exactly this line.
  process.exit(exitCode);
}

function computeExitCode(err: unknown): number {
  if (err instanceof JumpstartError) {
    return err.exitCode;
  }
  return 99;
}

function errorCode(err: unknown): string {
  if (err instanceof Error && err.name) return err.name.toUpperCase();
  return 'TOOL_ERROR';
}
