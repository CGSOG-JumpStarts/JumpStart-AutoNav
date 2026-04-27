/**
 * test-hashing.test.ts — T4.1.2 unit tests for the hashing.ts port.
 *
 * The legacy `bin/lib/hashing.js` shipped without unit tests; this is
 * the first dedicated test corpus for the module. Coverage:
 *   - SHA-256 known vectors for `hashContent` (deterministic + matches
 *     openssl reference output).
 *   - `hashFile` ↔ `hashContent` parity for arbitrary content.
 *   - `loadManifest` create-on-missing + parse-on-existing.
 *   - `saveManifest` round-trip + `lastUpdated` mutation.
 *   - `registerArtifact` first-time + unchanged + changed cases.
 *   - `verifyAll` clean / tampered / missing / mixed cases plus the
 *     pre-rendered `summary` strings (callers grep them).
 *
 * @see bin/lib-ts/hashing.ts
 * @see bin/lib/hashing.js (legacy reference implementation)
 * @see specs/implementation-plan.md T4.1.2
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hashContent,
  hashFile,
  loadManifest,
  type Manifest,
  registerArtifact,
  saveManifest,
  verifyAll,
} from '../bin/lib-ts/hashing.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'hashing-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, body: string): string {
  const p = path.join(tmpDir, name);
  writeFileSync(p, body, 'utf8');
  return p;
}

describe('hashContent — known vectors', () => {
  it('returns the canonical SHA-256 hex digest for empty string', () => {
    expect(hashContent('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('returns the canonical SHA-256 hex digest for "abc"', () => {
    expect(hashContent('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('is deterministic across repeated calls', () => {
    const a = hashContent('jumpstart-mode');
    const b = hashContent('jumpstart-mode');
    expect(a).toBe(b);
  });

  it('produces a 64-character hex string', () => {
    expect(hashContent('any input')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashFile ↔ hashContent parity', () => {
  it('hashFile of a file matches hashContent of its body', () => {
    const body = 'specs/architecture.md content fixture';
    const p = writeFixture('arch.md', body);
    expect(hashFile(p)).toBe(hashContent(body));
  });

  it('detects a one-byte change', () => {
    const a = writeFixture('a.txt', 'hello world');
    const b = writeFixture('b.txt', 'hello worle'); // last char flipped
    expect(hashFile(a)).not.toBe(hashFile(b));
  });
});

describe('loadManifest — create-on-missing', () => {
  it('returns a fresh in-memory manifest when the file does not exist', () => {
    const p = path.join(tmpDir, 'missing.json');
    const m = loadManifest(p);
    expect(m.version).toBe('1.0.0');
    expect(typeof m.generated).toBe('string');
    expect(m.lastUpdated).toBeUndefined(); // not set until first save
    expect(m.artifacts).toEqual({});
  });

  it('parses an existing manifest verbatim', () => {
    const p = path.join(tmpDir, 'manifest.json');
    const existing: Manifest = {
      version: '2.0.0',
      generated: '2026-04-01T00:00:00.000Z',
      artifacts: { 'spec.md': { hash: 'abc', lastVerified: 'now', size: 42 } },
    };
    writeFileSync(p, JSON.stringify(existing), 'utf8');
    const loaded = loadManifest(p);
    expect(loaded).toEqual(existing);
  });
});

describe('saveManifest — round-trip', () => {
  it('persists the manifest as pretty-printed JSON', () => {
    const p = path.join(tmpDir, 'manifest.json');
    const m: Manifest = {
      version: '1.0.0',
      generated: '2026-04-01T00:00:00.000Z',
      artifacts: {},
    };
    saveManifest(p, m);
    const raw = readFileSync(p, 'utf8');
    expect(raw).toContain('\n  "version"');
    expect(raw.trim().startsWith('{')).toBe(true);
  });

  it('mutates lastUpdated on the in-memory manifest object', () => {
    const p = path.join(tmpDir, 'manifest.json');
    const m: Manifest = {
      version: '1.0.0',
      generated: '2026-04-01T00:00:00.000Z',
      artifacts: {},
    };
    expect(m.lastUpdated).toBeUndefined();
    saveManifest(p, m);
    expect(typeof m.lastUpdated).toBe('string');
  });
});

describe('registerArtifact — first time / unchanged / changed', () => {
  it('reports previousHash=null and changed=true on first registration', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const filePath = writeFixture('spec.md', 'first version');

    const result = registerArtifact(manifestPath, 'specs/spec.md', filePath);
    expect(result.previousHash).toBeNull();
    expect(result.changed).toBe(true);
    expect(result.hash).toBe(hashContent('first version'));

    // Manifest persists the entry.
    const m = loadManifest(manifestPath);
    expect(m.artifacts['specs/spec.md'].hash).toBe(result.hash);
    expect(m.artifacts['specs/spec.md'].size).toBe('first version'.length);
  });

  it('reports changed=false when content is unchanged across re-register', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const filePath = writeFixture('spec.md', 'content');

    const first = registerArtifact(manifestPath, 'specs/spec.md', filePath);
    const second = registerArtifact(manifestPath, 'specs/spec.md', filePath);

    expect(second.previousHash).toBe(first.hash);
    expect(second.changed).toBe(false);
    expect(second.hash).toBe(first.hash);
  });

  it('reports changed=true with the prior hash on content change', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const filePath = writeFixture('spec.md', 'v1');

    const first = registerArtifact(manifestPath, 'specs/spec.md', filePath);

    writeFileSync(filePath, 'v2', 'utf8');
    const second = registerArtifact(manifestPath, 'specs/spec.md', filePath);

    expect(second.previousHash).toBe(first.hash);
    expect(second.changed).toBe(true);
    expect(second.hash).not.toBe(first.hash);
  });
});

describe('verifyAll — clean / tampered / missing', () => {
  it('reports zero tampered + zero missing for a clean tree', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const filePath = writeFixture('a.md', 'aaa');
    registerArtifact(manifestPath, 'a.md', filePath);

    const result = verifyAll(manifestPath, tmpDir);
    expect(result.verified).toBe(1);
    expect(result.tampered).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.summary).toBe('All 1 artifact(s) verified successfully.');
  });

  it('reports tampered artifacts with both hashes', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const filePath = writeFixture('a.md', 'original');
    const expectedHash = registerArtifact(manifestPath, 'a.md', filePath).hash;

    writeFileSync(filePath, 'tampered', 'utf8');

    const result = verifyAll(manifestPath, tmpDir);
    expect(result.verified).toBe(0);
    expect(result.tampered).toHaveLength(1);
    expect(result.tampered[0].path).toBe('a.md');
    expect(result.tampered[0].expectedHash).toBe(expectedHash);
    expect(result.tampered[0].actualHash).toBe(hashContent('tampered'));
    expect(result.summary).toBe('0/1 verified. 1 tampered. 0 missing.');
  });

  it('reports missing artifacts when the file has been deleted', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const filePath = writeFixture('a.md', 'aaa');
    registerArtifact(manifestPath, 'a.md', filePath);
    rmSync(filePath);

    const result = verifyAll(manifestPath, tmpDir);
    expect(result.missing).toEqual(['a.md']);
    expect(result.verified).toBe(0);
    expect(result.summary).toBe('0/1 verified. 0 tampered. 1 missing.');
  });

  it('handles mixed verified + tampered + missing in one report', () => {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const ok = writeFixture('ok.md', 'ok');
    const bad = writeFixture('bad.md', 'before');
    const gone = writeFixture('gone.md', 'gone');
    registerArtifact(manifestPath, 'ok.md', ok);
    registerArtifact(manifestPath, 'bad.md', bad);
    registerArtifact(manifestPath, 'gone.md', gone);

    writeFileSync(bad, 'after', 'utf8');
    rmSync(gone);

    const result = verifyAll(manifestPath, tmpDir);
    expect(result.verified).toBe(1);
    expect(result.tampered.map((t) => t.path)).toEqual(['bad.md']);
    expect(result.missing).toEqual(['gone.md']);
    expect(result.summary).toBe('1/3 verified. 1 tampered. 1 missing.');
  });
});
