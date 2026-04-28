/**
 * test-install.test.ts — T4.5.1 marketplace installer port tests.
 *
 * Coverage for `bin/lib-ts/install.ts`:
 *   - IDE detection (vscode-copilot vs generic)
 *   - normalizeItemId (3 forms: dotted, type+name, single)
 *   - findItem / findItemByName / searchItems
 *   - checkCompatibility (semver range matching)
 *   - compareSemver
 *   - readInstalled / writeInstalled round-trip + redaction (ADR-012)
 *   - readInstalled shape validation (rejects __proto__, string root, array root)
 *   - resolveTargetPaths (default vs explicit install.targetPaths)
 *   - resolveDependencies topological order + cycle detection
 *   - getStatus / uninstallItem / checkUpdates
 *   - ZIP reader: ADR-010 zipslip enforcement on 5 fixture archives
 *
 * @see bin/lib-ts/install.ts
 * @see specs/decisions/adr-010-marketplace-zipslip-prevention.md
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../bin/lib-ts/errors.js';
import type { RegistryIndex } from '../bin/lib-ts/install.js';
import {
  checkCompatibility,
  checkUpdates,
  compareSemver,
  detectIDE,
  findItem,
  findItemByName,
  getStatus,
  isInstalled,
  normalizeItemId,
  readInstalled,
  resolveDependencies,
  resolveTargetPaths,
  searchItems,
  uninstallItem,
  writeInstalled,
} from '../bin/lib-ts/install.js';

// Type-narrowing helpers — the install module is in transit so we re-import
// the private extractor by reading the file. Instead of cracking it open
// we drive ZIP behavior through the public surface where possible. The
// extractor is exercised end-to-end by the fixture-based tests further
// down via a private path that re-imports the module dynamically.

// ─────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────

const MOCK_INDEX: RegistryIndex = {
  version: '2026-02-21',
  items: [
    {
      id: 'skill.ignition',
      type: 'skill',
      displayName: 'Ignition',
      version: '1.0.0',
      category: 'presentations',
      tags: ['pptx', 'slides'],
      keywords: ['presentation', 'deck'],
      searchText: 'Use when any PPTX file needs to be created.',
      install: { targetPaths: ['.jumpstart/skills/ignition'] },
      dependencies: ['skill.agent-customization'],
      contains: {
        agents: ['.github/agents/deck-builder.agent.md'],
        prompts: ['.github/prompts/create-presentation.prompt.md'],
      },
      compatibility: { jumpstartMode: '>=0.9.0' },
      download: {
        zip: 'https://example.com/ignition-1.0.0.zip',
        checksumSha256: 'abc123',
      },
    },
    {
      id: 'skill.agent-customization',
      type: 'skill',
      displayName: 'Agent Customization',
      version: '1.0.0',
      category: 'meta',
      tags: ['agent', 'customization'],
      install: { targetPaths: ['.jumpstart/skills/agent-customization'] },
      dependencies: [],
      download: {
        zip: 'https://example.com/agent-customization-1.0.0.zip',
        checksumSha256: 'def456',
      },
    },
    {
      id: 'agent.deck-builder',
      type: 'agent',
      displayName: 'Deck Builder',
      version: '1.0.0',
      category: 'presentations',
      tags: ['orchestrator', 'pptx'],
      install: { targetPaths: ['.jumpstart/agents/deck-builder'] },
      dependencies: ['skill.ignition'],
      download: {
        zip: 'https://example.com/deck-builder-1.0.0.zip',
        checksumSha256: 'ghi789',
      },
    },
    {
      id: 'prompt.create-presentation',
      type: 'prompt',
      displayName: 'Create Presentation',
      version: '1.0.0',
      category: 'presentations',
      tags: ['pptx', 'slides'],
      install: { targetPaths: ['.jumpstart/prompts/create-presentation'] },
      dependencies: [],
      download: {
        zip: 'https://example.com/create-presentation-1.0.0.zip',
        checksumSha256: 'jkl012',
      },
    },
    {
      id: 'bundle.ignition-suite',
      type: 'bundle',
      displayName: 'Ignition Presentation Suite',
      version: '1.0.0',
      category: 'presentations',
      tags: ['pptx', 'enterprise'],
      includes: ['skill.ignition', 'agent.deck-builder', 'prompt.create-presentation'],
      download: {
        zip: 'https://example.com/ignition-suite-1.0.0.zip',
        checksumSha256: 'mno345',
      },
    },
    {
      id: 'skill.circular-a',
      type: 'skill',
      displayName: 'Circular A',
      version: '1.0.0',
      category: 'test',
      tags: [],
      dependencies: ['skill.circular-b'],
      install: { targetPaths: ['.jumpstart/skills/circular-a'] },
      download: { zip: 'https://example.com/a.zip', checksumSha256: 'aaa' },
    },
    {
      id: 'skill.circular-b',
      type: 'skill',
      displayName: 'Circular B',
      version: '1.0.0',
      category: 'test',
      tags: [],
      dependencies: ['skill.circular-a'],
      install: { targetPaths: ['.jumpstart/skills/circular-b'] },
      download: { zip: 'https://example.com/b.zip', checksumSha256: 'bbb' },
    },
  ],
};

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'jumpstart-install-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────
// normalizeItemId
// ─────────────────────────────────────────────────────────────────────────

describe('normalizeItemId', () => {
  it('passes through dotted IDs', () => {
    expect(normalizeItemId('skill.ignition')).toBe('skill.ignition');
    expect(normalizeItemId('bundle.ignition-suite')).toBe('bundle.ignition-suite');
  });

  it('joins type + name into dotted ID', () => {
    expect(normalizeItemId('skill', 'ignition')).toBe('skill.ignition');
    expect(normalizeItemId('agent', 'deck-builder')).toBe('agent.deck-builder');
    expect(normalizeItemId('prompt', 'create-presentation')).toBe('prompt.create-presentation');
    expect(normalizeItemId('bundle', 'ignition-suite')).toBe('bundle.ignition-suite');
  });

  it('returns null for bare type keyword without name', () => {
    expect(normalizeItemId('skill')).toBeNull();
    expect(normalizeItemId('agent')).toBeNull();
  });

  it('returns bare name for non-type single word', () => {
    expect(normalizeItemId('ignition')).toBe('ignition');
  });

  it('returns null for empty input', () => {
    expect(normalizeItemId(undefined)).toBeNull();
    expect(normalizeItemId('')).toBeNull();
  });

  it('is case-insensitive for type keywords', () => {
    expect(normalizeItemId('Skill', 'ignition')).toBe('skill.ignition');
    expect(normalizeItemId('AGENT', 'deck-builder')).toBe('agent.deck-builder');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// detectIDE
// ─────────────────────────────────────────────────────────────────────────

describe('detectIDE', () => {
  it('detects VS Code / Copilot when .github/ exists', () => {
    mkdirSync(path.join(tmp, '.github'));
    const result = detectIDE(tmp);
    expect(result.ide).toBe('vscode-copilot');
    expect(result.agentDir).toBe('.github/agents');
    expect(result.promptDir).toBe('.github/prompts');
  });

  it('detects generic when .github/ absent', () => {
    const result = detectIDE(tmp);
    expect(result.ide).toBe('generic');
    expect(result.agentDir).toBe('.jumpstart/agents');
    expect(result.promptDir).toBe('.jumpstart/prompts');
  });

  it('detects VS Code via copilot-instructions.md', () => {
    mkdirSync(path.join(tmp, '.github'), { recursive: true });
    writeFileSync(path.join(tmp, '.github', 'copilot-instructions.md'), '');
    const result = detectIDE(tmp);
    expect(result.ide).toBe('vscode-copilot');
  });

  it('detects VS Code via .github/agents/', () => {
    mkdirSync(path.join(tmp, '.github', 'agents'), { recursive: true });
    const result = detectIDE(tmp);
    expect(result.ide).toBe('vscode-copilot');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// findItem / findItemByName / searchItems
// ─────────────────────────────────────────────────────────────────────────

describe('findItem', () => {
  it('finds by exact ID', () => {
    expect(findItem(MOCK_INDEX, 'skill.ignition')?.displayName).toBe('Ignition');
  });

  it('returns null for unknown ID', () => {
    expect(findItem(MOCK_INDEX, 'skill.nonexistent')).toBeNull();
  });

  it('returns null for null/invalid index', () => {
    expect(findItem(null, 'skill.ignition')).toBeNull();
    expect(findItem({} as RegistryIndex, 'skill.ignition')).toBeNull();
  });
});

describe('findItemByName', () => {
  it('finds by bare name trying all type prefixes', () => {
    const item = findItemByName(MOCK_INDEX, 'ignition');
    expect(item).not.toBeNull();
    expect(item?.id).toBe('skill.ignition');
  });

  it('finds by displayName', () => {
    const item = findItemByName(MOCK_INDEX, 'Deck Builder');
    expect(item).not.toBeNull();
    expect(item?.id).toBe('agent.deck-builder');
  });

  it('returns null for unknown name', () => {
    expect(findItemByName(MOCK_INDEX, 'nonexistent')).toBeNull();
  });

  it('returns null for null/invalid index', () => {
    expect(findItemByName(null, 'ignition')).toBeNull();
  });
});

describe('searchItems', () => {
  it('finds items by tag', () => {
    const results = searchItems(MOCK_INDEX, 'pptx');
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.map((r) => r.id)).toContain('skill.ignition');
  });

  it('finds items by category', () => {
    const results = searchItems(MOCK_INDEX, 'presentations');
    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  it('scores exact matches higher', () => {
    const results = searchItems(MOCK_INDEX, 'Ignition');
    expect(results[0].id).toBe('skill.ignition');
  });

  it('returns empty for no-match', () => {
    expect(searchItems(MOCK_INDEX, 'zzzzzzzzzzz')).toEqual([]);
  });

  it('handles null/empty index gracefully', () => {
    expect(searchItems(null, 'pptx')).toEqual([]);
    expect(searchItems({} as RegistryIndex, 'pptx')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// checkCompatibility / compareSemver
// ─────────────────────────────────────────────────────────────────────────

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });
  it('returns negative when a < b', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareSemver('0.9.0', '1.0.0')).toBeLessThan(0);
  });
  it('returns positive when a > b', () => {
    expect(compareSemver('1.0.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0', '1.999.999')).toBeGreaterThan(0);
  });
  it('handles missing components as 0', () => {
    expect(compareSemver('1', '1.0.0')).toBe(0);
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
  });
});

describe('checkCompatibility', () => {
  it('passes for compatible items', () => {
    const result = checkCompatibility({
      id: 'x',
      type: 'skill',
      version: '1.0.0',
      compatibility: { jumpstartMode: '>=0.1.0' },
    });
    expect(result.compatible).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('warns for incompatible version', () => {
    const result = checkCompatibility({
      id: 'x',
      type: 'skill',
      version: '1.0.0',
      compatibility: { jumpstartMode: '>=99.0.0' },
    });
    expect(result.compatible).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('passes for items with no compatibility block', () => {
    const result = checkCompatibility({ id: 'x', type: 'skill', version: '1.0.0' });
    expect(result.compatible).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// readInstalled / writeInstalled / isInstalled (with redaction + shape)
// ─────────────────────────────────────────────────────────────────────────

describe('install tracking', () => {
  it('readInstalled returns empty for fresh project', () => {
    const data = readInstalled(tmp);
    expect(data.items).toEqual({});
  });

  it('writeInstalled + readInstalled round-trips', () => {
    writeInstalled(tmp, {
      items: {
        'skill.test': {
          version: '1.0.0',
          installedAt: '2026-02-21T00:00:00Z',
          targetPaths: ['.jumpstart/skills/test'],
          remappedFiles: ['.github/agents/test.agent.md'],
        },
      },
    });
    const read = readInstalled(tmp);
    expect(read.items['skill.test'].version).toBe('1.0.0');
    expect(read.items['skill.test'].remappedFiles).toEqual(['.github/agents/test.agent.md']);
  });

  it('isInstalled returns entry when present', () => {
    writeInstalled(tmp, {
      items: {
        'skill.test': {
          version: '2.0.0',
          installedAt: '2026-02-21T00:00:00Z',
          targetPaths: [],
          remappedFiles: [],
        },
      },
    });
    const entry = isInstalled('skill.test', tmp);
    expect(entry).not.toBeNull();
    expect(entry?.version).toBe('2.0.0');
  });

  it('isInstalled returns null when absent', () => {
    expect(isInstalled('skill.missing', tmp)).toBeNull();
  });

  it('redacts secrets on write (ADR-012)', () => {
    // A realistic-looking but obviously fake GitHub token planted in
    // the displayName field — could happen if a malformed registry
    // ships a token-tainted name. The redactor should strip it.
    const fakeToken = `ghp_${'A'.repeat(36)}`;
    writeInstalled(tmp, {
      items: {
        'skill.tainted': {
          version: '1.0.0',
          displayName: `Tainted skill ${fakeToken} embedded`,
          installedAt: 'now',
          targetPaths: [],
          remappedFiles: [],
        },
      },
    });
    const onDisk = readFileSync(path.join(tmp, '.jumpstart', 'installed.json'), 'utf8');
    expect(onDisk).not.toContain(fakeToken);
    expect(onDisk).toContain('[REDACTED:GitHub Token]');
  });
});

describe('readInstalled shape validation', () => {
  function writeRaw(content: string): void {
    mkdirSync(path.join(tmp, '.jumpstart'), { recursive: true });
    writeFileSync(path.join(tmp, '.jumpstart', 'installed.json'), content, 'utf8');
  }

  it('rejects __proto__-keyed JSON, falling back to empty', () => {
    writeRaw('{"__proto__": {"polluted": true}, "items": {"skill.x": {"version": "1.0.0"}}}');
    const data = readInstalled(tmp);
    expect(data.items).toEqual({});
  });

  it('rejects constructor-keyed JSON', () => {
    writeRaw('{"constructor": {"x": 1}, "items": {}}');
    const data = readInstalled(tmp);
    expect(data.items).toEqual({});
  });

  it('rejects string root', () => {
    writeRaw('"hello"');
    const data = readInstalled(tmp);
    expect(data.items).toEqual({});
  });

  it('rejects array root', () => {
    writeRaw('[1, 2, 3]');
    const data = readInstalled(tmp);
    expect(data.items).toEqual({});
  });

  it('rejects malformed JSON, returns empty', () => {
    writeRaw('{ malformed');
    const data = readInstalled(tmp);
    expect(data.items).toEqual({});
  });

  it('rejects items field that is not an object', () => {
    writeRaw('{"items": [1, 2, 3]}');
    const data = readInstalled(tmp);
    expect(data.items).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────
// resolveTargetPaths
// ─────────────────────────────────────────────────────────────────────────

describe('resolveTargetPaths', () => {
  it('uses explicit targetPaths from item', () => {
    const item = MOCK_INDEX.items[0];
    expect(resolveTargetPaths(item)).toEqual(['.jumpstart/skills/ignition']);
  });

  it('derives from type when targetPaths absent', () => {
    expect(resolveTargetPaths({ id: 'agent.my-agent', type: 'agent', version: '1.0.0' })).toEqual([
      '.jumpstart/agents/my-agent',
    ]);
  });

  it('handles multi-segment names', () => {
    expect(
      resolveTargetPaths({ id: 'prompt.my.deep.name', type: 'prompt', version: '1.0.0' })
    ).toEqual(['.jumpstart/prompts/my.deep.name']);
  });

  it('falls back to skills/ for unknown types', () => {
    expect(
      resolveTargetPaths({ id: 'mystery.unknown', type: 'mystery', version: '1.0.0' })
    ).toEqual(['.jumpstart/skills/unknown']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// resolveDependencies
// ─────────────────────────────────────────────────────────────────────────

describe('resolveDependencies', () => {
  it('produces topological order with deps first', () => {
    const { order } = resolveDependencies('skill.ignition', MOCK_INDEX, tmp);
    const depIdx = order.indexOf('skill.agent-customization');
    const mainIdx = order.indexOf('skill.ignition');
    expect(depIdx).toBeGreaterThanOrEqual(0);
    expect(mainIdx).toBeGreaterThanOrEqual(0);
    expect(depIdx).toBeLessThan(mainIdx);
  });

  it('detects circular dependencies', () => {
    const { warnings } = resolveDependencies('skill.circular-a', MOCK_INDEX, tmp);
    expect(warnings.some((w) => w.includes('Circular'))).toBe(true);
  });

  it('skips already-installed items', () => {
    writeInstalled(tmp, {
      items: {
        'skill.agent-customization': {
          version: '1.0.0',
          installedAt: 'now',
          targetPaths: [],
          remappedFiles: [],
        },
      },
    });
    const { order, skipped } = resolveDependencies('skill.ignition', MOCK_INDEX, tmp);
    expect(skipped).toContain('skill.agent-customization');
    expect(order).not.toContain('skill.agent-customization');
    expect(order).toContain('skill.ignition');
  });

  it('warns on missing dependency', () => {
    const indexWithMissingDep: RegistryIndex = {
      items: [
        {
          id: 'skill.test',
          type: 'skill',
          version: '1.0.0',
          dependencies: ['skill.nonexistent'],
          install: { targetPaths: ['.jumpstart/skills/test'] },
          download: { zip: 'x', checksumSha256: 'y' },
        },
      ],
    };
    const { warnings } = resolveDependencies('skill.test', indexWithMissingDep, tmp);
    expect(warnings.some((w) => w.includes('not found'))).toBe(true);
  });

  it('force flag re-installs already-present items', () => {
    writeInstalled(tmp, {
      items: {
        'skill.agent-customization': {
          version: '1.0.0',
          installedAt: 'now',
          targetPaths: [],
          remappedFiles: [],
        },
      },
    });
    const { order, skipped } = resolveDependencies('skill.ignition', MOCK_INDEX, tmp, {
      force: true,
    });
    expect(skipped).not.toContain('skill.agent-customization');
    expect(order).toContain('skill.agent-customization');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getStatus / checkUpdates / uninstallItem
// ─────────────────────────────────────────────────────────────────────────

describe('getStatus', () => {
  it('returns count 0 for fresh project', () => {
    expect(getStatus(tmp).count).toBe(0);
  });

  it('returns installed items', () => {
    writeInstalled(tmp, {
      items: {
        'skill.a': {
          version: '1.0.0',
          type: 'skill',
          installedAt: 'now',
          targetPaths: [],
          remappedFiles: [],
        },
        'agent.b': {
          version: '2.0.0',
          type: 'agent',
          installedAt: 'now',
          targetPaths: [],
          remappedFiles: [],
        },
      },
    });
    const status = getStatus(tmp);
    expect(status.count).toBe(2);
    expect(status.items['skill.a'].version).toBe('1.0.0');
  });
});

describe('checkUpdates', () => {
  it('detects available updates', () => {
    writeInstalled(tmp, {
      items: {
        'skill.ignition': {
          version: '0.9.0',
          installedAt: 'now',
          targetPaths: [],
          remappedFiles: [],
        },
      },
    });
    const { updates } = checkUpdates(tmp, MOCK_INDEX);
    expect(updates.length).toBe(1);
    expect(updates[0].id).toBe('skill.ignition');
    expect(updates[0].localVersion).toBe('0.9.0');
    expect(updates[0].registryVersion).toBe('1.0.0');
  });

  it('marks items as up-to-date when versions match', () => {
    writeInstalled(tmp, {
      items: {
        'skill.ignition': {
          version: '1.0.0',
          installedAt: 'now',
          targetPaths: [],
          remappedFiles: [],
        },
      },
    });
    const { updates, upToDate } = checkUpdates(tmp, MOCK_INDEX);
    expect(updates.length).toBe(0);
    expect(upToDate).toContain('skill.ignition');
  });
});

describe('uninstallItem', () => {
  it('removes installed item and its files', () => {
    const targetDir = path.join(tmp, '.jumpstart', 'skills', 'test');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, 'SKILL.md'), 'test');

    const remappedFile = path.join(tmp, '.github', 'agents', 'test.agent.md');
    mkdirSync(path.dirname(remappedFile), { recursive: true });
    writeFileSync(remappedFile, 'agent');

    writeInstalled(tmp, {
      items: {
        'skill.test': {
          version: '1.0.0',
          installedAt: 'now',
          targetPaths: ['.jumpstart/skills/test'],
          remappedFiles: ['.github/agents/test.agent.md'],
        },
      },
    });

    const result = uninstallItem('skill.test', tmp);
    expect(result.success).toBe(true);
    expect(result.removed).toContain('.jumpstart/skills/test');
    expect(result.removed).toContain('.github/agents/test.agent.md');

    expect(existsSync(targetDir)).toBe(false);
    expect(existsSync(remappedFile)).toBe(false);

    const data = readInstalled(tmp);
    expect(data.items['skill.test']).toBeUndefined();
  });

  it('throws for uninstalled items', () => {
    expect(() => uninstallItem('skill.missing', tmp)).toThrow('not installed');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ADR-010 ZIP-slip prevention via fixture archives
// ─────────────────────────────────────────────────────────────────────────
//
// `extractZipSafely` is a private helper inside install.ts but is the
// load-bearing security boundary; we drive it directly via the test-only
// `_extractZipSafely_TEST_ONLY` hatch (see install.ts). The alternative
// of routing through `installItem` would require fetch over file:// (not
// supported in Node's global fetch), so the hatch is required.

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'zipslip');

async function callExtractor(
  zipPath: string,
  targetDir: string
): Promise<{ ok: boolean; error?: Error }> {
  const installMod = (await import('../bin/lib-ts/install.js')) as Record<string, unknown>;
  const extractZipSafely = installMod._extractZipSafely_TEST_ONLY as
    | ((zipPath: string, targetDir: string) => void)
    | undefined;
  if (typeof extractZipSafely !== 'function') {
    throw new Error(
      '_extractZipSafely_TEST_ONLY hatch is missing from install.ts. Add a test-only export so the ZIP-slip fixtures can drive the extractor directly.'
    );
  }
  try {
    extractZipSafely(zipPath, targetDir);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err as Error };
  }
}

describe('ZIP reader (ADR-010 fixtures)', () => {
  it('legitimate.zip extracts cleanly with all 3 files', async () => {
    const zipPath = path.join(FIXTURE_DIR, 'legitimate.zip');
    const target = mkdtempSync(path.join(tmpdir(), 'zipslip-legit-'));
    try {
      const result = await callExtractor(zipPath, target);
      expect(result.ok).toBe(true);
      const files = listFilesRecursively(target);
      expect(files.sort()).toEqual(
        ['README.md', 'src/hello.txt', 'src/nested/deep.txt'].map((p) => p.replace(/\//g, path.sep))
      );
      // Verify content of one file to prove decompression worked.
      const readme = readFileSync(path.join(target, 'README.md'), 'utf8');
      expect(readme).toContain('# README');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('traversal.zip rejects with ValidationError', async () => {
    const zipPath = path.join(FIXTURE_DIR, 'traversal.zip');
    const target = mkdtempSync(path.join(tmpdir(), 'zipslip-trav-'));
    try {
      const result = await callExtractor(zipPath, target);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ValidationError);
      const err = result.error as ValidationError;
      expect(err.schemaId).toBe('marketplace-zip-extract');
      // Nothing should have been written.
      expect(listFilesRecursively(target)).toEqual([]);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('absolute.zip rejects with ValidationError', async () => {
    const zipPath = path.join(FIXTURE_DIR, 'absolute.zip');
    const target = mkdtempSync(path.join(tmpdir(), 'zipslip-abs-'));
    try {
      const result = await callExtractor(zipPath, target);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ValidationError);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('null-byte.zip rejects with ValidationError', async () => {
    const zipPath = path.join(FIXTURE_DIR, 'null-byte.zip');
    const target = mkdtempSync(path.join(tmpdir(), 'zipslip-null-'));
    try {
      const result = await callExtractor(zipPath, target);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ValidationError);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('symlink.zip rejects with ValidationError', async () => {
    const zipPath = path.join(FIXTURE_DIR, 'symlink.zip');
    const target = mkdtempSync(path.join(tmpdir(), 'zipslip-sym-'));
    try {
      const result = await callExtractor(zipPath, target);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ValidationError);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('legitimate.zip SHA-256 reproducibility tracking', () => {
    // The build-fixtures.mjs script is deterministic; the SHA-256 below
    // is reported back to the orchestrator and used to detect drift in
    // the fixture-generation pipeline. If this assertion fails the
    // regenerator changed something and the deviation needs review.
    const zipPath = path.join(FIXTURE_DIR, 'legitimate.zip');
    const buf = readFileSync(zipPath);
    const sha = createHash('sha256').update(buf).digest('hex');
    expect(sha).toBe('be3a251e93b655149566a71cf519cb59442fecc152516a55ada6e7ec8de52d1d');
  });
});

function listFilesRecursively(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const child of listFilesRecursively(full)) {
        out.push(path.join(entry.name, child));
      }
    } else if (entry.isFile()) {
      out.push(entry.name);
    }
  }
  return out;
}
