/**
 * test-secret-scanner.test.ts — T4.2.4b unit tests.
 *
 * Coverage:
 *   - DEFAULT_PATTERNS catalog parity (12 entries)
 *   - shouldSkip / compileCustomPatterns
 *   - scanFile / runSecretScan (legacy parity)
 *   - scanForSecrets (ADR-012 helper)
 *   - redactSecrets recursive walk + cycle protection + class-instance
 *     preservation
 *
 * @see bin/lib-ts/secret-scanner.ts
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compileCustomPatterns,
  DEFAULT_PATTERNS,
  redactSecrets,
  runSecretScan,
  scanFile,
  scanForSecrets,
  shouldSkip,
} from '../bin/lib-ts/secret-scanner.js';

// Test fixtures: realistic-looking but obviously-fake secrets so they
// trip the patterns without ever being a real key.
const FAKE_AWS_ACCESS = 'AKIAIOSFODNN7EXAMPLE';
const FAKE_GH_TOKEN = `ghp_${'A'.repeat(36)}`;
const FAKE_GH_PAT = `github_pat_${'B'.repeat(22)}`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'secret-scanner-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('DEFAULT_PATTERNS', () => {
  it('contains the 12 canonical entries', () => {
    expect(DEFAULT_PATTERNS).toHaveLength(12);
    const names = DEFAULT_PATTERNS.map((p) => p.name);
    expect(names).toContain('AWS Access Key');
    expect(names).toContain('GitHub Token');
    expect(names).toContain('GitHub Fine-grained PAT');
    expect(names).toContain('Private Key Header');
    expect(names).toContain('Slack Webhook');
    expect(names).toContain('Bearer Token');
  });
  it('AWS Secret Key has requires_context guard', () => {
    const aws = DEFAULT_PATTERNS.find((p) => p.name === 'AWS Secret Key');
    expect(aws?.requires_context).toBeInstanceOf(RegExp);
  });
});

describe('shouldSkip', () => {
  it('skips binary extensions', () => {
    expect(shouldSkip('img.png')).toBe(true);
    expect(shouldSkip('font.woff2')).toBe(true);
    expect(shouldSkip('src/code.ts')).toBe(false);
  });
  it('matches DEFAULT_SKIP against path SEGMENTS, not substrings', () => {
    expect(shouldSkip('node_modules/foo/bar.js')).toBe(true);
    // "build" segment should match
    expect(shouldSkip('build/output.js')).toBe(true);
    // But "rebuild" should NOT match (no exact "build" segment)
    expect(shouldSkip('src/rebuild.ts')).toBe(false);
  });
  it('honors allowlist (exact / suffix / basename)', () => {
    expect(shouldSkip('.env.example', ['.env.example'])).toBe(true);
    expect(shouldSkip('foo/.env.example', ['.env.example'])).toBe(true);
  });
});

describe('compileCustomPatterns', () => {
  it('compiles valid patterns', () => {
    const compiled = compileCustomPatterns([
      { name: 'X', pattern: 'CUSTOM_[A-Z]+', severity: 'high' },
    ]);
    expect(compiled).toHaveLength(1);
    expect(compiled[0].pattern).toBeInstanceOf(RegExp);
  });
  it('drops invalid regex', () => {
    expect(compileCustomPatterns([{ pattern: '[unclosed' }])).toEqual([]);
  });
  it('drops patterns longer than 500 chars (ReDoS-safe)', () => {
    expect(compileCustomPatterns([{ pattern: 'a'.repeat(501) }])).toEqual([]);
  });
});

describe('scanFile', () => {
  it('detects AWS access key with redacted match', () => {
    const file = path.join(tmpDir, 'leak.js');
    writeFileSync(file, `const key = "${FAKE_AWS_ACCESS}";\n`);
    const findings = scanFile(file, DEFAULT_PATTERNS);
    expect(findings.length).toBeGreaterThan(0);
    const aws = findings.find((f) => f.pattern_name === 'AWS Access Key');
    expect(aws).toBeDefined();
    expect(aws?.match).toMatch(/^.{4}\*{4}.{4}$/);
    expect(aws?.match).not.toContain(FAKE_AWS_ACCESS);
  });

  it('skips comment-line examples (TODO/FIXME/example/NOTE)', () => {
    const file = path.join(tmpDir, 'comments.js');
    writeFileSync(
      file,
      [`// example: ghp_${'X'.repeat(36)}`, `# TODO: rotate key xoxb-fake`].join('\n')
    );
    const findings = scanFile(file, DEFAULT_PATTERNS);
    expect(findings).toHaveLength(0);
  });

  it('returns empty when file is unreadable/missing', () => {
    expect(scanFile('/nonexistent/path/file.js', DEFAULT_PATTERNS)).toEqual([]);
  });
});

describe('runSecretScan', () => {
  it('aggregates files_scanned and severity counters', () => {
    const f1 = path.join(tmpDir, 'a.js');
    writeFileSync(f1, `const k = "${FAKE_GH_TOKEN}";\n`);
    const f2 = path.join(tmpDir, 'b.js');
    writeFileSync(f2, 'no secrets here\n');
    const result = runSecretScan({ files: [f1, f2], root: tmpDir });
    expect(result.files_scanned).toBe(2);
    expect(result.secrets_found).toBeGreaterThanOrEqual(1);
    expect(result.critical).toBeGreaterThanOrEqual(1);
    expect(result.pass).toBe(false);
  });

  it('returns pass=true when nothing matches', () => {
    const f1 = path.join(tmpDir, 'clean.js');
    writeFileSync(f1, 'const x = 1;\n');
    const result = runSecretScan({ files: [f1], root: tmpDir });
    expect(result.pass).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('honors allowlist', () => {
    const allowed = path.join(tmpDir, '.env.example');
    writeFileSync(allowed, `${FAKE_GH_TOKEN}\n`);
    const result = runSecretScan({
      files: [allowed],
      root: tmpDir,
      config: { allowlist: ['.env.example'] },
    });
    expect(result.files_scanned).toBe(0);
    expect(result.findings).toEqual([]);
  });
});

describe('scanForSecrets (ADR-012 helper)', () => {
  it('finds matches in a free-form string', () => {
    const matches = scanForSecrets(`Use ${FAKE_GH_TOKEN} for auth`);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    const gh = matches.find((m) => m.pattern_name === 'GitHub Token');
    expect(gh).toBeDefined();
    expect(gh?.start).toBeGreaterThan(0);
    expect(gh?.end).toBeGreaterThan(gh?.start ?? 0);
  });
  it('returns [] for empty / non-string', () => {
    expect(scanForSecrets('')).toEqual([]);
  });
});

describe('redactSecrets', () => {
  it('redacts secrets inside top-level strings', () => {
    const out = redactSecrets(`hello ${FAKE_GH_TOKEN} world`);
    expect(out).not.toContain(FAKE_GH_TOKEN);
    expect(out).toContain('[REDACTED:GitHub Token]');
  });

  it('walks nested objects recursively', () => {
    const input = {
      auth: { token: FAKE_GH_TOKEN },
      meta: { ok: true, fingerprint: FAKE_AWS_ACCESS },
    };
    const out = redactSecrets(input);
    expect(out.auth.token).toContain('[REDACTED:GitHub Token]');
    expect(out.meta.fingerprint).toContain('[REDACTED:AWS Access Key]');
    expect(out.meta.ok).toBe(true);
  });

  it('walks arrays recursively', () => {
    const out = redactSecrets([FAKE_GH_TOKEN, 'safe', { nested: FAKE_GH_PAT }]);
    expect(out[0]).toContain('[REDACTED:GitHub Token]');
    expect(out[1]).toBe('safe');
    expect((out[2] as { nested: string }).nested).toContain('[REDACTED:GitHub Fine-grained PAT]');
  });

  it('preserves primitive values unchanged', () => {
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(true)).toBe(true);
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(undefined)).toBe(undefined);
  });

  it('does not infinite-loop on cyclic objects', () => {
    interface Node {
      name: string;
      self?: Node;
    }
    const obj: Node = { name: 'cycle' };
    obj.self = obj;
    expect(() => redactSecrets(obj)).not.toThrow();
  });

  it('leaves class instances intact (shape-preserving)', () => {
    class Marker {
      readonly value = FAKE_GH_TOKEN;
    }
    const inst = new Marker();
    const out = redactSecrets(inst);
    // Class instance round-trips by reference (NOT redacted) — by
    // design: we don't know the constructor's invariants, and a
    // recursive copy of class instances is a footgun.
    expect(out).toBe(inst);
  });

  it('leaves clean strings unchanged', () => {
    expect(redactSecrets('nothing-to-redact')).toBe('nothing-to-redact');
  });
});

describe('Pit Crew M3 Reviewer H2 — redactSecrets handles Buffer / Map / Set', () => {
  it('redacts Buffer payload (round-trip via utf-8)', () => {
    const buf = Buffer.from(`embed ${FAKE_GH_TOKEN} here`, 'utf8');
    const out = redactSecrets(buf);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect((out as Buffer).toString('utf8')).toContain('[REDACTED:GitHub Token]');
    expect((out as Buffer).toString('utf8')).not.toContain(FAKE_GH_TOKEN);
  });
  it('walks Map values + keys (projected to JSON-safe array of tuples per Pit Crew M4 F11)', () => {
    const m = new Map<string, string>([['key', FAKE_GH_TOKEN]]);
    const out = redactSecrets(m) as unknown as Array<[string, string]>;
    expect(Array.isArray(out)).toBe(true);
    // Project to plain array of [key, value] tuples — JSON-safe AND
    // round-trips via `new Map(arr)` for in-process consumers.
    const reconstructed = new Map(out);
    expect(reconstructed.get('key')).toContain('[REDACTED:GitHub Token]');
  });
  it('walks Set members (projected to JSON-safe array per Pit Crew M4 F11)', () => {
    const s = new Set([FAKE_GH_TOKEN, 'safe']);
    const out = redactSecrets(s) as unknown as string[];
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((v) => v.includes('[REDACTED:GitHub Token]'))).toBe(true);
    expect(out).toContain('safe');
  });
});

describe('Pit Crew M3 QA C3 + Reviewer H3 — redactString overlap determinism', () => {
  it('produces deterministic redaction marker when two patterns overlap', () => {
    // Construct a string that triggers both Generic Token Assignment
    // (token = "...") and Generic Secret Assignment (secret = "...")
    // simultaneously. Both regexes match the same offset region.
    // Pre-fix: V8 sort stability picked one non-deterministically.
    // Post-fix: tie-break by pattern_name.localeCompare guarantees
    // the same marker every run.
    const input = `secret = "${FAKE_GH_TOKEN}"`;
    const out1 = redactSecrets(input);
    const out2 = redactSecrets(input);
    expect(out1).toBe(out2);
    expect(out1).toMatch(/\[REDACTED:.+\]/);
  });
  it('handles string with no matches as identity', () => {
    expect(redactSecrets('nothing-to-redact-here')).toBe('nothing-to-redact-here');
  });
});

describe('Pit Crew M3 Reviewer M10 — scanFile multi-secret-per-line', () => {
  it('reports both secrets when two appear on one line', () => {
    const file = path.join(tmpDir, 'multi.js');
    writeFileSync(file, `const a = "${FAKE_GH_TOKEN}", b = "${'C'.repeat(36)}_ghp"; // unused\n`);
    // Just two real GH tokens on one line:
    const both = `${FAKE_GH_TOKEN} ${`ghp_${'D'.repeat(36)}`}`;
    writeFileSync(file, `const x = "${both}";\n`);
    const findings = scanFile(file, DEFAULT_PATTERNS);
    const ghFindings = findings.filter((f) => f.pattern_name === 'GitHub Token');
    expect(ghFindings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Pit Crew M3 Adversary F3 — runSecretScan boundary check', () => {
  it('skips files outside resolvedRoot', () => {
    const result = runSecretScan({ files: ['/etc/passwd'], root: tmpDir });
    expect(result.files_scanned).toBe(0);
    expect(result.findings).toEqual([]);
  });
  it('accepts files inside resolvedRoot', () => {
    const inside = path.join(tmpDir, 'inside.js');
    writeFileSync(inside, `// no secret here\n`);
    const result = runSecretScan({ files: [inside], root: tmpDir });
    expect(result.files_scanned).toBe(1);
  });
});
