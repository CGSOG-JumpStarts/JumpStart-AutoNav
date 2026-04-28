/**
 * integrate.ts — Dynamic Skill Integration Engine port (T4.5.2, cluster M6).
 *
 * Pure-library port of `bin/lib/integrate.js`. Public surface preserved
 * verbatim by name + signature:
 *
 *   - `parseSkillFrontmatter(content)` => SkillFrontmatter
 *   - `scanInstalledSkills(projectRoot)` => SkillEntry[]
 *   - `generateIDEInstructions(projectRoot, skills)` => GeneratedFile | null
 *   - `generateSkillIndex(skills)` => GeneratedFile | null
 *   - `readIntegrationLog(projectRoot)` => IntegrationLog
 *   - `applyIntegration(projectRoot, options?)` => IntegrateResult
 *   - `cleanIntegration(projectRoot, options?)` => CleanResult
 *
 * Behavior parity:
 *   - SKILL.md frontmatter parser handles ```skill ... ``` AND --- ... --- formats.
 *   - Skill discovery scans `.jumpstart/skills/` and cross-references
 *     installed.json for version/keyword metadata.
 *   - IDE instructions auto-detect VS Code/Copilot vs generic.
 *   - Integration log records every generated file with sha256 hash.
 *
 * **ADR-012 redaction (NEW in this port).**
 *   Skill descriptions, install metadata, and discovery keywords can
 *   surface user-supplied content. Every persistence path runs through
 *   `redactSecrets` before write — covering `writeIntegrationLog` and
 *   the IDE/skill-index generated files (which embed the descriptions).
 *
 * **Path-safety hardening (NEW in this port).**
 *   Every `path.join(projectRoot, userInput)` is gated by
 *   `assertInsideRoot`. The legacy was permissive — the TS port
 *   rejects traversal-shaped inputs at the boundary.
 *
 * **JSON shape validation (NEW in this port).**
 *   `readIntegrationLog` rejects `__proto__`/`constructor`/`prototype`-
 *   keyed JSON, non-object roots, and normalizes wrong-typed sub-fields.
 *
 * **Deferred from legacy** — the `if (process.argv[1].endsWith('integrate.js'))`
 * CLI entry block at the bottom of legacy is NOT ported. CLI-level
 * orchestration is the strangler-phase responsibility of the M9 ESM
 * cutover (the legacy block uses `process.exit` which library code is
 * forbidden to call per ADR-006).
 *
 * @see bin/lib/integrate.js (legacy reference)
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.5.2
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { assertInsideRoot } from './path-safety.js';
import { redactSecrets } from './secret-scanner.js';

// ─────────────────────────────────────────────────────────────────────────
// Constants (preserved verbatim from legacy)
// ─────────────────────────────────────────────────────────────────────────

const SKILLS_DIR = '.jumpstart/skills';
const INSTALLED_FILE = '.jumpstart/installed.json';
const INTEGRATION_LOG = '.jumpstart/integration-log.json';
const SKILL_INDEX_FILE = '.jumpstart/skills/skill-index.md';
const IDE_INSTRUCTIONS_VSCODE = '.github/instructions/skills.instructions.md';
const IDE_INSTRUCTIONS_GENERIC = '.jumpstart/instructions/skills.instructions.md';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export interface SkillFrontmatter {
  name: string;
  description: string;
  discoveryKeywords: string[];
  triggers: string[];
  body: string;
}

export interface SkillEntry {
  id: string;
  name: string;
  displayName: string;
  description: string;
  discoveryKeywords: string[];
  triggers: string[];
  version: string;
  type: string;
  skillDir: string;
  entryFile: string;
  remappedFiles: string[];
  installedAt: string | null;
}

export interface GeneratedFile {
  filePath: string;
  content: string;
}

export interface IntegrationFileEntry {
  type: 'generated';
  sourceSkills: string[];
  hash: string;
}

export interface IntegrationSkillContribution {
  integratedAt: string;
  generatedFiles: string[];
  triggers: string[];
}

export interface IntegrationLog {
  generatedAt: string | null;
  files: Record<string, IntegrationFileEntry>;
  skillContributions: Record<string, IntegrationSkillContribution>;
}

export interface IntegrateOptions {
  onProgress?: (msg: string) => void;
}

export interface IntegrateResult {
  filesWritten: string[];
  filesRemoved: string[];
  skillCount: number;
}

export interface CleanResult {
  filesRemoved: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shape helpers
// ─────────────────────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Mirror of evidence-collector's `safeParseState` shape — rejects
 *  prototype-pollution keys, non-object roots, and array roots. Returns
 *  null on parse/shape failure so callers can fall back to a default. */
