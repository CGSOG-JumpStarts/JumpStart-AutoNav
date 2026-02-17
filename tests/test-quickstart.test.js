/**
 * test-quickstart.test.js — Tests for 5-Minute Quickstart Wizard (UX Feature 15)
 *
 * Tests for bin/lib/quickstart.js covering:
 * - Domain options structure
 * - Ceremony options mapping
 * - Config building
 * - First command determination
 * - Summary generation
 * - Config patching
 */

import { describe, it, expect } from 'vitest';

// Dynamic import because quickstart.js is ESM
let quickstart;

describe('quickstart', () => {
  // Use beforeAll-style technique: import once
  it('module loads successfully', async () => {
    quickstart = await import('../bin/lib/quickstart.js');
    expect(quickstart).toBeDefined();
  });

  // ─── DOMAIN_OPTIONS ──────────────────────────────────────────────────

  describe('DOMAIN_OPTIONS', () => {
    it('has common domain entries', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { DOMAIN_OPTIONS } = quickstart;

      expect(DOMAIN_OPTIONS.length).toBeGreaterThanOrEqual(8);
      const values = DOMAIN_OPTIONS.map(d => d.value);
      expect(values).toContain('web-app');
      expect(values).toContain('api-service');
      expect(values).toContain('cli-tool');
      expect(values).toContain('library');
      expect(values).toContain('ecommerce');
      expect(values).toContain('other');
    });

    it('each option has value, title, and description', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      for (const option of quickstart.DOMAIN_OPTIONS) {
        expect(option).toHaveProperty('value');
        expect(option).toHaveProperty('title');
        expect(option).toHaveProperty('description');
        expect(typeof option.value).toBe('string');
        expect(typeof option.title).toBe('string');
      }
    });
  });

  // ─── CEREMONY_OPTIONS ────────────────────────────────────────────────

  describe('CEREMONY_OPTIONS', () => {
    it('maps to valid ceremony profiles', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { CEREMONY_OPTIONS } = quickstart;

      expect(CEREMONY_OPTIONS.length).toBe(3);
      const values = CEREMONY_OPTIONS.map(c => c.value);
      expect(values).toContain('light');
      expect(values).toContain('standard');
      expect(values).toContain('rigorous');
    });

    it('each option has value, title, and description', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      for (const option of quickstart.CEREMONY_OPTIONS) {
        expect(option).toHaveProperty('value');
        expect(option).toHaveProperty('title');
        expect(option).toHaveProperty('description');
      }
    });
  });

  // ─── buildQuickstartConfig ───────────────────────────────────────────

  describe('buildQuickstartConfig', () => {
    it('builds a valid config with all answers', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { buildQuickstartConfig } = quickstart;

      const config = buildQuickstartConfig({
        projectName: 'my-app',
        projectType: 'greenfield',
        domain: 'web-app',
        ceremony: 'light',
        targetDir: '/tmp/test'
      });

      expect(config.projectName).toBe('my-app');
      expect(config.projectType).toBe('greenfield');
      expect(config.domain).toBe('web-app');
      expect(config.ceremony).toBe('light');
      expect(config.targetDir).toBe('/tmp/test');
      expect(config.copilot).toBe(true);
    });

    it('uses defaults for missing answers', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { buildQuickstartConfig } = quickstart;

      const config = buildQuickstartConfig({});

      expect(config.targetDir).toBe('.');
      expect(config.projectType).toBe('greenfield');
      expect(config.domain).toBe('general');
      expect(config.ceremony).toBe('standard');
    });

    it('handles "other" domain with custom value', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { buildQuickstartConfig } = quickstart;

      const config = buildQuickstartConfig({
        domain: 'other',
        customDomain: 'robotics-firmware'
      });

      expect(config.domain).toBe('robotics-firmware');
    });

    it('handles "other" domain without custom value', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { buildQuickstartConfig } = quickstart;

      const config = buildQuickstartConfig({ domain: 'other' });

      expect(config.domain).toBe('general');
    });

    it('sets brownfield project type', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { buildQuickstartConfig } = quickstart;

      const config = buildQuickstartConfig({ projectType: 'brownfield' });

      expect(config.projectType).toBe('brownfield');
    });
  });

  // ─── getFirstCommand ─────────────────────────────────────────────────

  describe('getFirstCommand', () => {
    it('returns /jumpstart.challenge for greenfield', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { getFirstCommand } = quickstart;

      const result = getFirstCommand({ projectType: 'greenfield' });
      expect(result.command).toBe('/jumpstart.challenge');
      expect(result.message).toBeDefined();
    });

    it('returns /jumpstart.scout for brownfield', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { getFirstCommand } = quickstart;

      const result = getFirstCommand({ projectType: 'brownfield' });
      expect(result.command).toBe('/jumpstart.scout');
      expect(result.message).toContain('Scout');
    });
  });

  // ─── generateQuickstartSummary ────────────────────────────────────────

  describe('generateQuickstartSummary', () => {
    it('includes project details in summary lines', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { generateQuickstartSummary, buildQuickstartConfig } = quickstart;

      const config = buildQuickstartConfig({
        projectName: 'my-app',
        projectType: 'greenfield',
        domain: 'web-app',
        ceremony: 'light'
      });
      const summary = generateQuickstartSummary(config);

      expect(summary.lines).toBeDefined();
      expect(summary.lines.some(l => l.includes('my-app'))).toBe(true);
      expect(summary.lines.some(l => l.includes('greenfield'))).toBe(true);
      expect(summary.lines.some(l => l.includes('web-app'))).toBe(true);
      expect(summary.lines.some(l => l.includes('light'))).toBe(true);
      expect(summary.firstCommand).toBe('/jumpstart.challenge');
    });

    it('returns the correct firstCommand for brownfield', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { generateQuickstartSummary, buildQuickstartConfig } = quickstart;

      const config = buildQuickstartConfig({ projectType: 'brownfield' });
      const summary = generateQuickstartSummary(config);

      expect(summary.firstCommand).toBe('/jumpstart.scout');
    });
  });

  // ─── applyConfigPatches ──────────────────────────────────────────────

  describe('applyConfigPatches', () => {
    it('patches ceremony profile in config content', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { applyConfigPatches, buildQuickstartConfig } = quickstart;

      const configContent = 'ceremony:\n  profile: standard\n';
      const config = buildQuickstartConfig({ ceremony: 'light' });
      const patched = applyConfigPatches(configContent, config);

      expect(patched).toContain('profile: light');
    });

    it('patches domain into project section', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { applyConfigPatches, buildQuickstartConfig } = quickstart;

      const configContent = 'project:\n  type: greenfield\n  name: test\n';
      const config = buildQuickstartConfig({ domain: 'ecommerce' });
      const patched = applyConfigPatches(configContent, config);

      expect(patched).toContain('domain: ecommerce');
    });

    it('does not modify content for standard ceremony', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { applyConfigPatches, buildQuickstartConfig } = quickstart;

      const configContent = 'ceremony:\n  profile: standard\n';
      const config = buildQuickstartConfig({ ceremony: 'standard', domain: 'general' });
      const patched = applyConfigPatches(configContent, config);

      // "general" domain produces no patch, "standard" ceremony produces no patch
      expect(patched).toBe(configContent);
    });
  });

  // ─── getConfigPatches ────────────────────────────────────────────────

  describe('getConfigPatches', () => {
    it('returns empty patches for standard defaults', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { getConfigPatches, buildQuickstartConfig } = quickstart;

      const config = buildQuickstartConfig({});
      const { patches } = getConfigPatches(config);

      // Default is standard ceremony and general domain → 0 patches
      expect(patches.length).toBe(0);
    });

    it('returns ceremony patch for non-standard profile', async () => {
      if (!quickstart) quickstart = await import('../bin/lib/quickstart.js');
      const { getConfigPatches, buildQuickstartConfig } = quickstart;

      const config = buildQuickstartConfig({ ceremony: 'rigorous' });
      const { patches } = getConfigPatches(config);

      const ceremonyPatch = patches.find(p => p.key === 'profile');
      expect(ceremonyPatch).toBeDefined();
      expect(ceremonyPatch.value).toBe('rigorous');
    });
  });
});
