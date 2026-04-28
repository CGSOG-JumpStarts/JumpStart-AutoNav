#!/usr/bin/env node
/**
 * build-fixtures.mjs — Reproducible ZIP fixture generator for ADR-010
 * zipslip test coverage (T4.5.1, T4.5.5).
 *
 * Generates 5 deterministic ZIPs in this directory:
 *
 *   - legitimate.zip   — clean archive with 3 files (control)
 *   - traversal.zip    — entry name uses `..` to escape target dir
 *   - absolute.zip     — entry name is a POSIX absolute path
 *   - null-byte.zip    — entry name contains a U+0000 byte
 *   - symlink.zip      — entry encoded as a UNIX symbolic link
 *
 * Determinism is critical: the SHA-256 of `legitimate.zip` is reported
 * back to the orchestrator as a reproducibility-tracking digest.
 * Fixed timestamps + fixed file order + canonical CRC32 (computed from
 * payload, not random) means rerunning this script must produce
 * byte-identical output.
 *
 * Run once and commit the .zip files:
 *
 *     node tests/fixtures/zipslip/build-fixtures.mjs
 *
 * No external dependencies — uses Node's built-in `zlib` (`deflateRawSync`)
 * and writes ZIP records by hand.
 *
 * @see specs/decisions/adr-010-marketplace-zipslip-prevention.md
 * @see bin/lib-ts/install.ts
 * @see tests/test-install.test.ts
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Deterministic constants ────────────────────────────────────────────────
//
// MS-DOS-encoded date+time: 2026-01-01 00:00:00 UTC.
//   year-1980 = 46 (10 1110), month = 1 (0001), day = 1 (0 0001)
//   hour = 0, minute = 0, second/2 = 0
const DOS_TIME = 0x0000;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 0x5C21

// Compression methods
const STORED = 0;
const DEFLATE = 8;

// Signatures
const LOCAL_SIG = 0x04034b50;
const CD_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

// ─── CRC-32 (IEEE 802.3) ────────────────────────────────────────────────────

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ─── Low-level record builders ──────────────────────────────────────────────

/**
 * Build a single ZIP entry's local file header + body, plus the
 * matching central directory record. Returns `{ local, central }` so
 * the caller can stitch them in the right order.
 *
 * Options:
 *   - fileName        — string, written as UTF-8.
 *   - data            — Buffer payload.
 *   - method          — STORED (0) or DEFLATE (8).
 *   - hostSystem      — 0 = MSDOS, 3 = UNIX. Default 0.
 *   - externalAttrs   — 32-bit external file attrs. Default 0.
 *
 * On DEFLATE the stored payload is `deflateRawSync(data)`. CRC32 and
 * uncompressed size always describe the *original* `data`.
 */
function buildEntry({ fileName, data, method, hostSystem = 0, externalAttrs = 0 }, offset) {
  const nameBuf = Buffer.from(fileName, 'utf8');
  const uncompressedSize = data.length;
  const crc = crc32(data);
  const compressed = method === DEFLATE ? deflateRawSync(data) : Buffer.from(data);
  const compressedSize = compressed.length;

  // Local file header (30 bytes + name + extra + payload)
  const local = Buffer.alloc(30 + nameBuf.length + compressedSize);
  let p = 0;
  local.writeUInt32LE(LOCAL_SIG, p); p += 4;
  local.writeUInt16LE(20, p); p += 2;          // versionNeeded
  local.writeUInt16LE(0, p); p += 2;            // generalPurposeFlag
  local.writeUInt16LE(method, p); p += 2;       // compressionMethod
  local.writeUInt16LE(DOS_TIME, p); p += 2;     // lastModTime
  local.writeUInt16LE(DOS_DATE, p); p += 2;     // lastModDate
  local.writeUInt32LE(crc, p); p += 4;          // crc32
  local.writeUInt32LE(compressedSize, p); p += 4;
  local.writeUInt32LE(uncompressedSize, p); p += 4;
  local.writeUInt16LE(nameBuf.length, p); p += 2;
  local.writeUInt16LE(0, p); p += 2;            // extraFieldLength
  nameBuf.copy(local, p); p += nameBuf.length;
  compressed.copy(local, p);

  // Central directory header (46 bytes + name + extra + comment)
  const central = Buffer.alloc(46 + nameBuf.length);
  let q = 0;
  central.writeUInt32LE(CD_SIG, q); q += 4;
  central.writeUInt16LE((hostSystem << 8) | 20, q); q += 2; // versionMadeBy
  central.writeUInt16LE(20, q); q += 2;         // versionNeeded
  central.writeUInt16LE(0, q); q += 2;          // generalPurposeFlag
  central.writeUInt16LE(method, q); q += 2;
  central.writeUInt16LE(DOS_TIME, q); q += 2;
  central.writeUInt16LE(DOS_DATE, q); q += 2;
  central.writeUInt32LE(crc, q); q += 4;
  central.writeUInt32LE(compressedSize, q); q += 4;
  central.writeUInt32LE(uncompressedSize, q); q += 4;
  central.writeUInt16LE(nameBuf.length, q); q += 2;
  central.writeUInt16LE(0, q); q += 2;          // extraFieldLength
  central.writeUInt16LE(0, q); q += 2;          // commentLength
  central.writeUInt16LE(0, q); q += 2;          // diskNumberStart
  central.writeUInt16LE(0, q); q += 2;          // internalFileAttributes
  central.writeUInt32LE(externalAttrs >>> 0, q); q += 4;
  central.writeUInt32LE(offset >>> 0, q); q += 4;
  nameBuf.copy(central, q);

  return { local, central };
}