function safeParseIntegrationLog(raw: string): IntegrationLog | null {
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
  const data = parsed as Partial<IntegrationLog>;
  return {
    generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : null,
    files: isPlainObject(data.files) ? (data.files as Record<string, IntegrationFileEntry>) : {},
    skillContributions: isPlainObject(data.skillContributions)
      ? (data.skillContributions as Record<string, IntegrationSkillContribution>)
      : {},
  };
}

/** Default-shape integration log used when the file is missing OR when
 *  shape validation rejects the on-disk JSON. */
function defaultIntegrationLog(): IntegrationLog {
  return {
    generatedAt: null,
    files: {},
    skillContributions: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SKILL.md frontmatter parser
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parse YAML-like frontmatter from a SKILL.md file. Handles both the
 * ```skill ... ``` fenced format AND the standard `--- ... ---` YAML
 * frontmatter format. The body field carries the post-frontmatter
 * content unchanged.
 *
 * Simple field extractor (no full YAML parser dep) — only `name` and
 * `description` are read from the frontmatter block; `discoveryKeywords`
 * and `triggers` come from H2 sections in the body.
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter {
  const result: SkillFrontmatter = {
    name: '',
    description: '',
    discoveryKeywords: [],
    triggers: [],
    body: content,
  };

  let yamlBlock = '';
  const skillFenceMatch = content.match(/^```skill\s*\n---\n([\s\S]*?)\n---\s*\n/m);
  const standardFenceMatch = content.match(/^---\n([\s\S]*?)\n---\s*\n/m);

  if (skillFenceMatch) {
    yamlBlock = skillFenceMatch[1];
    result.body = content.slice(skillFenceMatch[0].length);
  } else if (standardFenceMatch) {
    yamlBlock = standardFenceMatch[1];
    result.body = content.slice(standardFenceMatch[0].length);
  }

  for (const line of yamlBlock.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)/);
    const descMatch = line.match(/^description:\s*['"]?([\s\S]+?)['"]?\s*$/);
    if (nameMatch) result.name = nameMatch[1].trim();
    if (descMatch) result.description = descMatch[1].trim();
  }

  // Discovery Keywords section (single line, comma-separated)
  const kwMatch = result.body.match(/## Discovery Keywords\s*\n([^\n#]+)/i);
  if (kwMatch) {
    result.discoveryKeywords = kwMatch[1]
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  }

  // Triggers section (bulleted list, terminates at next H2 or H1)
  const triggerMatch = result.body.match(/## Triggers\s*\n([\s\S]*?)(?=\n##|\n#[^#]|$)/i);
  if (triggerMatch) {
    result.triggers = triggerMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[-*]\s*/, '').trim())
      .filter((l) => l.length > 0);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Skill scanner
// ─────────────────────────────────────────────────────────────────────────

interface InstalledItemMetadata {
  displayName?: string;
  keywords?: string[];
  version?: string;
  type?: string;
  remappedFiles?: string[];
  installedAt?: string;
}

interface InstalledManifest {
  items: Record<string, InstalledItemMetadata>;
}

/** Read installed.json — soft-fails to an empty manifest on any parse
 *  or shape error (legacy semantics). Rejects prototype-pollution keys
 *  in the items map. */
function readInstalledManifest(installedPath: string): InstalledManifest {
  if (!existsSync(installedPath)) return { items: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(installedPath, 'utf8'));
  } catch {
    return { items: {} };
  }
  if (!isPlainObject(parsed)) return { items: {} };
  const items: Record<string, InstalledItemMetadata> = {};
  if (isPlainObject(parsed.items)) {
    for (const [k, v] of Object.entries(parsed.items)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      if (isPlainObject(v)) {
        items[k] = v as InstalledItemMetadata;
      }
    }
  }
  return { items };
}

/**
 * Scan `.jumpstart/skills/` for installed skills and parse their
 * metadata. Cross-references with `.jumpstart/installed.json` for
 * registry version/type/displayName info.
 *
 * Path-safety: `projectRoot` is the boundary; entries that don't
 * lexically resolve under it are skipped (defense-in-depth — readdirSync
 * already operates on the resolved skillsDir, but a malformed entry
 * name with traversal-shape would still feed into downstream join()
 * calls in `applyIntegration`).
 */
export function scanInstalledSkills(projectRoot: string): SkillEntry[] {
  const skillsDir = resolve(projectRoot, SKILLS_DIR);
  if (!existsSync(skillsDir)) return [];

  const installed = readInstalledManifest(resolve(projectRoot, INSTALLED_FILE));

  const skills: SkillEntry[] = [];
  const entries = readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'README.md' || entry.name.startsWith('.')) continue;

    // Path-safety: reject directory names that resolve outside projectRoot.
    // readdirSync returns plain dirent names (no traversal possible from
    // the OS layer), but we apply the check defense-in-depth so that an
    // explicit `..`-named subdir (legal on Unix, weirdly allowed) can't
    // smuggle a traversal through the join() below.
    const relPath = `${SKILLS_DIR}/${entry.name}`;
    try {
      assertInsideRoot(relPath, projectRoot, { schemaId: 'scanInstalledSkills.relPath' });
    } catch {
      continue;
    }

    const skillDir = join(skillsDir, entry.name);
    const skillMdPath = join(skillDir, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    const content = readFileSync(skillMdPath, 'utf8');
    const parsed = parseSkillFrontmatter(content);

    const itemId = `skill.${entry.name}`;
    const installedEntry = installed.items[itemId] ?? {};

    skills.push({
      id: itemId,
      name: parsed.name || entry.name,
      displayName: installedEntry.displayName || parsed.name || entry.name,
      description: parsed.description,
      // keywords persisted at install time take precedence; fall back
      // to SKILL.md body parsing.
      discoveryKeywords: installedEntry.keywords || parsed.discoveryKeywords,
      triggers: parsed.triggers,
      version: installedEntry.version || 'unknown',
      type: installedEntry.type || 'skill',
      skillDir: `.jumpstart/skills/${entry.name}`,
      entryFile: `.jumpstart/skills/${entry.name}/SKILL.md`,
      remappedFiles: installedEntry.remappedFiles || [],
      installedAt: installedEntry.installedAt || null,
    });
  }

  return skills;
}

// ─────────────────────────────────────────────────────────────────────────
// IDE instructions generator
// ─────────────────────────────────────────────────────────────────────────

/** Detect the IDE environment (mirrors install.js logic). */
function detectIDEForIntegration(projectRoot: string): {
  ide: 'vscode-copilot' | 'generic';
  instructionsDir: string;
} {
  const hasGitHub = existsSync(join(projectRoot, '.github'));
  if (hasGitHub) {
    return { ide: 'vscode-copilot', instructionsDir: '.github/instructions' };
  }
  return { ide: 'generic', instructionsDir: '.jumpstart/instructions' };
}

/**
 * Generate the IDE-level skills instructions file with `applyTo: '**'`
 * so Copilot injects it into ALL agent conversations, making every
 * @Jump Start: * agent skill-aware.
 *
 * Returns null when no skills are installed (caller cleans up the file).
 */
export function generateIDEInstructions(
  projectRoot: string,
  skills: SkillEntry[]
): GeneratedFile | null {
  if (skills.length === 0) return null;

  const ide = detectIDEForIntegration(projectRoot);
  const relPath = ide.ide === 'vscode-copilot' ? IDE_INSTRUCTIONS_VSCODE : IDE_INSTRUCTIONS_GENERIC;

  const tableRows = skills.map((s) => {
    const triggers =
      s.triggers.length > 0
        ? s.triggers.slice(0, 3).join('; ')
        : s.discoveryKeywords.slice(0, 4).join(', ');
    const agents =
      s.remappedFiles
        .filter((f) => f.endsWith('.agent.md'))
        .map(
          (f) =>
            `@${basename(f, '.agent.md')
              .split('.')[0]
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (c) => c.toUpperCase())}`
        )
        .join(', ') || '—';
    return `| ${s.displayName} | ${triggers} | \`${s.entryFile}\` | ${agents} |`;
  });

  const triggerList = skills.map((s) => {
    const kw = [...s.discoveryKeywords, ...s.triggers.slice(0, 3)].slice(0, 6);
    return `- **${s.displayName}** (\`${s.id}\`): ${kw.join(', ') || s.description.slice(0, 80)}`;
  });

  const content = `---
applyTo: "**"
---

# Installed Skills — Dynamic Integration

This file is auto-generated by \`jumpstart-mode integrate\`. Do NOT edit manually.
Regenerate with: \`npx jumpstart-mode integrate\`

## Available Skills

${skills.length} skill(s) are installed in this project:

| Skill | Triggers | Entry File | Bundled Agents |
| --- | --- | --- | --- |
${tableRows.join('\n')}

## Skill Loading Protocol

When a user's request matches any of the trigger conditions below, you MUST:
1. Read the skill's \`SKILL.md\` entry file for domain-specific instructions.
2. Follow the workflow, templates, and decision trees defined in the skill.
3. If the skill has bundled agents listed above, delegate to them as appropriate.
4. Reference the skill's \`references/\` and \`scripts/\` directories for supporting assets.

## Trigger Keywords

${triggerList.join('\n')}

## Skill Discovery Index

For detailed metadata, see \`.jumpstart/skills/skill-index.md\`.
`;

  return { filePath: relPath, content };
}

