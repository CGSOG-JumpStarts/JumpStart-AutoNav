/**
 * ceremony.js — Tiered Ceremony Profiles (UX Feature 3)
 *
 * Defines three workflow ceremony levels (light, standard, rigorous) that
 * expand into concrete config overrides. Profiles act as a base layer —
 * explicit user config always takes precedence.
 *
 * Usage:
 *   echo '{"profile":"light"}' | node bin/lib/ceremony.js
 *   echo '{"profile":"rigorous","show_diff":true}' | node bin/lib/ceremony.js
 *
 * Output (stdout JSON):
 *   {
 *     "ok": true,
 *     "profile": "light",
 *     "settings": { ... },
 *     "description": "..."
 *   }
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/**
 * Ceremony profile definitions.
 *
 * Each profile maps config paths (dot-notation) to their values.
 * These form a base layer that explicit user config overrides.
 *
 * Design principle: "standard" matches the current defaults exactly,
 * so applying it changes nothing. "light" reduces ceremony for speed.
 * "rigorous" maximises quality guardrails for enterprise/regulated work.
 */
const PROFILES = {
  light: {
    description: 'Minimal ceremony — quick elicitation, fewer gates, auto-skip optional steps. Best for prototypes, small features, and rapid iteration.',
    settings: {
      // Agent behavior
      'agents.challenger.elicitation_depth': 'quick',
      'agents.analyst.persona_count': '1-2',
      'agents.analyst.scope_method': 'mvp',
      'agents.pm.require_nfrs': false,
      'agents.architect.adr_required': false,
      'agents.architect.generate_api_contracts': false,
      'agents.architect.generate_data_model': false,

      // Workflow
      'workflow.qa_log': false,

      // Testing thresholds (relaxed)
      'testing.adversarial_required': false,
      'testing.peer_review_required': false,
      'testing.spec_quality.ambiguity_max': 10,
      'testing.spec_quality.passive_voice_max': 20,
      'testing.spec_quality.metric_coverage_min': 60,
      'testing.spec_quality.smell_density_max': 8.0,
      'testing.spec_quality.overall_score_min': 50,
      'testing.story_coverage_required': false,

      // Roadmap
      'roadmap.test_drive_mandate': false,

      // Adaptive planning
      'adaptive_planning.thresholds.quick': 50,
      'adaptive_planning.thresholds.standard': 80,

      // Context7 (relaxed freshness threshold)
      'context7.freshness_threshold': 60,
      'context7.require_audit': false,

      // Diagram verification (relaxed)
      'diagram_verification.strict_c4_semantics': false
    }
  },

  standard: {
    description: 'Balanced workflow — standard elicitation depth, all core gates enabled, advisory agents available but not mandatory. This is the default.',
    settings: {
      // Agent behavior
      'agents.challenger.elicitation_depth': 'standard',
      'agents.analyst.persona_count': 'auto',
      'agents.analyst.scope_method': 'mvp',
      'agents.pm.require_nfrs': true,
      'agents.architect.adr_required': true,
      'agents.architect.generate_api_contracts': true,
      'agents.architect.generate_data_model': true,

      // Workflow
      'workflow.qa_log': true,

      // Testing thresholds (balanced)
      'testing.adversarial_required': false,
      'testing.peer_review_required': false,
      'testing.spec_quality.ambiguity_max': 5,
      'testing.spec_quality.passive_voice_max': 10,
      'testing.spec_quality.metric_coverage_min': 80,
      'testing.spec_quality.smell_density_max': 5.0,
      'testing.spec_quality.overall_score_min': 70,
      'testing.story_coverage_required': true,

      // Roadmap
      'roadmap.test_drive_mandate': false,

      // Adaptive planning
      'adaptive_planning.thresholds.quick': 30,
      'adaptive_planning.thresholds.standard': 65,

      // Context7
      'context7.freshness_threshold': 80,
      'context7.require_audit': true,

      // Diagram verification
      'diagram_verification.strict_c4_semantics': true
    }
  },

  rigorous: {
    description: 'Maximum rigor — deep elicitation, mandatory adversarial + security review, strict TDD, comprehensive documentation. Best for enterprise, regulated, or high-risk projects.',
    settings: {
      // Agent behavior
      'agents.challenger.elicitation_depth': 'deep',
      'agents.analyst.persona_count': '3-5',
      'agents.analyst.scope_method': 'phased',
      'agents.pm.require_nfrs': true,
      'agents.architect.adr_required': true,
      'agents.architect.generate_api_contracts': true,
      'agents.architect.generate_data_model': true,

      // Workflow
      'workflow.qa_log': true,

      // Testing thresholds (strict)
      'testing.adversarial_required': true,
      'testing.peer_review_required': true,
      'testing.peer_review_min_score': 80,
      'testing.spec_quality.ambiguity_max': 2,
      'testing.spec_quality.passive_voice_max': 5,
      'testing.spec_quality.metric_coverage_min': 95,
      'testing.spec_quality.smell_density_max': 2.0,
      'testing.spec_quality.overall_score_min': 85,
      'testing.story_coverage_required': true,

      // Roadmap
      'roadmap.test_drive_mandate': true,

      // Adaptive planning
      'adaptive_planning.thresholds.quick': 20,
      'adaptive_planning.thresholds.standard': 50,

      // Context7 (strict freshness)
      'context7.freshness_threshold': 90,
      'context7.require_audit': true,

      // Diagram verification (strict)
      'diagram_verification.strict_c4_semantics': true
    }
  }
};

/**
 * Valid profile names.
 */