/**
 * Stitch a list of entry specs into a complete ZIP buffer. Entries are
 * written in the supplied order; offsets are computed sequentially.
 */
function buildZip(entrySpecs) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const spec of entrySpecs) {
    const { local, central } = buildEntry(spec, offset);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);
  const cdOffset = localBlock.length;
  const cdSize = centralBlock.length;

  // EOCD record (22 bytes, no comment)
  const eocd = Buffer.alloc(22);
  let r = 0;
  eocd.writeUInt32LE(EOCD_SIG, r); r += 4;
  eocd.writeUInt16LE(0, r); r += 2;             // diskNumber
  eocd.writeUInt16LE(0, r); r += 2;             // diskWhereCDStarts
  eocd.writeUInt16LE(entrySpecs.length, r); r += 2;
  eocd.writeUInt16LE(entrySpecs.length, r); r += 2;
  eocd.writeUInt32LE(cdSize, r); r += 4;
  eocd.writeUInt32LE(cdOffset, r); r += 4;
  eocd.writeUInt16LE(0, r);                     // commentLength

  return Buffer.concat([localBlock, centralBlock, eocd]);
}

// ─── Fixture specs ──────────────────────────────────────────────────────────

// Fixed payload contents — deterministic so CRC32s never drift.
const HELLO = Buffer.from('hello from legitimate.zip\n', 'utf8');
const README = Buffer.from('# README\n\nThis is a control fixture.\n', 'utf8');
const NESTED = Buffer.from('nested file payload\n', 'utf8');

// 1. legitimate.zip — clean archive with 3 files
const legitimate = buildZip([
  { fileName: 'README.md', data: README, method: DEFLATE },
  { fileName: 'src/hello.txt', data: HELLO, method: DEFLATE },
  { fileName: 'src/nested/deep.txt', data: NESTED, method: STORED },
]);

// 2. traversal.zip — entry escapes via `..`
const traversal = buildZip([
  {
    fileName: '../../../etc/passwd',
    data: Buffer.from('malicious traversal payload\n', 'utf8'),
    method: DEFLATE,
  },
]);

// 3. absolute.zip — POSIX absolute path
const absolute = buildZip([
  {
    fileName: '/tmp/escape.txt',
    data: Buffer.from('malicious absolute payload\n', 'utf8'),
    method: DEFLATE,
  },
]);

// 4. null-byte.zip — entry name carries a U+0000 byte
const nullByte = buildZip([
  {
    fileName: `safe.txt${String.fromCharCode(0)}../etc/passwd`,
    data: Buffer.from('malicious null-byte payload\n', 'utf8'),
    method: DEFLATE,
  },
]);

// 5. symlink.zip — entry flagged as UNIX symbolic link
//    External attrs = (S_IFLNK | 0777) << 16 = 0xA1FF0000
//    versionMadeBy host = 3 (UNIX)
const SYMLINK_ATTRS = ((0xa000 | 0o777) << 16) >>> 0;
const symlink = buildZip([
  {
    fileName: 'evil-link',
    data: Buffer.from('/etc/passwd', 'utf8'),
    method: STORED,
    hostSystem: 3,
    externalAttrs: SYMLINK_ATTRS,
  },
]);

// ─── Write files ────────────────────────────────────────────────────────────

const outputs = [
  ['legitimate.zip', legitimate],
  ['traversal.zip', traversal],
  ['absolute.zip', absolute],
  ['null-byte.zip', nullByte],
  ['symlink.zip', symlink],
];

for (const [name, buf] of outputs) {
  writeFileSync(join(__dirname, name), buf);
}

// Print SHA-256 digests for reproducibility tracking.
import { createHash } from 'node:crypto';
console.log('Generated zipslip fixtures:');
for (const [name, buf] of outputs) {
  const hash = createHash('sha256').update(buf).digest('hex');
  console.log(`  ${name}\tsha256:${hash}\t${buf.length} bytes`);
}
