/**
 * test-install-output-byte-identical.test.ts — T4.5.4 byte-identical
 * install-output regression.
 *
 * Asserts that the TS port's hand-rolled ZIP extractor produces a file
 * tree byte-equivalent to the canonical contents that went into the
 * source ZIP, and that running it twice on the same archive produces
 * byte-identical output.
 *
 * Three properties are pinned:
 *   1. The TS extractor faithfully reproduces ZIP entry payloads
 *      (DEFLATE inflate is correct, STORED passthrough is correct).
 *   2. Extraction is deterministic — running twice produces identical
 *      bytes in identical relative paths.
 *   3. A SHA-256 digest of the combined output (paths + bytes,
 *      sorted) acts as a tripwire: if the fixture or the extractor
 *      drifts, the digest changes loudly.
 *
 * The legacy `bin/lib/install.js` shell-`unzip` parity check was
 * dropped per the security guidance to avoid `child_process` use in
 * tests. The TS-vs-TS determinism plus content-bytes-vs-pinned-tree
 * comparison covers the same ground without invoking external
 * binaries.
 *
 * @see specs/implementation-plan.md T4.5.4
 * @see bin/lib-ts/install.ts (_extractZipSafely_TEST_ONLY)
 * @see tests/fixtures/zipslip/legitimate.zip
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _extractZipSafely_TEST_ONLY } from '../bin/lib-ts/install.js';

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'zipslip');
const LEGITIMATE_ZIP = path.join(FIXTURES_DIR, 'legitimate.zip');

// Canonical contents of legitimate.zip — pinned in
// tests/fixtures/zipslip/build-fixtures.mjs lines 184-193.
const EXPECTED_TREE: Record<string, string> = {
  'README.md': '# README\n\nThis is a control fixture.\n',
  'src/hello.txt': 'hello from legitimate.zip\n',
  'src/nested/deep.txt': 'nested file payload\n',
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'inst-out-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Walk a directory tree, returning a sorted list of relative paths and their contents. */
function snapshotTree(root: string): Array<{ relPath: string; bytes: Buffer }> {
  const entries: Array<{ relPath: string; bytes: Buffer }> = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        entries.push({ relPath: rel, bytes: readFileSync(full) });
      }
    }
  }
  walk(root);
  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return entries;
}

/** Combined-tree digest: SHA-256 over (relPath || bytes) for every entry, sorted. */
function digestTree(snap: Array<{ relPath: string; bytes: Buffer }>): string {
  const concatenated = Buffer.concat(
    snap.flatMap((e) => [Buffer.from(e.relPath, 'utf8'), e.bytes])
  );
  return createHash('sha256').update(concatenated).digest('hex');
}

/** Expected digest computed from EXPECTED_TREE — stays in lockstep with the fixture. */
function expectedDigest(): string {
  const snap = Object.entries(EXPECTED_TREE)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([relPath, content]) => ({ relPath, bytes: Buffer.from(content, 'utf8') }));
  return digestTree(snap);
}

describe('T4.5.4 — byte-identical install-output regression', () => {
  it('legitimate.zip exists and is non-empty', () => {
    const st = statSync(LEGITIMATE_ZIP);
    expect(st.isFile()).toBe(true);
    expect(st.size).toBeGreaterThan(0);
  });

  it('extracted file tree matches the canonical 3-file manifest', () => {
    const out = path.join(tmpDir, 'extract-1');
    mkdirSync(out, { recursive: true });
    _extractZipSafely_TEST_ONLY(LEGITIMATE_ZIP, out);

    const snap = snapshotTree(out);
    const relPaths = snap.map((e) => e.relPath);
    expect(relPaths).toEqual(Object.keys(EXPECTED_TREE).sort());

    // Each file's bytes match the pinned payload.
    for (const { relPath, bytes } of snap) {
      const expected = EXPECTED_TREE[relPath];
      expect(bytes.toString('utf8')).toBe(expected);
    }
  });

  it('two consecutive extractions produce byte-identical file trees (TS-vs-TS determinism)', () => {
    const a = path.join(tmpDir, 'extract-a');
    const b = path.join(tmpDir, 'extract-b');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });

    _extractZipSafely_TEST_ONLY(LEGITIMATE_ZIP, a);
    _extractZipSafely_TEST_ONLY(LEGITIMATE_ZIP, b);

    const snapA = snapshotTree(a);
    const snapB = snapshotTree(b);

    expect(snapA.length).toBe(snapB.length);
    for (let i = 0; i < snapA.length; i++) {
      expect(snapA[i].relPath).toBe(snapB[i].relPath);
      // Buffer.equals: byte-identical comparison.
      expect(snapA[i].bytes.equals(snapB[i].bytes)).toBe(true);
    }
  });

  it('combined-tree SHA-256 digest matches the expected pinned value', () => {
    const out = path.join(tmpDir, 'extract-hash');
    mkdirSync(out, { recursive: true });
    _extractZipSafely_TEST_ONLY(LEGITIMATE_ZIP, out);

    const actual = digestTree(snapshotTree(out));
    const expected = expectedDigest();
    expect(actual).toBe(expected);
  });

  it('three extractions in three different sandboxes all produce identical digests', () => {
    const dirs = ['ext-1', 'ext-2', 'ext-3'].map((d) => {
      const p = path.join(tmpDir, d);
      mkdirSync(p, { recursive: true });
      _extractZipSafely_TEST_ONLY(LEGITIMATE_ZIP, p);
      return p;
    });
    const digests = dirs.map((d) => digestTree(snapshotTree(d)));
    expect(new Set(digests).size).toBe(1);
  });
});
