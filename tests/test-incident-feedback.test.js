import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-test-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}
function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  defaultState,
  loadState,
  saveState,
  logIncident,
  analyzeIncident,
  generateReport,
  INCIDENT_SEVERITIES,
  INCIDENT_CATEGORIES
} = require('../bin/lib/incident-feedback.js');

describe('incident-feedback', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'incidents.json');
  });
  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('has severities', () => {
      expect(INCIDENT_SEVERITIES).toContain('sev1');
      expect(INCIDENT_SEVERITIES).toContain('sev4');
    });
    it('has categories', () => {
      expect(INCIDENT_CATEGORIES).toContain('security');
      expect(INCIDENT_CATEGORIES).toContain('availability');
    });
  });

  describe('defaultState', () => {
    it('returns fresh state', () => {
      const s = defaultState();
      expect(s.incidents).toEqual([]);
      expect(s.spec_updates).toEqual([]);
    });
  });

  describe('logIncident', () => {
    it('fails without title/severity', () => {
      expect(logIncident(null).success).toBe(false);
      expect(logIncident({ title: 'x' }).success).toBe(false);
    });
    it('fails for invalid severity', () => {
      const r = logIncident({ title: 'x', severity: 'bogus' }, { stateFile });
      expect(r.success).toBe(false);
    });
    it('logs a valid incident', () => {
      const r = logIncident({ title: 'DB down', severity: 'sev1', category: 'availability' }, { stateFile });
      expect(r.success).toBe(true);
      expect(r.incident.id).toBe('INC-0001');
    });
  });

  describe('analyzeIncident', () => {
    it('fails for missing incident', () => {
      expect(analyzeIncident('INC-9999', { stateFile }).success).toBe(false);
    });
    it('generates recommendations for availability sev1', () => {
      logIncident({ title: 'Outage', severity: 'sev1', category: 'availability' }, { stateFile });
      const r = analyzeIncident('INC-0001', { stateFile });
      expect(r.success).toBe(true);
      expect(r.recommendations.length).toBeGreaterThan(0);
    });
    it('generates security recommendations', () => {
      logIncident({ title: 'Breach', severity: 'sev2', category: 'security' }, { stateFile });
      const r = analyzeIncident('INC-0001', { stateFile });
      expect(r.recommendations.some(rec => rec.type === 'requirement')).toBe(true);
    });
  });

  describe('generateReport', () => {
    it('empty report', () => {
      const r = generateReport({ stateFile });
      expect(r.success).toBe(true);
      expect(r.total_incidents).toBe(0);
    });
    it('reports after logging', () => {
      logIncident({ title: 'a', severity: 'sev2' }, { stateFile });
      logIncident({ title: 'b', severity: 'sev2' }, { stateFile });
      const r = generateReport({ stateFile });
      expect(r.total_incidents).toBe(2);
      expect(r.by_severity.sev2).toBe(2);
    });
  });
});