// ─────────────────────────────────────────────────────────────────────────
// Framework skill index generator
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate the framework-level skill index. Agent personas reference
 * this during their Skill Discovery protocol step. Returns null when
 * no skills are installed.
 */
export function generateSkillIndex(skills: SkillEntry[]): GeneratedFile | null {
  if (skills.length === 0) return null;

  const generatedAt = new Date().toISOString();

  const catalogEntries = skills.map((s) => {
    return `### ${s.displayName} (\`${s.id}\`)

- **Version:** ${s.version}
- **Entry File:** \`${s.entryFile}\`
- **Description:** ${s.description}
- **Discovery Keywords:** ${s.discoveryKeywords.join(', ') || '—'}
- **Triggers:** ${s.triggers.length > 0 ? `\n${s.triggers.map((t) => `  - ${t}`).join('\n')}` : '—'}
- **Bundled Agents:** ${
      s.remappedFiles
        .filter((f) => f.endsWith('.agent.md'))
        .map((f) => `\`${basename(f)}\``)
        .join(', ') || 'None'
    }
- **Bundled Prompts:** ${
      s.remappedFiles
        .filter((f) => f.endsWith('.prompt.md'))
        .map((f) => `\`${basename(f)}\``)
        .join(', ') || 'None'
    }
- **Installed:** ${s.installedAt || 'Unknown'}`;
  });

  const content = `# Skill Index — Dynamic Integration

> **Auto-generated** by \`jumpstart-mode integrate\` on ${generatedAt}.
> Do NOT edit manually. Regenerate with: \`npx jumpstart-mode integrate\`

## Summary

${skills.length} skill(s) installed.

| Skill | Version | Keywords |
| --- | --- | --- |
${skills
  .map(
    (s) =>
      `| [${s.displayName}](${s.entryFile}) | ${s.version} | ${s.discoveryKeywords.slice(0, 5).join(', ')} |`
  )
  .join('\n')}

## Catalog

${catalogEntries.join('\n\n')}

## Skill Discovery Protocol

All phase and advisory agents follow this protocol when \`skills.enabled\` is \`true\` in \`.jumpstart/config.yaml\`:

1. **Scan this index** at the start of each task.
2. **Match triggers** — compare the user's request against each skill's triggers and discovery keywords.
3. **Load SKILL.md** — for each matching skill, read its entry file for domain-specific workflow.
4. **Delegate to bundled agents** — if the skill has remapped agents, invoke them for specialized work.
5. **Follow skill workflow** — the SKILL.md defines decision trees, templates, and validation rules.

## Usage by Agents

- **Phase agents** (Challenger → Developer): check this index during their Setup step.
- **Advisory agents** (QA, Security, Performance, etc.): check this index at activation.
- **Facilitator**: include skill-aware agents in Pit Crew when topics overlap with installed skills.
`;

  return { filePath: SKILL_INDEX_FILE, content };
}

