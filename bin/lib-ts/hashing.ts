/**
 * hashing.ts — content-addressable specs (T4.1.2 port).
 *
 * SHA-256 hashing utilities for tamper detection on spec artifacts.
 * Pure-library port of `bin/lib/hashing.js` — no IPC subprocess shape,
 * no CLI driver, no fixture pair required.
 *
 * Behavior parity with the legacy module:
 *   - Same hex-encoded SHA-256 output for identical inputs (verified
 *     by the test corpus's known-vector cases).
 *   - Same manifest schema: `{ version, generated, lastUpdated?, artifacts }`.
 *   - Same throw semantics: `fs` errors and JSON parse errors bubble
 *     unchanged. (Wrapping into typed `JumpstartError` subclasses is a
 *     forward-secure improvement deferred to M5 alongside the IPC
 *     wrapper layer per ADR-013 — see Deviation Log entry.)
 *
 * Security note (ADR-009): all four file-path-accepting functions
 * (`hashFile`, `loadManifest`, `saveManifest`, `verifyAll`) currently
 * trust the caller's path. A future caller migrating from
 * `require('./hashing.js')` → `import from '@lib/hashing'` should pass
 * pre-validated paths from `safePathSchema`. The wrapper layer planned
 * in ADR-013 (`safeReadFile`/`safeWriteFile`) will make this automatic.
 *
 * @see specs/decisions/adr-005-module-layout.md (strangler-fig)
 * @see specs/decisions/adr-006-error-model.md
 * @see specs/decisions/adr-009-ipc-stdin-path-traversal.md
 * @see specs/implementation-plan.md T4.1.2
 * @see bin/lib/hashing.js (legacy — kept unchanged during strangler)
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Manifest entry recording the hash of a single tracked artifact.
 * Field shape preserved verbatim from the legacy module so existing
 * `manifest.json` files round-trip without migration.
 */
export interface ArtifactEntry {
  hash: string;
  lastVerified: string;
  size: number;
}

/**
 * Top-level manifest shape. `lastUpdated` is added on every save and
 * therefore present on any persisted manifest, but absent from a
 * freshly-created in-memory manifest before the first save — matching
 * legacy behavior exactly.
 */
export interface Manifest {
  version: string;
  generated: string;
  lastUpdated?: string;
  artifacts: Record<string, ArtifactEntry>;
}

/**
 * Result of `registerArtifact` — distinguishes "first registration"
 * (`previousHash === null`) from "content changed since last seen"
 * (`changed === true && previousHash !== null`) and "unchanged"
 * (`changed === false`).
 */
export interface RegisterResult {
  hash: string;
  changed: boolean;
  previousHash: string | null;
}

/**
 * Detail of a single tampered artifact. Both hashes are kept so the
 * caller can render an actionable diff message.
 */
export interface TamperedArtifact {
  path: string;
  expectedHash: string;
  actualHash: string;
}

/**
 * Result of `verifyAll`. `summary` is a pre-rendered human-readable
 * string matching the legacy format (callers print it directly).
 */
export interface VerifyResult {
  verified: number;
  tampered: TamperedArtifact[];
  missing: string[];
  summary: string;
}

/**
 * Compute SHA-256 of file content. Reads the file with UTF-8 encoding
 * to match legacy semantics (NOT binary-safe — but every spec artifact
 * the framework hashes is text, and a future binary use case should
 * call `hashContent` after reading the file with a buffer encoding).
 */
export function hashFile(filePath: string): string {
  const content = readFileSync(filePath, 'utf8');
  return createHash('sha256').update(content).digest('hex');
}

/** Compute SHA-256 of an in-memory string. Pure / deterministic. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Load the manifest from disk, or return a fresh in-memory manifest if
 * the file doesn't exist. Mirrors the legacy "create on first use"
 * pattern so callers don't need to special-case the bootstrap path.
 */
export function loadManifest(manifestPath: string): Manifest {
  if (existsSync(manifestPath)) {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  }
  return {
    version: '1.0.0',
    generated: new Date().toISOString(),
    artifacts: {},
  };
}

/**
 * Save the manifest to disk. Mutates `manifest.lastUpdated` in place
 * before writing — matches legacy behavior so callers see the timestamp
 * update on the in-memory object too.
 */
export function saveManifest(manifestPath: string, manifest: Manifest): void {
  manifest.lastUpdated = new Date().toISOString();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * Hash `filePath`, register it under `artifactPath` in the manifest at
 * `manifestPath`, and persist. Returns the hash + whether the content
 * changed since the last registration. First-time registrations report
 * `previousHash: null` and `changed: true`.
 */
export function registerArtifact(
  manifestPath: string,
  artifactPath: string,
  filePath: string
): RegisterResult {
  const manifest = loadManifest(manifestPath);
  const hash = hashFile(filePath);

  const previous = manifest.artifacts[artifactPath];
  const previousHash = previous ? previous.hash : null;
  const changed = previousHash !== hash;

  manifest.artifacts[artifactPath] = {
    hash,
    lastVerified: new Date().toISOString(),
    size: statSync(filePath).size,
  };

  saveManifest(manifestPath, manifest);

  return { hash, changed, previousHash };
}

/**
 * Re-hash every artifact registered in the manifest and report
 * tampered + missing entries. `baseDir` resolves the relative
 * `artifactPath` keys (typically `process.cwd()` for repo-rooted
 * artifacts).
 *
 * Summary string format matches the legacy verbatim — downstream tools
 * grep for "All N artifact(s) verified successfully." and the exact
 * "X/Y verified. N tampered. M missing." form.
 */
export function verifyAll(manifestPath: string, baseDir: string): VerifyResult {
  const manifest = loadManifest(manifestPath);
  const tampered: TamperedArtifact[] = [];
  const missing: string[] = [];
  let verified = 0;

  for (const [artifactPath, entry] of Object.entries(manifest.artifacts)) {
    const fullPath = path.resolve(baseDir, artifactPath);

    if (!existsSync(fullPath)) {
      missing.push(artifactPath);
      continue;
    }

    const currentHash = hashFile(fullPath);
    if (currentHash !== entry.hash) {
      tampered.push({
        path: artifactPath,
        expectedHash: entry.hash,
        actualHash: currentHash,
      });
    } else {
      verified++;
    }
  }

  const total = Object.keys(manifest.artifacts).length;
  const summary =
    tampered.length === 0 && missing.length === 0
      ? `All ${verified} artifact(s) verified successfully.`
      : `${verified}/${total} verified. ${tampered.length} tampered. ${missing.length} missing.`;

  return { verified, tampered, missing, summary };
}
