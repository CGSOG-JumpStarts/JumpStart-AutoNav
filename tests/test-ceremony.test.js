/**
 * test-ceremony.test.js — Tests for Tiered Ceremony Profiles (UX Feature 3)
 *
 * Tests for bin/lib/ceremony.js covering:
 * - Profile expansion (light, standard, rigorous)
 * - Dot-notation expansion to nested objects
 * - Profile application with user override precedence
 * - Profile comparison
 * - Invalid profile handling
 * - Standard profile matches current defaults (no regression)
 */

import { describe, it, expect } from 'vitest';

// Dynamic import for ESM module
let ceremony;

async function loadCeremony() {
  if (!ceremony) {
    ceremony = await import('../bin/lib/ceremony.js');
  }
  return ceremony;
}

// ─── Profile Expansion ───────────────────────────────────────────────────────

describe('expandProfile', () => {
  it('expands the light profile', async () => {
    const { expandProfile } = await loadCeremony();
    const settings = expandProfile('light');
    expect(settings['agents.challenger.elicitation_depth']).toBe('quick');
    expect(settings['agents.pm.require_nfrs']).toBe(false);
    expect(settings['agents.architect.adr_required']).toBe(false);
    expect(settings['testing.adversarial_required']).toBe(false);
    expect(settings['roadmap.test_drive_mandate']).toBe(false);
  });

  it('expands the standard profile', async () => {
    const { expandProfile } = await loadCeremony();
    const settings = expandProfile('standard');
    expect(settings['agents.challenger.elicitation_depth']).toBe('standard');
    expect(settings['agents.pm.require_nfrs']).toBe(true);
    expect(settings['agents.architect.adr_required']).toBe(true);
    expect(settings['testing.adversarial_required']).toBe(false);
  });

  it('expands the rigorous profile', async () => {
    const { expandProfile } = await loadCeremony();
    const settings = expandProfile('rigorous');
    expect(settings['agents.challenger.elicitation_depth']).toBe('deep');
    expect(settings['agents.pm.require_nfrs']).toBe(true);
    expect(settings['testing.adversarial_required']).toBe(true);
    expect(settings['testing.peer_review_required']).toBe(true);
    expect(settings['roadmap.test_drive_mandate']).toBe(true);
  });

  it('throws on invalid profile name', async () => {
    const { expandProfile } = await loadCeremony();
    expect(() => expandProfile('extreme')).toThrow('Unknown ceremony profile');
  });

  it('returns a new object each time (no mutation)', async () => {
    const { expandProfile } = await loadCeremony();
    const a = expandProfile('light');
    const b = expandProfile('light');
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // Different object references
  });
});

// ─── Dot-Notation Expansion ──────────────────────────────────────────────────

describe('expandDotNotation', () => {
  it('expands flat dot-notation to nested objects', async () => {
    const { expandDotNotation } = await loadCeremony();
    const result = expandDotNotation({
      'agents.pm.require_nfrs': true,
      'agents.architect.adr_required': false,
      'testing.spec_quality.ambiguity_max': 10
    });
    expect(result.agents.pm.require_nfrs).toBe(true);
    expect(result.agents.architect.adr_required).toBe(false);
    expect(result.testing.spec_quality.ambiguity_max).toBe(10);
  });

  it('handles single-level keys', async () => {
    const { expandDotNotation } = await loadCeremony();
    const result = expandDotNotation({ 'simple': 'value' });
    expect(result.simple).toBe('value');
  });

  it('handles empty input', async () => {
    const { expandDotNotation } = await loadCeremony();
    const result = expandDotNotation({});
    expect(result).toEqual({});
  });
});

// ─── Profile Application ─────────────────────────────────────────────────────

