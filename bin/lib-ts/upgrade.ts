/**
 * upgrade.ts — Safe Framework Upgrade with Backup/Restore port (T4.5.2, cluster M6).
 *
 * Pure-library port of `bin/lib/upgrade.js`. Public surface preserved
 * verbatim by name + signature:
 *
 *   - `upgrade(projectRoot, options?)` => Promise<UpgradeResult>
 *   - `restore(projectRoot, options?)` => RestoreResult
 *   - `listUpgradeBackups(projectRoot)` => UpgradeBackup[]
 *
 * Behavior parity:
 *   - Updates framework-owned files while preserving user content.
 *   - Backs up modified files before overwriting via the archive system.
 *   - Three-way YAML merge on `config.yaml` (delegates to `config-merge.ts`).
 *   - First-upgrade fall-back: when no manifest exists, treats every
 *     framework file as "added".
 *
 * **ADR-012 redaction (NEW in this port).**
 *   Archive metadata files (`*.meta.json`) record file paths, version
 *   numbers, and operation reasons — fields that may carry user-supplied
 *   strings. The metadata-update step in the backup pass runs through
 *   `redactSecrets` before persistence.
 *
 * **Path-safety hardening (NEW in this port).**
 *   The legacy is permissive — every relPath in `diff.added` /
 *   `safeUpdates` / `conflictingFiles` is asserted inside `projectRoot`
 *   before fs writes. A maliciously-crafted framework manifest entry
 *   like `'../../etc/passwd'` triggers a `ValidationError` at the
 *   boundary rather than silently writing outside the project.
 *
 * **`__dirname` removed.**
 *   Legacy `upgrade.js:69` uses `__dirname` to compute the default
 *   `packageRoot`. ESM/TS port: caller MUST pass `options.packageRoot`,
 *   defaulting to `process.cwd()` if absent. The CLI orchestrator
 *   computes the npm package root explicitly and passes it in.
 *
 * **Logging via injected callable.**
 *   Legacy uses `options.log || console.log`. We default to a no-op so
 *   that the library produces no stdout side-effects unless the caller
 *   opts in by passing a logger. CLI integration sets
 *   `log: console.log`.
 *
 * **Deferred from legacy** — no CLI entry block to skip (legacy had none
 * — the file is library-only, the CLI surface is in `bin/cli.js`).
 *
 * @see bin/lib/upgrade.js (legacy reference)
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.5.2
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  type ConfigConflict,
  mergeConfigs,
  readConfig,
  writeConfig,
  writeConflictsFile,
} from './config-merge.js';
import {
  detectUserModifications,
  diffManifest,
  generateManifest,
  getPackageVersion,
  type Manifest,
  type ManifestDiff,
  readFrameworkManifest,
  type UserModifications,
  writeFrameworkManifest,
} from './framework-manifest.js';
import { assertInsideRoot } from './path-safety.js';
import { archiveArtifacts } from './rewind.js';
import { redactSecrets } from './secret-scanner.js';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export interface UpgradeOptions {
  /** Path to the npm package root. Defaults to `process.cwd()` when
   *  omitted (ESM port — legacy used `__dirname`-relative which is
   *  unavailable in ESM). CLI orchestrator should pass this explicitly. */
  packageRoot?: string;
  /** Preview without writing. */
  dryRun?: boolean;
  /** Skip interactive confirmation. */
  yes?: boolean;
  /** Logging function — defaults to a no-op for library purity. */
  log?: (msg: string) => void;
  /** Confirmation function for interactive mode. Returns true to proceed. */
  confirm?: (prompt: string) => Promise<boolean>;
}

export interface UpgradeResult {
  success: boolean;
  message?: string;
  oldVersion?: string;
  newVersion?: string;
  filesUpdated?: number;
  filesAdded?: number;
  filesBackedUp?: number;
  filesSkipped?: number;
  backedUpFiles?: string[];
  conflicts?: string[];
  newConfigKeys?: string[];
}

export interface UpgradeBackup {
  file: string;
  metaFile: string;
  originalPath: string;
  archivedAt: string;
  fromVersion: string;
  toVersion: string;
  archivePath: string;
}

export interface RestoreOptions {
  version?: string;
  files?: string[];
  dryRun?: boolean;
  log?: (msg: string) => void;
}

