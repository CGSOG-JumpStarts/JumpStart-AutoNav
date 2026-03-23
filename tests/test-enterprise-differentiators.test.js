/**
 * test-enterprise-differentiators.test.js — Tests for Enterprise Differentiator modules
 * Covers Items 81-86, 90-91, 94-96.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-enterprise-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// --- Module imports ---
const {
  addNode, addEdge, queryGraph, generateReport: kgReport,
  NODE_TYPES, EDGE_TYPES
} = require('../bin/lib/knowledge-graph');

const {
  registerPattern, searchPatterns, listPatterns,
  PATTERN_CATEGORIES
} = require('../bin/lib/pattern-library');

const {
  defineElement, queryOntology, generateReport: ontologyReport,
  ELEMENT_TYPES
} = require('../bin/lib/domain-ontology');

const {
  registerContract, validateCompatibility, trackLineage,
  generateReport: contractReport, COMPATIBILITY_MODES
} = require('../bin/lib/data-contracts');

const {
  defineTopic, defineEvent, defineSaga,
  generateReport: eventReport, EVENT_TYPES
} = require('../bin/lib/event-modeling');

const {
  registerTemplate, listTemplates, instantiateTemplate,
  generateReport: platformReport, TEMPLATE_TYPES
} = require('../bin/lib/platform-engineering');

const {
  evaluate, generateReport: aiReport, configureBenchmark,
  EVAL_DIMENSIONS
} = require('../bin/lib/ai-evaluation');

const {
  registerAsset, addVersion, approveVersion, listAssets,
  ASSET_TYPES
} = require('../bin/lib/prompt-governance');

const {
  generateMonitor, generateAlert, generateRunbook, configureErrorBudget,
  MONITOR_TYPES, ALERT_SEVERITIES
} = require('../bin/lib/sre-integration');

const {
  ingestMetric, analyzeMetrics, generateFeedbackReport,
  METRIC_TYPES
} = require('../bin/lib/telemetry-feedback');

const {
  indexProject, searchProject, SEARCHABLE_TYPES
} = require('../bin/lib/enterprise-search');

// ============================================================
// Item 81 — Knowledge Graph
// ============================================================
describe('knowledge-graph (Item 81)', () => {
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'knowledge-graph.json');
  });
  afterEach(() => cleanup(tmpDir));

  it('addNode creates a node with correct fields', () => {
    const result = addNode('AuthService', 'component', { stateFile, tags: ['security'] });
    expect(result.success).toBe(true);
    expect(result.node.name).toBe('AuthService');
    expect(result.node.type).toBe('component');
    expect(result.node.tags).toContain('security');
    expect(result.node.id).toBeTruthy();
  });

  it('addEdge links two nodes', () => {
    const n1 = addNode('ServiceA', 'component', { stateFile });
    const n2 = addNode('ServiceB', 'component', { stateFile });
    const edge = addEdge(n1.node.id, n2.node.id, 'depends-on', { stateFile });
    expect(edge.success).toBe(true);
    expect(edge.edge.from).toBe(n1.node.id);
    expect(edge.edge.to).toBe(n2.node.id);
    expect(edge.edge.type).toBe('depends-on');
  });

  it('queryGraph returns matching nodes', () => {
    addNode('Logger', 'module', { stateFile });
    addNode('Metrics', 'module', { stateFile });
    const result = queryGraph({ stateFile, type: 'module' });
    expect(result.success).toBe(true);
    expect(result.results.length).toBe(2);
  });

  it('generateReport summarises the graph', () => {
    addNode('Cache', 'component', { stateFile });
    addNode('DB', 'component', { stateFile });
    addEdge('n1', 'n2', 'uses', { stateFile });
    const report = kgReport({ stateFile });
    expect(report.success).toBe(true);
    expect(report.total_nodes).toBe(2);
    expect(report.total_edges).toBe(1);
  });
});

// ============================================================
// Item 82 — Pattern Library
// ============================================================
describe('pattern-library (Item 82)', () => {
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'pattern-library.json');
  });
  afterEach(() => cleanup(tmpDir));

  it('registerPattern creates a pattern with id', () => {
    const result = registerPattern('RetryWithBackoff', 'error-handling', {
      stateFile,
      description: 'Exponential backoff retry',
      tags: ['resilience']
    });
    expect(result.success).toBe(true);
    expect(result.pattern.name).toBe('RetryWithBackoff');
    expect(result.pattern.category).toBe('error-handling');
    expect(result.pattern.id).toBeTruthy();
  });

  it('searchPatterns finds matching patterns', () => {
    registerPattern('CircuitBreaker', 'error-handling', { stateFile });
    registerPattern('JWT Auth', 'auth', { stateFile });
    const result = searchPatterns('circuit', { stateFile });
    expect(result.success).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('listPatterns returns all patterns', () => {
    registerPattern('CQRS', 'api', { stateFile });
    registerPattern('Repository', 'data-access', { stateFile });
    const result = listPatterns({ stateFile });
    expect(result.success).toBe(true);
    expect(result.total).toBe(2);
    expect(result.patterns.length).toBe(2);
  });
});

// ============================================================
// Item 83 — Domain Ontology
// ============================================================
describe('domain-ontology (Item 83)', () => {
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'domain-ontology.json');
  });
  afterEach(() => cleanup(tmpDir));

  it('defineElement adds a domain element', () => {
    const result = defineElement('ecommerce', 'Order', 'entity', {
      stateFile,
      description: 'A customer order',
      properties: ['orderId', 'total']
    });
    expect(result.success).toBe(true);
    expect(result.element.name).toBe('Order');
    expect(result.element.type).toBe('entity');
  });

  it('queryOntology returns elements for a domain', () => {
    defineElement('payments', 'Invoice', 'entity', { stateFile });
    defineElement('payments', 'Refund', 'event', { stateFile });
    const result = queryOntology('payments', { stateFile });
    expect(result.success).toBe(true);
    expect(result.domain).toBe('payments');
    expect(result.total).toBe(2);
  });

  it('queryOntology filters by type', () => {
    defineElement('shipping', 'Shipment', 'entity', { stateFile });
    defineElement('shipping', 'ShipmentCreated', 'event', { stateFile });
    const result = queryOntology('shipping', { stateFile, type: 'event' });
    expect(result.success).toBe(true);
    expect(result.elements.length).toBe(1);
    expect(result.elements[0].type).toBe('event');
  });

  it('generateReport summarises all domains', () => {
    defineElement('billing', 'Payment', 'entity', { stateFile });
    const report = ontologyReport({ stateFile });
    expect(report.success).toBe(true);
    expect(report.total_domains).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// Item 84 — Data Contracts
// ============================================================
describe('data-contracts (Item 84)', () => {
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'data-contracts.json');
  });
  afterEach(() => cleanup(tmpDir));

  it('registerContract creates a contract', () => {
    const schema = { fields: [{ name: 'id', type: 'string' }, { name: 'amount', type: 'number' }] };
    const result = registerContract('OrderEvent', schema, {
      stateFile,
      version: '1.0.0',
      producer: 'order-service'
    });
    expect(result.success).toBe(true);
    expect(result.contract.name).toBe('OrderEvent');
    expect(result.contract.schema).toEqual(schema);
  });

  it('validateCompatibility detects breaking changes', () => {
    const schema = { id: 'string', total: 'number' };
    const reg = registerContract('PaymentEvent', schema, { stateFile });
    const newSchema = { id: 'string' };
    const result = validateCompatibility(reg.contract.id, newSchema, { stateFile });
    expect(result.success).toBe(true);
    expect(result.removed.length).toBeGreaterThanOrEqual(1);
  });

  it('trackLineage connects contracts', () => {
    const c1 = registerContract('Source', { fields: [] }, { stateFile });
    const c2 = registerContract('Target', { fields: [] }, { stateFile });
    const result = trackLineage(c1.contract.id, c2.contract.id, {
      stateFile,
      transformation: 'map'
    });
    expect(result.success).toBe(true);
    expect(result.lineage.source).toBe(c1.contract.id);
    expect(result.lineage.target).toBe(c2.contract.id);
  });

  it('generateReport lists contracts and lineage', () => {
    registerContract('Evt1', { fields: [] }, { stateFile });
    const report = contractReport({ stateFile });
    expect(report.success).toBe(true);
    expect(report.total_contracts).toBe(1);
  });
});

// ============================================================
// Item 85 — Event Modeling
// ============================================================
describe('event-modeling (Item 85)', () => {
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'event-modeling.json');
  });
  afterEach(() => cleanup(tmpDir));

  it('defineTopic creates a topic', () => {
    const result = defineTopic('order-events', { stateFile, partitions: 4 });
    expect(result.success).toBe(true);
    expect(result.topic.name).toBe('order-events');
    expect(result.topic.partitions).toBe(4);
  });

  it('defineEvent attaches an event to a topic', () => {
    const topic = defineTopic('payments', { stateFile });
    const result = defineEvent('PaymentReceived', topic.topic.id, {
      stateFile,
      type: 'domain-event'
    });
    expect(result.success).toBe(true);
    expect(result.event.name).toBe('PaymentReceived');
    expect(result.event.topic).toBe(topic.topic.id);
  });

  it('defineSaga creates a saga with ordered steps', () => {
    const steps = [
      { action: 'reserve-inventory' },
      { action: 'charge-payment' },
      { action: 'confirm-order' }
    ];
    const result = defineSaga('OrderFulfillment', steps, { stateFile });
    expect(result.success).toBe(true);
    expect(result.saga.name).toBe('OrderFulfillment');
    expect(result.saga.steps.length).toBe(3);
  });

  it('generateReport summarises topics, events, sagas', () => {
    defineTopic('t1', { stateFile });
    const report = eventReport({ stateFile });
    expect(report.success).toBe(true);
    expect(report.total_topics).toBe(1);
  });
});

// ============================================================
// Item 86 — Platform Engineering
// ============================================================
describe('platform-engineering (Item 86)', () => {
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'platform-engineering.json');
  });
  afterEach(() => cleanup(tmpDir));

  it('registerTemplate creates a golden-path template', () => {
    const result = registerTemplate('node-api', 'service', {
      stateFile,
      tech_stack: ['node', 'express'],
      version: '1.0.0'
    });
    expect(result.success).toBe(true);
    expect(result.template.name).toBe('node-api');
    expect(result.template.type).toBe('service');
  });

  it('listTemplates returns registered templates', () => {
    registerTemplate('python-worker', 'worker', { stateFile });
    registerTemplate('react-app', 'frontend', { stateFile });
    const result = listTemplates({ stateFile });
    expect(result.success).toBe(true);
    expect(result.total).toBe(2);
  });

  it('instantiateTemplate creates an instance from a template', () => {
    const tmpl = registerTemplate('go-service', 'service', { stateFile });
    const result = instantiateTemplate(tmpl.template.id, 'my-new-service', { stateFile });
    expect(result.success).toBe(true);
    expect(result.instance.project_name).toBe('my-new-service');
    expect(result.instance.template_id).toBe(tmpl.template.id);
  });

  it('generateReport summarises templates and instances', () => {
    registerTemplate('java-api', 'service', { stateFile });
    const report = platformReport({ stateFile });
    expect(report.success).toBe(true);
    expect(report.total_templates).toBe(1);
  });
});

// ============================================================
// Item 90 — AI Evaluation
// ============================================================
describe('ai-evaluation (Item 90)', () => {
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'ai-evaluation.json');
  });
  afterEach(() => cleanup(tmpDir));

  it('evaluate records an evaluation with overall score', () => {
    const scores = { groundedness: 0.9, relevance: 0.8, coherence: 0.85 };
    const result = evaluate('gpt4-test', scores, { stateFile, model: 'gpt-4' });
    expect(result.success).toBe(true);
    expect(result.evaluation.name).toBe('gpt4-test');
    expect(result.evaluation.scores).toEqual(scores);
    expect(typeof result.evaluation.overall).toBe('number');
  });

  it('generateReport computes averages across evaluations', () => {
    evaluate('eval1', { groundedness: 0.8, relevance: 0.6 }, { stateFile });
    evaluate('eval2', { groundedness: 1.0, relevance: 0.8 }, { stateFile });
    const report = aiReport({ stateFile });
    expect(report.success).toBe(true);
    expect(report.total_evaluations).toBe(2);
  });

  it('configureBenchmark stores threshold config', () => {
    const thresholds = { groundedness: 0.7, relevance: 0.6 };
    const result = configureBenchmark('quality-gate', thresholds, { stateFile });
    expect(result.success).toBe(true);
    expect(result.benchmark.name).toBe('quality-gate');
    expect(result.benchmark.thresholds).toEqual(thresholds);
  });
});

// ============================================================
// Item 91 — Prompt Governance
// ============================================================
describe('prompt-governance (Item 91)', () => {
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'prompt-governance.json');
  });
  afterEach(() => cleanup(tmpDir));

  it('registerAsset creates a versioned prompt asset', () => {
    const result = registerAsset('system-prompt', 'prompt', 'You are a helpful assistant.', { stateFile });
    expect(result.success).toBe(true);
    expect(result.asset.name).toBe('system-prompt');
    expect(result.asset.type).toBe('prompt');
  });

  it('addVersion adds a new version to an asset', () => {
    const reg = registerAsset('code-reviewer', 'persona', 'Review code carefully.', { stateFile });
    const result = addVersion(reg.asset.id, 'Review code with security focus.', '2.0.0', { stateFile });
    expect(result.success).toBe(true);
    expect(result.version).toBe('2.0.0');
  });

  it('approveVersion marks a version as approved', () => {
    const reg = registerAsset('qa-prompt', 'prompt', 'Test all edge cases.', { stateFile });
    const result = approveVersion(reg.asset.id, reg.asset.version, { stateFile, approver: 'admin' });
    expect(result.success).toBe(true);
    expect(result.approved).toBe(true);
  });

  it('listAssets returns all registered assets', () => {
    registerAsset('p1', 'prompt', 'content1', { stateFile });
    registerAsset('p2', 'persona', 'content2', { stateFile });
    const result = listAssets({ stateFile });
    expect(result.success).toBe(true);
    expect(result.total).toBe(2);
  });
});

// ============================================================
// Item 94 — SRE Integration
// ============================================================
describe('sre-integration (Item 94)', () => {
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'sre-integration.json');
  });
  afterEach(() => cleanup(tmpDir));

  it('generateMonitor creates a monitoring definition', () => {
    const result = generateMonitor('api-latency', 'latency', {
      stateFile,
      threshold: '200ms',
      service: 'api-gateway'
    });
    expect(result.success).toBe(true);
    expect(result.monitor.name).toBe('api-latency');
    expect(result.monitor.type).toBe('latency');
  });

  it('generateAlert creates an alert rule', () => {
    const result = generateAlert('high-error-rate', 'critical', {
      stateFile,
      condition: 'error_rate > 5%',
      channels: ['pagerduty']
    });
    expect(result.success).toBe(true);
    expect(result.alert.name).toBe('high-error-rate');
    expect(result.alert.severity).toBe('critical');
  });

  it('generateRunbook creates a runbook with steps', () => {
    const steps = [
      { action: 'Check logs for errors' },
      { action: 'Restart the service' },
      { action: 'Verify health endpoint' }
    ];
    const result = generateRunbook('api-recovery', steps, { stateFile, service: 'api' });
    expect(result.success).toBe(true);
    expect(result.runbook.name).toBe('api-recovery');
    expect(result.runbook.steps.length).toBe(3);
  });

  it('configureErrorBudget sets SLO and budget', () => {
    const result = configureErrorBudget('checkout-api', 99.9, {
      stateFile,
      window: '30d'
    });
    expect(result.success).toBe(true);
    expect(result.error_budget.service).toBe('checkout-api');
    expect(result.error_budget.slo_target).toBe(99.9);
  });
});

// ============================================================
// Item 95 — Telemetry Feedback
// ============================================================
describe('telemetry-feedback (Item 95)', () => {
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'telemetry-feedback.json');
  });
  afterEach(() => cleanup(tmpDir));

  it('ingestMetric records a metric data point', () => {
    const result = ingestMetric('response-time', 'latency', 150, {
      stateFile,
      unit: 'ms',
      service: 'api'
    });
    expect(result.success).toBe(true);
    expect(result.metric.name).toBe('response-time');
    expect(result.metric.value).toBe(150);
    expect(result.metric.type).toBe('latency');
  });

  it('analyzeMetrics computes aggregates', () => {
    ingestMetric('latency-1', 'latency', 100, { stateFile });
    ingestMetric('latency-2', 'latency', 200, { stateFile });
    ingestMetric('errors', 'error-rate', 0.05, { stateFile });
    const result = analyzeMetrics({ stateFile });
    expect(result.success).toBe(true);
    expect(result.total_metrics).toBe(3);
    expect(result.analysis).toHaveProperty('latency');
  });

  it('generateFeedbackReport produces recommendations', () => {
    ingestMetric('m1', 'latency', 50, { stateFile });
    const report = generateFeedbackReport({ stateFile });
    expect(report.success).toBe(true);
    expect(report.total_metrics).toBe(1);
  });
});

// ============================================================
// Item 96 — Enterprise Search
// ============================================================
describe('enterprise-search (Item 96)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });
  afterEach(() => cleanup(tmpDir));

  it('indexProject indexes specs, src, and config', () => {
    fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Architecture\nOverview of the system');
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'console.log("hello");');
    const result = indexProject(tmpDir);
    expect(result.success).toBe(true);
    expect(result.total_entries).toBeGreaterThanOrEqual(2);
    const types = result.index.entries.map(e => e.type);
    expect(types).toContain('spec');
    expect(types).toContain('code');
  });

  it('searchProject finds content matching a query', () => {
    fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'), '# PRD\nUser authentication flow');
    fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Arch\nDatabase schema');
    const result = searchProject(tmpDir, 'authentication');
    expect(result.success).toBe(true);
    expect(result.total_results).toBeGreaterThanOrEqual(1);
    expect(result.results[0].preview.length).toBeGreaterThanOrEqual(1);
  });

  it('searchProject returns error for empty query', () => {
    const result = searchProject(tmpDir, '');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