describe('applyProfile', () => {
  it('fills in defaults for missing config keys', async () => {
    const { applyProfile } = await loadCeremony();
    const config = {}; // Empty config — profile fills everything
    const result = applyProfile(config, 'light');

    expect(result.config.agents.challenger.elicitation_depth).toBe('quick');
    expect(result.config.agents.pm.require_nfrs).toBe(false);
    expect(result.applied.length).toBeGreaterThan(0);
  });

  it('preserves explicit user config over profile defaults', async () => {
    const { applyProfile } = await loadCeremony();
    const config = {
      agents: {
        challenger: { elicitation_depth: 'deep' }, // User override
        pm: {} // No override — will get profile default
      }
    };
    const result = applyProfile(config, 'light');

    // User's explicit value wins
    expect(result.config.agents.challenger.elicitation_depth).toBe('deep');
    // Profile default fills in missing
    expect(result.config.agents.pm.require_nfrs).toBe(false);
    // Track what was skipped
    expect(result.skipped).toContain('agents.challenger.elicitation_depth');
  });

  it('does not mutate the original config', async () => {
    const { applyProfile } = await loadCeremony();
    const config = { agents: { pm: { require_nfrs: true } } };
    const configCopy = JSON.parse(JSON.stringify(config));
    applyProfile(config, 'light');

    expect(config).toEqual(configCopy);
  });

  it('reports applied and skipped settings', async () => {
    const { applyProfile } = await loadCeremony();
    const config = {
      agents: { challenger: { elicitation_depth: 'standard' } },
      workflow: { qa_log: true }
    };
    const result = applyProfile(config, 'rigorous');

    expect(Array.isArray(result.applied)).toBe(true);
    expect(Array.isArray(result.skipped)).toBe(true);
    expect(result.skipped).toContain('agents.challenger.elicitation_depth');
    expect(result.skipped).toContain('workflow.qa_log');
  });
});

// ─── Profile Comparison ──────────────────────────────────────────────────────

describe('compareProfiles', () => {
  it('shows differences between light and rigorous', async () => {
    const { compareProfiles } = await loadCeremony();
    const diffs = compareProfiles('light', 'rigorous');

    expect(diffs.length).toBeGreaterThan(0);

    // Elicitation depth should differ
    const elicitation = diffs.find(d => d.setting === 'agents.challenger.elicitation_depth');
    expect(elicitation).toBeDefined();
    expect(elicitation.light).toBe('quick');
    expect(elicitation.rigorous).toBe('deep');
  });

  it('shows no differences between same profile', async () => {
    const { compareProfiles } = await loadCeremony();
    const diffs = compareProfiles('standard', 'standard');
    expect(diffs).toEqual([]);
  });
});

// ─── Profile Summary ─────────────────────────────────────────────────────────

describe('getProfileSummary', () => {
  it('returns all three profiles', async () => {
    const { getProfileSummary } = await loadCeremony();
    const summary = getProfileSummary();

    expect(summary.profiles).toHaveLength(3);
    expect(summary.profiles.map(p => p.name)).toEqual(['light', 'standard', 'rigorous']);
  });

  it('each profile has a description and setting count', async () => {
    const { getProfileSummary } = await loadCeremony();
    const summary = getProfileSummary();

    for (const profile of summary.profiles) {
      expect(profile.description).toBeTruthy();
      expect(profile.setting_count).toBeGreaterThan(0);
    }
  });

  it('includes key differences between light and rigorous', async () => {
    const { getProfileSummary } = await loadCeremony();
    const summary = getProfileSummary();
    expect(summary.key_differences.length).toBeGreaterThan(0);
  });
});

// ─── VALID_PROFILES ──────────────────────────────────────────────────────────

describe('VALID_PROFILES', () => {
  it('contains exactly three profiles', async () => {
    const { VALID_PROFILES } = await loadCeremony();
    expect(VALID_PROFILES).toEqual(['light', 'standard', 'rigorous']);
  });
});

// ─── Profile Description ─────────────────────────────────────────────────────

describe('getProfileDescription', () => {
  it('returns a description for each valid profile', async () => {
    const { getProfileDescription, VALID_PROFILES } = await loadCeremony();
    for (const name of VALID_PROFILES) {
      const desc = getProfileDescription(name);
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(10);
    }
  });

  it('throws on invalid profile', async () => {
    const { getProfileDescription } = await loadCeremony();
    expect(() => getProfileDescription('invalid')).toThrow('Unknown ceremony profile');
  });
});
