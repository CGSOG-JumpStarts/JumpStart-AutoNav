/**
 * test-collaboration-cluster.test.ts — T4.4.3 collaboration cluster L tests.
 *
 * Smoke coverage for the 10 ports landed under cluster L:
 *   - playback-summaries.ts: AUDIENCES, generateSummary, listAudiences
 *   - structured-elicitation.ts: DOMAINS, startElicitation, answerQuestion, getNextQuestion
 *   - chat-integration.ts: PLATFORMS, configure, queueNotification, getStatus
 *   - contract-checker.ts: extractModelEntities, extractContractEntities, validateContracts
 *   - decision-conflicts.ts: extractTechReferences, extractPatternReferences, findConflicts, detectConflicts
 *   - delivery-confidence.ts: analyzeCompleteness, analyzeRisk, analyzeAmbiguity, scoreConfidence, scoreFile
 *   - dependency-upgrade.ts: defaultState, scanUpgrades, createUpgradePlan, generateReport
 *   - deterministic-artifacts.ts: normalizeMarkdown, hashContent, normalizeFile, verifyStability
 *   - domain-ontology.ts: ELEMENT_TYPES, defineElement, queryOntology, validateTermUsage
 *   - ea-review-packet.ts: PACKET_SECTIONS, generatePacket
 *
 * @see bin/lib-ts/{10 collaboration modules}.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as chatInt from '../bin/lib-ts/chat-integration.js';
import * as contractChk from '../bin/lib-ts/contract-checker.js';
import * as decisionConflicts from '../bin/lib-ts/decision-conflicts.js';
import * as deliveryConf from '../bin/lib-ts/delivery-confidence.js';
import * as depUpgrade from '../bin/lib-ts/dependency-upgrade.js';
import * as detArtifacts from '../bin/lib-ts/deterministic-artifacts.js';
import * as domainOnt from '../bin/lib-ts/domain-ontology.js';
import * as eaReview from '../bin/lib-ts/ea-review-packet.js';
import * as playback from '../bin/lib-ts/playback-summaries.js';
import * as structElicit from '../bin/lib-ts/structured-elicitation.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'collab-cluster-test-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function file(name: string): string {
  return path.join(tmp, name);
}

// ─────────────────────────────────────────────────────────────────────────
// playback-summaries
// ─────────────────────────────────────────────────────────────────────────

describe('playback-summaries', () => {
  it('exports 5 default audiences', () => {
    expect(playback.AUDIENCES.length).toBe(5);
    expect(playback.AUDIENCES).toContain('executive');
  });
  it('listAudiences returns config-shaped entries', () => {
    const r = playback.listAudiences();
    expect(r.success).toBe(true);
    expect(r.audiences.length).toBe(5);
  });
  it('generateSummary rejects unknown audience', () => {
    const r = playback.generateSummary(tmp, 'martian');
    expect(r.success).toBe(false);
  });
  it('generateSummary returns shape with project_status', () => {
    const r = playback.generateSummary(tmp, 'executive');
    expect(r.success).toBe(true);
    expect(r.summary?.project_status?.current_phase).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// structured-elicitation
// ─────────────────────────────────────────────────────────────────────────

describe('structured-elicitation', () => {
  it('exports 6 domains', () => {
    expect(structElicit.DOMAINS.length).toBe(6);
  });
  it('start, answer, next round-trip', () => {
    const f = file('elicit.json');
    const start = structElicit.startElicitation('healthcare', { stateFile: f });
    expect(start.success).toBe(true);
    const qid = start.session?.questions[0].id || '';
    const a = structElicit.answerQuestion(start.session?.id || '', qid, 'yes', { stateFile: f });
    expect(a.success).toBe(true);
    const n = structElicit.getNextQuestion(start.session?.id || '', { stateFile: f });
    expect(n.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// chat-integration
// ─────────────────────────────────────────────────────────────────────────

describe('chat-integration', () => {
  it('configure rejects unknown platform', () => {
    const r = chatInt.configure('discord', { stateFile: file('chat.json') });
    expect(r.success).toBe(false);
  });
  it('queueNotification + getStatus reflect counts', () => {
    const f = file('chat.json');
    chatInt.configure('slack', { stateFile: f, channel: 'eng' });
    chatInt.queueNotification('approval', 'ok', { stateFile: f });
    const s = chatInt.getStatus({ stateFile: f });
    expect(s.configurations).toBe(1);
    expect(s.notifications_queued).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// contract-checker
// ─────────────────────────────────────────────────────────────────────────

describe('contract-checker', () => {
  it('extracts model entities from headers', () => {
    const md = `### Entity: User\n\n| \`id\` | string |\n| \`name\` | string |\n`;
    const ents = contractChk.extractModelEntities(md);
    expect(ents.length).toBe(1);
    expect(ents[0].name).toBe('User');
  });
  it('validateContracts returns error for missing files', () => {
    const r = contractChk.validateContracts({ root: tmp });
    expect(r.pass).toBe(false);
    expect(r.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// decision-conflicts (NEW T4.4.3)
// ─────────────────────────────────────────────────────────────────────────

describe('decision-conflicts', () => {
  it('exports 5 conflict types', () => {
    expect(decisionConflicts.CONFLICT_TYPES.length).toBe(5);
    expect(decisionConflicts.CONFLICT_TYPES).toContain('technology');
  });
  it('extractTechReferences finds known terms and dedupes', () => {
    const out = decisionConflicts.extractTechReferences(
      'We use React with React hooks and PostgreSQL.'
    );
    expect(out).toContain('react');
    expect(out).toContain('postgresql');
    // dedup
    expect(out.filter((t) => t === 'react').length).toBe(1);
  });
  it('extractPatternReferences finds patterns', () => {
    const out = decisionConflicts.extractPatternReferences('We use microservices and CQRS.');
    expect(out).toContain('microservice');
    expect(out).toContain('cqrs');
  });
  it('findConflicts flags competing frontends and contradictory patterns', () => {
    const decisions = [
      {
        source: 'a.md',
        type: 'adr' as const,
        title: 'a',
        decision_text: '',
        technologies: ['react'],
        patterns: ['microservice'],
      },
      {
        source: 'b.md',
        type: 'adr' as const,
        title: 'b',
        decision_text: '',
        technologies: ['vue'],
        patterns: ['monolith'],
      },
    ];
    const conflicts = decisionConflicts.findConflicts(decisions);
    const types = conflicts.map((c) => c.type);
    expect(types).toContain('technology');
    expect(types).toContain('pattern');
  });
  it('detectConflicts returns no-decisions message on empty project', () => {
    const r = decisionConflicts.detectConflicts(tmp);
    expect(r.success).toBe(true);
    expect(r.conflicts).toEqual([]);
    expect(r.message).toMatch(/No decisions/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// delivery-confidence (NEW T4.4.3)
// ─────────────────────────────────────────────────────────────────────────

describe('delivery-confidence', () => {
  it('exports 5 dimensions with default weights summing ~1.0', () => {
    expect(deliveryConf.DIMENSIONS.length).toBe(5);
    const sum = Object.values(deliveryConf.WEIGHT_DEFAULTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
  });
  it('analyzeCompleteness returns score and gaps', () => {
    const r = deliveryConf.analyzeCompleteness('# h\n## h2\n## h3\nbody', 'generic');
    expect(typeof r.score).toBe('number');
    expect(Array.isArray(r.gaps)).toBe(true);
  });
  it('analyzeAmbiguity scales inversely with ambiguous terms', () => {
    const clean = deliveryConf.analyzeAmbiguity('The system processes orders.');
    const ambig = deliveryConf.analyzeAmbiguity('Maybe it should possibly approximately work.');
    expect(clean.score).toBeGreaterThanOrEqual(ambig.score);
  });
  it('scoreConfidence returns level + emoji', () => {
    const r = deliveryConf.scoreConfidence('# Title\n## A\n## B\n## C\nbody more body');
    expect(r.success).toBe(true);
    expect(typeof r.confidence_level).toBe('string');
    expect(typeof r.confidence_emoji).toBe('string');
  });
  it('scoreFile fails on missing file', () => {
    const r = deliveryConf.scoreFile(file('nope.md'));
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// dependency-upgrade (NEW T4.4.3)
// ─────────────────────────────────────────────────────────────────────────

describe('dependency-upgrade', () => {
  it('exports upgrade types and risk mapping', () => {
    expect(depUpgrade.UPGRADE_TYPES).toContain('major');
    expect(depUpgrade.RISK_BY_TYPE.major).toBe('high');
    expect(depUpgrade.RISK_BY_TYPE.patch).toBe('low');
  });
  it('scanUpgrades fails when package.json missing', () => {
    const r = depUpgrade.scanUpgrades(tmp, { stateFile: file('upg.json') });
    expect(r.success).toBe(false);
  });
  it('scanUpgrades reads package.json and reports candidates', () => {
    writeFileSync(
      file('package.json'),
      JSON.stringify({
        dependencies: { foo: '^1.0.0' },
        devDependencies: { bar: '~2.0.0' },
      })
    );
    const r = depUpgrade.scanUpgrades(tmp, { stateFile: file('upg.json') });
    expect(r.success).toBe(true);
    expect(r.total).toBe(2);
    const foo = r.dependencies?.find((d) => d.name === 'foo');
    expect(foo?.type).toBe('minor-range');
  });
  it('createUpgradePlan rejects missing name and accepts valid input', () => {
    const fail = depUpgrade.createUpgradePlan({}, { stateFile: file('upg.json') });
    expect(fail.success).toBe(false);
    const ok = depUpgrade.createUpgradePlan(
      {
        name: 'q3-bumps',
        upgrades: [{ package: 'foo', from: '1.0.0', to: '1.1.0', type: 'minor' }],
      },
      { stateFile: file('upg.json') }
    );
    expect(ok.success).toBe(true);
    expect(ok.plan?.upgrades[0].risk).toBe('medium');
  });
  it('generateReport summarises plans and scans', () => {
    const f = file('upg.json');
    depUpgrade.createUpgradePlan({ name: 'p1' }, { stateFile: f });
    const r = depUpgrade.generateReport({ stateFile: f });
    expect(r.success).toBe(true);
    expect(r.total_plans).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// deterministic-artifacts (NEW T4.4.3)
// ─────────────────────────────────────────────────────────────────────────

describe('deterministic-artifacts', () => {
  it('normalizeMarkdown collapses whitespace and substitutes timestamps/UUIDs', () => {
    const out = detArtifacts.normalizeMarkdown(
      'Built at 2024-05-12T10:30:00Z by 12345678-1234-1234-1234-123456789abc\r\n\n\n\nbody'
    );
    expect(out).toContain('[TIMESTAMP]');
    expect(out).toContain('[UUID]');
    expect(out).not.toContain('\r\n');
    expect(out).not.toMatch(/\n{3,}/);
  });
  it('hashContent returns 16-char hex hash', () => {
    const h = detArtifacts.hashContent('hello world');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).toBe(detArtifacts.hashContent('hello world'));
  });
  it('normalizeFile fails on missing path', () => {
    const r = detArtifacts.normalizeFile(file('missing.md'));
    expect(r.success).toBe(false);
  });
  it('verifyStability detects identical content', () => {
    writeFileSync(file('a.md'), '# Title\n');
    writeFileSync(file('b.md'), '# Title\n');
    const r = detArtifacts.verifyStability(file('a.md'), file('b.md'));
    expect(r.success).toBe(true);
    expect(r.identical).toBe(true);
    expect(r.similarity).toBe(100);
  });
  it('normalizeSpecs handles missing specs/ gracefully', () => {
    const r = detArtifacts.normalizeSpecs(tmp);
    expect(r.success).toBe(true);
    expect(r.files).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// domain-ontology (NEW T4.4.3)
// ─────────────────────────────────────────────────────────────────────────

describe('domain-ontology', () => {
  it('exports 6 element types', () => {
    expect(domainOnt.ELEMENT_TYPES.length).toBe(6);
    expect(domainOnt.ELEMENT_TYPES).toContain('aggregate');
  });
  it('defineElement rejects bad type and accepts valid', () => {
    const bad = domainOnt.defineElement('orders', 'Order', 'badtype', {
      stateFile: file('ont.json'),
    });
    expect(bad.success).toBe(false);
    const ok = domainOnt.defineElement('orders', 'Order', 'aggregate', {
      stateFile: file('ont.json'),
    });
    expect(ok.success).toBe(true);
    expect(ok.element?.name).toBe('Order');
  });
  it('queryOntology returns elements per domain and filters by type', () => {
    const f = file('ont.json');
    domainOnt.defineElement('orders', 'Order', 'aggregate', { stateFile: f });
    domainOnt.defineElement('orders', 'OrderPlaced', 'event', { stateFile: f });
    const all = domainOnt.queryOntology('orders', { stateFile: f });
    expect(all.total).toBe(2);
    const events = domainOnt.queryOntology('orders', { stateFile: f, type: 'event' });
    expect(events.total).toBe(1);
  });
  it('validateTermUsage flags possible typos via Levenshtein', () => {
    const f = file('ont.json');
    domainOnt.defineElement('orders', 'Customer', 'entity', { stateFile: f });
    const r = domainOnt.validateTermUsage('orders', 'Custmer placed an order', { stateFile: f });
    expect(r.success).toBe(true);
    expect((r.issues || []).length).toBeGreaterThan(0);
  });
  it('generateReport tallies elements by type', () => {
    const f = file('ont.json');
    domainOnt.defineElement('orders', 'Order', 'aggregate', { stateFile: f });
    const r = domainOnt.generateReport({ stateFile: f });
    expect(r.success).toBe(true);
    expect(r.total_domains).toBe(1);
    expect(r.domains.orders.by_type.aggregate).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ea-review-packet (NEW T4.4.3)
// ─────────────────────────────────────────────────────────────────────────

describe('ea-review-packet', () => {
  it('exports 7 packet sections', () => {
    expect(eaReview.PACKET_SECTIONS.length).toBe(7);
    expect(eaReview.PACKET_SECTIONS).toContain('risk-assessment');
  });
  it('generatePacket returns gaps for empty project', () => {
    const r = eaReview.generatePacket(tmp);
    expect(r.success).toBe(true);
    expect(r.completeness).toBe(0);
    expect(r.gaps.length).toBe(7);
  });
  it('generatePacket detects mermaid diagrams in architecture.md', () => {
    mkdirSync(path.join(tmp, 'specs'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'specs', 'architecture.md'),
      '# Architecture\n## Overview\n```mermaid\nflowchart TD\n```\n'
    );
    const r = eaReview.generatePacket(tmp);
    expect(r.sections.diagrams.present).toBe(true);
    expect(r.sections['architecture-overview'].present).toBe(true);
  });
  it('generatePacket counts ADR files in specs/decisions', () => {
    const decDir = path.join(tmp, 'specs', 'decisions');
    mkdirSync(decDir, { recursive: true });
    writeFileSync(path.join(decDir, 'adr-001.md'), '# ADR 1\n');
    writeFileSync(path.join(decDir, 'adr-002.md'), '# ADR 2\n');
    const r = eaReview.generatePacket(tmp);
    const ds = r.sections['decision-summary'];
    expect(ds.present).toBe(true);
    expect(ds.total_adrs).toBe(2);
  });
});
