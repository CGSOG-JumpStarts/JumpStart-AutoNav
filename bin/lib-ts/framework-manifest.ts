/**
 * framework-manifest.ts — file ownership classification + manifests (T4.1.11).
 *
 * Pure-library port of `bin/lib/framework-manifest.js`. The classification
 * lists drive `bin/upgrade.js`'s "what's safe to overwrite vs what's
 * the user's customization?" decision; the manifest functions hash every
 * framework-owned file at install time so subsequent upgrades can do a
 * three-way diff.
 *
 * **Eleven exports preserved verbatim by name + signature:**
 *   - `FRAMEWORK_OWNED_PATTERNS` (constant array)
 *   - `USER_OWNED_PATHS` (constant array)
 *   - `isUserOwned(relPath)` → boolean
 *   - `isFrameworkOwned(relPath)` → boolean
 *   - `hashFile(absPath)` → hex SHA-256
 *   - `generateManifest(rootDir, options?)` → manifest
 *   - `diffManifest(old, new)` → { added, removed, changed, unchanged }
 *   - `detectUserModifications(projectRoot, installedManifest)`
 *   - `readFrameworkManifest(projectRoot)` → manifest | null
 *   - `writeFrameworkManifest(projectRoot, manifest)`
 *   - `getPackageVersion(packageRoot)` → string
 *
 * Behavior parity:
 *   - User-owned takes precedence over framework-owned (legacy
 *     `isFrameworkOwned` returns false if `isUserOwned` is true).
 *   - Pattern matching is forward-slash-normalized; trailing-slash
 *     patterns match prefix; bare patterns match exactly.
 *   - Manifest JSON is pretty-printed with trailing newline + parent
 *     directory auto-created on write.
 *
 * Note: this module computes SHA-256 directly via `node:crypto` rather
 * than reusing `bin/lib-ts/hashing.ts`'s `hashFile` because the legacy
 * function reads the file as a Buffer (`readFileSync(filePath)` with
 * no encoding — binary read), while `hashing.ts` uses `'utf8'`. The
 * binary read is correct for arbitrary file types under
 * `.jumpstart/templates/` (which can be markdown, JSON, YAML, or
 * binary blobs in the future). Preserved verbatim.
 *
 * @see bin/lib/framework-manifest.js (legacy reference)
 * @see bin/upgrade.js (caller — drives the three-way diff during npm upgrade)
 * @see specs/implementation-plan.md T4.1.11
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// Classification rules
// ─────────────────────────────────────────────────────────────────────────

/**
 * Glob-style path patterns for framework-owned files. These are shipped
 * with the npm package and are safe to overwrite on upgrade. List
 * order matches legacy verbatim.
 */
export const FRAMEWORK_OWNED_PATTERNS: readonly string[] = [
  '.jumpstart/agents/',
  '.jumpstart/templates/',
  '.jumpstart/schemas/',
  '.jumpstart/guides/',
  '.jumpstart/handoffs/',
  '.jumpstart/compat/',
  '.jumpstart/commands/',
  '.jumpstart/base/',
  '.jumpstart/modules/README.md',
  '.jumpstart/roadmap.md',
  '.jumpstart/invariants.md',
  '.jumpstart/domain-complexity.csv',
  '.jumpstart/glossary.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
  '.github/agents/',
  '.github/instructions/specs.instructions.md',
  '.github/prompts/',
  '.github/copilot-instructions.md',
];

/**
 * Paths that are always user-owned and must NEVER be overwritten.
 * These take precedence over framework patterns where they overlap.
 */
export const USER_OWNED_PATHS: readonly string[] = [
  '.jumpstart/config.yaml',
  '.jumpstart/state/',
  '.jumpstart/installed.json',
  '.jumpstart/manifest.json',
  '.jumpstart/spec-graph.json',
  '.jumpstart/usage-log.json',
  '.jumpstart/correction-log.md',
  '.jumpstart/archive/',
  '.jumpstart/skills/',
  '.jumpstart/integration-log.json',
  'specs/',
  'src/',
  'tests/',
];

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

/** Manifest shape: framework version + per-file SHA-256 map. */
export interface Manifest {
  frameworkVersion: string;
  generatedAt: string;
  files: Record<string, string>;
}

/** Options for `generateManifest`. */
export interface GenerateManifestOptions {
  /** Framework version to stamp on the manifest. Defaults to `'0.0.0'`. */
  version?: string;
  /** Include all files under .jumpstart/, .github/, and top-level rather
   *  than filtering to framework-owned. Useful for snapshotting test
   *  fixtures. */
  allFiles?: boolean;
}

/** Result of `diffManifest`. */
export interface ManifestDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

