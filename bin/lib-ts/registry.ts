/**
 * registry.ts — Module Registry for Jump Start Marketplace port (T4.5.2, cluster M6).
 *
 * Pure-library port of `bin/lib/registry.js`. Public surface preserved
 * verbatim by name + signature:
 *
 *   - `validateForPublishing(moduleDir)` => ValidateResult
 *   - `generateRegistryEntry(moduleDir, manifest)` => RegistryEntry
 *   - `loadRegistry(registryPath)` => RegistryIndex
 *   - `normalizeRegistryFormat(data)` => RegistryIndex
 *   - `publishToRegistry(registryPath, entry)` => RegistryIndex
 *
 * Behavior parity:
 *   - Required manifest fields: `name`, `version`, `description`.
 *   - Recommended fields surfaced as warnings: `author`, `license`, `keywords`.
 *   - Validates referenced files exist for `agents`/`templates`/`commands`/`checks`/`skills`.
 *   - Content hash: SHA-256 over concatenation of every file's raw bytes
 *     (recursive directory walk — order is `readdirSync` lexicographic
 *     order, which is stable for any given filesystem).
 *
 * **ADR-012 redaction (NEW in this port).**
 *   Module manifests can carry author email, descriptions, keywords —
 *   plain string fields that may surface accidentally-committed
 *   credentials. The `publishToRegistry` write path runs the full
 *   registry payload through `redactSecrets` before persistence.
 *
 * **Path-safety hardening (NEW in this port).**
 *   `validateForPublishing` rejects module manifests whose
 *   referenced-file entries (e.g. `agents: ['../../etc/passwd']`)
 *   resolve outside the module directory. The legacy was permissive —
 *   the TS port asserts against the module dir boundary at validation
 *   time so a malicious manifest can't smuggle a traversal through
 *   `existsSync(join(moduleDir, filePath))`.
 *
 * **JSON shape validation (NEW in this port).**
 *   `loadRegistry` rejects `__proto__`/`constructor`/`prototype`-keyed
 *   JSON. Wrong-typed sub-fields normalized to defaults.
 *
 * **Deferred from legacy** — the `if (process.argv[1].endsWith('registry.js'))`
 * CLI entry block at the bottom of legacy is NOT ported. The CLI
 * orchestrator that surfaces this module's output lives in `bin/cli.js`
 * and stays in legacy until the M9 ESM cutover.
 *
 * @see bin/lib/registry.js (legacy reference)
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.5.2
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { assertInsideRoot } from './path-safety.js';
import { redactSecrets } from './secret-scanner.js';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export interface ModuleManifest {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  keywords?: string[];
  agents?: string[];
  templates?: string[];
  commands?: string[];
  checks?: string[];
  skills?: string[];
  [key: string]: unknown;
}

export interface RegistryEntry {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  keywords: string[];
  file_count: number;
  content_hash: string;
  published_at: string;
  agents: number;
  templates: number;
  commands: number;
  checks: number;
  skills: number;
}

export interface ValidateResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  entry: RegistryEntry | null;
}

export interface RegistryIndex {
  modules: RegistryEntry[];
  items: unknown[];
  updated_at: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shape helpers
// ─────────────────────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Soft-fail JSON load with prototype-pollution rejection. Returns null
 *  on parse failure, scalar root, array root, or any prototype-pollution
 *  key in the top level. */
function safeParseRegistry(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  for (const key of Object.keys(parsed)) {
    if (FORBIDDEN_KEYS.has(key)) return null;
  }
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────
// File walker
// ─────────────────────────────────────────────────────────────────────────

/**
 * Collect every file under `dir` recursively. Returns absolute paths in
 * `readdirSync` order (which is filesystem-dependent but stable per-run
 * — important for the deterministic content_hash output).
 *
 * The legacy is exported as a top-level function but only consumed
 * internally; we preserve it as an internal helper since the assignment
 * requirement note says "if exported in legacy". Legacy registry.js
 * declares it as `function collectFiles` (NOT `export function`), so
 * we keep it module-local.
 */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation + entry generation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validate a module directory for marketplace readiness. Returns a
 * structured result with errors/warnings + the generated registry
 * entry (null if validation failed).
 *
 * Path-safety: every referenced file path is asserted inside `moduleDir`
 * before `existsSync` runs. A malicious manifest with
 * `agents: ['../../etc/passwd']` is caught at validation rather than
 * silently bypassed.
 */
export function validateForPublishing(moduleDir: string): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(moduleDir)) {
    return {
      valid: false,
      errors: ['Module directory does not exist'],
      warnings: [],
      entry: null,
    };
  }

  const manifestPath = join(moduleDir, 'module.json');
  if (!existsSync(manifestPath)) {
    return {
      valid: false,
      errors: ['Missing module.json manifest'],
      warnings: [],
      entry: null,
    };
  }

  let manifest: ModuleManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ModuleManifest;
  } catch (err) {
    return {
      valid: false,
      errors: [`Invalid JSON in module.json: ${(err as Error).message}`],
      warnings: [],
      entry: null,
    };
  }

  // Required fields
  if (!manifest.name) errors.push('Missing "name" in manifest');
  if (!manifest.version) errors.push('Missing "version" in manifest');
  if (!manifest.description) errors.push('Missing "description" in manifest');

  // Recommended fields
  if (!manifest.author) warnings.push('Missing "author" — recommended for marketplace');
  if (!manifest.license) warnings.push('Missing "license" — recommended for marketplace');
  if (!manifest.keywords || manifest.keywords.length === 0) {
    warnings.push('Missing "keywords" — helps with discovery');
  }

  // Validate referenced files exist + path-safety check.
  const refKeys = ['agents', 'templates', 'commands', 'checks', 'skills'] as const;
  const moduleDirAbs = resolve(moduleDir);
  for (const key of refKeys) {
    const refList = manifest[key];
    if (!refList) continue;
    if (!Array.isArray(refList)) continue;
    for (const filePath of refList) {
      if (typeof filePath !== 'string') continue;
      // Path-safety: assert the referenced file resolves inside the
      // module directory. Reject `../../etc/passwd` shapes at the
      // validation boundary.
      try {
        assertInsideRoot(filePath, moduleDirAbs, {
          schemaId: 'validateForPublishing.referencedFile',
        });
      } catch (err) {
        errors.push(
          `Referenced ${key} file rejected (path traversal): ${filePath} (${(err as Error).message})`
        );
        continue;
      }
      const fullPath = join(moduleDirAbs, filePath);
      if (!existsSync(fullPath)) {
        errors.push(`Referenced ${key} file not found: ${filePath}`);
      }
    }
  }

  const entry = errors.length === 0 ? generateRegistryEntry(moduleDir, manifest) : null;

  return { valid: errors.length === 0, errors, warnings, entry };
}

