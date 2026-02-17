/**
 * Tests for bin/lib/rewind.js — Phase Rewind with Cascade (UX Feature 2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Helpers
function createTempProject(suffix = '') {
  const dir = join(tmpdir(), `jumpstart-rewind-test-${Date.now()}${suffix}`);
  mkdirSync(join(dir, '.jumpstart', 'state'), { recursive: true });
  mkdirSync(join(dir, '.jumpstart', 'archive'), { recursive: true });
  mkdirSync(join(dir, 'specs', 'insights'), { recursive: true });
  mkdirSync(join(dir, 'specs', 'decisions'), { recursive: true });
  return dir;
}

function writeState(dir, state) {
  const statePath = join(dir, '.jumpstart', 'state', 'state.json');
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function loadStateFromDisk(dir) {
  const statePath = join(dir, '.jumpstart', 'state', 'state.json');
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

function writeArtifact(dir, relPath, content) {
  const fullPath = join(dir, relPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content || `# ${relPath}\n\nContent for ${relPath}\n`, 'utf8');
}

const APPROVED_SECTION = `
## Phase Gate Approval

- [x] Human has reviewed this artifact
- [x] All required sections are populated
- [x] Content traces to upstream artifacts

**Approved by:** Jane
**Approval date:** 2026-01-01
**Status:** Approved
`;

let tmpDir;

describe('rewind', () => {
  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Dynamic import (ESM)
  async function loadRewind() {
    const mod = await import('../bin/lib/rewind.js');
    return mod;
  }

  describe('PHASE_ORDER', () => {
    it('contains all 6 phases in order', async () => {
      const { PHASE_ORDER } = await loadRewind();
      expect(PHASE_ORDER).toEqual([-1, 0, 1, 2, 3, 4]);
    });
  });

  describe('PHASE_ARTIFACTS', () => {
    it('has entries for all phases', async () => {
      const { PHASE_ARTIFACTS, PHASE_ORDER } = await loadRewind();
      for (const p of PHASE_ORDER) {
        expect(PHASE_ARTIFACTS[String(p)]).toBeDefined();
        expect(PHASE_ARTIFACTS[String(p)].name).toBeTruthy();
        expect(Array.isArray(PHASE_ARTIFACTS[String(p)].primary)).toBe(true);
        expect(Array.isArray(PHASE_ARTIFACTS[String(p)].secondary)).toBe(true);
      }
    });

    it('Phase 3 Architect has two primary artifacts', async () => {
      const { PHASE_ARTIFACTS } = await loadRewind();
      expect(PHASE_ARTIFACTS['3'].primary).toContain('specs/architecture.md');
      expect(PHASE_ARTIFACTS['3'].primary).toContain('specs/implementation-plan.md');
    });
  });

  describe('getDownstreamPhases', () => {
    it('returns all phases after target', async () => {
      const { getDownstreamPhases } = await loadRewind();
      expect(getDownstreamPhases(0)).toEqual([1, 2, 3, 4]);
      expect(getDownstreamPhases(1)).toEqual([2, 3, 4]);
      expect(getDownstreamPhases(2)).toEqual([3, 4]);
      expect(getDownstreamPhases(3)).toEqual([4]);
    });

    it('returns empty array for final phase', async () => {
      const { getDownstreamPhases } = await loadRewind();
      expect(getDownstreamPhases(4)).toEqual([]);
    });

    it('returns all phases when rewinding to Scout', async () => {
      const { getDownstreamPhases } = await loadRewind();
      expect(getDownstreamPhases(-1)).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('getPhaseArtifacts', () => {
    it('returns primary and secondary artifacts', async () => {
      const { getPhaseArtifacts } = await loadRewind();
      const artifacts = getPhaseArtifacts(0);
      expect(artifacts).toContain('specs/challenger-brief.md');
      expect(artifacts).toContain('specs/insights/challenger-brief-insights.md');
    });

    it('returns empty for invalid phase', async () => {
      const { getPhaseArtifacts } = await loadRewind();
      expect(getPhaseArtifacts(99)).toEqual([]);
    });
  });

  describe('archiveArtifacts', () => {
    it('archives existing files', async () => {
      const { archiveArtifacts } = await loadRewind();
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\nContent');

      const result = archiveArtifacts(['specs/prd.md'], 'test rewind', { root: tmpDir });

      expect(result.archived).toHaveLength(1);
      expect(result.archived[0].original).toBe('specs/prd.md');
      expect(existsSync(result.archived[0].archived_to)).toBe(true);
      // Meta file exists
      expect(existsSync(result.archived[0].archived_to + '.meta.json')).toBe(true);
    });

    it('skips non-existent files', async () => {
      const { archiveArtifacts } = await loadRewind();
      const result = archiveArtifacts(['specs/nonexistent.md'], 'test', { root: tmpDir });

      expect(result.archived).toHaveLength(0);
      expect(result.skipped).toContain('specs/nonexistent.md');
    });

    it('archives multiple files at once', async () => {
      const { archiveArtifacts } = await loadRewind();
      writeArtifact(tmpDir, 'specs/prd.md');
      writeArtifact(tmpDir, 'specs/architecture.md');

      const result = archiveArtifacts(
        ['specs/prd.md', 'specs/architecture.md'],
        'cascade',
        { root: tmpDir }
      );

      expect(result.archived).toHaveLength(2);
    });

    it('writes metadata with operation field', async () => {
      const { archiveArtifacts } = await loadRewind();
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD');

      const result = archiveArtifacts(['specs/prd.md'], 'rewind test', { root: tmpDir });
      const meta = JSON.parse(readFileSync(result.archived[0].archived_to + '.meta.json', 'utf8'));

      expect(meta.operation).toBe('rewind');
      expect(meta.reason).toBe('rewind test');
      expect(meta.original_path).toBe('specs/prd.md');
    });
  });

  describe('rewindToPhase', () => {
    it('rejects invalid phase numbers', async () => {
      const { rewindToPhase } = await loadRewind();
      const result = rewindToPhase(99, { root: tmpDir });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid phase');
    });

    it('returns success with no changes for final phase', async () => {
      const { rewindToPhase } = await loadRewind();
      writeState(tmpDir, {
        version: '1.0.0', current_phase: 4, current_agent: 'developer',
        current_step: null, last_completed_step: null,
        active_artifacts: [], approved_artifacts: [], phase_history: [],
        last_updated: null, resume_context: null
      });

      const result = rewindToPhase(4, {
        root: tmpDir,
        statePath: join(tmpDir, '.jumpstart', 'state', 'state.json')
      });

      expect(result.success).toBe(true);
      expect(result.archived).toEqual([]);
      expect(result.invalidated_phases).toEqual([]);
    });

    it('archives downstream artifacts when rewinding', async () => {
      const { rewindToPhase } = await loadRewind();
      // Set up Phase 2 and Phase 3 artifacts
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\nContent');
      writeArtifact(tmpDir, 'specs/architecture.md', '# Arch\nContent');
      writeArtifact(tmpDir, 'specs/implementation-plan.md', '# Plan\nContent');
      writeState(tmpDir, {
        version: '1.0.0', current_phase: 3, current_agent: 'architect',
        current_step: null, last_completed_step: null,
        active_artifacts: [], approved_artifacts: ['specs/prd.md', 'specs/architecture.md'],
        phase_history: [
          { phase: 1, agent: 'analyst', completed_at: '2026-01-01' },
          { phase: 2, agent: 'pm', completed_at: '2026-01-02' },
          { phase: 3, agent: 'architect', completed_at: '2026-01-03' }
        ],
        last_updated: null, resume_context: null
      });

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = rewindToPhase(1, { root: tmpDir, statePath });

      expect(result.success).toBe(true);
      expect(result.rewound_to).toBe(1);
      expect(result.phase_name).toBe('Analyst');
      // PRD (phase 2) and architecture (phase 3) should be archived
      const archivedOriginals = result.archived.map(a => a.original);
      expect(archivedOriginals).toContain('specs/prd.md');
      expect(archivedOriginals).toContain('specs/architecture.md');
      expect(archivedOriginals).toContain('specs/implementation-plan.md');
    });

    it('resets state correctly', async () => {
      const { rewindToPhase } = await loadRewind();
      writeArtifact(tmpDir, 'specs/prd.md');
      writeArtifact(tmpDir, 'specs/architecture.md');
      writeState(tmpDir, {
        version: '1.0.0', current_phase: 3, current_agent: 'architect',
        current_step: 5, last_completed_step: 4,
        active_artifacts: [], approved_artifacts: ['specs/challenger-brief.md', 'specs/product-brief.md', 'specs/prd.md', 'specs/architecture.md'],
        phase_history: [
          { phase: 0, agent: 'challenger', completed_at: '2026-01-01' },
          { phase: 1, agent: 'analyst', completed_at: '2026-01-02' },
          { phase: 2, agent: 'pm', completed_at: '2026-01-03' },
          { phase: 3, agent: 'architect', completed_at: '2026-01-04' }
        ],
        last_updated: null, resume_context: null
      });

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      rewindToPhase(1, { root: tmpDir, statePath });

      const state = loadStateFromDisk(tmpDir);
      expect(state.current_phase).toBe(1);
      expect(state.current_agent).toBe('analyst');
      expect(state.current_step).toBe(null);
      // Phase 2, 3 removed from approved_artifacts
      expect(state.approved_artifacts).toContain('specs/challenger-brief.md');
      expect(state.approved_artifacts).toContain('specs/product-brief.md');
      expect(state.approved_artifacts).not.toContain('specs/prd.md');
      expect(state.approved_artifacts).not.toContain('specs/architecture.md');
      // Phase history filtered
      expect(state.phase_history.map(h => h.phase)).toContain(0);
      expect(state.phase_history.map(h => h.phase)).toContain(1);
      expect(state.phase_history.map(h => h.phase)).not.toContain(2);
      expect(state.phase_history.map(h => h.phase)).not.toContain(3);
    });

    it('updates resume_context with rewind info', async () => {
      const { rewindToPhase } = await loadRewind();
      writeState(tmpDir, {
        version: '1.0.0', current_phase: 2, current_agent: 'pm',
        current_step: null, last_completed_step: null,
        active_artifacts: [], approved_artifacts: [],
        phase_history: [], last_updated: null, resume_context: null
      });

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      rewindToPhase(0, { root: tmpDir, statePath });

      const state = loadStateFromDisk(tmpDir);
      expect(state.resume_context).toBeDefined();
      expect(state.resume_context.last_action).toContain('rewind');
      expect(state.resume_context.last_phase).toBe(0);
    });

    it('reports state changes correctly', async () => {
      const { rewindToPhase } = await loadRewind();
      writeArtifact(tmpDir, 'specs/prd.md');
      writeState(tmpDir, {
        version: '1.0.0', current_phase: 3, current_agent: 'architect',
        current_step: null, last_completed_step: null,
        active_artifacts: [], approved_artifacts: ['specs/prd.md'],
        phase_history: [{ phase: 2, agent: 'pm', completed_at: '2026-01-01' }],
        last_updated: null, resume_context: null
      });

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = rewindToPhase(1, { root: tmpDir, statePath });

      expect(result.state_changes.previous_phase).toBe(3);
      expect(result.state_changes.new_phase).toBe(1);
      expect(result.state_changes.removed_approvals).toContain('specs/prd.md');
    });

    it('handles custom reason', async () => {
      const { rewindToPhase } = await loadRewind();
      writeState(tmpDir, {
        version: '1.0.0', current_phase: 2, current_agent: 'pm',
        current_step: null, last_completed_step: null,
        active_artifacts: [], approved_artifacts: [],
        phase_history: [], last_updated: null, resume_context: null
      });

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = rewindToPhase(0, {
        root: tmpDir, statePath,
        reason: 'Requirements changed'
      });

      expect(result.success).toBe(true);
      const state = loadStateFromDisk(tmpDir);
      expect(state.resume_context.key_insights[0]).toContain('Requirements changed');
    });
  });

  describe('renderRewindReport', () => {
    it('shows error for failed rewind', async () => {
      const { renderRewindReport } = await loadRewind();
      const report = renderRewindReport({ success: false, error: 'Bad phase' });
      expect(report).toContain('Bad phase');
    });

    it('shows archived artifacts', async () => {
      const { renderRewindReport } = await loadRewind();
      const report = renderRewindReport({
        success: true,
        rewound_to: 1,
        phase_name: 'Analyst',
        archived: [{ original: 'specs/prd.md', archived_to: '/tmp/prd.2026.md' }],
        skipped: [],
        invalidated_phases: [{ phase: 2, name: 'PM', artifacts: [] }],
        state_changes: { previous_phase: 3, new_phase: 1, removed_approvals: [], removed_history_entries: 1 }
      });
      expect(report).toContain('specs/prd.md');
      expect(report).toContain('Analyst');
      expect(report).toContain('Phase 2');
    });

    it('shows skipped files', async () => {
      const { renderRewindReport } = await loadRewind();
      const report = renderRewindReport({
        success: true,
        rewound_to: 0,
        phase_name: 'Challenger',
        archived: [],
        skipped: ['specs/product-brief.md'],
        invalidated_phases: [],
        state_changes: { previous_phase: 1, new_phase: 0, removed_approvals: [] }
      });
      expect(report).toContain('specs/product-brief.md');
    });
  });
});
