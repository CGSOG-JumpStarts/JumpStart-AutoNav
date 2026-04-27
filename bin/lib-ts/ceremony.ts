/**
 * ceremony.ts — tiered ceremony profiles port (T4.3.2).
 *
 * Pure-library port of `bin/lib/ceremony.js`. Public surface preserved
 * verbatim by name + signature:
 *
 *   - `VALID_PROFILES` (constant array)
 *   - `expandProfile(profileName)` => Record<string, unknown>
 *   - `getProfileDescription(profileName)` => string
 *   - `expandDotNotation(flat)` => Record<string, unknown>
 *   - `applyProfile(config, profileName)` =>
 *     { config, applied, skipped }
 *   - `compareProfiles(profileA, profileB)` => DiffEntry[]
 *   - `getProfileSummary()` => ProfileSummary
 *
 * Three profile levels (verbatim from legacy):
 *   - light:     minimal ceremony, fewer gates, auto-skip optional
 *   - standard:  balanced (current defaults — applying it changes nothing)
 *   - rigorous:  maximum rigor for enterprise/regulated workflows
 *
 * Profile values act as a BASE LAYER — explicit user config wins on
 * collision. Merge order (lowest → highest): profile → global → project.
 *
 * **M2 stub deferral closeout**: in M2, `config-loader.ts`'s
 * `maybeApplyCeremonyProfile` was stubbed because of a CJS dynamic-
 * import path issue. Now that ceremony.ts is ported, callers can
 * import `applyProfile` directly. Wiring config-loader to call this
 * port is queued for the M9 ESM cutover.
 *
 * @see bin/lib/ceremony.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.2
 */

// Public types

export interface ProfileEntry {
  description: string;
  settings: Record<string, unknown>;
}

export interface ApplyProfileResult {
  config: Record<string, unknown>;
  applied: string[];
  skipped: string[];
}

export interface ProfileDiff {
  setting: string;
  [profile: string]: unknown;
}

export interface ProfileSummaryEntry {
  name: string;
  description: string;
  setting_count: number;
}

export interface ProfileSummary {
  profiles: ProfileSummaryEntry[];
  key_differences: ProfileDiff[];
}

// Profile definitions (verbatim from legacy)

const PROFILES: Record<string, ProfileEntry> = {
  light: {
    description:
      'Minimal ceremony — quick elicitation, fewer gates, auto-skip optional steps. Best for prototypes, small features, and rapid iteration.',
    settings: {
      'agents.challenger.elicitation_depth': 'quick',
      'agents.analyst.persona_count': '1-2',
      'agents.analyst.scope_method': 'mvp',
      'agents.pm.require_nfrs': false,
      'agents.architect.adr_required': false,
      'agents.architect.generate_api_contracts': false,
      'agents.architect.generate_data_model': false,
      'workflow.qa_log': false,
      'testing.adversarial_required': false,
      'testing.peer_review_required': false,
      'testing.spec_quality.ambiguity_max': 10,
      'testing.spec_quality.passive_voice_max': 20,
      'testing.spec_quality.metric_coverage_min': 60,
      'testing.spec_quality.smell_density_max': 8.0,
      'testing.spec_quality.overall_score_min': 50,
      'testing.story_coverage_required': false,
      'roadmap.test_drive_mandate': false,
      'adaptive_planning.thresholds.quick': 50,
      'adaptive_planning.thresholds.standard': 80,
      'context7.freshness_threshold': 60,
      'context7.require_audit': false,
      'diagram_verification.strict_c4_semantics': false,
    },
  },
  standard: {
    description:
      'Balanced workflow — standard elicitation depth, all core gates enabled, advisory agents available but not mandatory. This is the default.',
    settings: {
      'agents.challenger.elicitation_depth': 'standard',
      'agents.analyst.persona_count': 'auto',
      'agents.analyst.scope_method': 'mvp',
      'agents.pm.require_nfrs': true,
      'agents.architect.adr_required': true,
      'agents.architect.generate_api_contracts': true,
      'agents.architect.generate_data_model': true,
      'workflow.qa_log': true,
      'testing.adversarial_required': false,
      'testing.peer_review_required': false,
      'testing.spec_quality.ambiguity_max': 5,
      'testing.spec_quality.passive_voice_max': 10,
      'testing.spec_quality.metric_coverage_min': 80,
      'testing.spec_quality.smell_density_max': 5.0,
      'testing.spec_quality.overall_score_min': 70,
      'testing.story_coverage_required': true,
      'roadmap.test_drive_mandate': false,
      'adaptive_planning.thresholds.quick': 30,
      'adaptive_planning.thresholds.standard': 65,
      'context7.freshness_threshold': 80,
      'context7.require_audit': true,
      'diagram_verification.strict_c4_semantics': true,
    },
  },
  rigorous: {
    description:
      'Maximum rigor — deep elicitation, mandatory adversarial + security review, strict TDD, comprehensive documentation. Best for enterprise, regulated, or high-risk projects.',
    settings: {
      'agents.challenger.elicitation_depth': 'deep',
      'agents.analyst.persona_count': '3-5',
      'agents.analyst.scope_method': 'phased',
      'agents.pm.require_nfrs': true,
      'agents.architect.adr_required': true,
      'agents.architect.generate_api_contracts': true,
      'agents.architect.generate_data_model': true,
      'workflow.qa_log': true,
      'testing.adversarial_required': true,
      'testing.peer_review_required': true,
      'testing.peer_review_min_score': 80,
      'testing.spec_quality.ambiguity_max': 2,
      'testing.spec_quality.passive_voice_max': 5,
      'testing.spec_quality.metric_coverage_min': 95,
      'testing.spec_quality.smell_density_max': 2.0,
      'testing.spec_quality.overall_score_min': 85,
      'testing.story_coverage_required': true,
      'roadmap.test_drive_mandate': true,
      'adaptive_planning.thresholds.quick': 20,
      'adaptive_planning.thresholds.standard': 50,
      'context7.freshness_threshold': 90,
      'context7.require_audit': true,
      'diagram_verification.strict_c4_semantics': true,
    },
  },
};

