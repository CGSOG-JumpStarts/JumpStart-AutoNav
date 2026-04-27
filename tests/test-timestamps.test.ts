/**
 * test-timestamps.test.ts — T4.1.3 unit tests for the timestamps.ts port.
 *
 * Coverage of every documented branch in `validate()` + `audit()` plus
 * `now()` shape and `ISO_UTC_REGEX` boundary cases. Audit tests use a
 * tmp-dir fixture so they exercise the real `fs.readFileSync` path.
 *
 * @see bin/lib-ts/timestamps.ts
 * @see bin/lib/timestamps.js (legacy reference)
 * @see specs/implementation-plan.md T4.1.3
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { audit, ISO_UTC_REGEX, now, validate } from '../bin/lib-ts/timestamps.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'timestamps-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function fixture(name: string, body: string): string {
  const p = path.join(tmpDir, name);
  writeFileSync(p, body, 'utf8');
  return p;
}

describe('now()', () => {
  it('returns an ISO 8601 UTC string ending in Z', () => {
    const ts = now();
    expect(ts).toMatch(ISO_UTC_REGEX);
    expect(ts.endsWith('Z')).toBe(true);
  });

  it('is monotonic across two calls (or at worst equal)', () => {
    const a = now();
    const b = now();
    expect(b >= a).toBe(true);
  });
});

describe('ISO_UTC_REGEX', () => {
  it('accepts second-precision UTC', () => {
    expect(ISO_UTC_REGEX.test('2026-04-24T12:34:56Z')).toBe(true);
  });

  it('accepts millisecond-precision UTC', () => {
    expect(ISO_UTC_REGEX.test('2026-04-24T12:34:56.789Z')).toBe(true);
  });

  it('rejects timestamps without trailing Z', () => {
    expect(ISO_UTC_REGEX.test('2026-04-24T12:34:56')).toBe(false);
  });

  it('rejects offset notation like +00:00', () => {
    expect(ISO_UTC_REGEX.test('2026-04-24T12:34:56+00:00')).toBe(false);
  });

  it('rejects micro/nano precision (4+ subsecond digits)', () => {
    expect(ISO_UTC_REGEX.test('2026-04-24T12:34:56.0000Z')).toBe(false);
  });
});

describe('validate() — invalid branches', () => {
  it('rejects empty string', () => {
    const r = validate('');
    expect(r.valid).toBe(false);
    expect(r.parsed).toBeNull();
    expect(r.error).toBe('Timestamp is empty or not a string');
  });

  it('rejects undefined / null / non-string', () => {
    expect(validate(undefined).valid).toBe(false);
    expect(validate(null).valid).toBe(false);
    expect(validate(12345 as unknown).valid).toBe(false);
    expect(validate({} as unknown).valid).toBe(false);
  });

  it('rejects offset-style timestamp WITH a UTC suggestion', () => {
    const r = validate('2026-04-24T12:34:56+00:00');
    expect(r.valid).toBe(false);
    expect(r.parsed).toBe('2026-04-24T12:34:56.000Z');
    expect(r.error).toContain('not in UTC format');
    expect(r.error).toContain('Did you mean: 2026-04-24T12:34:56.000Z');
  });

  it('rejects unparseable garbage with the format-help error', () => {
    const r = validate('not-a-date');
    expect(r.valid).toBe(false);
    expect(r.parsed).toBeNull();
    expect(r.error).toBe('Invalid ISO 8601 UTC format. Expected: YYYY-MM-DDTHH:MM:SSZ');
  });

  it('rejects format-correct but date-invalid timestamps (month 13)', () => {
    const r = validate('2026-13-01T00:00:00Z');
    expect(r.valid).toBe(false);
    expect(r.parsed).toBeNull();
    expect(r.error).toBe('Timestamp has valid format but represents an invalid date');
  });
});

describe('validate() — valid branches', () => {
  it('accepts a past UTC timestamp with no warning', () => {
    const r = validate('2024-01-01T00:00:00Z');
    expect(r.valid).toBe(true);
    expect(r.parsed).toBe('2024-01-01T00:00:00.000Z');
    expect(r.error).toBeNull();
    expect(r.warning).toBeNull();
  });

  it('accepts a future UTC timestamp with the future warning', () => {
    // Use today's date + 100 years to be future-proof against the test
    // fixtures' own timestamps (which include 2026-04-24).
    const future = new Date(Date.now() + 100 * 365 * 86400_000).toISOString();
    const r = validate(future);
    expect(r.valid).toBe(true);
    expect(r.warning).toBe('Timestamp is in the future');
  });

  it('accepts millisecond-precision UTC', () => {
    const r = validate('2024-01-01T00:00:00.123Z');
    expect(r.valid).toBe(true);
    expect(r.parsed).toBe('2024-01-01T00:00:00.123Z');
  });
});

describe('audit() — body Timestamp lines', () => {
  it('counts and validates **Timestamp:** lines', () => {
    const file = fixture(
      'doc.md',
      [
        '# Doc',
        '',
        '**Timestamp:** 2024-01-01T00:00:00Z',
        '',
        'Some prose.',
        '**Timestamp:** not-a-date',
      ].join('\n')
    );
    const r = audit(file);
    expect(r.entries).toBe(2);
    expect(r.valid).toBe(1);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].line).toBe(6);
    expect(r.invalid[0].value).toBe('not-a-date');
    expect(r.invalid[0].error).toContain('Invalid ISO 8601 UTC format');
  });

  it('treats {{template}} placeholders as VALID without validating', () => {
    const file = fixture('doc.md', '**Timestamp:** {{generated_at}}');
    const r = audit(file);
    expect(r.entries).toBe(1);
    expect(r.valid).toBe(1);
    expect(r.invalid).toEqual([]);
  });

  it('treats [bracketed] placeholders as VALID without validating', () => {
    const file = fixture('doc.md', '**Timestamp:** [Pending]');
    const r = audit(file);
    expect(r.entries).toBe(1);
    expect(r.valid).toBe(1);
  });

  it('case-insensitive on the **Timestamp:** literal', () => {
    const file = fixture('doc.md', '**timestamp:** 2024-01-01T00:00:00Z');
    const r = audit(file).valid;
    expect(r).toBe(1);
  });
});

describe('audit() — frontmatter date fields', () => {
  it('validates created / updated / approval_date in YAML frontmatter', () => {
    const body = [
      '---',
      'created: 2024-01-01T00:00:00Z',
      'updated: not-a-date',
      'approval_date: 2024-06-01T00:00:00Z',
      '---',
      '# Body',
    ].join('\n');
    const file = fixture('a.md', body);
    const r = audit(file);
    expect(r.entries).toBe(3);
    expect(r.valid).toBe(2);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].field).toBe('updated');
    expect(r.invalid[0].value).toBe('not-a-date');
  });

  it('skips Pending / N/A / empty / {{template}} frontmatter values silently', () => {
    const body = [
      '---',
      'created: Pending',
      'updated: N/A',
      'approval_date: {{when_approved}}',
      '---',
    ].join('\n');
    const file = fixture('a.md', body);
    const r = audit(file);
    expect(r.entries).toBe(0); // none counted
    expect(r.valid).toBe(0);
    expect(r.invalid).toEqual([]);
  });

  it('strips surrounding double-quotes from frontmatter values', () => {
    const body = ['---', 'created: "2024-01-01T00:00:00Z"', '---'].join('\n');
    const file = fixture('a.md', body);
    const r = audit(file);
    expect(r.entries).toBe(1);
    expect(r.valid).toBe(1);
  });
});

describe('audit() — error handling', () => {
  it('returns the empty result with `error` set when the file is unreadable', () => {
    const r = audit(path.join(tmpDir, 'does-not-exist.md'));
    expect(r.entries).toBe(0);
    expect(r.valid).toBe(0);
    expect(r.error).toMatch(/^Cannot read file:/);
  });
});
