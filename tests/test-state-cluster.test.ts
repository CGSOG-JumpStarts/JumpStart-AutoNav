/**
 * test-state-cluster.test.ts — T4.3.2 State cluster tests.
 *
 * Coverage for the 6 ports landed together:
 *   - state-store.ts: load/save/update/sync/checkpoint
 *   - ceremony.ts: VALID_PROFILES + applyProfile + compareProfiles
 *   - approve.ts: approveArtifact / rejectArtifact / detectCurrentArtifact
 *   - rewind.ts: rewindToPhase + getDownstreamPhases + archiveArtifacts
 *   - focus.ts: presets + buildFocusConfig + read/write
 *   - next-phase.ts: determineNextAction
 *
 * @see bin/lib-ts/{state-store,ceremony,approve,rewind,focus,next-phase}.ts
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approveArtifact, detectCurrentArtifact, rejectArtifact } from '../bin/lib-ts/approve.js';
import {
  applyProfile,
  compareProfiles,
  expandProfile,
  VALID_PROFILES,
} from '../bin/lib-ts/ceremony.js';
import {
  buildFocusConfig,
  clearFocusFromConfig,
  getFocusStatus,
  getPhasesInRange,
  isPhaseInFocus,
  listPresets,
  readFocusFromConfig,
  VALID_PRESETS,
  validatePhaseRange,
  writeFocusToConfig,
} from '../bin/lib-ts/focus.js';
import { determineNextAction } from '../bin/lib-ts/next-phase.js';
import {
  archiveArtifacts,
  getDownstreamPhases,
  getPhaseArtifacts,
  PHASE_ORDER,
  rewindToPhase,
} from '../bin/lib-ts/rewind.js';
import {
  createCheckpoint,
  listCheckpoints,
  loadState,
  pruneCheckpoints,
  resetState,
  restoreCheckpoint,
  saveState,
  updateState,
} from '../bin/lib-ts/state-store.js';

let tmpRoot: string;
let statePath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'state-cluster-test-'));
  mkdirSync(path.join(tmpRoot, '.jumpstart', 'state'), { recursive: true });
  statePath = path.join(tmpRoot, '.jumpstart', 'state', 'state.json');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────
// state-store.ts
// ─────────────────────────────────────────────────────────────────────────

describe('state-store — load/save/update', () => {
  it('returns default state when no file exists', () => {
    const s = loadState(statePath);
    expect(s.version).toBe('1.0.0');
    expect(s.current_phase).toBeNull();
    expect(s.approved_artifacts).toEqual([]);
  });
  it('round-trips via save/load', () => {
    const s = loadState(statePath);
    s.current_phase = 2;
    saveState(s, statePath);
    expect(loadState(statePath).current_phase).toBe(2);
  });
  it('updateState transitions phase and pushes to phase_history', () => {
    updateState({ phase: 0, agent: 'challenger' }, statePath);
    updateState({ phase: 1, agent: 'analyst' }, statePath);
    const s = loadState(statePath);
    expect(s.current_phase).toBe(1);
    expect(s.phase_history.length).toBe(1);
    expect(s.phase_history[0].phase).toBe(0);
  });
  it('updateState dedupes approved_artifacts', () => {
    updateState({ approved_artifact: 'specs/prd.md' }, statePath);
    updateState({ approved_artifact: 'specs/prd.md' }, statePath);
    const s = loadState(statePath);
    expect(s.approved_artifacts.length).toBe(1);
  });
  it('resetState resets to defaults', () => {
    updateState({ phase: 3 }, statePath);
    resetState(statePath);
    expect(loadState(statePath).current_phase).toBeNull();
  });
});

describe('state-store — checkpoints', () => {
  it('createCheckpoint persists snapshot', () => {
    updateState({ phase: 1, agent: 'analyst' }, statePath);
    const result = createCheckpoint('test', { statePath });
    expect(result.success).toBe(true);
    expect(result.checkpoint.phase).toBe(1);
    expect(result.checkpoint.id).toMatch(/^cp-/);
  });
  it('listCheckpoints returns most-recent-first', () => {
    createCheckpoint('first', { statePath });
    createCheckpoint('second', { statePath });
    const list = listCheckpoints(statePath);
    expect(list[0].label).toBe('second');
  });
  it('restoreCheckpoint restores phase + step + agent', () => {
    updateState({ phase: 0, agent: 'challenger' }, statePath);
    const cp = createCheckpoint('mark', { statePath }).checkpoint;
    updateState({ phase: 3, agent: 'architect' }, statePath);
    const restored = restoreCheckpoint(cp.id, statePath);
    expect(restored.success).toBe(true);
    expect(loadState(statePath).current_phase).toBe(0);
  });
  it('restoreCheckpoint returns error on unknown id', () => {
    expect(restoreCheckpoint('cp-nonexistent', statePath).success).toBe(false);
  });
  it('pruneCheckpoints keeps N most recent', () => {
    for (let i = 0; i < 5; i++) {
      createCheckpoint(`cp-${i}`, { statePath });
    }
    const pruned = pruneCheckpoints(2, statePath);
    expect(pruned.removed).toBe(3);
    expect(pruned.remaining).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ceremony.ts
// ─────────────────────────────────────────────────────────────────────────

describe('ceremony — VALID_PROFILES + expandProfile', () => {
  it('exports 3 profiles', () => {
    expect(VALID_PROFILES).toEqual(['light', 'standard', 'rigorous']);
  });
  it('expandProfile returns dot-notation map', () => {
    const settings = expandProfile('light');
    expect(settings['agents.challenger.elicitation_depth']).toBe('quick');
  });
  it('expandProfile throws on unknown', () => {
    expect(() => expandProfile('mystery')).toThrow(/Unknown ceremony profile/);
  });
});

describe('ceremony — applyProfile + compareProfiles', () => {
  it('fills missing keys, skips existing', () => {
    const result = applyProfile(
      { agents: { challenger: { elicitation_depth: 'custom' } } },
      'light'
    );
    // User-supplied value wins
    expect(
      (result.config.agents as { challenger: { elicitation_depth: string } }).challenger
        .elicitation_depth
    ).toBe('custom');
    expect(result.skipped).toContain('agents.challenger.elicitation_depth');
    // Other light-profile keys filled in
    expect(result.applied.length).toBeGreaterThan(0);
  });
  it('compareProfiles surfaces differences', () => {
    const diffs = compareProfiles('light', 'rigorous');
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.every((d) => d.setting && d.light !== d.rigorous)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// approve.ts
// ─────────────────────────────────────────────────────────────────────────

function writeArtifact(rel: string, body: string): string {
  const full = path.join(tmpRoot, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
  return full;
}

describe('approve — approveArtifact / rejectArtifact', () => {
  it('approves an artifact with a Phase Gate section', () => {
    writeArtifact(
      'specs/prd.md',
      [
        '# PRD',
        '',
        '## Phase Gate Approval',
        '',
        '- [ ] Phase 2 ready',
        '',
        '**Approved by:** Pending',
        '**Approval date:** Pending',
        '**Status:** Draft',
        '',
      ].join('\n')
    );
    writeArtifact(
      '.jumpstart/config.yaml',
      'workflow:\n  auto_handoff: false\n  current_phase: "2"\n'
    );
    updateState({ phase: 2 }, statePath);
    const result = approveArtifact('specs/prd.md', { root: tmpRoot, approver: 'Sam' });
    expect(result.success).toBe(true);
    const content = readFileSync(path.join(tmpRoot, 'specs/prd.md'), 'utf8');
    expect(content).toContain('**Status:** Approved');
    expect(content).toContain('**Approved by:** Sam');
    expect(content).toContain('- [x]');
  });

  it('rejects an artifact and logs to rejection-log.md', () => {
    writeArtifact(
      'specs/prd.md',
      [
        '## Phase Gate Approval',
        '- [x] OK',
        '**Approved by:** Sam',
        '**Approval date:** 2026-04-27',
        '**Status:** Approved',
      ].join('\n')
    );
    const r = rejectArtifact('specs/prd.md', { root: tmpRoot, reason: 'rework' });
    expect(r.success).toBe(true);
    expect(existsSync(path.join(tmpRoot, 'specs/insights/rejection-log.md'))).toBe(true);
  });

  it('detectCurrentArtifact reports phase + path', () => {
    updateState({ phase: 2 }, statePath);
    writeArtifact('specs/prd.md', '# PRD\n');
    const d = detectCurrentArtifact({ root: tmpRoot, statePath });
    expect(d.phase).toBe(2);
    expect(d.artifact_path).toBe('specs/prd.md');
    expect(d.exists).toBe(true);
  });

  it('approve returns error when artifact missing', () => {
    const r = approveArtifact('specs/no-such.md', { root: tmpRoot });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Artifact not found/);
  });

  it('approve returns error when no Phase Gate section', () => {
    writeArtifact('specs/no-gate.md', '# Heading only');
    const r = approveArtifact('specs/no-gate.md', { root: tmpRoot });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Phase Gate Approval/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// rewind.ts
// ─────────────────────────────────────────────────────────────────────────

describe('rewind — phase order helpers', () => {
  it('PHASE_ORDER spans -1 to 4', () => {
    expect(PHASE_ORDER).toEqual([-1, 0, 1, 2, 3, 4]);
  });
  it('getDownstreamPhases returns strictly-greater', () => {
    expect(getDownstreamPhases(2)).toEqual([3, 4]);
  });
  it('getPhaseArtifacts merges primary + secondary', () => {
    expect(getPhaseArtifacts(3)).toContain('specs/architecture.md');
    expect(getPhaseArtifacts(3)).toContain('specs/insights/architecture-insights.md');
  });
});

describe('rewind — archiveArtifacts', () => {
  it('skips missing, archives present', () => {
    writeArtifact('specs/prd.md', 'pretend prd');
    const r = archiveArtifacts(['specs/prd.md', 'specs/missing.md'], 'test', {
      root: tmpRoot,
    });
    expect(r.archived.length).toBe(1);
    expect(r.skipped).toEqual(['specs/missing.md']);
  });
});

describe('rewind — rewindToPhase', () => {
  it('errors on invalid phase', () => {
    expect(rewindToPhase(99, { root: tmpRoot, statePath }).success).toBe(false);
  });
  it('rewinds and archives downstream artifacts', () => {
    writeArtifact('specs/prd.md', 'prd content');
    writeArtifact('specs/architecture.md', 'arch content');
    updateState({ phase: 3 }, statePath);
    const r = rewindToPhase(1, { root: tmpRoot, statePath });
    expect(r.success).toBe(true);
    expect(r.rewound_to).toBe(1);
    expect(r.invalidated_phases?.some((p) => p.phase === 3)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// focus.ts
// ─────────────────────────────────────────────────────────────────────────

describe('focus — VALID_PRESETS + listPresets', () => {
  it('exports 6 presets', () => {
    expect(VALID_PRESETS.length).toBe(6);
    expect(VALID_PRESETS).toContain('full');
    expect(VALID_PRESETS).toContain('business-analyst');
  });
  it('listPresets includes role and phase counts', () => {
    const list = listPresets();
    expect(list.length).toBe(6);
    expect(list[0]).toHaveProperty('role');
  });
});

describe('focus — validatePhaseRange', () => {
  it('rejects start > end', () => {
    expect(validatePhaseRange(3, 1).valid).toBe(false);
  });
  it('rejects out-of-range', () => {
    expect(validatePhaseRange(99, 0).valid).toBe(false);
  });
  it('accepts valid ranges', () => {
    expect(validatePhaseRange(0, 4).valid).toBe(true);
  });
});

describe('focus — buildFocusConfig + isPhaseInFocus + getPhasesInRange', () => {
  it('builds preset config', () => {
    const c = buildFocusConfig({ preset: 'business-analyst' });
    expect(c.start_phase).toBe(0);
    expect(c.end_phase).toBe(2);
  });
  it('builds custom range config', () => {
    const c = buildFocusConfig({ start_phase: 1, end_phase: 3 });
    expect(c.preset).toBeNull();
  });
  it('isPhaseInFocus respects range', () => {
    const c = buildFocusConfig({ start_phase: 1, end_phase: 2 });
    expect(isPhaseInFocus(2, c)).toBe(true);
    expect(isPhaseInFocus(3, c)).toBe(false);
  });
  it('getPhasesInRange enumerates phases', () => {
    expect(getPhasesInRange(0, 1).length).toBe(2);
  });
});

describe('focus — read/write/clear', () => {
  it('round-trips focus config in config.yaml', () => {
    const cfg = path.join(tmpRoot, '.jumpstart', 'config.yaml');
    writeFileSync(cfg, '# initial\nworkflow:\n  auto_handoff: true\n');
    const c = buildFocusConfig({ preset: 'discovery' });
    writeFocusToConfig(cfg, c);
    const reloaded = readFocusFromConfig(cfg);
    expect(reloaded?.enabled).toBe(true);
    expect(reloaded?.start_phase).toBe(0);
    expect(reloaded?.end_phase).toBe(1);
  });
  it('clearFocusFromConfig disables', () => {
    const cfg = path.join(tmpRoot, '.jumpstart', 'config.yaml');
    writeFileSync(cfg, 'focus:\n  enabled: true\n');
    clearFocusFromConfig(cfg);
    const r = readFocusFromConfig(cfg);
    expect(r).toBeNull(); // disabled focus = null per legacy
  });
  it('getFocusStatus reports inactive when no config', () => {
    const r = getFocusStatus({ root: path.join(tmpRoot, 'no-such') });
    expect(r.active).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// next-phase.ts
// ─────────────────────────────────────────────────────────────────────────

describe('next-phase — determineNextAction', () => {
  it('returns "init" when config.yaml missing', () => {
    const r = determineNextAction({ root: tmpRoot });
    expect(r.action).toBe('init');
  });

  it('greenfield ready-to-start', () => {
    writeFileSync(
      path.join(tmpRoot, '.jumpstart', 'config.yaml'),
      'project:\n  type: greenfield\n'
    );
    const r = determineNextAction({ root: tmpRoot, state_path: statePath });
    expect(r.action).toBe('start');
    expect(r.next_phase).toBe(0);
  });

  it('phase 4 returns complete', () => {
    writeFileSync(
      path.join(tmpRoot, '.jumpstart', 'config.yaml'),
      'project:\n  type: greenfield\n'
    );
    updateState({ phase: 4 }, statePath);
    const r = determineNextAction({ root: tmpRoot, state_path: statePath });
    expect(r.action).toBe('complete');
  });
});