export const VALID_PROFILES: readonly string[] = Object.keys(PROFILES);

// Implementation

/** Get the dot-notation settings for a ceremony profile. Throws on
 *  unknown profile. */
export function expandProfile(profileName: string): Record<string, unknown> {
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(
      `Unknown ceremony profile: "${profileName}". Valid profiles: ${VALID_PROFILES.join(', ')}`
    );
  }
  return { ...profile.settings };
}

/** Get the human-readable description of a profile. Throws on unknown. */
export function getProfileDescription(profileName: string): string {
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(
      `Unknown ceremony profile: "${profileName}". Valid profiles: ${VALID_PROFILES.join(', ')}`
    );
  }
  return profile.description;
}

/** Expand dot-notation keys to a nested object. */
export function expandDotNotation(flat: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [dotPath, value] of Object.entries(flat)) {
    const keys = dotPath.split('.');
    let current = result;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in current) || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k] as Record<string, unknown>;
    }
    current[keys[keys.length - 1]] = value;
  }
  return result;
}

/**
 * Apply a ceremony profile to a config object as a fill-defaults base
 * layer. User explicit values are NEVER overridden; only missing keys
 * are filled in.
 */
export function applyProfile(
  config: Record<string, unknown>,
  profileName: string
): ApplyProfileResult {
  const flatSettings = expandProfile(profileName);
  const nestedProfile = expandDotNotation(flatSettings);
  const applied: string[] = [];
  const skipped: string[] = [];

  function fillDefaults(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    path = ''
  ): void {
    for (const key of Object.keys(source)) {
      const fullPath = path ? `${path}.${key}` : key;
      if (!(key in target)) {
        target[key] = source[key];
        applied.push(fullPath);
      } else if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        fillDefaults(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>,
          fullPath
        );
      } else {
        skipped.push(fullPath);
      }
    }
  }

  // Deep-clone to avoid mutating the caller's config
  const merged = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  fillDefaults(merged, nestedProfile);

  return { config: merged, applied, skipped };
}

/** Diff two profiles by dot-notation keys. */
export function compareProfiles(profileA: string, profileB: string): ProfileDiff[] {
  const settingsA = expandProfile(profileA);
  const settingsB = expandProfile(profileB);
  const allKeys = new Set([...Object.keys(settingsA), ...Object.keys(settingsB)]);
  const diffs: ProfileDiff[] = [];

  for (const key of allKeys) {
    const valA = settingsA[key];
    const valB = settingsB[key];
    if (valA !== valB) {
      diffs.push({ setting: key, [profileA]: valA, [profileB]: valB });
    }
  }

  return diffs;
}

/** Summary of all profiles and their light↔rigorous diffs. */
export function getProfileSummary(): ProfileSummary {
  return {
    profiles: VALID_PROFILES.map((name) => ({
      name,
      description: PROFILES[name].description,
      setting_count: Object.keys(PROFILES[name].settings).length,
    })),
    key_differences: compareProfiles('light', 'rigorous'),
  };
}
