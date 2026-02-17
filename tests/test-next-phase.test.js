/**
 * test-next-phase.test.js — Tests for Auto-Pilot Phase Progression (UX Feature 1)
 *
 * Tests for bin/lib/next-phase.js covering:
 * - Fresh project (no state) → recommends /jumpstart.challenge
 * - Brownfield project → recommends /jumpstart.scout
 * - Mid-phase (unapproved artifact) → recommends approval
 * - Approved artifact → recommends next phase
 * - Final phase (Phase 4) → recommends completion
 * - Missing config → recommends initialization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');

// Helper: create a temporary project directory
function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-test-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

// Helper: write a minimal config.yaml
function writeConfig(tmpDir, overrides = {}) {
  const config = {
    project: { type: overrides.projectType || 'greenfield', name: 'test' },
    workflow: { require_gate_approval: true, ...overrides.workflow },
    ...overrides
  };
  // Write as simple YAML
  const lines = [];
  function writeObj(obj, indent = 0) {
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        lines.push(' '.repeat(indent) + `${key}:`);
        writeObj(value, indent + 2);
      } else {
        lines.push(' '.repeat(indent) + `${key}: ${value}`);
      }
    }
  }
  writeObj(config);
  fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'config.yaml'), lines.join('\n'), 'utf8');
}

// Helper: write state.json
function writeState(tmpDir, state) {
  fs.writeFileSync(
    path.join(tmpDir, '.jumpstart', 'state', 'state.json'),
    JSON.stringify(state, null, 2),
    'utf8'
  );
}

// Helper: write a spec artifact with approval status
function writeArtifact(tmpDir, relPath, approved = false) {
  const fullPath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  const approvalSection = approved
    ? `## Phase Gate Approval\n\n- [x] All criteria met\n- [x] Quality gates passed\n\n**Approved by:** Human`
    : `## Phase Gate Approval\n\n- [ ] All criteria met\n- [ ] Quality gates passed\n\n**Approved by:** Pending`;

  fs.writeFileSync(fullPath, `# Test Artifact\n\nContent here.\n\n${approvalSection}\n`, 'utf8');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('determineNextAction', () => {
  let tmpDir;
  let determineNextAction;

  beforeEach(async () => {
    tmpDir = createTempProject();
    // Dynamic import to get the ESM module
    const mod = await import('../bin/lib/next-phase.js');
    determineNextAction = mod.determineNextAction;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── No config → init ───────────────────────────────────────────────────

  it('recommends initialization when config is missing', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-empty-'));
    try {
      const result = determineNextAction({ root: emptyDir });
      expect(result.action).toBe('init');
      expect(result.command).toContain('jumpstart-mode');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  // ─── Fresh greenfield → challenge ───────────────────────────────────────

  it('recommends /jumpstart.challenge for fresh greenfield project', () => {
    writeConfig(tmpDir, { projectType: 'greenfield' });
    const result = determineNextAction({ root: tmpDir });
    expect(result.action).toBe('start');
    expect(result.next_phase).toBe(0);
    expect(result.next_agent).toBe('challenger');
    expect(result.command).toBe('/jumpstart.challenge');
  });

  // ─── Fresh brownfield → scout ──────────────────────────────────────────

  it('recommends /jumpstart.scout for fresh brownfield project', () => {
    writeConfig(tmpDir, { projectType: 'brownfield' });
    const result = determineNextAction({ root: tmpDir });
    expect(result.action).toBe('start');
    expect(result.next_phase).toBe(-1);
    expect(result.next_agent).toBe('scout');
    expect(result.command).toBe('/jumpstart.scout');
  });

  // ─── Brownfield with unapproved scout artifact ─────────────────────────

  it('recommends approval when scout artifact exists but is unapproved', () => {
    writeConfig(tmpDir, { projectType: 'brownfield' });
    writeArtifact(tmpDir, 'specs/codebase-context.md', false);
    const result = determineNextAction({ root: tmpDir });
    expect(result.action).toBe('approve');
    expect(result.current_phase).toBe(-1);
  });

  // ─── Brownfield with approved scout → challenger ───────────────────────

  it('recommends /jumpstart.challenge after approved scout', () => {
    writeConfig(tmpDir, { projectType: 'brownfield' });
    writeArtifact(tmpDir, 'specs/codebase-context.md', true);
    const result = determineNextAction({ root: tmpDir });
    expect(result.action).toBe('proceed');
    expect(result.next_phase).toBe(0);
    expect(result.next_agent).toBe('challenger');
    expect(result.command).toBe('/jumpstart.challenge');
  });

  // ─── Existing approved challenger → analyst ────────────────────────────

  it('recommends /jumpstart.analyze when challenger brief is approved', () => {
    writeConfig(tmpDir);
    writeArtifact(tmpDir, 'specs/challenger-brief.md', true);
    // State is null (not tracked) but artifact exists
    const result = determineNextAction({ root: tmpDir });
    expect(result.action).toBe('proceed');
    expect(result.next_phase).toBe(1);
    expect(result.next_agent).toBe('analyst');
    expect(result.command).toBe('/jumpstart.analyze');
  });

  // ─── Unapproved current artifact → approve ────────────────────────────

  it('recommends approval when current phase artifact is unapproved', () => {
    writeConfig(tmpDir);
    writeState(tmpDir, {
      current_phase: 1,
      current_agent: 'analyst',
      approved_artifacts: ['specs/challenger-brief.md']
    });
    writeArtifact(tmpDir, 'specs/product-brief.md', false);

    const result = determineNextAction({ root: tmpDir });
    expect(result.action).toBe('approve');
    expect(result.current_phase).toBe(1);
    expect(result.artifact).toBe('specs/product-brief.md');
  });

  // ─── Approved current artifact → next phase ───────────────────────────

  it('recommends next phase when current artifact is approved', () => {
    writeConfig(tmpDir);
    writeState(tmpDir, {
      current_phase: 2,
      current_agent: 'pm',
      approved_artifacts: ['specs/challenger-brief.md', 'specs/product-brief.md']
    });
    writeArtifact(tmpDir, 'specs/prd.md', true);

    const result = determineNextAction({ root: tmpDir });
    expect(result.action).toBe('proceed');
    expect(result.next_phase).toBe(3);
    expect(result.next_agent).toBe('architect');
    expect(result.command).toBe('/jumpstart.architect');
  });

  // ─── Final phase → complete ────────────────────────────────────────────

  it('recommends completion when on Phase 4', () => {
    writeConfig(tmpDir);
    writeState(tmpDir, {
      current_phase: 4,
      current_agent: 'developer'
    });

    const result = determineNextAction({ root: tmpDir });
    expect(result.action).toBe('complete');
    expect(result.current_phase).toBe(4);
    expect(result.next_phase).toBeNull();
  });

  // ─── Missing artifact mid-phase → continue ────────────────────────────

  it('recommends continuing when current artifact does not exist yet', () => {
    writeConfig(tmpDir);
    writeState(tmpDir, {
      current_phase: 1,
      current_agent: 'analyst'
    });
    // product-brief.md does NOT exist

    const result = determineNextAction({ root: tmpDir });
    expect(result.action).toBe('continue');
    expect(result.current_phase).toBe(1);
  });

  // ─── Result always has required fields ─────────────────────────────────

  it('always returns action, current_phase, next_phase, command, message', () => {
    writeConfig(tmpDir);
    const result = determineNextAction({ root: tmpDir });
    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('current_phase');
    expect(result).toHaveProperty('next_phase');
    expect(result).toHaveProperty('command');
    expect(result).toHaveProperty('message');
  });
});
