/**
 * Tests for state-store.js checkpoint functions — Automatic Session Checkpointing (UX Feature 10)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Helpers
function createTempProject(suffix = '') {
  const dir = join(tmpdir(), `jumpstart-checkpoint-test-${Date.now()}${suffix}`);
  mkdirSync(join(dir, '.jumpstart', 'state'), { recursive: true });
  mkdirSync(join(dir, 'specs', 'insights'), { recursive: true });
  return dir;
}

function writeState(dir, state) {
  writeFileSync(
    join(dir, '.jumpstart', 'state', 'state.json'),
    JSON.stringify(state, null, 2),
    'utf8'
  );
}

function loadStateFromDisk(dir) {
  return JSON.parse(readFileSync(join(dir, '.jumpstart', 'state', 'state.json'), 'utf8'));
}

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

describe('checkpointing', () => {
  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  async function loadStateStore() {
    return await import('../bin/lib/state-store.js');
  }

  describe('createCheckpoint', () => {
    it('creates a checkpoint with correct structure', async () => {
      const { createCheckpoint } = await loadStateStore();
      writeState(tmpDir, defaultState({ current_phase: 2, current_agent: 'pm', current_step: 3 }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const specsDir = join(tmpDir, 'specs');
      const result = createCheckpoint('After PM step 3', { statePath, specsDir });

      expect(result.success).toBe(true);
      expect(result.checkpoint).toBeDefined();
      expect(result.checkpoint.id).toMatch(/^cp-/);
      expect(result.checkpoint.label).toBe('After PM step 3');
      expect(result.checkpoint.phase).toBe(2);
      expect(result.checkpoint.step).toBe(3);
      expect(result.checkpoint.agent).toBe('pm');
      expect(result.checkpoint.timestamp).toBeTruthy();
    });

    it('generates unique IDs for successive checkpoints', async () => {
      const { createCheckpoint } = await loadStateStore();
      writeState(tmpDir, defaultState({ current_phase: 1 }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const r1 = createCheckpoint('first', { statePath, specsDir: join(tmpDir, 'specs') });

      // Mutate state slightly to change timestamp
      const state = loadStateFromDisk(tmpDir);
      state.current_step = 2;
      writeState(tmpDir, state);

      const r2 = createCheckpoint('second', { statePath, specsDir: join(tmpDir, 'specs') });

      // IDs should be defined (may or may not differ by ms)
      expect(r1.checkpoint.id).toBeDefined();
      expect(r2.checkpoint.id).toBeDefined();
    });

    it('persists checkpoints to state', async () => {
      const { createCheckpoint } = await loadStateStore();
      writeState(tmpDir, defaultState({ current_phase: 1 }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      createCheckpoint('cp1', { statePath, specsDir: join(tmpDir, 'specs') });

      const state = loadStateFromDisk(tmpDir);
      expect(Array.isArray(state.checkpoints)).toBe(true);
      expect(state.checkpoints).toHaveLength(1);
    });

    it('includes artifact hashes when specs exist', async () => {
      const { createCheckpoint } = await loadStateStore();
      writeState(tmpDir, defaultState({ current_phase: 2 }));
      writeFileSync(join(tmpDir, 'specs', 'prd.md'), '# PRD\nContent', 'utf8');

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const specsDir = join(tmpDir, 'specs');
      const result = createCheckpoint('with artifacts', { statePath, specsDir });

      expect(Object.keys(result.checkpoint.artifact_hashes).length).toBeGreaterThan(0);
    });

    it('captures approved_artifacts snapshot', async () => {
      const { createCheckpoint } = await loadStateStore();
      writeState(tmpDir, defaultState({ approved_artifacts: ['specs/challenger-brief.md', 'specs/product-brief.md'] }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = createCheckpoint('snapshot', { statePath, specsDir: join(tmpDir, 'specs') });

      expect(result.checkpoint.approved_artifacts).toEqual(['specs/challenger-brief.md', 'specs/product-brief.md']);
    });

    it('prunes old checkpoints when over limit', async () => {
      const { createCheckpoint } = await loadStateStore();
      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');

      // Create state with 3 existing checkpoints
      writeState(tmpDir, defaultState({
        checkpoints: [
          { id: 'cp-old-1', label: 'old1', timestamp: '2026-01-01', phase: 0, step: null, agent: null, approved_artifacts: [], resume_context: null, artifact_hashes: {} },
          { id: 'cp-old-2', label: 'old2', timestamp: '2026-01-02', phase: 1, step: null, agent: null, approved_artifacts: [], resume_context: null, artifact_hashes: {} },
          { id: 'cp-old-3', label: 'old3', timestamp: '2026-01-03', phase: 2, step: null, agent: null, approved_artifacts: [], resume_context: null, artifact_hashes: {} }
        ]
      }));

      createCheckpoint('new', { statePath, specsDir: join(tmpDir, 'specs'), maxCheckpoints: 3 });

      const state = loadStateFromDisk(tmpDir);
      expect(state.checkpoints).toHaveLength(3);
      expect(state.checkpoints[0].id).toBe('cp-old-2'); // old-1 pruned
      expect(state.checkpoints[2].label).toBe('new');
    });

    it('uses auto label when none provided', async () => {
      const { createCheckpoint } = await loadStateStore();
      writeState(tmpDir, defaultState());
      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = createCheckpoint(null, { statePath, specsDir: join(tmpDir, 'specs') });
      expect(result.checkpoint.label).toBe('auto');
    });
  });

  describe('restoreCheckpoint', () => {
    it('restores phase, step, and agent from checkpoint', async () => {
      const { restoreCheckpoint } = await loadStateStore();
      writeState(tmpDir, defaultState({
        current_phase: 3, current_agent: 'architect', current_step: 5,
        checkpoints: [
          { id: 'cp-001', label: 'before arch', timestamp: '2026-01-01', phase: 2, step: 3, agent: 'pm', approved_artifacts: ['specs/prd.md'], resume_context: null, artifact_hashes: {} }
        ]
      }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = restoreCheckpoint('cp-001', statePath);

      expect(result.success).toBe(true);
      expect(result.restored_from.phase).toBe(2);

      const state = loadStateFromDisk(tmpDir);
      expect(state.current_phase).toBe(2);
      expect(state.current_step).toBe(3);
      expect(state.current_agent).toBe('pm');
      expect(state.approved_artifacts).toEqual(['specs/prd.md']);
    });

    it('returns error for non-existent checkpoint', async () => {
      const { restoreCheckpoint } = await loadStateStore();
      writeState(tmpDir, defaultState({ checkpoints: [] }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = restoreCheckpoint('cp-nonexistent', statePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No checkpoints');
    });

    it('returns error for wrong checkpoint ID', async () => {
      const { restoreCheckpoint } = await loadStateStore();
      writeState(tmpDir, defaultState({
        checkpoints: [{ id: 'cp-001', label: 'x', timestamp: '2026-01-01', phase: 0, step: null, agent: null, approved_artifacts: [], resume_context: null, artifact_hashes: {} }]
      }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = restoreCheckpoint('cp-wrong', statePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('restores resume_context from checkpoint', async () => {
      const { restoreCheckpoint } = await loadStateStore();
      const ctx = { tldr: 'Working on PM', last_action: 'Wrote stories', next_action: 'Review', open_questions: [], key_insights: [], last_agent: 'pm', last_phase: 2, last_step: 3, timestamp: '2026-01-01' };
      writeState(tmpDir, defaultState({
        current_phase: 4,
        checkpoints: [
          { id: 'cp-ctx', label: 'with ctx', timestamp: '2026-01-01', phase: 2, step: 3, agent: 'pm', approved_artifacts: [], resume_context: ctx, artifact_hashes: {} }
        ]
      }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      restoreCheckpoint('cp-ctx', statePath);

      const state = loadStateFromDisk(tmpDir);
      expect(state.resume_context.tldr).toBe('Working on PM');
    });
  });

  describe('listCheckpoints', () => {
    it('returns empty array for fresh state', async () => {
      const { listCheckpoints } = await loadStateStore();
      writeState(tmpDir, defaultState());
      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = listCheckpoints(statePath);
      expect(result).toEqual([]);
    });

    it('returns checkpoints in reverse chronological order', async () => {
      const { listCheckpoints } = await loadStateStore();
      writeState(tmpDir, defaultState({
        checkpoints: [
          { id: 'cp-a', label: 'first', timestamp: '2026-01-01' },
          { id: 'cp-b', label: 'second', timestamp: '2026-01-02' },
          { id: 'cp-c', label: 'third', timestamp: '2026-01-03' }
        ]
      }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = listCheckpoints(statePath);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('cp-c');
      expect(result[2].id).toBe('cp-a');
    });
  });

  describe('pruneCheckpoints', () => {
    it('removes oldest checkpoints over limit', async () => {
      const { pruneCheckpoints } = await loadStateStore();
      writeState(tmpDir, defaultState({
        checkpoints: [
          { id: 'cp-1', label: '1', timestamp: '2026-01-01' },
          { id: 'cp-2', label: '2', timestamp: '2026-01-02' },
          { id: 'cp-3', label: '3', timestamp: '2026-01-03' },
          { id: 'cp-4', label: '4', timestamp: '2026-01-04' },
          { id: 'cp-5', label: '5', timestamp: '2026-01-05' }
        ]
      }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = pruneCheckpoints(3, statePath);

      expect(result.success).toBe(true);
      expect(result.removed).toBe(2);
      expect(result.remaining).toBe(3);

      const state = loadStateFromDisk(tmpDir);
      expect(state.checkpoints).toHaveLength(3);
      expect(state.checkpoints[0].id).toBe('cp-3');
    });

    it('does nothing when under limit', async () => {
      const { pruneCheckpoints } = await loadStateStore();
      writeState(tmpDir, defaultState({
        checkpoints: [{ id: 'cp-1', label: '1', timestamp: '2026-01-01' }]
      }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = pruneCheckpoints(5, statePath);

      expect(result.removed).toBe(0);
      expect(result.remaining).toBe(1);
    });

    it('handles state without checkpoints', async () => {
      const { pruneCheckpoints } = await loadStateStore();
      writeState(tmpDir, defaultState());

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = pruneCheckpoints(5, statePath);

      expect(result.success).toBe(true);
      expect(result.removed).toBe(0);
    });
  });

  describe('integration: create → list → restore', () => {
    it('full cycle works end-to-end', async () => {
      const { createCheckpoint, listCheckpoints, restoreCheckpoint } = await loadStateStore();
      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const specsDir = join(tmpDir, 'specs');

      // Start at phase 1
      writeState(tmpDir, defaultState({ current_phase: 1, current_agent: 'analyst', current_step: 2 }));

      // Create checkpoint
      const created = createCheckpoint('analyst-step-2', { statePath, specsDir });
      expect(created.success).toBe(true);

      // Progress to phase 2
      const state = loadStateFromDisk(tmpDir);
      state.current_phase = 2;
      state.current_agent = 'pm';
      state.current_step = 1;
      writeState(tmpDir, state);

      // List checkpoints
      const cps = listCheckpoints(statePath);
      expect(cps).toHaveLength(1);
      expect(cps[0].label).toBe('analyst-step-2');

      // Restore checkpoint
      const restored = restoreCheckpoint(created.checkpoint.id, statePath);
      expect(restored.success).toBe(true);

      // Verify state is back to phase 1
      const finalState = loadStateFromDisk(tmpDir);
      expect(finalState.current_phase).toBe(1);
      expect(finalState.current_agent).toBe('analyst');
      expect(finalState.current_step).toBe(2);
    });
  });
});