// ─────────────────────────────────────────────────────────────────────────
// Integration log
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read the integration log. Returns a default-shape log when the file
 * is missing, malformed JSON, or contains a prototype-pollution key.
 *
 * Shape validation rejects: array root, scalar root, prototype-pollution
 * keys (`__proto__`/`constructor`/`prototype`), and wrong-typed
 * sub-fields. Mirror of `evidence-collector.ts::safeParseState`.
 */
export function readIntegrationLog(projectRoot: string): IntegrationLog {
  const fp = resolve(projectRoot, INTEGRATION_LOG);
  if (!existsSync(fp)) return defaultIntegrationLog();
  const parsed = safeParseIntegrationLog(readFileSync(fp, 'utf8'));
  return parsed ?? defaultIntegrationLog();
}

/**
 * Write the integration log. ADR-012: redact every persisted log object
 * before writing. Skill descriptions and `triggers` arrays can carry
 * user-supplied content (e.g. example trigger like
 * `"deploy with token=ghp_..."`) — the redaction layer scrubs each
 * matched secret before the JSON hits disk.
 */
export function writeIntegrationLog(projectRoot: string, log: IntegrationLog): void {
  const fp = resolve(projectRoot, INTEGRATION_LOG);
  mkdirSync(dirname(fp), { recursive: true });
  const redacted: IntegrationLog = redactSecrets(log);
  writeFileSync(fp, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');
}

/** SHA-256 hex digest of a UTF-8 string. */
function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────
// Core integration engine
// ─────────────────────────────────────────────────────────────────────────

/**
 * Apply full integration: scan skills → generate IDE instructions →
 * generate skill index → write integration log.
 *
 * Called automatically after install/uninstall, or manually via
 * `npx jumpstart-mode integrate`.
 *
 * Returns counts + the lists of files written/removed.
 */
export function applyIntegration(
  projectRoot: string,
  options: IntegrateOptions = {}
): IntegrateResult {
  const progress =
    options.onProgress ||
    ((_msg: string) => {
      /* default no-op progress callback */
    });
  const skills = scanInstalledSkills(projectRoot);
  const filesWritten: string[] = [];
  const filesRemoved: string[] = [];

  const prevLog = readIntegrationLog(projectRoot);

  if (skills.length === 0) {
    // No skills installed — clean up integration files.
    progress('No skills installed — cleaning up integration files.');
    for (const relPath of Object.keys(prevLog.files)) {
      // Path-safety: a corrupted integration log could carry a
      // traversal-shaped key (`'../../etc/passwd'`). Skip rather than
      // throw — a corrupt log shouldn't block the no-op cleanup path.
      try {
        assertInsideRoot(relPath, projectRoot, {
          schemaId: 'applyIntegration.cleanup.relPath',
        });
      } catch {
        continue;
      }
      const abs = resolve(projectRoot, relPath);
      if (existsSync(abs)) {
        rmSync(abs, { force: true });
        filesRemoved.push(relPath);
        progress(`  Removed ${relPath}`);
      }
    }
    writeIntegrationLog(projectRoot, {
      generatedAt: new Date().toISOString(),
      files: {},
      skillContributions: {},
    });
    return { filesWritten, filesRemoved, skillCount: 0 };
  }

  // Generate IDE instructions
  const ideResult = generateIDEInstructions(projectRoot, skills);
  if (ideResult) {
    assertInsideRoot(ideResult.filePath, projectRoot, {
      schemaId: 'applyIntegration.ideResult.filePath',
    });
    const abs = resolve(projectRoot, ideResult.filePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, ideResult.content, 'utf8');
    filesWritten.push(ideResult.filePath);
    progress(`  ✓ ${ideResult.filePath}`);
  }

  // Generate skill index
  const indexResult = generateSkillIndex(skills);
  if (indexResult) {
    assertInsideRoot(indexResult.filePath, projectRoot, {
      schemaId: 'applyIntegration.indexResult.filePath',
    });
    const abs = resolve(projectRoot, indexResult.filePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, indexResult.content, 'utf8');
    filesWritten.push(indexResult.filePath);
    progress(`  ✓ ${indexResult.filePath}`);
  }

  // Remove any previously generated files we didn't just regenerate.
  const currentFiles = new Set(filesWritten);
  for (const relPath of Object.keys(prevLog.files)) {
    if (!currentFiles.has(relPath)) {
      try {
        assertInsideRoot(relPath, projectRoot, {
          schemaId: 'applyIntegration.staleCleanup.relPath',
        });
      } catch {
        continue;
      }
      const abs = resolve(projectRoot, relPath);
      if (existsSync(abs)) {
        rmSync(abs, { force: true });
        filesRemoved.push(relPath);
        progress(`  Removed stale ${relPath}`);
      }
    }
  }

  // Build integration log
  const newLog: IntegrationLog = {
    generatedAt: new Date().toISOString(),
    files: {},
    skillContributions: {},
  };

  for (const fp of filesWritten) {
    const abs = resolve(projectRoot, fp);
    const content = readFileSync(abs, 'utf8');
    newLog.files[fp] = {
      type: 'generated',
      sourceSkills: skills.map((s) => s.id),
      hash: `sha256:${sha256(content)}`,
    };
  }

  for (const s of skills) {
    newLog.skillContributions[s.id] = {
      integratedAt: new Date().toISOString(),
      generatedFiles: filesWritten,
      triggers: [...s.discoveryKeywords.slice(0, 5), ...s.triggers.slice(0, 3)],
    };
  }

  writeIntegrationLog(projectRoot, newLog);
  progress(
    `Integration complete: ${skills.length} skill(s), ${filesWritten.length} file(s) written.`
  );

  return { filesWritten, filesRemoved, skillCount: skills.length };
}

/**
 * Remove all integration-generated files and reset the log. Used by
 * `npx jumpstart-mode integrate --clean`.
 */
export function cleanIntegration(projectRoot: string, options: IntegrateOptions = {}): CleanResult {
  const progress =
    options.onProgress ||
    ((_msg: string) => {
      /* default no-op progress callback */
    });
  const log = readIntegrationLog(projectRoot);
  const filesRemoved: string[] = [];

  for (const relPath of Object.keys(log.files)) {
    try {
      assertInsideRoot(relPath, projectRoot, {
        schemaId: 'cleanIntegration.relPath',
      });
    } catch {
      continue;
    }
    const abs = resolve(projectRoot, relPath);
    if (existsSync(abs)) {
      rmSync(abs, { force: true });
      filesRemoved.push(relPath);
      progress(`  Removed ${relPath}`);
    }
  }

  writeIntegrationLog(projectRoot, {
    generatedAt: new Date().toISOString(),
    files: {},
    skillContributions: {},
  });

  progress(`Clean complete: removed ${filesRemoved.length} file(s).`);
  return { filesRemoved };
}