export interface RestoredEntry {
  from: string;
  to: string;
}

export interface RestoreResult {
  success: boolean;
  restored: RestoredEntry[];
  skipped: string[];
}

interface ArchiveMeta {
  original_path?: string;
  archived_at?: string;
  reason?: string;
  archived_to?: string;
  operation?: string;
  from_version?: string;
  to_version?: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shape helpers
// ─────────────────────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Soft-fail load of an archive metadata file. Returns null on parse
 *  failure, scalar root, array root, or any prototype-pollution key. */
function safeParseMeta(raw: string): ArchiveMeta | null {
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
  return parsed as ArchiveMeta;
}

/** Write an archive metadata file. ADR-012: the `reason` field can
 *  carry user-supplied strings (e.g. "Framework upgrade from
 *  user-named-version to ..."), and downstream consumers may read
 *  this in audit contexts. Redact secrets before persistence. */
function writeMeta(metaPath: string, meta: ArchiveMeta): void {
  const redacted: ArchiveMeta = redactSecrets(meta);
  writeFileSync(metaPath, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** No-op default logger so the library produces no stdout side-effects
 *  when callers don't opt in. */
function noopLog(_msg: string): void {
  /* intentional no-op */
}

// ─────────────────────────────────────────────────────────────────────────
// Upgrade
// ─────────────────────────────────────────────────────────────────────────

/**
 * Perform a safe framework upgrade.
 *
 * Steps:
 *   A. Version check (skip if already current).
 *   B. Generate manifests + diff.
 *   C. Detect user modifications to framework files.
 *   D. Print summary + (optionally) prompt for confirmation.
 *   E. Backup user-modified files into `.jumpstart/archive/`.
 *   F. Copy framework files (added + safe-updates + post-backup conflicts).
 *   G. Three-way merge of `config.yaml`.
 *   H. Update framework manifest stamp.
 *   I. Report.
 */
export async function upgrade(
  projectRoot: string,
  options: UpgradeOptions = {}
): Promise<UpgradeResult> {
  // Default packageRoot to cwd in absence — legacy used `__dirname`
  // which ESM doesn't expose. Caller passes packageRoot explicitly when
  // running from CLI; tests pass a fixture dir.
  const packageRoot = options.packageRoot || process.cwd();
  const dryRun = options.dryRun || false;
  const yes = options.yes || false;
  const log = options.log || noopLog;

  // ── Step A: Version check ──────────────────────────────────────────
  const newVersion = getPackageVersion(packageRoot);
  const installedManifest = readFrameworkManifest(projectRoot);
  const oldVersion = installedManifest ? installedManifest.frameworkVersion : null;

  if (!existsSync(join(projectRoot, '.jumpstart'))) {
    return {
      success: false,
      message: 'No .jumpstart directory found. Run "npx jumpstart-mode" to install first.',
    };
  }

  if (oldVersion && oldVersion === newVersion) {
    log(`✓ Framework is already at version ${newVersion}. Nothing to upgrade.`);
    return {
      success: true,
      message: `Already at version ${newVersion}`,
      oldVersion,
      newVersion,
      filesUpdated: 0,
      filesAdded: 0,
      filesBackedUp: 0,
      filesSkipped: 0,
    };
  }

  // ── Step B: Generate manifests and diff ────────────────────────────
  const newManifest: Manifest = generateManifest(packageRoot, { version: newVersion });

  let diff: ManifestDiff;
  if (installedManifest) {
    diff = diffManifest(installedManifest, newManifest);
  } else {
    log('ℹ️  No framework manifest found. Creating initial manifest.');
    diff = {
      added: Object.keys(newManifest.files),
      removed: [],
      changed: [],
      unchanged: [],
    };
  }

  // ── Step C: Detect user modifications to framework files ───────────
  let userMods: UserModifications = { modified: [], unmodified: [], missing: [] };
  if (installedManifest) {
    userMods = detectUserModifications(projectRoot, installedManifest);
  }

  const conflictingFiles = diff.changed.filter((f) => userMods.modified.includes(f));
  const safeUpdates = diff.changed.filter((f) => !userMods.modified.includes(f));

  // ── Step D: Summary and confirmation ───────────────────────────────
  const versionLabel = oldVersion ? `${oldVersion} → ${newVersion}` : `(initial) → ${newVersion}`;

  log(`\n⬆️  Framework Upgrade: ${versionLabel}\n`);
  log(`   Files to add:     ${diff.added.length}`);
  log(`   Files to update:  ${safeUpdates.length}`);
  log(`   Files with user customizations: ${conflictingFiles.length}`);
  if (diff.removed.length > 0) {
    log(`   Files removed in new version: ${diff.removed.length}`);
  }
  log(`   Unchanged files:  ${diff.unchanged.length}`);

  if (conflictingFiles.length > 0) {
    log(`\n   ⚠️  These framework files have local modifications:`);
    for (const f of conflictingFiles) {
      log(`      ${f}`);
    }
    log('   They will be backed up to .jumpstart/archive/ before overwriting.');
  }

  if (dryRun) {
    log('\n   [DRY RUN — no files will be changed]\n');

    if (diff.added.length > 0) {
      log('   Would add:');
      for (const f of diff.added) log(`     + ${f}`);
    }
    if (safeUpdates.length > 0) {
      log('   Would update:');
      for (const f of safeUpdates) log(`     ~ ${f}`);
    }
    if (conflictingFiles.length > 0) {
      log('   Would backup & update:');
      for (const f of conflictingFiles) log(`     ⚠ ${f}`);
    }

    return {
      success: true,
      message: 'Dry run complete. No files changed.',
      oldVersion: oldVersion || '(none)',
      newVersion,
      filesUpdated: safeUpdates.length,
      filesAdded: diff.added.length,
      filesBackedUp: conflictingFiles.length,
      filesSkipped: diff.unchanged.length,
    };
  }

  if (!yes) {
    if (options.confirm) {
      const confirmed = await options.confirm(
        `Proceed with upgrade? (${diff.added.length} add, ${
          safeUpdates.length + conflictingFiles.length
        } update, ${conflictingFiles.length} backup)`
      );
      if (!confirmed) {
        log('\n❌ Upgrade cancelled.\n');
        return { success: false, message: 'Cancelled by user.' };
      }
    }
    // No confirm function and not --yes: proceed (CLI handles prompting).
  }

  // ── Step E: Backup user-modified framework files ───────────────────
  const backedUpFiles: string[] = [];
  if (conflictingFiles.length > 0) {
    log('\n📦 Backing up modified files...');
    const reason = `Framework upgrade from ${oldVersion || 'unknown'} to ${newVersion}`;
    const archiveResult = archiveArtifacts(conflictingFiles, reason, {
      root: projectRoot,
    });

    for (const a of archiveResult.archived) {
      log(`   📦 ${a.original} → ${basename(a.archived_to)}`);
      backedUpFiles.push(a.original);
    }

    // Update metadata to mark operation as 'upgrade'. ADR-012: redact
    // before re-write — the `reason` carries user-supplied content.
    for (const a of archiveResult.archived) {
      const metaPath = `${a.archived_to}.meta.json`;
      if (existsSync(metaPath)) {
        const meta = safeParseMeta(readFileSync(metaPath, 'utf8'));
        if (meta) {
          meta.operation = 'upgrade';
          meta.from_version = oldVersion || 'unknown';
          meta.to_version = newVersion;
          writeMeta(metaPath, meta);
        }
      }
    }
  }

  // ── Step F: Copy framework files ───────────────────────────────────
  log('\n📁 Updating framework files...');
  let updatedCount = 0;
  let addedCount = 0;

  const filesToCopy = [...diff.added, ...safeUpdates, ...conflictingFiles];

  for (const relPath of filesToCopy) {
    // Path-safety: every relPath must lexically resolve under
    // projectRoot. A maliciously-crafted manifest with
    // `'../../etc/passwd'` triggers ValidationError at the boundary,
    // before any fs write. Pit Crew M3 Adversary 3 in
    // framework-manifest.ts catches this earlier in `diffManifest` /
    // `detectUserModifications`, but defense-in-depth.
    assertInsideRoot(relPath, projectRoot, {
      schemaId: 'upgrade.relPath.dest',
    });
    assertInsideRoot(relPath, packageRoot, {
      schemaId: 'upgrade.relPath.src',
    });

    const srcPath = join(packageRoot, relPath);
    const destPath = join(projectRoot, relPath);

    if (!existsSync(srcPath)) continue;

    const destDir = dirname(destPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    copyFileSync(srcPath, destPath);

    if (diff.added.includes(relPath)) {
      addedCount++;
    } else {
      updatedCount++;
    }
  }

  log(`   ✓ ${addedCount} file(s) added, ${updatedCount} file(s) updated`);

  // ── Step G: Config merge ───────────────────────────────────────────
  log('\n⚙️  Merging config.yaml...');
  const configConflicts: string[] = [];
  const newConfigKeys: string[] = [];

  const userConfig = readConfig(projectRoot);
  const newDefaultConfig = readConfig(packageRoot);

  if (userConfig && newDefaultConfig) {
    const oldDefaultConfigPath = join(projectRoot, '.jumpstart', 'config.yaml.default');
    let oldDefaultConfig: string | null = null;

    if (existsSync(oldDefaultConfigPath)) {
      oldDefaultConfig = readFileSync(oldDefaultConfigPath, 'utf8');
    }

    if (oldDefaultConfig) {
      const mergeResult = mergeConfigs(oldDefaultConfig, newDefaultConfig, userConfig);
      writeConfig(projectRoot, mergeResult.mergedYaml);

      if (mergeResult.conflicts.length > 0) {
        writeConflictsFile(projectRoot, mergeResult.conflicts, oldVersion || 'unknown', newVersion);
        configConflicts.push(...mergeResult.conflicts.map((c: ConfigConflict) => c.key));
        log(
          `   ⚠️  ${mergeResult.conflicts.length} config conflict(s) — see .jumpstart/config.yaml.conflicts`
        );
      }

      if (mergeResult.newKeys.length > 0) {
        newConfigKeys.push(...mergeResult.newKeys);
        log(`   + ${mergeResult.newKeys.length} new config key(s) added`);
      }

      log('   ✓ Config merged (user values preserved)');
    } else {
      log('   ℹ️  No config baseline found. User config preserved as-is.');
      log('   ℹ️  Review new default at .jumpstart/config.yaml.new for new settings.');

      const newConfigPath = join(projectRoot, '.jumpstart', 'config.yaml.new');
      writeFileSync(newConfigPath, newDefaultConfig, 'utf8');
    }

    writeFileSync(join(projectRoot, '.jumpstart', 'config.yaml.default'), newDefaultConfig, 'utf8');
  } else if (!userConfig && newDefaultConfig) {
    writeConfig(projectRoot, newDefaultConfig);
    log('   ✓ Config created from default');
  } else {
    log('   ℹ️  No config changes needed');
  }

  // ── Step H: Update manifest ────────────────────────────────────────
  log('\n📝 Updating framework manifest...');
  const updatedManifest = generateManifest(projectRoot, { version: newVersion });
  writeFrameworkManifest(projectRoot, updatedManifest);
  log(`   ✓ Manifest stamped at version ${newVersion}`);

  // ── Step I: Report ─────────────────────────────────────────────────
  log(`\n✅ Upgrade complete! ${oldVersion || '(initial)'} → ${newVersion}\n`);

  if (backedUpFiles.length > 0) {
    log('   📦 Backed-up files (in .jumpstart/archive/):');
    for (const f of backedUpFiles) {
      log(`      ${f}`);
    }
    log('   Review and re-apply any customizations you want to keep.\n');
  }

  if (configConflicts.length > 0) {
    log('   ⚠️  Config conflicts require manual resolution:');
    log('   Edit .jumpstart/config.yaml and delete .jumpstart/config.yaml.conflicts\n');
  }

  return {
    success: true,
    oldVersion: oldVersion || '(none)',
    newVersion,
    filesUpdated: updatedCount,
    filesAdded: addedCount,
    filesBackedUp: backedUpFiles.length,
    filesSkipped: diff.unchanged.length,
    backedUpFiles,
    conflicts: configConflicts,
    newConfigKeys,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Backup listing
// ─────────────────────────────────────────────────────────────────────────

/**
 * List available upgrade backups under `.jumpstart/archive/`. Sorted
 * by `archived_at` descending (newest first). Soft-fails on individual
 * malformed `*.meta.json` files (skip rather than throw).
 */
export function listUpgradeBackups(projectRoot: string): UpgradeBackup[] {
  const archiveDir = join(projectRoot, '.jumpstart', 'archive');
  if (!existsSync(archiveDir)) return [];

  const entries = readdirSync(archiveDir).filter((f) => f.endsWith('.meta.json'));
  const backups: UpgradeBackup[] = [];

  for (const metaFile of entries) {
    const meta = safeParseMeta(readFileSync(join(archiveDir, metaFile), 'utf8'));
    if (!meta) continue;
    if (meta.operation !== 'upgrade') continue;
    const archivedFile = metaFile.replace('.meta.json', '');
    backups.push({
      file: archivedFile,
      metaFile,
      originalPath: meta.original_path ?? '',
      archivedAt: meta.archived_at ?? '',
      fromVersion: meta.from_version || 'unknown',
      toVersion: meta.to_version || 'unknown',
      archivePath: join(archiveDir, archivedFile),
    });
  }

  return backups.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

// ─────────────────────────────────────────────────────────────────────────
// Restore
// ─────────────────────────────────────────────────────────────────────────

/**
 * Restore files from upgrade backups. Optionally filtered by version
 * or specific original-path list. Returns counts + the restored / skipped
 * lists.
 *
 * Path-safety: every backup's recorded `originalPath` is asserted
 * inside `projectRoot` before restoration. A maliciously-crafted
 * `*.meta.json` (filesystem corruption or attacker influence) cannot
 * smuggle a restore-write outside the project boundary.
 */
export function restore(projectRoot: string, options: RestoreOptions = {}): RestoreResult {
  const dryRun = options.dryRun || false;
  const log = options.log || noopLog;

  const backups = listUpgradeBackups(projectRoot);
  if (backups.length === 0) {
    log('ℹ️  No upgrade backups found.');
    return { success: true, restored: [], skipped: [] };
  }

  let filtered = backups;
  if (options.version) {
    filtered = backups.filter(
      (b) => b.fromVersion === options.version || b.toVersion === options.version
    );
  }

  if (options.files && options.files.length > 0) {
    const wantFiles = options.files;
    filtered = filtered.filter((b) => wantFiles.includes(b.originalPath));
  }

  if (filtered.length === 0) {
    log('ℹ️  No matching backups found for the specified criteria.');
    return { success: true, restored: [], skipped: [] };
  }

  log(`\n🔄 Restoring ${filtered.length} file(s) from upgrade backup...\n`);

  const restored: RestoredEntry[] = [];
  const skipped: string[] = [];

  for (const backup of filtered) {
    if (!existsSync(backup.archivePath)) {
      skipped.push(backup.originalPath);
      log(`   ⊘ Archive file not found: ${backup.file}`);
      continue;
    }

    // Path-safety: assert the recorded originalPath resolves inside
    // projectRoot before the copy. Defense against a corrupt or
    // attacker-influenced meta.json that records `'../../etc/passwd'`.
    try {
      assertInsideRoot(backup.originalPath, projectRoot, {
        schemaId: 'restore.originalPath',
      });
    } catch (err) {
      skipped.push(backup.originalPath);
      log(
        `   ⊘ Skipping ${backup.file} — recorded original path "${backup.originalPath}" rejected (${(err as Error).message})`
      );
      continue;
    }

    const destPath = join(projectRoot, backup.originalPath);

    if (dryRun) {
      log(`   Would restore: ${backup.originalPath}`);
      restored.push({ from: backup.file, to: backup.originalPath });
      continue;
    }

    const destDir = dirname(destPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    copyFileSync(backup.archivePath, destPath);
    restored.push({ from: backup.file, to: backup.originalPath });
    log(`   ✓ ${backup.originalPath} (from ${backup.file})`);
  }

  if (!dryRun && restored.length > 0) {
    const manifest = readFrameworkManifest(projectRoot);
    if (manifest) {
      const updated = generateManifest(projectRoot, { version: manifest.frameworkVersion });
      writeFrameworkManifest(projectRoot, updated);
    }
  }

  log(`\n✓ Restored ${restored.length} file(s), skipped ${skipped.length}.\n`);

  return { success: true, restored, skipped };
}
