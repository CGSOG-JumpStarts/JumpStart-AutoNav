/**
 * test-ux-cluster.test.ts — T4.3.3 UX cluster tests.
 *
 * Coverage for the 7 ports landed together:
 *   - dashboard.ts: PHASES catalog + gatherDashboardData + render
 *   - timeline.ts: createTimeline, recordEvent + ADR-012 redaction
 *   - context-summarizer.ts: extractFrontmatter + summarizeArtifact
 *   - project-memory.ts: addMemory + searchMemories + recallMemory
 *   - role-views.ts: ROLES + generateView
 *   - promptless-mode.ts: WIZARDS + startWizard + answerStep
 *   - workshop-mode.ts: WORKSHOP_TYPES + startSession + captureInsight
 *
 * @see bin/lib-ts/{dashboard,timeline,context-summarizer,project-memory,role-views,promptless-mode,workshop-mode}.ts
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractFrontmatter as ctxExtractFrontmatter,
  extractSections,
  summarizeArtifact,
} from '../bin/lib-ts/context-summarizer.js';
import {
  findClarifications,
  PHASES,
  renderDashboardText,
  STATUS_ICONS,
} from '../bin/lib-ts/dashboard.js';
import {
  addMemory,
  defaultMemoryStore,
  getMemoryStats,
  loadMemoryStore,
  MEMORY_TYPES,
  recallMemory,
  saveMemoryStore,
  searchMemories,
} from '../bin/lib-ts/project-memory.js';
import {
  answerStep,
  getWizardStatus,
  startWizard,
  WIZARDS,
} from '../bin/lib-ts/promptless-mode.js';
import { generateRoleSummary, generateView, listRoles, ROLES } from '../bin/lib-ts/role-views.js';
import {
  createTimeline,
  EVENT_TYPES,
  loadTimeline,
  queryTimeline,
} from '../bin/lib-ts/timeline.js';
import { captureInsight, startSession, WORKSHOP_TYPES } from '../bin/lib-ts/workshop-mode.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'ux-cluster-test-'));
  mkdirSync(path.join(tmpRoot, '.jumpstart', 'state'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeAt(rel: string, body: string): string {
  const full = path.join(tmpRoot, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
  return full;
}

// ─────────────────────────────────────────────────────────────────────────
// dashboard.ts
// ─────────────────────────────────────────────────────────────────────────

describe('dashboard — PHASES + STATUS_ICONS', () => {
  it('exports the canonical phase order (-1 → 4)', () => {
    expect(PHASES.length).toBeGreaterThanOrEqual(6);
    expect(PHASES[0]).toMatchObject({ phase: -1, name: 'Scout' });
  });
  it('STATUS_ICONS includes the canonical status keys', () => {
    expect(STATUS_ICONS).toHaveProperty('pending');
    expect(STATUS_ICONS).toHaveProperty('approved');
  });
});

describe('dashboard — findClarifications', () => {
  it('returns [] when specs dir missing', () => {
    const r = findClarifications(path.join(tmpRoot, 'no-such'));
    expect(r).toEqual([]);
  });
  it('extracts [NEEDS CLARIFICATION] markers (bracketed, per regex)', () => {
    writeAt('specs/prd.md', '# PRD\n\n[NEEDS CLARIFICATION: define MVP scope]\n');
    const r = findClarifications(path.join(tmpRoot, 'specs'));
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0].file).toContain('prd.md');
  });
});

describe('dashboard — renderDashboardText', () => {
  it('renders a valid text dashboard with minimal data', () => {
    const text = renderDashboardText({
      project_type: 'greenfield',
      current: { phase: null, agent: null, step: null },
      progress: {
        approved_count: 0,
        total_phases: 6,
        completion_pct: 0,
        active_artifacts: [],
      },
      phases: PHASES.map((p) => ({
        ...p,
        status: 'pending',
        approved_at: null,
        approved_by: null,
        artifact_path: null,
      })),
      quality: { overall_score: null, scores: [], by_artifact: [] },
      clarifications: [],
      coverage: null,
      graph_coverage: null,
      usage: null,
      next_action: { action: 'init', message: 'Start' },
      timeline: null,
    } as never);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// timeline.ts (ADR-012 redaction is the key spec)
// ─────────────────────────────────────────────────────────────────────────

describe('timeline — EVENT_TYPES catalog', () => {
  it('exports a non-empty list of canonical event types', () => {
    expect(EVENT_TYPES.length).toBeGreaterThan(5);
    expect(EVENT_TYPES).toContain('phase_start');
    expect(EVENT_TYPES).toContain('phase_end');
  });
});

describe('timeline — createTimeline + recordEvent + persist', () => {
  it('appends events and persists to disk', () => {
    const tlPath = path.join(tmpRoot, '.jumpstart', 'state', 'timeline.json');
    const tl = createTimeline({ filePath: tlPath, sessionId: 'test-session' });
    tl.recordEvent({
      event_type: 'phase_start',
      phase: 1,
      agent: 'analyst',
      action: 'Phase 1 started',
    });
    tl.flush();
    expect(existsSync(tlPath)).toBe(true);
    const data = loadTimeline(tlPath);
    expect(data.events.length).toBe(1);
    expect(data.events[0].event_type).toBe('phase_start');
  });
});

describe('timeline — ADR-012 redaction wiring', () => {
  it('redacts secret-shaped strings from event metadata before persistence', () => {
    const tlPath = path.join(tmpRoot, '.jumpstart', 'state', 'timeline.json');
    const tl = createTimeline({ filePath: tlPath, sessionId: 'redact-test' });
    const fakeToken = `ghp_${'A'.repeat(36)}`;
    tl.recordEvent({
      event_type: 'tool_call',
      phase: 0,
      agent: 'challenger',
      action: 'Tool invoked',
      metadata: { auth_header: `Bearer ${fakeToken}` },
    });
    tl.flush();
    const raw = readFileSync(tlPath, 'utf8');
    expect(raw).not.toContain(fakeToken);
    expect(raw).toContain('[REDACTED:');
  });
  it('preserves clean event content unchanged', () => {
    const tlPath = path.join(tmpRoot, '.jumpstart', 'state', 'timeline.json');
    const tl = createTimeline({ filePath: tlPath });
    tl.recordEvent({
      event_type: 'phase_start',
      phase: 0,
      agent: 'challenger',
      action: 'Started',
      metadata: { step: 'init', count: 3 },
    });
    tl.flush();
    const data = loadTimeline(tlPath);
    expect(data.events[0].metadata).toMatchObject({ step: 'init', count: 3 });
  });
});

describe('timeline — queryTimeline filters', () => {
  it('filters by event_type', () => {
    const tlPath = path.join(tmpRoot, '.jumpstart', 'state', 'timeline.json');
    const tl = createTimeline({ filePath: tlPath });
    tl.recordEvent({ event_type: 'phase_start', phase: 0, agent: 'a', action: 'x' });
    tl.recordEvent({ event_type: 'tool_call', phase: 0, agent: 'a', action: 'y' });
    tl.flush();
    const r = queryTimeline(tlPath, { event_type: 'phase_start' });
    expect(r.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// context-summarizer.ts
// ─────────────────────────────────────────────────────────────────────────

describe('context-summarizer — extractFrontmatter + extractSections', () => {
  it('parses YAML frontmatter into {frontmatter, body}', () => {
    const r = ctxExtractFrontmatter('---\nid: x\nphase: 2\n---\nbody content');
    expect(r.frontmatter).not.toBeNull();
    if (r.frontmatter) {
      expect(r.frontmatter.id).toBe('x');
    }
    expect(r.body).toContain('body content');
  });
  it('returns null frontmatter when content has no header', () => {
    const r = ctxExtractFrontmatter('# Just heading\nbody');
    expect(r.frontmatter).toBeNull();
    expect(r.body).toContain('body');
  });
  it('extracts H2 sections', () => {
    const sections = extractSections('## A\nbody A\n\n## B\nbody B\n');
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });
});

describe('context-summarizer — summarizeArtifact', () => {
  it('returns a summary object for a real-shaped PRD', () => {
    const file = writeAt('specs/prd.md', '# PRD\n\n## Stories\n\nE1-S1: do things\n');
    const r = summarizeArtifact(file, 'specs/prd.md');
    expect(r).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// project-memory.ts
// ─────────────────────────────────────────────────────────────────────────

describe('project-memory — round-trip', () => {
  it('default store shape uses entries[]', () => {
    const s = defaultMemoryStore();
    expect(s.entries).toEqual([]);
  });
  it('round-trips an empty store', () => {
    const file = path.join(tmpRoot, 'memory.json');
    const s = defaultMemoryStore();
    saveMemoryStore(s, file);
    const reloaded = loadMemoryStore(file);
    expect(reloaded.entries).toEqual([]);
  });
  it('addMemory + searchMemories + recallMemory', () => {
    const file = path.join(tmpRoot, 'memory.json');
    const a = addMemory(
      {
        type: 'decision',
        title: 'Postgres choice',
        content: 'Use Postgres',
        tags: ['db'],
      },
      { memoryFile: file }
    );
    expect(a.success).toBe(true);
    addMemory(
      {
        type: 'insight',
        title: 'Repo pattern',
        content: 'Repository pattern works well here',
        tags: ['arch'],
      },
      { memoryFile: file }
    );
    const found = searchMemories('Postgres', { memoryFile: file });
    expect(found.success).toBe(true);
    expect((found.entries ?? []).length).toBeGreaterThanOrEqual(1);
    const recalled = recallMemory(a.entry?.id ?? '', { memoryFile: file });
    expect(recalled.success).toBe(true);
  });
  it('getMemoryStats reports counts', () => {
    const file = path.join(tmpRoot, 'memory.json');
    addMemory({ type: 'decision', title: 'A', content: 'A body', tags: [] }, { memoryFile: file });
    addMemory({ type: 'insight', title: 'B', content: 'B body', tags: [] }, { memoryFile: file });
    const stats = getMemoryStats({ memoryFile: file });
    expect(stats.total).toBe(2);
  });
  it('MEMORY_TYPES catalog', () => {
    expect(MEMORY_TYPES.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// role-views.ts
// ─────────────────────────────────────────────────────────────────────────

describe('role-views — ROLES + generateView', () => {
  it('exports the canonical role list', () => {
    expect(ROLES.length).toBeGreaterThan(0);
    expect(ROLES).toContain('executive');
  });
  it('listRoles returns a result envelope', () => {
    const r = listRoles();
    expect(r.success).toBe(true);
    expect(r.roles.length).toBe(ROLES.length);
  });
  it('generateView returns a result for a known role', () => {
    writeAt('specs/prd.md', '# PRD\n');
    const view = generateView(tmpRoot, ROLES[0]);
    expect(view).toBeDefined();
  });
  it('generateRoleSummary handles unknown role gracefully', () => {
    const r = generateRoleSummary(tmpRoot, 'not-a-role');
    expect(r).toBeDefined();
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// promptless-mode.ts
// ─────────────────────────────────────────────────────────────────────────

describe('promptless-mode — WIZARDS + startWizard', () => {
  it('exports wizard catalog', () => {
    expect(WIZARDS.length).toBeGreaterThan(0);
    expect(WIZARDS).toContain('new-project');
  });
  it('startWizard returns initial state', () => {
    const file = path.join(tmpRoot, 'wizard.json');
    const r = startWizard(WIZARDS[0], { stateFile: file });
    expect(r).toBeDefined();
  });
  it('answerStep returns a result envelope', () => {
    const file = path.join(tmpRoot, 'wizard.json');
    startWizard(WIZARDS[0], { stateFile: file });
    const r = answerStep(WIZARDS[0], 'an answer', { stateFile: file });
    expect(r).toBeDefined();
  });
  it('getWizardStatus returns status', () => {
    const file = path.join(tmpRoot, 'wizard.json');
    const status = getWizardStatus({ stateFile: file });
    expect(status).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// workshop-mode.ts
// ─────────────────────────────────────────────────────────────────────────

describe('workshop-mode — WORKSHOP_TYPES + startSession + captureInsight', () => {
  it('exports workshop type catalog', () => {
    expect(WORKSHOP_TYPES.length).toBeGreaterThan(0);
    expect(WORKSHOP_TYPES).toContain('discovery');
  });
  it('startSession + captureInsight round-trip', () => {
    const file = path.join(tmpRoot, 'workshop.json');
    const start = startSession('test-session', { stateFile: file, type: 'discovery' });
    expect(start.success).toBe(true);
    const sid = start.session?.id ?? 'test-session';
    const cap = captureInsight(sid, 'an insight worth capturing', { stateFile: file });
    expect(cap.success).toBe(true);
  });
});
