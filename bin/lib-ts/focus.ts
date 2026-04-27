/**
 * focus.ts — phase focus mode port (T4.3.2).
 *
 * Pure-library port of `bin/lib/focus.js`. Public surface preserved
 * verbatim by name + signature:
 *
 *   - `VALID_PRESETS` (constant)
 *   - `getPreset(presetName)` => Preset (throws on unknown)
 *   - `listPresets()` => PresetSummary[]
 *   - `validatePhaseRange(start, end)` => {valid, error?}
 *   - `isPhaseInFocus(phase, focusConfig)` => boolean
 *   - `getPhasesInRange(start, end)` => PhaseEntry[]
 *   - `buildFocusConfig(options)` => FocusConfig
 *   - `readFocusFromConfig(configPath)` => FocusConfig | null
 *   - `writeFocusToConfig(configPath, focusConfig)` => {success, error?}
 *   - `clearFocusFromConfig(configPath)` => {success, error?}
 *   - `getFocusStatus(options?)` => FocusStatus
 *
 * @see bin/lib/focus.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.2
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Public types

export interface Preset {
  name?: string;
  description: string;
  start_phase: number;
  end_phase: number;
  role: string;
  phases: string[];
}

export interface PresetSummary {
  name: string;
  description: string;
  start_phase: number;
  end_phase: number;
  role: string;
  phases: string[];
}

export interface PhaseEntry {
  phase: number;
  name: string;
  command: string;
}

export interface FocusConfig {
  enabled: boolean;
  preset: string | null;
  start_phase: number;
  end_phase: number;
  description: string;
  role: string;
  phases: PhaseEntry[];
}

export interface FocusBuildOptions {
  preset?: string;
  start_phase?: number;
  end_phase?: number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface WriteResult {
  success: boolean;
  error?: string;
}

export interface FocusStatus {
  active: boolean;
  message: string;
  preset?: string;
  start_phase?: number;
  end_phase?: number;
  description?: string;
  role?: string;
  phases?: PhaseEntry[];
}

// Catalogs (verbatim from legacy)

const PHASE_NAMES: Record<string, string> = {
  '-1': 'Scout',
  '0': 'Challenger',
  '1': 'Analyst',
  '2': 'PM',
  '3': 'Architect',
  '4': 'Developer',
};

const AGENT_COMMANDS: Record<string, string> = {
  '-1': '/jumpstart.scout',
  '0': '/jumpstart.challenge',
  '1': '/jumpstart.analyze',
  '2': '/jumpstart.plan',
  '3': '/jumpstart.architect',
  '4': '/jumpstart.build',
};

const PRESETS: Record<string, Preset> = {
  full: {
    description:
      'Full workflow — all phases from Challenger through Developer. This is the default.',
    start_phase: 0,
    end_phase: 4,
    role: 'Full Team',
    phases: ['Challenger', 'Analyst', 'PM', 'Architect', 'Developer'],
  },
  'business-analyst': {
    description:
      'Business Analyst focus — challenge assumptions, define personas and user journeys, then write the PRD with user stories and acceptance criteria.',
    start_phase: 0,
    end_phase: 2,
    role: 'Business Analyst',
    phases: ['Challenger', 'Analyst', 'PM'],
  },
  'prd-ready': {
    description:
      'PRD conversion — focus only on the PM phase to convert an existing PRD into a JumpStart-ready format with structured user stories, acceptance criteria, and NFRs.',
    start_phase: 2,
    end_phase: 2,
    role: 'Product Manager',
    phases: ['PM'],
  },
  discovery: {
    description:
      'Discovery focus — challenge assumptions and analyze the problem space without committing to a PRD or architecture.',
    start_phase: 0,
    end_phase: 1,
    role: 'Product / Strategy',
    phases: ['Challenger', 'Analyst'],
  },
  'technical-lead': {
    description:
      'Technical Lead focus — design architecture and plan implementation tasks from an existing PRD. Assumes PRD is already available.',
    start_phase: 3,
    end_phase: 3,
    role: 'Technical Lead / Architect',
    phases: ['Architect'],
  },
  'developer-only': {
    description:
      'Developer focus — build from existing specs. Assumes architecture and implementation plan are already available.',
    start_phase: 4,
    end_phase: 4,
    role: 'Developer',
    phases: ['Developer'],
  },
};

export const VALID_PRESETS: readonly string[] = Object.keys(PRESETS);

const VALID_PHASES: readonly number[] = [-1, 0, 1, 2, 3, 4];

// Implementation

export function getPreset(presetName: string): Preset {
  const preset = PRESETS[presetName];
  if (!preset) {
    throw new Error(
      `Unknown focus preset: "${presetName}". Valid presets: ${VALID_PRESETS.join(', ')}`
    );
  }
  return { name: presetName, ...preset };
}

export function listPresets(): PresetSummary[] {
  return VALID_PRESETS.map((name) => ({
    name,
    description: PRESETS[name].description,
    start_phase: PRESETS[name].start_phase,
    end_phase: PRESETS[name].end_phase,
    role: PRESETS[name].role,
    phases: PRESETS[name].phases,
  }));
}

export function validatePhaseRange(startPhase: number, endPhase: number): ValidationResult {
  if (!VALID_PHASES.includes(startPhase)) {
    return {
      valid: false,
      error: `Invalid start phase: ${startPhase}. Valid phases: ${VALID_PHASES.join(', ')}`,
    };
  }
  if (!VALID_PHASES.includes(endPhase)) {
    return {
      valid: false,
      error: `Invalid end phase: ${endPhase}. Valid phases: ${VALID_PHASES.join(', ')}`,
    };
  }
  if (startPhase > endPhase) {
    return {
      valid: false,
      error: `Start phase (${startPhase}) cannot be after end phase (${endPhase})`,
    };
  }
  return { valid: true };
}

export function isPhaseInFocus(
  phase: number,
  focusConfig: FocusConfig | null | undefined
): boolean {
  if (!focusConfig?.enabled) {
    return true;
  }
  const start = focusConfig.start_phase;
  const end = focusConfig.end_phase;
  if (start === undefined || start === null || end === undefined || end === null) {
    return true;
  }
  return phase >= start && phase <= end;
}

export function getPhasesInRange(startPhase: number, endPhase: number): PhaseEntry[] {
  const phases: PhaseEntry[] = [];
  for (const p of VALID_PHASES) {
    if (p >= startPhase && p <= endPhase) {
      phases.push({
        phase: p,
        name: PHASE_NAMES[String(p)],
        command: AGENT_COMMANDS[String(p)],
      });
    }
  }
  return phases;
}

export function buildFocusConfig(options: FocusBuildOptions): FocusConfig {
  if (options.preset) {
    const preset = getPreset(options.preset);
    return {
      enabled: options.preset !== 'full',
      preset: options.preset,
      start_phase: preset.start_phase,
      end_phase: preset.end_phase,
      description: preset.description,
      role: preset.role,
      phases: getPhasesInRange(preset.start_phase, preset.end_phase),
    };
  }

  const start = options.start_phase as number;
  const end = options.end_phase as number;
  const validation = validatePhaseRange(start, end);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const phases = getPhasesInRange(start, end);
  return {
    enabled: !(start === 0 && end === 4),
    preset: null,
    start_phase: start,
    end_phase: end,
    description: `Custom focus: Phase ${start} (${PHASE_NAMES[String(start)]}) through Phase ${end} (${PHASE_NAMES[String(end)]})`,
    role: 'Custom',
    phases,
  };
}

export function readFocusFromConfig(configPath: string): FocusConfig | null {
  if (!existsSync(configPath)) return null;
  try {
    const content = readFileSync(configPath, 'utf8');
    const lines = content.split('\n');

    let inFocus = false;
    const focusLines: string[] = [];
    for (const line of lines) {
      if (/^focus:\s*$/.test(line)) {
        inFocus = true;
        continue;
      }
      if (inFocus) {
        if (/^\S/.test(line) && line.trim() !== '') {
          break;
        }
        focusLines.push(line);
      }
    }

    if (focusLines.length === 0) return null;

    const section = focusLines.join('\n');
    const enabled = /^\s+enabled:\s*true/m.test(section);
    if (!enabled) return null;

    const presetMatch = section.match(/^\s+preset:\s*(\S+)/m);
    const startMatch = section.match(/^\s+start_phase:\s*(-?\d+)/m);
    const endMatch = section.match(/^\s+end_phase:\s*(-?\d+)/m);

    const preset = presetMatch ? presetMatch[1] : null;
    const startPhase = startMatch ? Number.parseInt(startMatch[1], 10) : null;
    const endPhase = endMatch ? Number.parseInt(endMatch[1], 10) : null;

    if (preset && preset !== 'null') {
      try {
        return buildFocusConfig({ preset });
      } catch {
        return null;
      }
    }

    if (startPhase !== null && endPhase !== null) {
      try {
        return buildFocusConfig({ start_phase: startPhase, end_phase: endPhase });
      } catch {
        return null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function writeFocusToConfig(
  configPath: string,
  focusConfig: { enabled: boolean; preset: string | null; start_phase: number; end_phase: number }
): WriteResult {
  if (!existsSync(configPath)) {
    return { success: false, error: 'Config file not found. Run jumpstart-mode init first.' };
  }

  let content = readFileSync(configPath, 'utf8');

  const focusYaml = [
    'focus:',
    `  enabled: ${focusConfig.enabled}`,
    `  preset: ${focusConfig.preset || 'null'}`,
    `  start_phase: ${focusConfig.start_phase}`,
    `  end_phase: ${focusConfig.end_phase}`,
  ].join('\n');

  const focusPattern = /^focus:\s*\n(?:(?:[ \t]+\S.*|[ \t]*)?\n?)*/m;
  if (focusPattern.test(content)) {
    content = content.replace(focusPattern, `${focusYaml}\n\n`);
  } else {
    const workflowIndex = content.indexOf('\nworkflow:');
    if (workflowIndex !== -1) {
      const insertComment =
        '\n# ---------------------------------------------------------------------------\n# Focus Mode — Restrict workflow to specific phases\n# ---------------------------------------------------------------------------\n';
      content =
        content.slice(0, workflowIndex) +
        insertComment +
        focusYaml +
        '\n' +
        content.slice(workflowIndex);
    } else {
      content += `\n${focusYaml}\n`;
    }
  }

  writeFileSync(configPath, content, 'utf8');
  return { success: true };
}

export function clearFocusFromConfig(configPath: string): WriteResult {
  return writeFocusToConfig(configPath, {
    enabled: false,
    preset: 'full',
    start_phase: 0,
    end_phase: 4,
  });
}

export function getFocusStatus(options: { root?: string } = {}): FocusStatus {
  const root = options.root || '.';
  const configPath = join(root, '.jumpstart', 'config.yaml');

  if (!existsSync(configPath)) {
    return { active: false, message: 'Project not initialized.' };
  }

  const focusConfig = readFocusFromConfig(configPath);
  if (!focusConfig?.enabled) {
    return {
      active: false,
      message: 'No focus restriction — full workflow is active.',
      preset: 'full',
      phases: getPhasesInRange(0, 4),
    };
  }

  return {
    active: true,
    preset: focusConfig.preset || 'custom',
    start_phase: focusConfig.start_phase,
    end_phase: focusConfig.end_phase,
    description: focusConfig.description,
    role: focusConfig.role,
    phases: focusConfig.phases,
    message: `Focus mode active: ${focusConfig.description}`,
  };
}
