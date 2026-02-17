/**
 * Tests for bin/lib/export.js — Portable Handoff Package (UX Feature 14)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const require = createRequire(import.meta.url);
const { gatherHandoffData, renderHandoffMarkdown, exportHandoffPackage, isApproved, PHASES } = require('../bin/lib/export');

// Helpers
function createTempProject(suffix = '') {
  const dir = join(tmpdir(), `jumpstart-export-test-${Date.now()}${suffix}`);
  mkdirSync(join(dir, '.jumpstart', 'state'), { recursive: true });
  mkdirSync(join(dir, 'specs', 'insights'), { recursive: true });
  mkdirSync(join(dir, 'specs', 'decisions'), { recursive: true });
  return dir;
}

function writeConfig(dir, content) {
  const configDir = join(dir, '.jumpstart');
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.yaml'), content, 'utf8');
}

function writeState(dir, state) {
  writeFileSync(
    join(dir, '.jumpstart', 'state', 'state.json'),
    JSON.stringify(state, null, 2),
    'utf8'
  );
}

function writeArtifact(dir, relPath, content) {
  const fullPath = join(dir, relPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

const APPROVED_SECTION = `
## Phase Gate Approval

- [x] Human has reviewed this artifact
- [x] All required sections are populated
- [x] Content traces to upstream artifacts

**Approved by:** Jane
**Approval date:** 2026-01-15
**Status:** Approved
`;

const DRAFT_SECTION = `
## Phase Gate Approval

- [ ] Human has reviewed this artifact
- [ ] All required sections are populated

**Approved by:** Pending
**Approval date:** Pending
**Status:** Draft
`;

function defaultState(overrides = {}) {
  return {
    version: '1.0.0',
    current_phase: null,
    current_agent: null,
    current_step: null,
    last_completed_step: null,
    active_artifacts: [],
    approved_artifacts: [],
    phase_history: [],
    last_updated: null,
    resume_context: null,
    ...overrides
  };
}

let tmpDir;

describe('export', () => {
  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('isApproved', () => {
    it('returns true for fully approved content', () => {
      expect(isApproved(`# Doc\n${APPROVED_SECTION}`)).toBe(true);
    });

    it('returns false for draft content', () => {
      expect(isApproved(`# Doc\n${DRAFT_SECTION}`)).toBe(false);
    });

    it('returns false for empty content', () => {
      expect(isApproved('')).toBe(false);
    });

    it('returns false when no gate section', () => {
      expect(isApproved('# Just content')).toBe(false);
    });
  });

  describe('PHASES', () => {
    it('has 6 phase entries', () => {
      expect(PHASES).toHaveLength(6);
    });

    it('includes Scout through Developer', () => {
      const names = PHASES.map(p => p.name);
      expect(names).toContain('Scout');
      expect(names).toContain('Developer');
    });
  });

  describe('gatherHandoffData', () => {
    it('returns minimal structure for empty project', () => {
      writeState(tmpDir, defaultState());
      const data = gatherHandoffData({ root: tmpDir });

      expect(data.project_name).toBeTruthy();
      expect(data.exported_at).toBeTruthy();
      expect(data.phases).toHaveLength(6);
      expect(data.approved_artifacts).toEqual([]);
      expect(data.summaries).toEqual([]);
      expect(data.decisions).toEqual([]);
      expect(data.coverage).toBe(null);
    });

    it('includes approved artifact summaries', () => {
      writeState(tmpDir, defaultState({ current_phase: 1 }));
      writeArtifact(tmpDir, 'specs/challenger-brief.md', `# Challenger Brief\n\n## Problem Statement\nBig problem.\n${APPROVED_SECTION}`);

      const data = gatherHandoffData({ root: tmpDir });
      expect(data.approved_artifacts).toContain('specs/challenger-brief.md');
      expect(data.summaries.length).toBeGreaterThanOrEqual(1);
      expect(data.summaries[0].approved).toBe(true);
    });

    it('marks draft artifacts correctly', () => {
      writeState(tmpDir, defaultState({ current_phase: 2 }));
      writeArtifact(tmpDir, 'specs/prd.md', `# PRD\n\n## Overview\nDraft PRD.\n${DRAFT_SECTION}`);

      const data = gatherHandoffData({ root: tmpDir });
      const prdPhase = data.phases.find(p => p.phase === 2);
      expect(prdPhase.status).toBe('draft');
    });

    it('includes ADRs from specs/decisions/', () => {
      writeState(tmpDir, defaultState());
      writeArtifact(tmpDir, 'specs/decisions/001-use-react.md',
        '# ADR-001: Use React\n\n**Status:** Accepted\n\nUse React for the frontend.'
      );

      const data = gatherHandoffData({ root: tmpDir });
      expect(data.decisions).toHaveLength(1);
      expect(data.decisions[0].title).toContain('React');
      expect(data.decisions[0].status).toBe('Accepted');
    });

    it('reads project name from config', () => {
      writeState(tmpDir, defaultState());
      writeConfig(tmpDir, 'project:\n  name: "My Cool App"\n  type: greenfield\n');

      const data = gatherHandoffData({ root: tmpDir });
      expect(data.project_name).toBe('My Cool App');
    });

    it('includes implementation status from state', () => {
      writeState(tmpDir, defaultState({
        current_phase: 2,
        current_agent: 'pm',
        phase_history: [
          { phase: 0, agent: 'challenger', completed_at: '2026-01-01' },
          { phase: 1, agent: 'analyst', completed_at: '2026-01-02' }
        ]
      }));

      const data = gatherHandoffData({ root: tmpDir });
      expect(data.implementation_status.current_phase).toBe(2);
      expect(data.implementation_status.current_agent).toBe('pm');
      expect(data.implementation_status.phase_history).toHaveLength(2);
    });

    it('detects open clarifications', () => {
      writeState(tmpDir, defaultState());
      writeArtifact(tmpDir, 'specs/prd.md',
        `# PRD\n\n[NEEDS CLARIFICATION: auth flow unclear]\n\n## Requirements\n[NEEDS CLARIFICATION: budget?]\n${DRAFT_SECTION}`
      );

      const data = gatherHandoffData({ root: tmpDir });
      expect(data.open_items.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('renderHandoffMarkdown', () => {
    it('contains project header', () => {
      const data = gatherHandoffData({ root: tmpDir });
      data.project_name = 'TestApp';
      const md = renderHandoffMarkdown(data);
      expect(md).toContain('# Handoff Package — TestApp');
    });

    it('contains phase status table', () => {
      writeState(tmpDir, defaultState());
      const data = gatherHandoffData({ root: tmpDir });
      const md = renderHandoffMarkdown(data);
      expect(md).toContain('## Phase Status');
      expect(md).toContain('| Phase | Name | Status | Artifact |');
      expect(md).toContain('Scout');
      expect(md).toContain('Developer');
    });

    it('shows approved artifacts section when present', () => {
      writeState(tmpDir, defaultState());
      writeArtifact(tmpDir, 'specs/challenger-brief.md', `# Brief\n${APPROVED_SECTION}`);
      const data = gatherHandoffData({ root: tmpDir });
      const md = renderHandoffMarkdown(data);
      expect(md).toContain('## Approved Artifacts');
      expect(md).toContain('specs/challenger-brief.md');
    });

    it('shows decisions section when ADRs exist', () => {
      writeState(tmpDir, defaultState());
      writeArtifact(tmpDir, 'specs/decisions/001-pick-db.md', '# ADR-001: Pick DB\n\n**Status:** Accepted');
      const data = gatherHandoffData({ root: tmpDir });
      const md = renderHandoffMarkdown(data);
      expect(md).toContain('## Architecture Decisions');
      expect(md).toContain('Pick DB');
    });

    it('shows open clarifications when present', () => {
      writeState(tmpDir, defaultState());
      writeArtifact(tmpDir, 'specs/prd.md', `# PRD\n[NEEDS CLARIFICATION: scope]\n${DRAFT_SECTION}`);
      const data = gatherHandoffData({ root: tmpDir });
      const md = renderHandoffMarkdown(data);
      expect(md).toContain('## Open Clarifications');
    });

    it('shows implementation status', () => {
      writeState(tmpDir, defaultState({ current_phase: 3, current_agent: 'architect' }));
      const data = gatherHandoffData({ root: tmpDir });
      const md = renderHandoffMarkdown(data);
      expect(md).toContain('## Implementation Status');
      expect(md).toContain('3');
    });

    it('contains footer attribution', () => {
      writeState(tmpDir, defaultState());
      const data = gatherHandoffData({ root: tmpDir });
      const md = renderHandoffMarkdown(data);
      expect(md).toContain('jumpstart.handoff');
    });
  });

  describe('exportHandoffPackage', () => {
    it('writes handoff file to disk', () => {
      writeState(tmpDir, defaultState());
      const outputPath = join(tmpDir, 'specs', 'handoff-package.md');
      const result = exportHandoffPackage({ root: tmpDir, output: outputPath });

      expect(result.success).toBe(true);
      expect(result.output_path).toBe(outputPath);
      expect(existsSync(outputPath)).toBe(true);

      const content = readFileSync(outputPath, 'utf8');
      expect(content).toContain('# Handoff Package');
    });

    it('supports custom output path', () => {
      writeState(tmpDir, defaultState());
      const customPath = join(tmpDir, 'custom-handoff.md');
      const result = exportHandoffPackage({ root: tmpDir, output: customPath });

      expect(result.output_path).toBe(customPath);
      expect(existsSync(customPath)).toBe(true);
    });

    it('exports as JSON when option is set', () => {
      writeState(tmpDir, defaultState());
      const outputPath = join(tmpDir, 'handoff.json');
      exportHandoffPackage({ root: tmpDir, output: outputPath, json: true });

      const content = readFileSync(outputPath, 'utf8');
      const data = JSON.parse(content);
      expect(data.project_name).toBeTruthy();
      expect(data.phases).toBeTruthy();
    });

    it('returns stats in result', () => {
      writeState(tmpDir, defaultState());
      writeArtifact(tmpDir, 'specs/challenger-brief.md', `# Brief\n${APPROVED_SECTION}`);
      const result = exportHandoffPackage({ root: tmpDir, output: join(tmpDir, 'out.md') });

      expect(result.stats.phases).toBe(6);
      expect(result.stats.approved).toBeGreaterThanOrEqual(1);
      expect(typeof result.stats.summaries).toBe('number');
      expect(typeof result.stats.decisions).toBe('number');
      expect(typeof result.stats.open_items).toBe('number');
    });

    it('creates output directory if it does not exist', () => {
      writeState(tmpDir, defaultState());
      const deepPath = join(tmpDir, 'output', 'nested', 'handoff.md');
      const result = exportHandoffPackage({ root: tmpDir, output: deepPath });

      expect(result.success).toBe(true);
      expect(existsSync(deepPath)).toBe(true);
    });
  });
});