export const VALID_PROFILES = Object.keys(PROFILES);

/**
 * Get the expanded settings for a ceremony profile.
 *
 * @param {string} profileName - 'light' | 'standard' | 'rigorous'
 * @returns {object} Profile settings in dot-notation.
 * @throws {Error} If profile name is invalid.
 */
export function expandProfile(profileName) {
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(
      `Unknown ceremony profile: "${profileName}". Valid profiles: ${VALID_PROFILES.join(', ')}`
    );
  }
  return { ...profile.settings };
}

/**
 * Get the description for a ceremony profile.
 *
 * @param {string} profileName - 'light' | 'standard' | 'rigorous'
 * @returns {string} Human-readable description.
 */
export function getProfileDescription(profileName) {
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(
      `Unknown ceremony profile: "${profileName}". Valid profiles: ${VALID_PROFILES.join(', ')}`
    );
  }
  return profile.description;
}

/**
 * Expand a dot-notation settings object into a nested object.
 *
 * @param {object} flat - Flat dot-notation key-value pairs.
 * @returns {object} Nested object.
 *
 * @example
 *   expandDotNotation({ 'agents.pm.require_nfrs': true })
 *   // => { agents: { pm: { require_nfrs: true } } }
 */
export function expandDotNotation(flat) {
  const result = {};
  for (const [dotPath, value] of Object.entries(flat)) {
    const keys = dotPath.split('.');
    let current = result;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current) || typeof current[keys[i]] !== 'object') {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  }
  return result;
}

/**
 * Apply a ceremony profile to a config object.
 *
 * Profile values act as a **base layer** — they fill in defaults but
 * never override values the user has explicitly set. The merge order is:
 *
 *   ceremony profile (lowest) → global config → project config (highest)
 *
 * @param {object} config - The merged config object (project + global).
 * @param {string} profileName - 'light' | 'standard' | 'rigorous'
 * @returns {{ config: object, applied: string[], skipped: string[] }}
 */
export function applyProfile(config, profileName) {
  const flatSettings = expandProfile(profileName);
  const nestedProfile = expandDotNotation(flatSettings);
  const applied = [];
  const skipped = [];

  /**
   * Deep merge where target (existing config) takes precedence.
   * Only fills in keys that don't already exist in the target.
   */
  function fillDefaults(target, source, path = '') {
    for (const key of Object.keys(source)) {
      const fullPath = path ? `${path}.${key}` : key;
      if (!(key in target)) {
        // Key doesn't exist in config — apply profile value
        target[key] = source[key];
        applied.push(fullPath);
      } else if (
        source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
      ) {
        // Both are objects — recurse
        fillDefaults(target[key], source[key], fullPath);
      } else {
        // Key exists in config — user's explicit value wins
        skipped.push(fullPath);
      }
    }
  }

  // Deep-clone config to avoid mutation
  const merged = JSON.parse(JSON.stringify(config));
  fillDefaults(merged, nestedProfile);

  return { config: merged, applied, skipped };
}

/**
 * Compare two profiles and return the differences.
 *
 * @param {string} profileA - First profile name.
 * @param {string} profileB - Second profile name.
 * @returns {object[]} Array of { setting, [profileA], [profileB] } diffs.
 */
export function compareProfiles(profileA, profileB) {
  const settingsA = expandProfile(profileA);
  const settingsB = expandProfile(profileB);
  const allKeys = new Set([...Object.keys(settingsA), ...Object.keys(settingsB)]);
  const diffs = [];

  for (const key of allKeys) {
    const valA = settingsA[key];
    const valB = settingsB[key];
    if (valA !== valB) {
      diffs.push({ setting: key, [profileA]: valA, [profileB]: valB });
    }
  }

  return diffs;
}

/**
 * Get a formatted summary of all profiles and their key differences.
 *
 * @returns {object} Summary with profile descriptions and key diffs.
 */
export function getProfileSummary() {
  return {
    profiles: VALID_PROFILES.map(name => ({
      name,
      description: PROFILES[name].description,
      setting_count: Object.keys(PROFILES[name].settings).length
    })),
    key_differences: compareProfiles('light', 'rigorous')
  };
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

if (process.argv[1] && (
  process.argv[1].endsWith('ceremony.js') ||
  process.argv[1].endsWith('ceremony')
)) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const parsed = input.trim() ? JSON.parse(input) : {};
      const profile = parsed.profile || 'standard';

      if (parsed.compare) {
        // Compare two profiles
        const diffs = compareProfiles(parsed.compare[0] || 'light', parsed.compare[1] || 'rigorous');
        process.stdout.write(JSON.stringify({ ok: true, timestamp: new Date().toISOString(), diffs }, null, 2) + '\n');
      } else if (parsed.summary) {
        // Get all profile summaries
        const summary = getProfileSummary();
        process.stdout.write(JSON.stringify({ ok: true, timestamp: new Date().toISOString(), ...summary }, null, 2) + '\n');
      } else {
        // Expand a single profile
        const settings = expandProfile(profile);
        const description = getProfileDescription(profile);
        process.stdout.write(JSON.stringify({
          ok: true,
          timestamp: new Date().toISOString(),
          profile,
          description,
          setting_count: Object.keys(settings).length,
          settings
        }, null, 2) + '\n');
      }
    } catch (err) {
      process.stderr.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
      process.exit(2);
    }
  });

  if (process.stdin.isTTY) {
    const summary = getProfileSummary();
    process.stdout.write(JSON.stringify({ ok: true, timestamp: new Date().toISOString(), ...summary }, null, 2) + '\n');
  }
}