/**
 * Generate a registry entry for a validated module. Computes a
 * deterministic content hash over every file in the module directory
 * (recursive walk).
 *
 * Caller note: the SHA-256 input is the concatenation of every file's
 * raw bytes in `collectFiles` order. Two functionally-equivalent
 * modules with different on-disk file order will produce different
 * hashes — this matches legacy semantics. Reordering at the publisher
 * level is a separate concern.
 */
export function generateRegistryEntry(moduleDir: string, manifest: ModuleManifest): RegistryEntry {
  const files = collectFiles(moduleDir);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(readFileSync(file));
  }

  return {
    name: manifest.name ?? '',
    version: manifest.version ?? '',
    description: manifest.description ?? '',
    author: manifest.author || 'Unknown',
    license: manifest.license || 'UNLICENSED',
    keywords: manifest.keywords || [],
    file_count: files.length,
    content_hash: hash.digest('hex'),
    published_at: new Date().toISOString(),
    agents: (manifest.agents || []).length,
    templates: (manifest.templates || []).length,
    commands: (manifest.commands || []).length,
    checks: (manifest.checks || []).length,
    skills: (manifest.skills || []).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Registry index load / normalize / publish
// ─────────────────────────────────────────────────────────────────────────

/**
 * Load or initialize a registry index. Supports both local module
 * format (`{ modules: [...] }`) and Skills marketplace format
 * (`{ items: [...] }`); the result is normalized to contain BOTH
 * `modules` and `items` keys so downstream code doesn't have to
 * branch.
 *
 * Returns a default-shape index on missing file, malformed JSON, or
 * prototype-pollution rejection.
 */
export function loadRegistry(registryPath: string): RegistryIndex {
  if (existsSync(registryPath)) {
    const parsed = safeParseRegistry(readFileSync(registryPath, 'utf8'));
    if (parsed) {
      return normalizeRegistryFormat(parsed);
    }
  }
  return { modules: [], items: [], updated_at: new Date().toISOString() };
}

/**
 * Normalize a registry payload to contain both `modules` and `items`
 * keys. Detects Skills marketplace format (has `items[]`) vs local
 * module format (has `modules[]`).
 */
export function normalizeRegistryFormat(data: Record<string, unknown>): RegistryIndex {
  const result: RegistryIndex = {
    ...data,
    modules: [],
    items: [],
    updated_at: '',
  };

  if (Array.isArray(data.items)) {
    result.items = data.items;
  }
  if (Array.isArray(data.modules)) {
    result.modules = data.modules as RegistryEntry[];
  }

  if (typeof data.updated_at === 'string') {
    result.updated_at = data.updated_at;
  } else if (typeof data.generatedAt === 'string') {
    result.updated_at = data.generatedAt;
  } else {
    result.updated_at = new Date().toISOString();
  }

  return result;
}

/**
 * Add or update a module entry in the registry. Persists the result
 * to `registryPath`. ADR-012: redact the registry payload before
 * persistence — module manifests can carry user-supplied descriptions
 * / keyword arrays that may include accidentally-committed credentials.
 *
 * Returns the updated registry index.
 */
export function publishToRegistry(registryPath: string, entry: RegistryEntry): RegistryIndex {
  const registry = loadRegistry(registryPath);

  const idx = registry.modules.findIndex((m) => m.name === entry.name);
  if (idx >= 0) {
    registry.modules[idx] = entry;
  } else {
    registry.modules.push(entry);
  }

  registry.updated_at = new Date().toISOString();

  const dir = dirname(registryPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const redacted: RegistryIndex = redactSecrets(registry);
  writeFileSync(registryPath, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');

  return registry;
}
