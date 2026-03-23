/**
 * test-portfolio-reporting.test.js — Tests for Portfolio Reporting Layer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-portfolio-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  defaultPortfolio,
  loadPortfolio,
  savePortfolio,
  analyzeProject,
  registerInitiative,
  refreshInitiative,
  getPortfolioStatus,
  removeInitiative,
  takeSnapshot,
  PORTFOLIO_STATUSES,
  PHASES
} = require('../bin/lib/portfolio-reporting');

describe('portfolio-reporting', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('defaultPortfolio', () => {
    it('returns valid default structure', () => {
      const p = defaultPortfolio();
      expect(p.version).toBe('1.0.0');
      expect(p.initiatives).toEqual([]);
      expect(p.snapshots).toEqual([]);
    });
  });

  describe('PORTFOLIO_STATUSES', () => {
    it('includes expected statuses', () => {
      expect(PORTFOLIO_STATUSES).toContain('on-track');
      expect(PORTFOLIO_STATUSES).toContain('at-risk');
      expect(PORTFOLIO_STATUSES).toContain('blocked');
      expect(PORTFOLIO_STATUSES).toContain('completed');
    });
  });

  describe('PHASES', () => {
    it('includes all phases', () => {
      expect(PHASES).toHaveLength(6);
      expect(PHASES.some(p => p.id === 'phase-0')).toBe(true);
      expect(PHASES.some(p => p.id === 'phase-4')).toBe(true);
    });
  });

  describe('loadPortfolio / savePortfolio', () => {
    it('loads default when missing', () => {
      const p = loadPortfolio(path.join(tmpDir, 'nonexistent.json'));
      expect(p.initiatives).toEqual([]);
    });

    it('saves and loads portfolio', () => {
      const filePath = path.join(tmpDir, '.jumpstart', 'state', 'portfolio.json');
      const p = defaultPortfolio();
      p.initiatives.push({ id: 'test', name: 'Test' });
      savePortfolio(p, filePath);

      const loaded = loadPortfolio(filePath);
      expect(loaded.initiatives).toHaveLength(1);
      expect(loaded.last_updated).toBeTruthy();
    });
  });

  describe('analyzeProject', () => {
    it('analyzes project with approved artifacts', () => {
      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(path.join(projectDir, '.jumpstart', 'state'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, 'specs'), { recursive: true });

      fs.writeFileSync(path.join(projectDir, 'specs', 'prd.md'),
        '# PRD\n\n- [x] Done\n\n**Approved by:** Human\n', 'utf8');

      const result = analyzeProject(projectDir);
      expect(result.artifacts_completed).toBeGreaterThan(0);
      expect(result.readiness).not.toBe('unknown');
    });

    it('detects blockers', () => {
      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(path.join(projectDir, '.jumpstart', 'state'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, 'specs'), { recursive: true });

      fs.writeFileSync(path.join(projectDir, 'specs', 'prd.md'),
        '# PRD\n\n[BLOCKER: API dependency unavailable]\n', 'utf8');

      const result = analyzeProject(projectDir);
      expect(result.blockers.length).toBeGreaterThan(0);
    });

    it('handles missing project', () => {
      const result = analyzeProject(path.join(tmpDir, 'nonexistent'));
      expect(result.readiness).toBe('not-started');
    });
  });

  describe('registerInitiative', () => {
    it('registers a new initiative', () => {
      const portfolioFile = path.join(tmpDir, '.jumpstart', 'state', 'portfolio.json');
      const result = registerInitiative({
        name: 'Project Alpha',
        owner: 'Team Lead',
        budget: 100000
      }, { portfolioFile });

      expect(result.success).toBe(true);
      expect(result.initiative.name).toBe('Project Alpha');
      expect(result.initiative.id).toBe('project-alpha');
    });

    it('errors without name', () => {
      const result = registerInitiative({});
      expect(result.success).toBe(false);
    });

    it('prevents duplicate IDs', () => {
      const portfolioFile = path.join(tmpDir, '.jumpstart', 'state', 'portfolio.json');
      registerInitiative({ name: 'Alpha' }, { portfolioFile });
      const result = registerInitiative({ name: 'Alpha' }, { portfolioFile });
      expect(result.success).toBe(false);
    });
  });

  describe('refreshInitiative', () => {
    it('refreshes initiative with project analysis', () => {
      const portfolioFile = path.join(tmpDir, '.jumpstart', 'state', 'portfolio.json');
      const projectDir = path.join(tmpDir, 'project');
      fs.mkdirSync(path.join(projectDir, '.jumpstart', 'state'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, 'specs'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'specs', 'prd.md'),
        '# PRD\n\n- [x] Done\n\n**Approved by:** Human\n', 'utf8');

      registerInitiative({ name: 'Alpha', path: projectDir }, { portfolioFile });
      const result = refreshInitiative('alpha', { portfolioFile });

      expect(result.success).toBe(true);
      expect(result.initiative.last_checked).toBeTruthy();
    });

    it('errors for unknown initiative', () => {
      const portfolioFile = path.join(tmpDir, '.jumpstart', 'state', 'portfolio.json');
      const result = refreshInitiative('nonexistent', { portfolioFile });
      expect(result.success).toBe(false);
    });
  });

  describe('getPortfolioStatus', () => {
    it('returns empty portfolio status', () => {
      const portfolioFile = path.join(tmpDir, '.jumpstart', 'state', 'portfolio.json');
      const result = getPortfolioStatus({ portfolioFile });
      expect(result.success).toBe(true);
      expect(result.total_initiatives).toBe(0);
    });

    it('returns populated portfolio status', () => {
      const portfolioFile = path.join(tmpDir, '.jumpstart', 'state', 'portfolio.json');
      registerInitiative({ name: 'Alpha', budget: 50000 }, { portfolioFile });
      registerInitiative({ name: 'Beta', budget: 75000 }, { portfolioFile });

      const result = getPortfolioStatus({ portfolioFile });
      expect(result.total_initiatives).toBe(2);
      expect(result.budget.total).toBe(125000);
      expect(result.initiatives).toHaveLength(2);
    });
  });

  describe('removeInitiative', () => {
    it('removes an initiative', () => {
      const portfolioFile = path.join(tmpDir, '.jumpstart', 'state', 'portfolio.json');
      registerInitiative({ name: 'Alpha' }, { portfolioFile });

      const result = removeInitiative('alpha', { portfolioFile });
      expect(result.success).toBe(true);
      expect(result.removed).toBe('Alpha');

      const status = getPortfolioStatus({ portfolioFile });
      expect(status.total_initiatives).toBe(0);
    });

    it('errors for unknown initiative', () => {
      const portfolioFile = path.join(tmpDir, '.jumpstart', 'state', 'portfolio.json');
      const result = removeInitiative('nonexistent', { portfolioFile });
      expect(result.success).toBe(false);
    });
  });

  describe('takeSnapshot', () => {
    it('takes a portfolio snapshot', () => {
      const portfolioFile = path.join(tmpDir, '.jumpstart', 'state', 'portfolio.json');
      registerInitiative({ name: 'Alpha' }, { portfolioFile });

      const result = takeSnapshot({ portfolioFile });
      expect(result.success).toBe(true);
      expect(result.snapshot.total_initiatives).toBe(1);

      const portfolio = loadPortfolio(portfolioFile);
      expect(portfolio.snapshots).toHaveLength(1);
    });
  });
});
