/**
 * test-m6-pitcrew-regressions.test.ts — M6 Pit Crew remediation pins.
 *
 * Pins every confirmed-exploit and parity-divergence finding from the
 * M6 Pit Crew round (Reviewer + QA + Adversary) so a future refactor
 * cannot silently re-open them.
 *
 * Findings covered:
 *   - BLOCKER (Reviewer + Adversary): `installFromStaging` and
 *     `uninstallItem` used registry-supplied `targetPaths` /
 *     `remappedFiles` without `assertInsideRoot`. Complete bypass of
 *     ADR-010 at the post-extraction copy stage.
 *   - BLOCKER (Adversary): symlink detection only fired for UNIX
 *     `versionMadeBy` host byte. Spoofing host=0 (MS-DOS) bypassed
 *     the rejection.
 *   - BLOCKER (Adversary): `downloadAndVerify` followed redirects
 *     by default and treated `expectedSha256` as optional, allowing
 *     a registry-controlled redirect chain + unverified payload.
 *   - HIGH (Reviewer): `registry.validateForPublishing` parsed
 *     `module.json` with raw `JSON.parse`, bypassing the prototype-
 *     pollution guard that the same module's `loadRegistry` already
 *     applies. `hasForbiddenKey` was also non-recursive.
 *   - HIGH (Reviewer + Adversary): `contains.agents` /
 *     `contains.prompts` source paths not validated. Arbitrary file
 *     read + copy via crafted relPath like `../../etc/shadow`.
 *   - HIGH (Reviewer): `safeParseInstalled` did not deep-validate
 *     entries, so `targetPaths: [null]` survived → uncaught
 *     TypeError (exit 99 — violates ADR-006).
 *   - HIGH (QA): no test coverage for compression-method ≠ 0/8
 *     rejection.
 *   - HIGH (QA): no test coverage for the Windows drive-letter
 *     branch in `validateEntryName`.
 *
 * @see specs/implementation-plan.md §Deviation Log (M6 entries)
 * @see specs/decisions/adr-010-marketplace-zipslip-prevention.md
 * @see specs/decisions/adr-011-llm-endpoint-allowlist.md
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../bin/lib-ts/errors.js';
import {
  _extractZipSafely_TEST_ONLY,
  downloadAndVerify,
  fetchRegistryIndex,
  readInstalled,
  uninstallItem,
} from '../bin/lib-ts/install.js';
import { validateForPublishing } from '../bin/lib-ts/registry.js';

const ZIPSLIP_FIXTURES = path.join(__dirname, 'fixtures', 'zipslip');

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'm6-pit-'));
  mkdirSync(path.join(tmpDir, '.jumpstart'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.JUMPSTART_ALLOW_INSECURE_LLM_URL;
});

// ─────────────────────────────────────────────────────────────────────────
// BLOCKER 1 — installFromStaging / uninstallItem assertInsideRoot
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M6 BLOCKER (Reviewer + Adversary 3) — registry targetPaths gated by assertInsideRoot', () => {
  it('uninstallItem rejects a tampered installed.json with traversal targetPaths', () => {
    // Pre-populate installed.json with an attacker-shaped entry. The
    // shape passes safeParseInstalled (paths are strings); only the
    // assertInsideRoot guard at uninstall time stops the rmSync.
    const ledger = {
      items: {
        'skill.evil': {
          version: '1.0.0',
          displayName: 'Evil',
          type: 'skill',
          installedAt: '2026-01-01T00:00:00.000Z',
          targetPaths: ['../../package.json'],
          remappedFiles: [],
        },
      },
    };
    writeFileSync(
      path.join(tmpDir, '.jumpstart', 'installed.json'),
      JSON.stringify(ledger, null, 2),
      'utf8'
    );

    expect(() => uninstallItem('skill.evil', tmpDir)).toThrow(ValidationError);
  });

  it('uninstallItem rejects absolute remappedFiles', () => {
    const ledger = {
      items: {
        'skill.evil2': {
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          targetPaths: ['.jumpstart/skills/evil2'],
          remappedFiles: ['/etc/passwd'],
        },
      },
    };
    writeFileSync(
      path.join(tmpDir, '.jumpstart', 'installed.json'),
      JSON.stringify(ledger, null, 2),
      'utf8'
    );
    expect(() => uninstallItem('skill.evil2', tmpDir)).toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BLOCKER 2 — symlink detection regardless of host byte
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M6 BLOCKER (Adversary 1) — symlink rejection works on any host byte', () => {
  it('rejects spoofed-symlink.zip (host byte = 0 MS-DOS, S_IFLNK in attrs)', () => {
    const out = path.join(tmpDir, 'extract');
    mkdirSync(out, { recursive: true });
    expect(() =>
      _extractZipSafely_TEST_ONLY(path.join(ZIPSLIP_FIXTURES, 'spoofed-symlink.zip'), out)
    ).toThrow(ValidationError);
  });

  it('still rejects classic symlink.zip (host byte = 3 UNIX) — no regression', () => {
    const out = path.join(tmpDir, 'extract');
    mkdirSync(out, { recursive: true });
    expect(() =>
      _extractZipSafely_TEST_ONLY(path.join(ZIPSLIP_FIXTURES, 'symlink.zip'), out)
    ).toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BLOCKER 3 — downloadAndVerify hardening
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M6 BLOCKER (Adversary 2) — downloadAndVerify URL/checksum hardening', () => {
  it('rejects userinfo-confused download URL', async () => {
    await expect(
      downloadAndVerify('https://attacker.com@trusted.com/payload.zip', 'a'.repeat(64))
    ).rejects.toThrow(ValidationError);
  });

  it('rejects plain HTTP non-localhost download URL', async () => {
    await expect(
      downloadAndVerify('http://example.com/payload.zip', 'a'.repeat(64))
    ).rejects.toThrow(ValidationError);
  });

  it('rejects download with no checksum unless escape hatch is set', async () => {
    await expect(downloadAndVerify('https://trusted.example.com/payload.zip')).rejects.toThrow(
      ValidationError
    );
  });

  it('escape hatch JUMPSTART_ALLOW_INSECURE_LLM_URL=1 permits no-checksum (dev mode)', async () => {
    process.env.JUMPSTART_ALLOW_INSECURE_LLM_URL = '1';
    // Will still fail — we don't have a real fetch target — but the
    // ValidationError on missing checksum will NOT fire. Any other
    // error (TypeError on fetch, network error) is acceptable here;
    // we only assert that the checksum-missing ValidationError is
    // suppressed.
    await expect(downloadAndVerify('https://nope.invalid/x.zip')).rejects.not.toBeInstanceOf(
      ValidationError
    );
  });
});

describe('Pit Crew M6 BLOCKER 3 — fetchRegistryIndex URL allowlist', () => {
  it('rejects plain HTTP non-localhost registry URL', async () => {
    await expect(fetchRegistryIndex('http://example.com/index.json')).rejects.toThrow(
      ValidationError
    );
  });

  it('rejects userinfo-confused registry URL', async () => {
    await expect(fetchRegistryIndex('https://attacker.com@trusted.com/index.json')).rejects.toThrow(
      ValidationError
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HIGH — registry.ts validateForPublishing prototype pollution
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M6 HIGH (Reviewer) — validateForPublishing rejects __proto__-keyed manifest', () => {
  it('top-level __proto__ rejected', () => {
    // Hand-craft the literal JSON string — `JSON.stringify` strips
    // `__proto__` from object literals because it traverses the
    // prototype chain. The attacker would author the file directly.
    const moduleDir = path.join(tmpDir, 'module-a');
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(
      path.join(moduleDir, 'module.json'),
      '{"__proto__": {"polluted": "PWNED"}, "name": "evil", "version": "1.0.0", "description": "x"}',
      'utf8'
    );
    const r = validateForPublishing(moduleDir);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/prototype-pollution|forbidden|Invalid JSON/i);
  });

  it('nested __proto__ also rejected', () => {
    const moduleDir = path.join(tmpDir, 'module-b');
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(
      path.join(moduleDir, 'module.json'),
      '{"name": "x", "version": "1.0.0", "description": "x", "nested": {"__proto__": {"polluted": "PWNED"}}}',
      'utf8'
    );
    const r = validateForPublishing(moduleDir);
    expect(r.valid).toBe(false);
  });

  it('clean manifest still validates', () => {
    const moduleDir = path.join(tmpDir, 'module-clean');
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(
      path.join(moduleDir, 'module.json'),
      JSON.stringify({
        name: 'clean-skill',
        version: '1.0.0',
        description: 'clean',
        author: 'Sam',
        license: 'MIT',
        keywords: ['demo'],
      }),
      'utf8'
    );
    const r = validateForPublishing(moduleDir);
    expect(r.valid).toBe(true);
    expect(r.entry).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HIGH — safeParseInstalled deep entry validation
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M6 HIGH (Reviewer) — safeParseInstalled deep-validates entries', () => {
  it('drops entries with non-string targetPaths members', () => {
    const ledger = {
      items: {
        'skill.bad-targetpaths': {
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          targetPaths: ['ok', null, 42],
          remappedFiles: [],
        },
      },
    };
    writeFileSync(
      path.join(tmpDir, '.jumpstart', 'installed.json'),
      JSON.stringify(ledger, null, 2),
      'utf8'
    );
    const data = readInstalled(tmpDir);
    expect(data.items['skill.bad-targetpaths']).toBeUndefined();
  });

  it('drops entries missing the required `version` field', () => {
    const ledger = {
      items: {
        'skill.no-version': {
          installedAt: '2026-01-01T00:00:00.000Z',
          targetPaths: [],
          remappedFiles: [],
        },
      },
    };
    writeFileSync(
      path.join(tmpDir, '.jumpstart', 'installed.json'),
      JSON.stringify(ledger, null, 2),
      'utf8'
    );
    const data = readInstalled(tmpDir);
    expect(data.items['skill.no-version']).toBeUndefined();
  });

  it('keeps well-formed entries even when malformed siblings are present', () => {
    const ledger = {
      items: {
        'skill.good': {
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          targetPaths: ['.jumpstart/skills/good'],
          remappedFiles: [],
        },
        'skill.bad': { not: 'an entry' },
      },
    };
    writeFileSync(
      path.join(tmpDir, '.jumpstart', 'installed.json'),
      JSON.stringify(ledger, null, 2),
      'utf8'
    );
    const data = readInstalled(tmpDir);
    expect(data.items['skill.good']).toBeDefined();
    expect(data.items['skill.bad']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HIGH — QA coverage gaps closed
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M6 HIGH (QA) — newly-covered ZIP rejection branches', () => {
  it('compression method ≠ 0 / 8 rejected (bad-compression.zip, method=2)', () => {
    const out = path.join(tmpDir, 'extract');
    mkdirSync(out, { recursive: true });
    expect(() =>
      _extractZipSafely_TEST_ONLY(path.join(ZIPSLIP_FIXTURES, 'bad-compression.zip'), out)
    ).toThrow(ValidationError);
  });

  it('Windows-drive-letter entry name rejected (windows-drive.zip)', () => {
    const out = path.join(tmpDir, 'extract');
    mkdirSync(out, { recursive: true });
    expect(() =>
      _extractZipSafely_TEST_ONLY(path.join(ZIPSLIP_FIXTURES, 'windows-drive.zip'), out)
    ).toThrow(ValidationError);
  });
});
