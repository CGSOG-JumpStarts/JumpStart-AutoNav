/**
 * test-collaboration-ux.test.js — Tests for Collaboration & UX Features (Items 61-68)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-collab-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs', 'decisions'), { recursive: true });
  return tmpDir;
}

function cleanupTempDir(tmpDir) {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Item 61: Web Dashboard ──────────────────────────────────────────────

describe('Web Dashboard (Item 61)', () => {
  const lib = require('../bin/lib/web-dashboard');
  let tmpDir;
  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('generates dashboard configuration', () => {
    const result = lib.generateConfig(tmpDir, { port: 8080 });
    expect(result.success).toBe(true);
    expect(result.config.port).toBe(8080);
    expect(result.config.sections).toBeDefined();
  });

  it('gathers dashboard data from project', () => {
    const result = lib.gatherDashboardData(tmpDir);
    expect(result.success).toBe(true);
    expect(result.sections.phases).toBeDefined();
    expect(result.sections.artifacts).toBeDefined();
  });

  it('generates static HTML dashboard', () => {
    const data = lib.gatherDashboardData(tmpDir);
    const result = lib.generateStaticDashboard(data);
    expect(result.success).toBe(true);
    expect(result.html).toContain('Jump Start Dashboard');
  });

  it('returns server status', () => {
    const result = lib.getServerStatus();
    expect(result.success).toBe(true);
    expect(result.running).toBe(false);
  });
});

// ─── Item 62: Role-Based Views ───────────────────────────────────────────

describe('Role-Based Views (Item 62)', () => {
  const lib = require('../bin/lib/role-views');
  let tmpDir;
  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('lists available roles', () => {
    const result = lib.listRoles();
    expect(result.success).toBe(true);
    expect(result.roles.length).toBeGreaterThanOrEqual(4);
    const ids = result.roles.map(r => r.id);
    expect(ids).toContain('executive');
    expect(ids).toContain('engineer');
  });

  it('generates a view for a valid role', () => {
    const result = lib.generateView(tmpDir, 'executive');
    expect(result.success).toBe(true);
    expect(result.view.role).toBe('executive');
    expect(result.view.focus_areas).toBeDefined();
    expect(result.view.sections).toBeDefined();
  });

  it('generates a role summary', () => {
    const result = lib.generateRoleSummary(tmpDir, 'architect');
    expect(result.success).toBe(true);
    expect(result.summary.role).toBe('architect');
    expect(result.summary.label).toBeDefined();
  });

  it('returns error for unknown role', () => {
    const result = lib.generateView(tmpDir, 'unknown-role');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─── Item 63: Spec Comments ──────────────────────────────────────────────

describe('Spec Comments (Item 63)', () => {
  const lib = require('../bin/lib/spec-comments');
  let tmpDir;
  let stateFile;
  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'comments.json');
  });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('adds a comment to an artifact', () => {
    const result = lib.addComment('specs/prd.md', 'Overview', 'Needs more detail', {
      author: 'alice', stateFile
    });
    expect(result.success).toBe(true);
    expect(result.comment.artifact).toBe('specs/prd.md');
    expect(result.comment.text).toBe('Needs more detail');
    expect(result.comment.status).toBe('open');
  });

  it('resolves an existing comment', () => {
    const added = lib.addComment('specs/prd.md', 'Overview', 'Fix this', {
      author: 'bob', stateFile
    });
    const result = lib.resolveComment(added.comment.id, 'Fixed in latest revision', {
      author: 'bob', stateFile
    });
    expect(result.success).toBe(true);
    expect(result.comment.status).toBe('resolved');
  });

  it('lists comments with filters', () => {
    lib.addComment('specs/prd.md', 'Scope', 'Comment A', { author: 'alice', stateFile });
    lib.addComment('specs/architecture.md', 'API', 'Comment B', { author: 'bob', stateFile });
    const result = lib.listComments({ stateFile, artifact: 'specs/prd.md' });
    expect(result.success).toBe(true);
    expect(result.comments.length).toBe(1);
    expect(result.comments[0].artifact).toBe('specs/prd.md');
  });

  it('assigns a comment to a user', () => {
    const added = lib.addComment('specs/prd.md', 'NFRs', 'Review needed', {
      author: 'alice', stateFile
    });
    const result = lib.assignComment(added.comment.id, 'charlie', { stateFile });
    expect(result.success).toBe(true);
    expect(result.comment.assignee).toBe('charlie');
  });
});

// ─── Item 64: Workshop Mode ─────────────────────────────────────────────

describe('Workshop Mode (Item 64)', () => {
  const lib = require('../bin/lib/workshop-mode');
  let tmpDir;
  let stateFile;
  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'workshops.json');
  });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('starts a workshop session', () => {
    const result = lib.startSession('Discovery Workshop', {
      type: 'discovery', facilitator: 'alice', stateFile
    });
    expect(result.success).toBe(true);
    expect(result.session.name).toBe('Discovery Workshop');
    expect(result.session.status).toBe('active');
    expect(result.session.type).toBe('discovery');
  });

  it('captures an insight during a session', () => {
    const session = lib.startSession('Ideation', { type: 'ideation', stateFile });
    const result = lib.captureInsight(session.session.id, 'Users need offline support', {
      category: 'requirement', author: 'bob', stateFile
    });
    expect(result.success).toBe(true);
    expect(result.capture.text).toBe('Users need offline support');
    expect(result.capture.category).toBe('requirement');
  });

  it('converts session insights to an artifact', () => {
    const session = lib.startSession('Brief Workshop', { stateFile });
    lib.captureInsight(session.session.id, 'Key insight 1', { stateFile });
    lib.captureInsight(session.session.id, 'Key insight 2', { stateFile });
    const result = lib.convertToArtifact(session.session.id, 'challenger-brief', { stateFile });
    expect(result.success).toBe(true);
    expect(result.artifact_type).toBe('challenger-brief');
    expect(result.captures_used).toBeGreaterThanOrEqual(2);
  });

  it('returns session status', () => {
    lib.startSession('Session A', { stateFile });
    const result = lib.getSessionStatus({ stateFile });
    expect(result.success).toBe(true);
    expect(result.total_sessions).toBeGreaterThanOrEqual(1);
  });
});

// ─── Item 65: Collaboration Sessions ─────────────────────────────────────

describe('Collaboration Sessions (Item 65)', () => {
  const lib = require('../bin/lib/collaboration');
  let tmpDir;
  let stateFile;
  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'collaboration.json');
  });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('creates a collaboration session', () => {
    const result = lib.createSession('Sprint Planning', {
      owner: 'alice', artifacts: ['specs/prd.md'], stateFile
    });
    expect(result.success).toBe(true);
    expect(result.session.name).toBe('Sprint Planning');
    expect(result.session.status).toBe('active');
    expect(result.session.owner).toBe('alice');
  });

  it('allows a participant to join a session', () => {
    const session = lib.createSession('Review', { owner: 'alice', stateFile });
    const result = lib.joinSession(session.session.id, 'bob', {
      role: 'reviewer', stateFile
    });
    expect(result.success).toBe(true);
    expect(result.session.participants).toContainEqual(
      expect.objectContaining({ name: 'bob', role: 'reviewer' })
    );
  });

  it('acquires and releases a lock on an artifact', () => {
    const lockResult = lib.acquireLock('specs/prd.md', 'alice', { stateFile });
    expect(lockResult.success).toBe(true);
    expect(lockResult.lock.artifact).toBe('specs/prd.md');
    expect(lockResult.lock.owner).toBe('alice');

    const releaseResult = lib.releaseLock(lockResult.lock.id, { stateFile });
    expect(releaseResult.success).toBe(true);
    expect(releaseResult.lock.released_at).toBeDefined();
  });

  it('returns collaboration status', () => {
    lib.createSession('Active Session', { owner: 'alice', stateFile });
    lib.acquireLock('specs/architecture.md', 'bob', { stateFile });
    const result = lib.getStatus({ stateFile });
    expect(result.success).toBe(true);
    expect(result.active_sessions).toBeGreaterThanOrEqual(1);
    expect(result.active_locks).toBeGreaterThanOrEqual(1);
  });
});

// ─── Item 66: Structured Elicitation ─────────────────────────────────────

describe('Structured Elicitation (Item 66)', () => {
  const lib = require('../bin/lib/structured-elicitation');
  let tmpDir;
  let stateFile;
  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'elicitation.json');
  });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('starts an elicitation session for a domain', () => {
    const result = lib.startElicitation('healthcare', { stateFile });
    expect(result.success).toBe(true);
    expect(result.session.domain).toBe('healthcare');
    expect(result.session.status).toBe('active');
    expect(result.session.questions.length).toBeGreaterThan(0);
  });

  it('answers a question and tracks remaining', () => {
    const session = lib.startElicitation('fintech', { stateFile });
    const qId = session.session.questions[0].id;
    const result = lib.answerQuestion(session.session.id, qId, 'Yes, PCI-DSS compliance required', { stateFile });
    expect(result.success).toBe(true);
    expect(result.question.answer).toBe('Yes, PCI-DSS compliance required');
  });

  it('gets the next unanswered question', () => {
    const session = lib.startElicitation('general', { stateFile });
    const result = lib.getNextQuestion(session.session.id, { stateFile });
    expect(result.success).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.question).toBeDefined();
    expect(result.question.id).toBeDefined();
  });

  it('generates a completion report', () => {
    const session = lib.startElicitation('retail', { stateFile });
    const result = lib.generateReport(session.session.id, { stateFile });
    expect(result.success).toBe(true);
    expect(result.domain).toBe('retail');
    expect(result.total_questions).toBeGreaterThan(0);
    expect(typeof result.completion_pct).toBe('number');
  });
});

// ─── Item 67: Enterprise Templates ───────────────────────────────────────

describe('Enterprise Templates (Item 67)', () => {
  const lib = require('../bin/lib/enterprise-templates');
  let tmpDir;
  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('lists all available templates', () => {
    const result = lib.listTemplates();
    expect(result.success).toBe(true);
    expect(result.verticals.length).toBeGreaterThanOrEqual(5);
    expect(result.templates.length).toBeGreaterThanOrEqual(5);
    expect(result.templates[0].id).toBeDefined();
  });

  it('gets a specific template by vertical', () => {
    const result = lib.getTemplate('healthcare');
    expect(result.success).toBe(true);
    expect(result.vertical).toBe('healthcare');
    expect(result.template.compliance).toBeDefined();
    expect(result.template.personas).toBeDefined();
  });

  it('applies a template to a project root', () => {
    const result = lib.applyTemplate(tmpDir, 'banking');
    expect(result.success).toBe(true);
    expect(result.applied.vertical).toBe('banking');
    expect(result.applied.compliance_frameworks.length).toBeGreaterThanOrEqual(1);
    expect(result.applied.applied_at).toBeDefined();
  });

  it('returns error for unknown vertical', () => {
    const result = lib.getTemplate('nonexistent-vertical');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─── Item 68: Playback Summaries ─────────────────────────────────────────

describe('Playback Summaries (Item 68)', () => {
  const lib = require('../bin/lib/playback-summaries');
  let tmpDir;
  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('lists all available audiences', () => {
    const result = lib.listAudiences();
    expect(result.success).toBe(true);
    expect(result.audiences.length).toBeGreaterThanOrEqual(3);
    const ids = result.audiences.map(a => a.id);
    expect(ids).toContain('executive');
    expect(ids).toContain('technical');
  });

  it('generates a summary for a valid audience', () => {
    const result = lib.generateSummary(tmpDir, 'executive');
    expect(result.success).toBe(true);
    expect(result.summary.audience).toBe('executive');
    expect(result.summary.tone).toBeDefined();
    expect(result.summary.focus_areas).toBeDefined();
    expect(result.summary.sections).toBeDefined();
  });

  it('returns error for unknown audience', () => {
    const result = lib.generateSummary(tmpDir, 'nonexistent-audience');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
