#!/usr/bin/env node
/**
 * build-fixtures.mjs — generate 10 historical `.jumpstart/installed.json`
 * shapes for T4.5.3 round-trip regression.
 *
 * The shape contract:
 *   - root MUST be a plain object with an `items` map
 *   - each entry has `version: string`, `installedAt: ISO8601`,
 *     `targetPaths: string[]`, `remappedFiles: string[]`
 *   - optional fields: `displayName`, `type`, `keywords`
 *
 * Byte-identical round-trip rule: `writeInstalled(p, readInstalled(p))`
 * MUST produce the exact same bytes as the input fixture. This means:
 *   1. Fixtures use the SAME serializer as `writeInstalled`:
 *        `JSON.stringify(data, null, 2) + '\n'`
 *   2. NO secret-shaped strings (redactSecrets would alter them)
 *   3. NO duplicate keys / unstable orderings
 *
 * Run once; commit the .json files. Re-run on shape additions.
 *
 * @see specs/implementation-plan.md T4.5.3
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 1. empty.json — initial state, no installs
// ---------------------------------------------------------------------------
const empty = { items: {} };

// ---------------------------------------------------------------------------
// 2. single-skill.json — one skill entry, full v1 shape
// ---------------------------------------------------------------------------
const singleSkill = {
  items: {
    'skill.ignition': {
      version: '1.0.0',
      displayName: 'Ignition Skill',
      type: 'skill',
      installedAt: '2026-01-15T10:00:00.000Z',
      targetPaths: ['.jumpstart/skills/ignition'],
      remappedFiles: [],
      keywords: ['scaffold', 'init', 'startup'],
    },
  },
};

// ---------------------------------------------------------------------------
// 3. multiple-types.json — skill + agent + prompt
// ---------------------------------------------------------------------------
const multipleTypes = {
  items: {
    'skill.ignition': {
      version: '1.0.0',
      displayName: 'Ignition Skill',
      type: 'skill',
      installedAt: '2026-01-15T10:00:00.000Z',
      targetPaths: ['.jumpstart/skills/ignition'],
      remappedFiles: [],
      keywords: ['scaffold'],
    },
    'agent.scout': {
      version: '0.9.2',
      displayName: 'Scout Agent',
      type: 'agent',
      installedAt: '2026-01-16T11:30:00.000Z',
      targetPaths: ['.jumpstart/agents/scout'],
      remappedFiles: ['.jumpstart/agents/scout.md'],
      keywords: ['recon', 'brownfield'],
    },
    'prompt.architect-review': {
      version: '2.1.0',
      displayName: 'Architect Review',
      type: 'prompt',
      installedAt: '2026-01-17T09:15:42.123Z',
      targetPaths: ['.jumpstart/prompts/architect-review'],
      remappedFiles: ['.jumpstart/prompts/architect-review.prompt.md'],
      keywords: ['review', 'architecture'],
    },
  },
};

// ---------------------------------------------------------------------------
// 4. bundle-installed.json — bundle entry
// ---------------------------------------------------------------------------
const bundleInstalled = {
  items: {
    'bundle.governance': {
      version: '1.5.0',
      displayName: 'Governance Bundle',
      type: 'bundle',
      installedAt: '2026-02-01T08:00:00.000Z',
      targetPaths: ['.jumpstart/bundles/governance'],
      remappedFiles: [
        '.jumpstart/agents/risk-officer.md',
        '.jumpstart/prompts/cab-review.prompt.md',
      ],
      keywords: ['compliance', 'risk', 'cab'],
    },
  },
};

// ---------------------------------------------------------------------------
// 5. with-keywords.json — keywords + tags merged from registry
// ---------------------------------------------------------------------------
const withKeywords = {
  items: {
    'skill.testing': {
      version: '0.5.0',
      displayName: 'Testing Helpers',
      type: 'skill',
      installedAt: '2026-03-01T14:22:00.000Z',
      targetPaths: ['.jumpstart/skills/testing'],
      remappedFiles: [],
      keywords: ['vitest', 'jest', 'mocha', 'fixture', 'snapshot'],
    },
  },
};

// ---------------------------------------------------------------------------
// 6. without-keywords.json — older v0 shape (no keywords field)
// ---------------------------------------------------------------------------
const withoutKeywords = {
  items: {
    'skill.legacy': {
      version: '0.1.0',
      displayName: 'Legacy Skill',
      type: 'skill',
      installedAt: '2025-11-15T08:00:00.000Z',
      targetPaths: ['.jumpstart/skills/legacy'],
      remappedFiles: [],
    },
  },
};

// ---------------------------------------------------------------------------
// 7. multi-target-paths.json — entry with multiple target dirs
// ---------------------------------------------------------------------------
const multiTargetPaths = {
  items: {
    'skill.dual-deploy': {
      version: '1.0.0',
      displayName: 'Dual Deploy',
      type: 'skill',
      installedAt: '2026-03-05T12:00:00.000Z',
      targetPaths: [
        '.jumpstart/skills/dual-deploy',
        '.github/workflows/deploy',
        'scripts/deploy',
      ],
      remappedFiles: ['.jumpstart/agents/deploy-runner.md'],
      keywords: ['deploy', 'ci'],
    },
  },
};

// ---------------------------------------------------------------------------
// 8. with-remapped-files.json — entry with non-trivial remappedFiles
// ---------------------------------------------------------------------------
const withRemappedFiles = {
  items: {
    'agent.architect': {
      version: '3.0.0',
      displayName: 'Architect Agent',
      type: 'agent',
      installedAt: '2026-03-10T09:00:00.000Z',
      targetPaths: ['.jumpstart/agents/architect'],
      remappedFiles: [
        '.github/agents/architect.agent.md',
        '.github/prompts/architect-protocol.prompt.md',
        '.github/prompts/architect-review.prompt.md',
      ],
      keywords: ['design', 'patterns', 'adr'],
    },
  },
};

// ---------------------------------------------------------------------------
// 9. legacy-no-displayname.json — older shape (pre-v0.5) with no
//    displayName / no type / no keywords — bare-minimum entry shape
// ---------------------------------------------------------------------------
const legacyNoDisplayName = {
  items: {
    'skill.minimal': {
      version: '0.0.1',
      installedAt: '2025-09-01T00:00:00.000Z',
      targetPaths: ['.jumpstart/skills/minimal'],
      remappedFiles: [],
    },
  },
};

// ---------------------------------------------------------------------------
// 10. realistic-mixed.json — full realistic snapshot, mixed shapes
// ---------------------------------------------------------------------------
const realisticMixed = {
  items: {
    'skill.ignition': {
      version: '1.0.0',
      displayName: 'Ignition Skill',
      type: 'skill',
      installedAt: '2026-01-15T10:00:00.000Z',
      targetPaths: ['.jumpstart/skills/ignition'],
      remappedFiles: [],
      keywords: ['scaffold', 'init'],
    },
    'agent.scout': {
      version: '0.9.2',
      displayName: 'Scout Agent',
      type: 'agent',
      installedAt: '2026-01-16T11:30:00.000Z',
      targetPaths: ['.jumpstart/agents/scout'],
      remappedFiles: ['.jumpstart/agents/scout.md'],
      keywords: ['recon'],
    },
    'prompt.architect-review': {
      version: '2.1.0',
      displayName: 'Architect Review',
      type: 'prompt',
      installedAt: '2026-01-17T09:15:42.123Z',
      targetPaths: ['.jumpstart/prompts/architect-review'],
      remappedFiles: ['.jumpstart/prompts/architect-review.prompt.md'],
      keywords: ['review'],
    },
    'skill.legacy': {
      version: '0.1.0',
      displayName: 'Legacy Skill',
      type: 'skill',
      installedAt: '2025-11-15T08:00:00.000Z',
      targetPaths: ['.jumpstart/skills/legacy'],
      remappedFiles: [],
    },
    'bundle.governance': {
      version: '1.5.0',
      displayName: 'Governance Bundle',
      type: 'bundle',
      installedAt: '2026-02-01T08:00:00.000Z',
      targetPaths: ['.jumpstart/bundles/governance'],
      remappedFiles: [
        '.jumpstart/agents/risk-officer.md',
        '.jumpstart/prompts/cab-review.prompt.md',
      ],
      keywords: ['compliance', 'risk'],
    },
  },
};

// ---------------------------------------------------------------------------
// Serializer — MUST match `writeInstalled` (`JSON.stringify(data, null, 2) + '\n'`)
// ---------------------------------------------------------------------------
function serialize(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

const fixtures = {
  '01-empty.json': empty,
  '02-single-skill.json': singleSkill,
  '03-multiple-types.json': multipleTypes,
  '04-bundle-installed.json': bundleInstalled,
  '05-with-keywords.json': withKeywords,
  '06-without-keywords.json': withoutKeywords,
  '07-multi-target-paths.json': multiTargetPaths,
  '08-with-remapped-files.json': withRemappedFiles,
  '09-legacy-no-displayname.json': legacyNoDisplayName,
  '10-realistic-mixed.json': realisticMixed,
};

for (const [name, data] of Object.entries(fixtures)) {
  const fp = join(HERE, name);
  writeFileSync(fp, serialize(data), 'utf8');
  console.log(`wrote ${name} (${serialize(data).length} bytes)`);
}

console.log(`\n✓ ${Object.keys(fixtures).length} fixtures written to ${HERE}`);
