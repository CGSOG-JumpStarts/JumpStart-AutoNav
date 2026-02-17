/**
 * test-dashboard.test.js — Tests for Interactive Progress Dashboard (UX Feature 5)
 *
 * Tests for bin/lib/dashboard.js covering:
 * - Empty project → all phases pending
 * - Approved artifacts → phases marked approved
 * - Progress percentage calculation
 * - Pipeline rendering
 * - Quality score aggregation
 * - Clarification extraction
 * - Coverage integration
 * - Next action integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-dash-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function writeConfig(tmpDir, overrides = {}) {
  const type = overrides.projectType || 'greenfield';
  const lines = [
    'project:',
    `  type: ${type}`,
    '  name: test-project',
    'workflow:',
    '  require_gate_approval: true'
  ];
  fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'config.yaml'), lines.join('\n'), 'utf8');
}

function writeState(tmpDir, state) {
  fs.writeFileSync(
    path.join(tmpDir, '.jumpstart', 'state', 'state.json'),
    JSON.stringify(state, null, 2),
    'utf8'
  );
}

function writeArtifact(tmpDir, relPath, content) {
  const fullPath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function makeApprovedContent(title = 'Test Artifact') {
  return `# ${title}\n\nContent here.\n\n## Phase Gate Approval\n\n- [x] All criteria met\n- [x] Quality gates passed\n\n**Approved by:** Human\n**Approval date:** 2026-01-01\n`;
}

function makeUnapprovedContent(title = 'Test Artifact') {
  return `# ${title}\n\nContent here.\n\n## Phase Gate Approval\n\n- [ ] All criteria met\n- [ ] Quality gates passed\n\n**Approved by:** Pending\n`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('dashboard', () => {
  let tmpDir;
  let dashboard;

  beforeEach(async () => {
    tmpDir = createTempProject();
    dashboard = await import('../bin/lib/dashboard.js');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── gatherDashboardData ─────────────────────────────────────────────

  describe('gatherDashboardData', () => {
    it('returns all phases as pending for empty greenfield project', async () => {
      writeConfig(tmpDir);
      const data = await dashboard.gatherDashboardData({ root: tmpDir });

      expect(data.phases).toBeDefined();
      expect(data.phases.length).toBe(5); // No Scout for greenfield
      expect(data.phases.every(p => p.status === 'pending')).toBe(true);
      expect(data.progress.completed).toBe(0);
      expect(data.progress.pct).toBe(0);
    });

    it('includes Scout phase for brownfield project', async () => {
      writeConfig(tmpDir, { projectType: 'brownfield' });
      const data = await dashboard.gatherDashboardData({ root: tmpDir });

      expect(data.phases.length).toBe(6); // Includes Scout
      expect(data.phases[0].name).toBe('Scout');
      expect(data.project_type).toBe('brownfield');
    });

    it('marks approved phases correctly', async () => {
      writeConfig(tmpDir);
      writeArtifact(tmpDir, 'specs/challenger-brief.md', makeApprovedContent('Challenger Brief'));

      const data = await dashboard.gatherDashboardData({ root: tmpDir });

      const challengerPhase = data.phases.find(p => p.phase === 0);
      expect(challengerPhase.status).toBe('approved');
      expect(challengerPhase.approved).toBe(true);
      expect(data.progress.completed).toBe(1);
    });

    it('marks unapproved artifacts as in-progress', async () => {
      writeConfig(tmpDir);
      writeArtifact(tmpDir, 'specs/challenger-brief.md', makeUnapprovedContent('Challenger Brief'));

      const data = await dashboard.gatherDashboardData({ root: tmpDir });

      const challengerPhase = data.phases.find(p => p.phase === 0);
      expect(challengerPhase.status).toBe('in-progress');
      expect(challengerPhase.approved).toBe(false);
    });

    it('calculates progress percentage correctly', async () => {
      writeConfig(tmpDir);
      writeArtifact(tmpDir, 'specs/challenger-brief.md', makeApprovedContent());
      writeArtifact(tmpDir, 'specs/product-brief.md', makeApprovedContent());

      const data = await dashboard.gatherDashboardData({ root: tmpDir });

      expect(data.progress.completed).toBe(2);
      expect(data.progress.total).toBe(5);
      expect(data.progress.pct).toBe(40);
    });

    it('returns quality scores for artifacts with content', async () => {
      writeConfig(tmpDir);
      // Write an artifact with clean content (no vague language)
      const cleanContent = `# Challenger Brief\n\nThe system processes 100 requests per second.\nResponse time is under 200ms p95.\n\n## Phase Gate Approval\n\n- [x] Complete\n\n**Approved by:** Human\n**Approval date:** 2026-01-01\n`;
      writeArtifact(tmpDir, 'specs/challenger-brief.md', cleanContent);

      const data = await dashboard.gatherDashboardData({ root: tmpDir });

      expect(data.quality.scores.length).toBeGreaterThan(0);
      expect(data.quality.scores[0].phase).toBe(0);
      expect(typeof data.quality.scores[0].score).toBe('number');
      expect(data.quality.avg_score).not.toBeNull();
    });

    it('includes next_action from determineNextAction', async () => {
      writeConfig(tmpDir);
      const data = await dashboard.gatherDashboardData({ root: tmpDir });

      expect(data.next_action).toBeDefined();
      expect(data.next_action.action).toBeDefined();
      expect(data.next_action.command).toBeDefined();
      expect(data.next_action.message).toBeDefined();
    });

    it('returns null coverage when PRD/plan do not exist', async () => {
      writeConfig(tmpDir);
      const data = await dashboard.gatherDashboardData({ root: tmpDir });

      expect(data.coverage).toBeNull();
    });

    it('returns null usage when no usage log exists', async () => {
      writeConfig(tmpDir);
      const data = await dashboard.gatherDashboardData({ root: tmpDir });

      expect(data.usage).toBeNull();
    });
  });

  // ─── findClarifications ──────────────────────────────────────────────

  describe('findClarifications', () => {
    it('returns empty array when no tags exist', () => {
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\n\nClean content here.\n');
      const results = dashboard.findClarifications(path.join(tmpDir, 'specs'));

      expect(results).toEqual([]);
    });

    it('extracts [NEEDS CLARIFICATION] tags with text', () => {
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\n\nThe auth flow [NEEDS CLARIFICATION: OAuth vs SAML decision pending]\n');
      const results = dashboard.findClarifications(path.join(tmpDir, 'specs'));

      expect(results.length).toBe(1);
      expect(results[0].file).toBe('specs/prd.md');
      expect(results[0].line).toBe(3);
      expect(results[0].text).toContain('OAuth vs SAML');
    });

    it('finds multiple tags across multiple files', () => {
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\n\n[NEEDS CLARIFICATION: item 1]\n\n[NEEDS CLARIFICATION: item 2]\n');
      writeArtifact(tmpDir, 'specs/architecture.md', '# Arch\n\n[NEEDS CLARIFICATION: item 3]\n');
      const results = dashboard.findClarifications(path.join(tmpDir, 'specs'));

      expect(results.length).toBe(3);
    });

    it('returns empty for non-existent directory', () => {
      const results = dashboard.findClarifications(path.join(tmpDir, 'nonexistent'));
      expect(results).toEqual([]);
    });
  });

  // ─── getArtifactQualityScore ─────────────────────────────────────────

  describe('getArtifactQualityScore', () => {
    it('returns null for non-existent file', () => {
      const score = dashboard.getArtifactQualityScore(path.join(tmpDir, 'nonexistent.md'));
      expect(score).toBeNull();
    });

    it('returns null for empty file', () => {
      writeArtifact(tmpDir, 'specs/empty.md', '');
      const score = dashboard.getArtifactQualityScore(path.join(tmpDir, 'specs', 'empty.md'));
      expect(score).toBeNull();
    });

    it('returns a numeric score for content', () => {
      writeArtifact(tmpDir, 'specs/test.md', '# Test\n\nThe system handles 500 requests per second with 99.9% uptime.\n');
      const score = dashboard.getArtifactQualityScore(path.join(tmpDir, 'specs', 'test.md'));
      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  // ─── renderDashboardText ─────────────────────────────────────────────

  describe('renderDashboardText', () => {
    it('contains pipeline visualization characters', () => {
      const data = {
        phases: [
          { phase: 0, name: 'Challenger', status: 'approved', approved: true, quality_score: 85 },
          { phase: 1, name: 'Analyst', status: 'in-progress', approved: false, quality_score: null },
          { phase: 2, name: 'PM', status: 'pending', approved: false, quality_score: null }
        ],
        current: { phase: 1, agent: 'analyst', step: null },
        progress: { completed: 1, total: 3, pct: 33 },
        quality: { avg_score: 85, lowest_phase: null, scores: [{ phase: 0, name: 'Challenger', score: 85 }] },
        clarifications: [],
        coverage: null,
        usage: null,
        next_action: { action: 'continue', command: '/jumpstart.analyze', message: 'Continue with analysis' },
        project_type: 'greenfield'
      };

      const text = dashboard.renderDashboardText(data);

      // Should contain pipeline status characters
      expect(text).toContain('✓');   // approved icon
      expect(text).toContain('●');   // in-progress icon
      expect(text).toContain('○');   // pending icon
      expect(text).toContain('Pipeline');
      expect(text).toContain('Progress');
    });

    it('includes quality scores section when scores exist', () => {
      const data = {
        phases: [
          { phase: 0, name: 'Challenger', status: 'approved', approved: true, quality_score: 75 }
        ],
        current: { phase: null, agent: null, step: null },
        progress: { completed: 1, total: 1, pct: 100 },
        quality: { avg_score: 75, lowest_phase: null, scores: [{ phase: 0, name: 'Challenger', score: 75 }] },
        clarifications: [],
        coverage: null,
        usage: null,
        next_action: { action: 'complete', command: '/jumpstart.status', message: 'All done' },
        project_type: 'greenfield'
      };

      const text = dashboard.renderDashboardText(data);
      expect(text).toContain('Quality');
      expect(text).toContain('75');
    });

    it('shows open clarifications when present', () => {
      const data = {
        phases: [],
        current: { phase: null, agent: null, step: null },
        progress: { completed: 0, total: 0, pct: 0 },
        quality: { avg_score: null, lowest_phase: null, scores: [] },
        clarifications: [{ file: 'specs/prd.md', line: 10, text: 'Need auth decision' }],
        coverage: null,
        usage: null,
        next_action: { action: 'init', command: 'npx jumpstart-mode', message: 'Init' },
        project_type: 'greenfield'
      };

      const text = dashboard.renderDashboardText(data);
      expect(text).toContain('Clarification');
      expect(text).toContain('Need auth decision');
    });

    it('shows coverage data when present', () => {
      const data = {
        phases: [],
        current: { phase: null, agent: null, step: null },
        progress: { completed: 0, total: 0, pct: 0 },
        quality: { avg_score: null, lowest_phase: null, scores: [] },
        clarifications: [],
        coverage: { story_pct: 80, total_stories: 10, total_tasks: 15, gaps: 2, uncovered: ['E01-S03', 'E01-S05'] },
        usage: null,
        next_action: { action: 'init', command: 'npx jumpstart-mode', message: 'Init' },
        project_type: 'greenfield'
      };

      const text = dashboard.renderDashboardText(data);
      expect(text).toContain('Coverage');
      expect(text).toContain('80%');
    });

    it('includes next action callout', () => {
      const data = {
        phases: [],
        current: { phase: null, agent: null, step: null },
        progress: { completed: 0, total: 0, pct: 0 },
        quality: { avg_score: null, lowest_phase: null, scores: [] },
        clarifications: [],
        coverage: null,
        usage: null,
        next_action: { action: 'start', command: '/jumpstart.challenge', message: 'Start with the Challenger' },
        project_type: 'greenfield'
      };

      const text = dashboard.renderDashboardText(data);
      expect(text).toContain('Next');
      expect(text).toContain('/jumpstart.challenge');
    });
  });

  // ─── renderDashboardJSON ─────────────────────────────────────────────

  describe('renderDashboardJSON', () => {
    it('returns the data object unchanged', () => {
      const data = { phases: [], progress: { pct: 50 } };
      expect(dashboard.renderDashboardJSON(data)).toBe(data);
    });
  });

  // ─── Constants ───────────────────────────────────────────────────────

  describe('constants', () => {
    it('PHASES has 6 entries (including Scout)', () => {
      expect(dashboard.PHASES.length).toBe(6);
    });

    it('STATUS_ICONS has all states', () => {
      expect(dashboard.STATUS_ICONS).toHaveProperty('approved');
      expect(dashboard.STATUS_ICONS).toHaveProperty('in-progress');
      expect(dashboard.STATUS_ICONS).toHaveProperty('pending');
    });
  });
});
