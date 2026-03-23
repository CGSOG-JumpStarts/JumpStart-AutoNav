/**
 * test-workflow-adoption.test.js — Tests for Workflow & Adoption Features (Items 69-80)
 *
 * Covers:
 *  1. Design System Integration (design-system.js)
 *  2. Diagram Studio (diagram-studio.js)
 *  3. Ambiguity Heatmap (ambiguity-heatmap.js)
 *  4. Estimation Studio (estimation-studio.js)
 *  5. Guided Handoff (guided-handoff.js)
 *  6. Transcript Ingestion (transcript-ingestion.js)
 *  7. Chat Integration (chat-integration.js)
 *  8. Context Onboarding (context-onboarding.js)
 *  9. Promptless Mode (promptless-mode.js)
 * 10. Artifact Comparison (artifact-comparison.js)
 * 11. Workstream Ownership (workstream-ownership.js)
 * 12. Persona Packs (persona-packs.js)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTempDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-wf-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs', 'decisions'), { recursive: true });
  return tmpDir;
}

function cleanupTempDir(tmpDir) {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── 1. Design System Integration (Item 69) ────────────────────────────────

describe('design-system', () => {
  let tmp;
  let opts;

  beforeEach(() => {
    tmp = createTempDir();
    opts = { stateFile: path.join(tmp, '.jumpstart', 'state', 'design-system.json') };
  });
  afterEach(() => cleanupTempDir(tmp));

  const lib = () => require('../bin/lib/design-system');

  it('registerTokens stores tokens for a valid category', () => {
    const tokens = { primary: '#0066cc', secondary: '#ff9900' };
    const r = lib().registerTokens('color', tokens, opts);
    expect(r.success).toBe(true);
    expect(r.category).toBe('color');
    expect(r.token_count).toBe(2);
    expect(fs.existsSync(opts.stateFile)).toBe(true);
  });

  it('registerTokens rejects invalid category', () => {
    const r = lib().registerTokens('invalid-cat', { x: 1 }, opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown category/);
  });

  it('registerComponent adds a component and checkCompliance detects missing accessibility', () => {
    lib().registerComponent('Button', { props: ['label', 'onClick'], accessibility: [] }, opts);
    const compliance = lib().checkCompliance(opts);
    expect(compliance.success).toBe(true);
    expect(compliance.components).toBe(1);
    expect(compliance.compliant).toBe(false);
    expect(compliance.issues.some(i => i.type === 'missing_accessibility')).toBe(true);
  });

  it('generateReport returns token and component counts', () => {
    lib().registerTokens('color', { bg: '#fff' }, opts);
    lib().registerComponent('Card', { props: ['title'], accessibility: ['aria-label'] }, opts);
    const r = lib().generateReport(opts);
    expect(r.success).toBe(true);
    expect(r.tokens.color).toBe(1);
    expect(r.components).toBe(1);
  });
});

// ─── 2. Diagram Studio (Item 70) ───────────────────────────────────────────

describe('diagram-studio', () => {
  const lib = () => require('../bin/lib/diagram-studio');

  it('generateDiagram returns a template for a known type', () => {
    const r = lib().generateDiagram('sequence');
    expect(r.success).toBe(true);
    expect(r.type).toBe('sequence');
    expect(r.content).toContain('sequenceDiagram');
    expect(r.editable).toBe(true);
  });

  it('generateDiagram rejects unknown type', () => {
    const r = lib().generateDiagram('unknown-diagram');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown type/);
  });

  it('validateDiagram detects syntax issues', () => {
    const r = lib().validateDiagram('no diagram here at all');
    expect(r.success).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it('compareDiagrams detects added and removed nodes', () => {
    const a = 'flowchart LR\n  A[Input] --> B[Process]';
    const b = 'flowchart LR\n  B[Process] --> C[Output]';
    const r = lib().compareDiagrams(a, b);
    expect(r.success).toBe(true);
    expect(r.has_changes).toBe(true);
    expect(r.added).toContain('C');
    expect(r.removed).toContain('A');
  });

  it('listDiagramTypes returns all types', () => {
    const r = lib().listDiagramTypes();
    expect(r.success).toBe(true);
    expect(r.types).toContain('c4-context');
    expect(r.types).toContain('sequence');
    expect(r.types.length).toBeGreaterThanOrEqual(8);
  });
});

// ─── 3. Ambiguity Heatmap (Item 71) ────────────────────────────────────────

describe('ambiguity-heatmap', () => {
  let tmp;

  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => cleanupTempDir(tmp));

  const lib = () => require('../bin/lib/ambiguity-heatmap');

  it('scanAmbiguity finds vague language', () => {
    const text = 'The system should be robust and scalable.\nIt must handle large scale traffic.';
    const r = lib().scanAmbiguity(text);
    expect(r.success).toBe(true);
    expect(r.total_findings).toBeGreaterThan(0);
    expect(r.metrics.vague_terms).toBeGreaterThan(0);
  });

  it('scanAmbiguity rejects empty text', () => {
    const r = lib().scanAmbiguity('');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/required/);
  });

  it('scanFile reads a file and returns findings', () => {
    const fp = path.join(tmp, 'specs', 'test-spec.md');
    fs.writeFileSync(fp, '# Overview\nThe API should be fast and secure.\nIt needs to be intuitive.');
    const r = lib().scanFile(fp);
    expect(r.success).toBe(true);
    expect(r.file).toBe(fp);
    expect(r.metrics.vague_terms).toBeGreaterThan(0);
  });

  it('generateHeatmap scans specs directory', () => {
    fs.writeFileSync(path.join(tmp, 'specs', 'a.md'), '# A\nShould be simple and easy.');
    fs.writeFileSync(path.join(tmp, 'specs', 'b.md'), '# B\nRequirements are well defined.');
    const r = lib().generateHeatmap(tmp);
    expect(r.success).toBe(true);
    expect(r.files_scanned).toBe(2);
    expect(r.overall.total_findings).toBeGreaterThan(0);
  });
});

// ─── 4. Estimation Studio (Item 72) ────────────────────────────────────────

describe('estimation-studio', () => {
  let tmp;
  let opts;

  beforeEach(() => {
    tmp = createTempDir();
    opts = { stateFile: path.join(tmp, '.jumpstart', 'state', 'estimations.json') };
  });
  afterEach(() => cleanupTempDir(tmp));

  const lib = () => require('../bin/lib/estimation-studio');

  it('estimateFeature creates an estimate with ROM cost', () => {
    const r = lib().estimateFeature('Login Page', 'M', opts);
    expect(r.success).toBe(true);
    expect(r.estimate.tshirt_size).toBe('M');
    expect(r.estimate.story_points).toBe(3);
    expect(r.estimate.ideal_days).toBe(2);
    expect(r.estimate.rom_cost.expected).toBe(1600);
  });

  it('estimateFeature rejects invalid size', () => {
    const r = lib().estimateFeature('Feature', 'XXXL', opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid size/);
  });

  it('generateReport aggregates estimates', () => {
    lib().estimateFeature('F1', 'S', opts);
    lib().estimateFeature('F2', 'L', opts);
    const r = lib().generateReport(opts);
    expect(r.success).toBe(true);
    expect(r.total_features).toBe(2);
    expect(r.total_story_points).toBe(7);
  });

  it('calibrate sets team velocity', () => {
    const r = lib().calibrate(21, opts);
    expect(r.success).toBe(true);
    expect(r.velocity).toBe(21);
  });
});

// ─── 5. Guided Handoff (Item 73) ───────────────────────────────────────────

describe('guided-handoff', () => {
  const lib = () => require('../bin/lib/guided-handoff');

  it('generateHandoff creates a handoff package with missing items', () => {
    const r = lib().generateHandoff('product-to-engineering', '/tmp');
    expect(r.success).toBe(true);
    expect(r.type).toBe('product-to-engineering');
    expect(r.label).toBe('Product → Engineering');
    expect(r.complete).toBe(false);
    expect(r.missing_required.length).toBeGreaterThan(0);
  });

  it('generateHandoff rejects unknown type', () => {
    const r = lib().generateHandoff('dev-to-ceo', '/tmp');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown handoff type/);
  });

  it('listHandoffTypes returns all types with metadata', () => {
    const r = lib().listHandoffTypes();
    expect(r.success).toBe(true);
    expect(r.types.length).toBe(4);
    expect(r.types[0].required_count).toBeGreaterThan(0);
  });

  it('validateHandoff computes coverage', () => {
    const r = lib().validateHandoff('engineering-to-qa', ['test_plan', 'api_contracts']);
    expect(r.success).toBe(true);
    expect(r.complete).toBe(false);
    expect(r.coverage_pct).toBeGreaterThan(0);
    expect(r.coverage_pct).toBeLessThan(100);
    expect(r.missing.length).toBeGreaterThan(0);
  });
});

// ─── 6. Transcript Ingestion (Item 74) ─────────────────────────────────────

describe('transcript-ingestion', () => {
  let tmp;
  let opts;

  beforeEach(() => {
    tmp = createTempDir();
    opts = { stateFile: path.join(tmp, '.jumpstart', 'state', 'transcripts.json') };
  });
  afterEach(() => cleanupTempDir(tmp));

  const lib = () => require('../bin/lib/transcript-ingestion');

  it('ingestTranscript extracts actions and decisions', () => {
    const text = [
      '# Sprint Planning',
      'We decided to use PostgreSQL for the database.',
      'Action item: Set up CI pipeline by Friday.',
      'TODO: Write migration scripts.'
    ].join('\n');
    const r = lib().ingestTranscript(text, { title: 'Sprint Planning', ...opts });
    expect(r.success).toBe(true);
    expect(r.transcript.actions.length).toBeGreaterThan(0);
    expect(r.transcript.decisions.length).toBeGreaterThan(0);
    expect(r.transcript.key_topics).toContain('Sprint Planning');
  });

  it('ingestTranscript rejects empty text', () => {
    const r = lib().ingestTranscript('', opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/required/);
  });

  it('extractFromTranscript retrieves a stored transcript', () => {
    const text = 'Decision: Use React for the frontend.';
    const ingested = lib().ingestTranscript(text, opts);
    const r = lib().extractFromTranscript(ingested.transcript.id, opts);
    expect(r.success).toBe(true);
    expect(r.decisions.length).toBeGreaterThan(0);
  });

  it('listTranscripts returns all ingested transcripts', () => {
    lib().ingestTranscript('Action: Deploy v1.', opts);
    lib().ingestTranscript('TODO: Review docs.', opts);
    const r = lib().listTranscripts(opts);
    expect(r.success).toBe(true);
    expect(r.total).toBe(2);
  });
});

// ─── 7. Chat Integration (Item 75) ─────────────────────────────────────────

describe('chat-integration', () => {
  let tmp;
  let opts;

  beforeEach(() => {
    tmp = createTempDir();
    opts = { stateFile: path.join(tmp, '.jumpstart', 'state', 'chat-integration.json') };
  });
  afterEach(() => cleanupTempDir(tmp));

  const lib = () => require('../bin/lib/chat-integration');

  it('configure sets up a platform integration', () => {
    const r = lib().configure('slack', { channel: '#dev', ...opts });
    expect(r.success).toBe(true);
    expect(r.configuration.platform).toBe('slack');
    expect(r.configuration.channel).toBe('#dev');
    expect(r.configuration.enabled).toBe(true);
  });

  it('configure rejects unknown platform', () => {
    const r = lib().configure('discord', opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown platform/);
  });

  it('queueNotification adds a notification', () => {
    const r = lib().queueNotification('approval', 'PR #42 needs approval', opts);
    expect(r.success).toBe(true);
    expect(r.notification.event_type).toBe('approval');
    expect(r.notification.status).toBe('queued');
  });

  it('getStatus reports configuration and notification counts', () => {
    lib().configure('teams', opts);
    lib().queueNotification('risk', 'High risk detected', opts);
    const r = lib().getStatus(opts);
    expect(r.success).toBe(true);
    expect(r.configurations).toBe(1);
    expect(r.notifications_queued).toBe(1);
    expect(r.platforms).toContain('teams');
  });
});

// ─── 8. Context Onboarding (Item 76) ───────────────────────────────────────

describe('context-onboarding', () => {
  let tmp;

  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => cleanupTempDir(tmp));

  const lib = () => require('../bin/lib/context-onboarding');

  it('generateOnboarding creates an onboarding package', () => {
    fs.writeFileSync(path.join(tmp, 'specs', 'decisions', 'adr-001.md'), '# ADR-001');
    const r = lib().generateOnboarding(tmp, { role: 'engineer' });
    expect(r.success).toBe(true);
    expect(r.onboarding.role).toBe('engineer');
    expect(r.onboarding.sections.decisions.total).toBe(1);
    expect(r.onboarding.sections.project_status.current_phase).toBe(0);
  });

  it('customizeForRole filters sections for product role', () => {
    const onboarding = {
      sections: {
        overview: { config_exists: true },
        architecture: { style: 'microservices' },
        specs: { total: 3 },
        risks: { total: 1, high: 0 },
        getting_started: { has_readme: true }
      }
    };
    const r = lib().customizeForRole(onboarding, 'product');
    expect(r.success).toBe(true);
    expect(r.role).toBe('product');
    expect(r.focus_areas).toContain('overview');
    expect(r.focus_areas).toContain('specs');
    expect(r.relevant_sections).toHaveProperty('overview');
    expect(r.relevant_sections).not.toHaveProperty('architecture');
  });

  it('customizeForRole rejects missing onboarding data', () => {
    const r = lib().customizeForRole(null, 'engineer');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/required/);
  });
});

// ─── 9. Promptless Mode (Item 77) ──────────────────────────────────────────

describe('promptless-mode', () => {
  let tmp;
  let opts;

  beforeEach(() => {
    tmp = createTempDir();
    opts = { stateFile: path.join(tmp, '.jumpstart', 'state', 'promptless.json') };
  });
  afterEach(() => cleanupTempDir(tmp));

  const lib = () => require('../bin/lib/promptless-mode');

  it('startWizard creates a session with steps', () => {
    const r = lib().startWizard('new-project', opts);
    expect(r.success).toBe(true);
    expect(r.session.wizard).toBe('new-project');
    expect(r.session.status).toBe('active');
    expect(r.next_step.id).toBe('name');
  });

  it('startWizard rejects unknown wizard type', () => {
    const r = lib().startWizard('magic-wizard', opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown wizard/);
  });

  it('answerStep advances the wizard and completes it', () => {
    const session = lib().startWizard('review-spec', opts);
    const sid = session.session.id;
    const r1 = lib().answerStep(sid, 'specs/prd.md', opts);
    expect(r1.success).toBe(true);
    expect(r1.complete).toBe(false);
    const r2 = lib().answerStep(sid, 'completeness', opts);
    expect(r2.success).toBe(true);
    expect(r2.complete).toBe(true);
    expect(r2.answers).toHaveProperty('spec_file', 'specs/prd.md');
  });

  it('getWizardStatus lists sessions', () => {
    lib().startWizard('add-feature', opts);
    const r = lib().getWizardStatus(opts);
    expect(r.success).toBe(true);
    expect(r.available_wizards).toContain('new-project');
    expect(r.sessions.length).toBe(1);
    expect(r.sessions[0].status).toBe('active');
  });
});

// ─── 10. Artifact Comparison (Item 78) ─────────────────────────────────────

describe('artifact-comparison', () => {
  let tmp;

  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => cleanupTempDir(tmp));

  const lib = () => require('../bin/lib/artifact-comparison');

  it('compareArtifacts detects added and removed sections', () => {
    const a = '# Overview\nFirst version.\n# Scope\nSmall scope.';
    const b = '# Overview\nUpdated version.\n# API\nNew API section.';
    const r = lib().compareArtifacts(a, b);
    expect(r.success).toBe(true);
    expect(r.total_changes).toBeGreaterThan(0);
    expect(r.changes.some(c => c.type === 'added' && c.section === 'API')).toBe(true);
    expect(r.changes.some(c => c.type === 'removed' && c.section === 'Scope')).toBe(true);
  });

  it('compareArtifacts rejects missing content', () => {
    const r = lib().compareArtifacts('', 'something');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/required/);
  });

  it('compareFiles compares two files on disk', () => {
    const fa = path.join(tmp, 'a.md');
    const fb = path.join(tmp, 'b.md');
    fs.writeFileSync(fa, '# Title\nOriginal.');
    fs.writeFileSync(fb, '# Title\nModified.\n# New Section\nContent.');
    const r = lib().compareFiles(fa, fb);
    expect(r.success).toBe(true);
    expect(r.file_a).toBe(fa);
    expect(r.changes.some(c => c.type === 'added')).toBe(true);
  });

  it('getArtifactHistory returns version history', () => {
    fs.writeFileSync(path.join(tmp, 'specs', 'prd.md'), '# PRD v2');
    fs.mkdirSync(path.join(tmp, '.jumpstart', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.jumpstart', 'archive', 'prd.md.2024-01-01'), '# PRD v1');
    const r = lib().getArtifactHistory(tmp, 'prd.md');
    expect(r.success).toBe(true);
    expect(r.versions).toBe(2);
    expect(r.history.some(h => h.current === true)).toBe(true);
  });
});

// ─── 11. Workstream Ownership (Item 79) ────────────────────────────────────

describe('workstream-ownership', () => {
  let tmp;
  let opts;

  beforeEach(() => {
    tmp = createTempDir();
    opts = { stateFile: path.join(tmp, '.jumpstart', 'state', 'workstream-ownership.json') };
  });
  afterEach(() => cleanupTempDir(tmp));

  const lib = () => require('../bin/lib/workstream-ownership');

  it('defineWorkstream creates a named workstream', () => {
    const r = lib().defineWorkstream('Auth Service', { team: 'Platform', owner: 'alice', ...opts });
    expect(r.success).toBe(true);
    expect(r.workstream.name).toBe('Auth Service');
    expect(r.workstream.team).toBe('Platform');
    expect(r.workstream.owner).toBe('alice');
  });

  it('defineWorkstream rejects empty name', () => {
    const r = lib().defineWorkstream('', opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/required/);
  });

  it('addDependency links two workstreams', () => {
    const ws1 = lib().defineWorkstream('Frontend', opts);
    const ws2 = lib().defineWorkstream('API', opts);
    const r = lib().addDependency(ws1.workstream.id, ws2.workstream.id, opts);
    expect(r.success).toBe(true);
    expect(r.dependency.from).toBe(ws1.workstream.id);
    expect(r.dependency.to).toBe(ws2.workstream.id);
    expect(r.dependency.type).toBe('depends-on');
  });

  it('generateReport aggregates workstreams by team', () => {
    lib().defineWorkstream('WS-A', { team: 'Alpha', ...opts });
    lib().defineWorkstream('WS-B', { team: 'Alpha', ...opts });
    lib().defineWorkstream('WS-C', { team: 'Beta', ...opts });
    const r = lib().generateReport(opts);
    expect(r.success).toBe(true);
    expect(r.total_workstreams).toBe(3);
    expect(r.by_team.Alpha.length).toBe(2);
    expect(r.by_team.Beta.length).toBe(1);
  });
});

// ─── 12. Persona Packs (Item 80) ───────────────────────────────────────────

describe('persona-packs', () => {
  const lib = () => require('../bin/lib/persona-packs');

  it('listPersonas returns all enterprise personas', () => {
    const r = lib().listPersonas();
    expect(r.success).toBe(true);
    expect(r.personas.length).toBeGreaterThanOrEqual(7);
    expect(r.personas.map(p => p.id)).toContain('architect');
    expect(r.personas.map(p => p.id)).toContain('sre');
  });

  it('getPersona returns details for a valid persona', () => {
    const r = lib().getPersona('security-lead');
    expect(r.success).toBe(true);
    expect(r.persona.label).toBe('Security Lead');
    expect(r.persona.focus).toContain('threat-modeling');
    expect(r.persona.tools).toContain('credential-boundary');
  });

  it('getPersona rejects unknown persona', () => {
    const r = lib().getPersona('wizard-of-oz');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown persona/);
  });

  it('applyPersona returns recommended tools and artifacts', () => {
    const r = lib().applyPersona('platform-engineer');
    expect(r.success).toBe(true);
    expect(r.persona_id).toBe('platform-engineer');
    expect(r.recommended_tools.length).toBeGreaterThan(0);
    expect(r.relevant_artifacts.length).toBeGreaterThan(0);
    expect(r.focus_areas).toContain('ci-cd');
  });
});
