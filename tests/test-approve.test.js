/**
 * Tests for bin/lib/approve.js — Streamlined Approval & Rejection (UX Feature 4)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Helpers
function createTempProject(suffix = '') {
  const dir = join(tmpdir(), `jumpstart-approve-test-${Date.now()}${suffix}`);
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

const DRAFT_APPROVAL = `
## Phase Gate Approval

- [ ] Human has reviewed this artifact
- [ ] All required sections are populated
- [ ] Content traces to upstream artifacts
- [ ] Insights document has been maintained
- [ ] Human has explicitly approved this artifact

**Approved by:** Pending
**Approval date:** Pending
**Status:** Draft
`;

const ALREADY_APPROVED = `
## Phase Gate Approval

- [x] Human has reviewed this artifact
- [x] All required sections are populated
- [x] Content traces to upstream artifacts

**Approved by:** Jane
**Approval date:** 2026-01-01
**Status:** Approved
`;

function writeArtifact(dir, relPath, content) {
  const fullPath = join(dir, relPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
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

describe('approve', () => {
  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  async function loadApprove() {
    return await import('../bin/lib/approve.js');
  }

  describe('detectCurrentArtifact', () => {
    it('returns null phase when state has no current_phase', async () => {
      const { detectCurrentArtifact } = await loadApprove();
      writeState(tmpDir, defaultState());
      const result = detectCurrentArtifact({
        root: tmpDir,
        statePath: join(tmpDir, '.jumpstart', 'state', 'state.json')
      });
      expect(result.phase).toBe(null);
      expect(result.artifact_path).toBe(null);
    });

    it('detects challenger-brief for Phase 0', async () => {
      const { detectCurrentArtifact } = await loadApprove();
      writeState(tmpDir, defaultState({ current_phase: 0 }));
      writeArtifact(tmpDir, 'specs/challenger-brief.md', '# Brief');
      const result = detectCurrentArtifact({
        root: tmpDir,
        statePath: join(tmpDir, '.jumpstart', 'state', 'state.json')
      });
      expect(result.phase).toBe(0);
      expect(result.artifact_path).toBe('specs/challenger-brief.md');
      expect(result.exists).toBe(true);
    });

    it('detects PRD for Phase 2', async () => {
      const { detectCurrentArtifact } = await loadApprove();
      writeState(tmpDir, defaultState({ current_phase: 2 }));
      const result = detectCurrentArtifact({
        root: tmpDir,
        statePath: join(tmpDir, '.jumpstart', 'state', 'state.json')
      });
      expect(result.phase).toBe(2);
      expect(result.artifact_path).toBe('specs/prd.md');
      expect(result.exists).toBe(false);
    });

    it('returns null artifact for Phase 4 (Developer)', async () => {
      const { detectCurrentArtifact } = await loadApprove();
      writeState(tmpDir, defaultState({ current_phase: 4 }));
      const result = detectCurrentArtifact({
        root: tmpDir,
        statePath: join(tmpDir, '.jumpstart', 'state', 'state.json')
      });
      expect(result.phase).toBe(4);
      expect(result.artifact_path).toBe(null);
    });

    it('detects Scout artifact for brownfield (Phase -1)', async () => {
      const { detectCurrentArtifact } = await loadApprove();
      writeState(tmpDir, defaultState({ current_phase: -1 }));
      const result = detectCurrentArtifact({
        root: tmpDir,
        statePath: join(tmpDir, '.jumpstart', 'state', 'state.json')
      });
      expect(result.phase).toBe(-1);
      expect(result.artifact_path).toBe('specs/codebase-context.md');
    });
  });

  describe('approveArtifact', () => {
    it('checks all checkboxes and sets approver', async () => {
      const { approveArtifact } = await loadApprove();
      writeArtifact(tmpDir, 'specs/prd.md', `# PRD\n\nContent\n${DRAFT_APPROVAL}`);
      writeState(tmpDir, defaultState({ current_phase: 2 }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = approveArtifact('specs/prd.md', {
        approver: 'Jane Smith',
        root: tmpDir,
        statePath
      });

      expect(result.success).toBe(true);
      expect(result.approver).toBe('Jane Smith');
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const content = readFileSync(join(tmpDir, 'specs/prd.md'), 'utf8');
      expect(content).not.toContain('- [ ]');
      expect(content).toContain('- [x]');
      expect(content).toContain('Jane Smith');
      expect(content).toContain('**Status:** Approved');
    });

    it('updates state with approved_artifact', async () => {
      const { approveArtifact } = await loadApprove();
      writeArtifact(tmpDir, 'specs/prd.md', `# PRD\n${DRAFT_APPROVAL}`);
      writeState(tmpDir, defaultState({ current_phase: 2 }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      approveArtifact('specs/prd.md', { root: tmpDir, statePath });

      const state = loadStateFromDisk(tmpDir);
      expect(state.approved_artifacts).toContain('specs/prd.md');
    });

    it('returns handoff info when available', async () => {
      const { approveArtifact } = await loadApprove();
      writeArtifact(tmpDir, 'specs/prd.md', `# PRD\n${DRAFT_APPROVAL}`);
      writeState(tmpDir, defaultState({ current_phase: 2 }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = approveArtifact('specs/prd.md', { root: tmpDir, statePath });

      expect(result.handoff_info).toBeDefined();
      expect(result.handoff_info.next_phase).toBe(3);
      expect(result.handoff_info.next_agent).toBe('architect');
    });

    it('defaults approver to Human', async () => {
      const { approveArtifact } = await loadApprove();
      writeArtifact(tmpDir, 'specs/prd.md', `# PRD\n${DRAFT_APPROVAL}`);
      writeState(tmpDir, defaultState({ current_phase: 2 }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = approveArtifact('specs/prd.md', { root: tmpDir, statePath });

      expect(result.approver).toBe('Human');
    });

    it('fails for missing file', async () => {
      const { approveArtifact } = await loadApprove();
      writeState(tmpDir, defaultState());
      const result = approveArtifact('specs/nonexistent.md', { root: tmpDir });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('fails for file without approval section', async () => {
      const { approveArtifact } = await loadApprove();
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\n\nJust content, no gate section');
      writeState(tmpDir, defaultState());
      const result = approveArtifact('specs/prd.md', { root: tmpDir });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Phase Gate Approval');
    });

    it('is idempotent on already-approved artifacts', async () => {
      const { approveArtifact } = await loadApprove();
      writeArtifact(tmpDir, 'specs/prd.md', `# PRD\n${ALREADY_APPROVED}`);
      writeState(tmpDir, defaultState({ current_phase: 2, approved_artifacts: ['specs/prd.md'] }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = approveArtifact('specs/prd.md', { approver: 'Bob', root: tmpDir, statePath });

      expect(result.success).toBe(true);
      // Should still update approver
      const content = readFileSync(join(tmpDir, 'specs/prd.md'), 'utf8');
      expect(content).toContain('Bob');
    });
  });

  describe('rejectArtifact', () => {
    it('unchecks all boxes and resets status', async () => {
      const { rejectArtifact } = await loadApprove();
      writeArtifact(tmpDir, 'specs/prd.md', `# PRD\n${ALREADY_APPROVED}`);
      writeState(tmpDir, defaultState({ approved_artifacts: ['specs/prd.md'] }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = rejectArtifact('specs/prd.md', {
        reason: 'Missing NFRs',
        root: tmpDir,
        statePath
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe('Missing NFRs');

      const content = readFileSync(join(tmpDir, 'specs/prd.md'), 'utf8');
      expect(content).not.toContain('- [x]');
      expect(content).toContain('- [ ]');
      expect(content).toContain('**Status:** Draft');
      expect(content).toContain('**Approved by:** Pending');
    });

    it('removes artifact from approved_artifacts', async () => {
      const { rejectArtifact } = await loadApprove();
      writeArtifact(tmpDir, 'specs/prd.md', `# PRD\n${ALREADY_APPROVED}`);
      writeState(tmpDir, defaultState({ approved_artifacts: ['specs/prd.md'] }));

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      rejectArtifact('specs/prd.md', { reason: 'Bad', root: tmpDir, statePath });

      const state = loadStateFromDisk(tmpDir);
      expect(state.approved_artifacts).not.toContain('specs/prd.md');
    });

    it('logs rejection to insights file', async () => {
      const { rejectArtifact } = await loadApprove();
      writeArtifact(tmpDir, 'specs/prd.md', `# PRD\n${ALREADY_APPROVED}`);
      writeState(tmpDir, defaultState());

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      const result = rejectArtifact('specs/prd.md', { reason: 'Scope too broad', root: tmpDir, statePath });

      expect(result.logged_to).toBe('specs/insights/rejection-log.md');
      const logContent = readFileSync(join(tmpDir, 'specs/insights/rejection-log.md'), 'utf8');
      expect(logContent).toContain('Scope too broad');
      expect(logContent).toContain('specs/prd.md');
    });

    it('fails for missing file', async () => {
      const { rejectArtifact } = await loadApprove();
      writeState(tmpDir, defaultState());
      const result = rejectArtifact('specs/nonexistent.md', { reason: 'Bad', root: tmpDir });
      expect(result.success).toBe(false);
    });

    it('fails for file without approval section', async () => {
      const { rejectArtifact } = await loadApprove();
      writeArtifact(tmpDir, 'specs/prd.md', '# No gate section');
      writeState(tmpDir, defaultState());
      const result = rejectArtifact('specs/prd.md', { reason: 'Bad', root: tmpDir });
      expect(result.success).toBe(false);
    });

    it('appends to existing rejection log', async () => {
      const { rejectArtifact } = await loadApprove();
      writeArtifact(tmpDir, 'specs/prd.md', `# PRD\n${ALREADY_APPROVED}`);
      writeArtifact(tmpDir, 'specs/insights/rejection-log.md', '# Rejection Log\n\n## Previous entry\n');
      writeState(tmpDir, defaultState());

      const statePath = join(tmpDir, '.jumpstart', 'state', 'state.json');
      rejectArtifact('specs/prd.md', { reason: 'V2 rejection', root: tmpDir, statePath });

      const logContent = readFileSync(join(tmpDir, 'specs/insights/rejection-log.md'), 'utf8');
      expect(logContent).toContain('Previous entry');
      expect(logContent).toContain('V2 rejection');
    });
  });

  describe('renderApprovalResult', () => {
    it('shows success with details', async () => {
      const { renderApprovalResult } = await loadApprove();
      const text = renderApprovalResult({
        success: true,
        artifact: 'specs/prd.md',
        approver: 'Jane',
        date: '2026-02-13',
        handoff_info: { ready: true, next_phase: 3, next_agent: 'architect' }
      });
      expect(text).toContain('specs/prd.md');
      expect(text).toContain('Jane');
      expect(text).toContain('Phase 3');
    });

    it('shows error for failed approval', async () => {
      const { renderApprovalResult } = await loadApprove();
      const text = renderApprovalResult({ success: false, error: 'Not found' });
      expect(text).toContain('Not found');
    });
  });

  describe('renderRejectionResult', () => {
    it('shows rejection details', async () => {
      const { renderRejectionResult } = await loadApprove();
      const text = renderRejectionResult({
        success: true,
        artifact: 'specs/prd.md',
        reason: 'Missing NFRs',
        logged_to: 'specs/insights/rejection-log.md'
      });
      expect(text).toContain('specs/prd.md');
      expect(text).toContain('Missing NFRs');
      expect(text).toContain('rejection-log.md');
    });

    it('shows error for failed rejection', async () => {
      const { renderRejectionResult } = await loadApprove();
      const text = renderRejectionResult({ success: false, error: 'File missing' });
      expect(text).toContain('File missing');
    });
  });
});
