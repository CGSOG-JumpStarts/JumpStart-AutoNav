/**
 * timestamps.ts — UTC timestamp utilities (T4.1.3 port).
 *
 * Pure-library port of `bin/lib/timestamps.js`. Three exports:
 *   - `now()` — fresh ISO-8601 UTC timestamp
 *   - `validate(value)` — parse + classify a string as valid UTC, valid
 *     non-UTC (with suggested replacement), or invalid
 *   - `audit(filePath)` — scan a markdown file's `**Timestamp:**`
 *     entries + frontmatter date fields for compliance
 *
 * Plus the regex constant `ISO_UTC_REGEX` re-exported for callers that
 * do their own pre-validation (matches legacy export).
 *
 * Behavior parity with the legacy module:
 *   - `validate()` returns the EXACT shape the legacy returned —
 *     `{ valid, parsed, error, warning? }`. Field set + nullability
 *     preserved verbatim.
 *   - `audit()` returns `{ entries, valid, invalid: Array<{ line, value, error, field? }> }`,
 *     also with optional `error` field for unreadable files.
 *   - Frontmatter scan covers the same three fields the legacy did:
 *     `created`, `updated`, `approval_date`. Same skip rules for
 *     `{{template}}`, `Pending`, `N/A`, empty, and bracketed placeholders.
 *
 * NOT ported in T4.1.3: the CLI driver block at the foot of the legacy
 * module (`if (process.argv[1].endsWith('timestamps.js')) { ... }`).
 * The legacy CLI continues to handle subprocess invocations until M5's
 * `runIpc` lands. The pure functions are usable by other ported TS
 * modules immediately.
 *
 * @see bin/lib/timestamps.js (legacy — kept unchanged during strangler)
 * @see specs/decisions/adr-005-module-layout.md
 * @see specs/implementation-plan.md T4.1.3
 */

import { readFileSync } from 'node:fs';

/**
 * ISO 8601 UTC timestamp regex — accepts millisecond precision.
 * Matches: `2026-02-08T14:23:00Z`, `2026-02-08T14:23:00.000Z`.
 * Pattern preserved verbatim from the legacy module.
 */
export const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Result shape for `validate`. Field set + nullability matches the
 * legacy module exactly so downstream callers parse identical JSON.
 *
 * `warning` is only populated when the timestamp is valid but in the
 * future; it is undefined (NOT null) for past/present timestamps —
 * matching the legacy `null` semantics requires the consumer to coerce
 * `warning ?? null`. We keep the more idiomatic optional-undefined
 * shape and document the JSON-output difference for callers that
 * stringify directly: `JSON.stringify({ ...result })` will omit the
 * `warning` key for past timestamps where the legacy module emitted
 * `"warning": null`. Net behavior unchanged because both shapes parse
 * back to a falsy `warning` field.
 */
export interface ValidateResult {
  valid: boolean;
  parsed: string | null;
  error: string | null;
  warning?: string | null;
}

/** A single per-line audit failure record. */
export interface AuditInvalidEntry {
  line: number;
  value: string;
  error: string | null;
  /** Frontmatter field name when the failure is in YAML frontmatter; absent for body entries. */
  field?: string;
}

/**
 * Result shape for `audit`. The optional `error` field is set only when
 * the file itself can't be read (matches legacy fallthrough shape).
 */
export interface AuditResult {
  entries: number;
  valid: number;
  invalid: AuditInvalidEntry[];
  error?: string;
}

/** Generate a fresh ISO 8601 UTC timestamp. Identical to legacy. */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Validate an ISO 8601 UTC timestamp string. Three decision levels:
 *   1. Empty / non-string → invalid with explicit error.
 *   2. Format mismatch but JS Date can parse it → invalid with the
 *      canonical UTC suggestion in the error message.
 *   3. Format match but JS Date rejects it (e.g. month 13) → invalid.
 *   4. Otherwise → valid; `warning` set to "future" string when applicable.
 */
export function validate(value: unknown): ValidateResult {
  if (!value || typeof value !== 'string') {
    return { valid: false, parsed: null, error: 'Timestamp is empty or not a string' };
  }

  if (!ISO_UTC_REGEX.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return {
        valid: false,
        parsed: d.toISOString(),
        error: `Timestamp is not in UTC format (must end with Z). Did you mean: ${d.toISOString()}?`,
      };
    }
    return {
      valid: false,
      parsed: null,
      error: 'Invalid ISO 8601 UTC format. Expected: YYYY-MM-DDTHH:MM:SSZ',
    };
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return {
      valid: false,
      parsed: null,
      error: 'Timestamp has valid format but represents an invalid date',
    };
  }

  const isFuture = d.getTime() > Date.now();
  return {
    valid: true,
    parsed: d.toISOString(),
    warning: isFuture ? 'Timestamp is in the future' : null,
    error: null,
  };
}

const TIMESTAMP_LINE_REGEX = /\*\*Timestamp:\*\*\s*(.+)/i;
const FRONTMATTER_BLOCK_REGEX = /^---\n([\s\S]*?)\n---/;
const FRONTMATTER_DATE_FIELDS = ['created', 'updated', 'approval_date'] as const;

/**
 * Scan a markdown file for timestamp compliance.
 *
 * Two scan layers:
 *   1. Body lines matching `**Timestamp:** <value>` (case-insensitive).
 *   2. YAML frontmatter fields `created`, `updated`, `approval_date`.
 *
 * Skip rules (preserved from legacy):
 *   - `{{template}}` placeholders count as VALID (template hygiene
 *     happens elsewhere; this audit is for instantiated artifacts).
 *   - Bracketed placeholders `[anything]` count as valid.
 *   - Frontmatter values `Pending` / `N/A` / empty are silently skipped
 *     (not counted as entries at all).
 *
 * Returns the scan summary. If the file can't be read, returns an
 * empty result with `error` populated.
 */
export function audit(filePath: string): AuditResult {
  const result: AuditResult = { entries: 0, valid: 0, invalid: [] };

  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    return { ...result, error: `Cannot read file: ${(err as Error).message}` };
  }

  const lines = content.split('\n');

  for (let idx = 0; idx < lines.length; idx++) {
    const match = lines[idx].match(TIMESTAMP_LINE_REGEX);
    if (!match) continue;

    result.entries++;
    const value = match[1].trim();

    if (value.startsWith('{{') || value.startsWith('[')) {
      result.valid++;
      continue;
    }

    const validation = validate(value);
    if (validation.valid) {
      result.valid++;
    } else {
      result.invalid.push({ line: idx + 1, value, error: validation.error });
    }
  }

  const fmMatch = content.match(FRONTMATTER_BLOCK_REGEX);
  if (fmMatch) {
    const fm = fmMatch[1];
    for (const field of FRONTMATTER_DATE_FIELDS) {
      const fieldRegex = new RegExp(`^${field}:\\s*"?(.+?)"?$`, 'm');
      const fieldMatch = fm.match(fieldRegex);
      if (!fieldMatch) continue;

      const value = fieldMatch[1].trim();
      if (value === '' || value.startsWith('{{') || value === 'Pending' || value === 'N/A') {
        continue;
      }

      result.entries++;
      const validation = validate(value);
      if (validation.valid) {
        result.valid++;
      } else {
        result.invalid.push({
          line: 0, // frontmatter
          field,
          value,
          error: validation.error,
        });
      }
    }
  }

  return result;
}