/** Result of `detectUserModifications`. */
export interface UserModifications {
  modified: string[];
  unmodified: string[];
  missing: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Classification helpers
// ─────────────────────────────────────────────────────────────────────────

/** True if `relPath` is in the user-owned allowlist (protected from upgrade). */
export function isUserOwned(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  for (const pattern of USER_OWNED_PATHS) {
    if (pattern.endsWith('/')) {
      if (normalized.startsWith(pattern) || normalized === pattern.slice(0, -1)) {
        return true;
      }
    } else if (normalized === pattern) {
      return true;
    }
  }
  return false;
}

/** True if `relPath` is framework-owned and safe to upgrade. User-owned
 *  takes precedence — `isFrameworkOwned` returns false even for an
 *  exact match in `FRAMEWORK_OWNED_PATTERNS` if `isUserOwned` says
 *  user-owned. */
export function isFrameworkOwned(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  if (isUserOwned(normalized)) return false;
  for (const pattern of FRAMEWORK_OWNED_PATTERNS) {
    if (pattern.endsWith('/')) {
      if (normalized.startsWith(pattern)) return true;
    } else if (normalized === pattern) {
      return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Hashing + walking
// ─────────────────────────────────────────────────────────────────────────

/**
 * SHA-256 hex digest of a file's contents. Reads as Buffer (no
 * encoding) so the digest is binary-safe — matches legacy semantics
 * verbatim and produces consistent hashes across line-ending platforms.
 */
export function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/** Recursively collect file paths under `dir`, returning forward-slash
 *  paths relative to `rootDir`. */
function walkDir(dir: string, rootDir: string = dir): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, rootDir));
    } else {
      const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
      results.push(relPath);
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Manifest generation + diff
// ─────────────────────────────────────────────────────────────────────────

/**
 * Walk `rootDir` for framework-owned files and produce a manifest with
 * version stamp + per-file SHA-256 map. Walks `.jumpstart/` and
 * `.github/` plus the top-level integration files (`AGENTS.md`,
 * `CLAUDE.md`, `.cursorrules`).
 */
export function generateManifest(rootDir: string, options: GenerateManifestOptions = {}): Manifest {
  const version = options.version || '0.0.0';
  const allFiles = options.allFiles || false;

  const manifest: Manifest = {
    frameworkVersion: version,
    generatedAt: new Date().toISOString(),
    files: {},
  };

  const jumpstartDir = join(rootDir, '.jumpstart');
  if (existsSync(jumpstartDir)) {
    for (const relPath of walkDir(jumpstartDir, rootDir)) {
      if (allFiles || isFrameworkOwned(relPath)) {
        manifest.files[relPath] = hashFile(join(rootDir, relPath));
      }
    }
  }

  const githubDir = join(rootDir, '.github');
  if (existsSync(githubDir)) {
    for (const relPath of walkDir(githubDir, rootDir)) {
      if (allFiles || isFrameworkOwned(relPath)) {
        manifest.files[relPath] = hashFile(join(rootDir, relPath));
      }
    }
  }

  const topLevelFiles = ['AGENTS.md', 'CLAUDE.md', '.cursorrules'];
  for (const file of topLevelFiles) {
    const fullPath = join(rootDir, file);
    if (existsSync(fullPath) && (allFiles || isFrameworkOwned(file))) {
      manifest.files[file] = hashFile(fullPath);
    }
  }

  return manifest;
}

/** Three-bucket diff between two manifests. */
export function diffManifest(oldManifest: Manifest, newManifest: Manifest): ManifestDiff {
  const oldFiles = oldManifest.files || {};
  const newFiles = newManifest.files || {};

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const [filePath, hash] of Object.entries(newFiles)) {
    if (!(filePath in oldFiles)) {
      added.push(filePath);
    } else if (oldFiles[filePath] !== hash) {
      changed.push(filePath);
    } else {
      unchanged.push(filePath);
    }
  }

  for (const filePath of Object.keys(oldFiles)) {
    if (!(filePath in newFiles)) {
      removed.push(filePath);
    }
  }

  return { added, removed, changed, unchanged };
}

/** Compare every file recorded in the installed manifest against its
 *  current on-disk hash. Reports modified / unmodified / missing
 *  buckets. */
export function detectUserModifications(
  projectRoot: string,
  installedManifest: Manifest
): UserModifications {
  const files = installedManifest.files || {};
  const modified: string[] = [];
  const unmodified: string[] = [];
  const missing: string[] = [];

  for (const [relPath, originalHash] of Object.entries(files)) {
    const fullPath = join(projectRoot, relPath);
    if (!existsSync(fullPath)) {
      missing.push(relPath);
      continue;
    }
    const currentHash = hashFile(fullPath);
    if (currentHash !== originalHash) {
      modified.push(relPath);
    } else {
      unmodified.push(relPath);
    }
  }

  return { modified, unmodified, missing };
}

// ─────────────────────────────────────────────────────────────────────────
// Manifest persistence + version helpers
// ─────────────────────────────────────────────────────────────────────────

/** Read `<projectRoot>/.jumpstart/framework-manifest.json` or null. */
export function readFrameworkManifest(projectRoot: string): Manifest | null {
  const manifestPath = join(projectRoot, '.jumpstart', 'framework-manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

/** Write `<projectRoot>/.jumpstart/framework-manifest.json`, creating
 *  the parent directory if needed. Pretty-printed JSON + trailing
 *  newline (legacy emit shape). */
export function writeFrameworkManifest(projectRoot: string, manifest: Manifest): void {
  const manifestPath = join(projectRoot, '.jumpstart', 'framework-manifest.json');
  const dir = dirname(manifestPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** Read the npm package version from `<packageRoot>/package.json`.
 *  Returns `'0.0.0'` on missing file or parse failure (legacy
 *  fallback for fresh installs). */
export function getPackageVersion(packageRoot: string): string {
  const pkgPath = join(packageRoot, 'package.json');
  if (!existsSync(pkgPath)) return '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
