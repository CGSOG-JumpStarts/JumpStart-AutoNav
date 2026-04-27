/**
 * versioning.ts — git-tag-driven spec versioning (T4.1.6 port).
 *
 * Pure-library port of `bin/lib/versioning.js` (5 exports preserved
 * verbatim by name + signature). The git tag scheme `spec/<artifact>/vX.Y.Z`
 * is preserved exactly, as is the "auto-bump minor on tag" semver
 * heuristic and the spec-file frontmatter injection logic.
 *
 * **Security improvement** (the only behavior change vs legacy):
 *   - Legacy `bin/lib/versioning.js` interpolated user-controlled
 *     `artifactName`, `version`, and `message` into a shell command
 *     string via `child_process.execSync` with backtick templates.
 *     A malicious tag-message containing `"; rm -rf ~"` would run on
 *     the user's shell.
 *   - The port uses the array-args form of `child_process.execFileSync`
 *     so arguments pass to git directly without shell interpretation.
 *     Result-shape is byte-identical for legitimate inputs; malicious
 *     inputs that would have shelled out under legacy now reach git
 *     as literal strings (rejected by git's own validation).
 *
 * Per ADR-005 the legacy `bin/lib/versioning.js` stays in place during
 * the strangler window. A caller migrating to `import from '@lib/versioning'`
 * picks up the safer execution path.
 *
 * @see bin/lib/versioning.js (legacy reference)
 * @see specs/decisions/adr-005-module-layout.md
 * @see specs/decisions/adr-009-ipc-stdin-path-traversal.md
 * @see specs/implementation-plan.md T4.1.6
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Result of `createVersionTag`. */
export interface CreateTagResult {
  success: boolean;
  tag: string;
  error?: string;
}

/** A single entry returned by `listVersions`. */
export interface VersionEntry {
  artifact: string;
  version: string;
  tag: string;
}

/**
 * Build the canonical tag string for an artifact + version.
 * Format: `spec/<artifactName>/v<version>` — matches legacy verbatim.
 */
export function generateTag(artifactName: string, version: string): string {
  return `spec/${artifactName}/v${version}`;
}

/**
 * Determine the next semver-minor for `artifactName`. Lists existing
 * `spec/<artifactName>/v*` tags, picks the highest, increments
 * `minor`. Returns `'1.0.0'` when no prior tags exist or when git is
 * unavailable.
 *
 * Behavior parity: identical sort key + identical fallback-to-1.0.0
 * branches as the legacy module.
 */
export function getNextVersion(artifactName: string, cwd?: string): string {
  const workDir = cwd || process.cwd();

  try {
    const tags = execFileSync('git', ['tag', '-l', `spec/${artifactName}/v*`], {
      cwd: workDir,
      encoding: 'utf8',
    }).trim();

    if (!tags) return '1.0.0';

    const versions = tags
      .split('\n')
      .map((tag) => tag.replace(`spec/${artifactName}/v`, ''))
      .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
      .map((v) => v.split('.').map(Number))
      .sort((a, b) => {
        for (let i = 0; i < 3; i++) {
          if (a[i] !== b[i]) return b[i] - a[i];
        }
        return 0;
      });

    if (versions.length === 0) return '1.0.0';

    const latest = versions[0];
    return `${latest[0]}.${latest[1] + 1}.0`;
  } catch {
    return '1.0.0';
  }
}

/**
 * Create a git tag for the approved artifact. Uses the array-args form
 * so user-controlled `artifactName` / `version` / `message` cannot
 * escape into shell context (security improvement vs legacy).
 */
export function createVersionTag(
  artifactName: string,
  version: string,
  message?: string,
  cwd?: string
): CreateTagResult {
  const workDir = cwd || process.cwd();
  const tag = generateTag(artifactName, version);
  const tagMessage = message || `Approved: ${artifactName} v${version}`;

  try {
    execFileSync('git', ['tag', '-a', tag, '-m', tagMessage], {
      cwd: workDir,
      encoding: 'utf8',
    });
    return { success: true, tag };
  } catch (err) {
    return { success: false, tag, error: (err as Error).message };
  }
}

/**
 * Inject `version: "<version>"` into the spec file's YAML frontmatter
 * AND update any `**Version:**` header line in the body. Returns
 * `false` if the file does not exist; returns `true` after a successful
 * write even if no fields actually changed (legacy semantics — the
 * function is idempotent and the boolean tracks "found and processed",
 * not "modified").
 */
export function injectVersion(filePath: string, version: string): boolean {
  if (!existsSync(filePath)) return false;

  let content = readFileSync(filePath, 'utf8');

  if (content.startsWith('---\n')) {
    const endIdx = content.indexOf('\n---', 4);
    if (endIdx !== -1) {
      let frontmatter = content.substring(4, endIdx);
      if (frontmatter.includes('version:')) {
        frontmatter = frontmatter.replace(/version:\s*.+/, `version: "${version}"`);
      } else {
        frontmatter += `\nversion: "${version}"`;
      }
      content = `---\n${frontmatter}${content.substring(endIdx)}`;
    }
  }

  const versionPattern = /(\*\*Version:\*\*\s*).*/;
  if (versionPattern.test(content)) {
    content = content.replace(versionPattern, `$1${version}`);
  }

  writeFileSync(filePath, content, 'utf8');
  return true;
}

/**
 * Enumerate every `spec/*` git tag in the working tree. Returns an
 * empty array when no tags exist or when git is unavailable.
 */
export function listVersions(cwd?: string): VersionEntry[] {
  const workDir = cwd || process.cwd();

  try {
    const tags = execFileSync('git', ['tag', '-l', 'spec/*'], {
      cwd: workDir,
      encoding: 'utf8',
    }).trim();

    if (!tags) return [];

    return tags
      .split('\n')
      .map((tag): VersionEntry | null => {
        const match = tag.match(/^spec\/(.+)\/v(.+)$/);
        if (match) {
          return { artifact: match[1], version: match[2], tag };
        }
        return null;
      })
      .filter((entry): entry is VersionEntry => entry !== null);
  } catch {
    return [];
  }
}
