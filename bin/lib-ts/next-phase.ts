/**
 * next-phase.ts — auto-pilot phase progression port (T4.3.2).
 *
 * Pure-library port of `bin/lib/next-phase.js`. Public surface preserved:
 *
 *   - `determineNextAction(options?)` => NextAction
 *
 * **Inlined helpers**: legacy depends on `handoff.js` for
 * `isArtifactApproved` + `getHandoff` (not in M4 cluster) and
 * `config-loader.js` for `parseSimpleYaml` (intentionally dropped per
 * T4.1.9 in favor of the yaml package). Both are inlined here so the
 * port is self-contained until those modules port.
 *
 * @see bin/lib/next-phase.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.2
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { isPhaseInFocus, readFocusFromConfig } from './focus.js';
import { loadState } from './state-store.js';

// Public types

export interface NextActionOptions {
  root?: string;
  state_path?: string;
  config_path?: string;
}

export interface FocusOutput {
  active: boolean;
  start_phase: number;
  end_phase: number;
}

export interface NextAction {
  action: 'init' | 'start' | 'continue' | 'approve' | 'proceed' | 'complete' | 'unknown';
  current_phase: number | string | null;
  next_phase: number | string | null;
  next_agent: string | null;
  command: string;
  artifact?: string;
  message: string;
  context_files: string[];
  suggestions?: string[];
  focus?: FocusOutput;
}

// Catalogs (verbatim from legacy)

const AGENT_COMMANDS: Record<string, string> = {
  scout: '/jumpstart.scout',
  challenger: '/jumpstart.challenge',
  analyst: '/jumpstart.analyze',
  pm: '/jumpstart.plan',
  architect: '/jumpstart.architect',
  developer: '/jumpstart.build',
};

const PHASE_DESCRIPTIONS: Record<string, string> = {
  '-1': 'The Scout analyzes the existing codebase, creating C4 diagrams and mapping dependencies.',
  '0': 'The Challenger interrogates the problem, finds root causes, and reframes assumptions.',
  '1': 'The Analyst defines personas, user journeys, and MVP scope.',
  '2': 'The PM writes user stories, acceptance criteria, and non-functional requirements.',
  '3': 'The Architect selects the tech stack, models data, designs APIs, and plans implementation tasks.',
  '4': 'The Developer writes code and tests according to the implementation plan.',
};

const PHASE_NAMES: Record<string, string> = {
  '-1': 'Scout',
  '0': 'Challenger',
  '1': 'Analyst',
  '2': 'PM',
  '3': 'Architect',
  '4': 'Developer',
};

const PHASE_ARTIFACTS: Record<string, string | null> = {
  '-1': 'specs/codebase-context.md',
  '0': 'specs/challenger-brief.md',
  '1': 'specs/product-brief.md',
  '2': 'specs/prd.md',
  '3': 'specs/architecture.md',
  '4': null,
};

const PHASE_MAP: Record<
  string,
  { name: string; next_phase: number | null; next_agent: string | null; next_context: string[] }
> = {
  '-1': {
    name: 'Scout',
    next_phase: 0,
    next_agent: 'challenger',
    next_context: ['.jumpstart/config.yaml', '.jumpstart/roadmap.md', 'specs/codebase-context.md'],
  },
  '0': {
    name: 'Challenger',
    next_phase: 1,
    next_agent: 'analyst',
    next_context: ['.jumpstart/config.yaml', '.jumpstart/roadmap.md', 'specs/challenger-brief.md'],
  },
  '1': {
    name: 'Analyst',
    next_phase: 2,
    next_agent: 'pm',
    next_context: [
      '.jumpstart/config.yaml',
      '.jumpstart/roadmap.md',
      'specs/challenger-brief.md',
      'specs/product-brief.md',
    ],
  },
  '2': {
    name: 'PM',
    next_phase: 3,
    next_agent: 'architect',
    next_context: [
      '.jumpstart/config.yaml',
      '.jumpstart/roadmap.md',
      'specs/challenger-brief.md',
      'specs/product-brief.md',
      'specs/prd.md',
    ],
  },
  '3': {
    name: 'Architect',
    next_phase: 4,
    next_agent: 'developer',
    next_context: [
      '.jumpstart/config.yaml',
      '.jumpstart/roadmap.md',
      'specs/prd.md',
      'specs/architecture.md',
      'specs/implementation-plan.md',
    ],
  },
  '4': { name: 'Developer', next_phase: null, next_agent: null, next_context: [] },
};

// Helpers (inlined from handoff.js — will be replaced with imports
// when handoff.ts ports later)

function isArtifactApproved(content: string): boolean {
  if (!content) return false;
  if (!/## Phase Gate Approval/i.test(content)) return false;

  const approvedByMatch = content.match(/\*\*Approved by:\*\*\s*(.+)/i);
  if (!approvedByMatch || approvedByMatch[1].trim().toLowerCase() === 'pending') return false;

  const gateSection = content.split(/## Phase Gate Approval/i)[1] || '';
  const unchecked = gateSection.match(/- \[ \]/g);
  return !unchecked || unchecked.length === 0;
}

interface HandoffResult {
  ready: boolean;
  current_phase?: number | string;
  current_name?: string;
  next_phase?: number | null;
  next_agent?: string | null;
  context_files?: string[];
  message?: string;
  error?: string;
}

function getHandoff(currentPhase: number | string): HandoffResult {
  const key = String(currentPhase);
  const transition = PHASE_MAP[key];

  if (!transition) {
    return { error: `Unknown phase: ${currentPhase}`, ready: false };
  }

  if (transition.next_phase === null) {
    return {
      current_phase: currentPhase,
      next_phase: null,
      next_agent: null,
      message: 'Phase 4 is the final phase. No further handoff needed.',
      ready: false,
    };
  }

  return {
    current_phase: currentPhase,
    current_name: transition.name,
    next_phase: transition.next_phase,
    next_agent: transition.next_agent,
    context_files: transition.next_context,
    ready: true,
  };
}

// Implementation

/**
 * Determine the next action the user should take. Inspects state.json,
 * config.yaml (project type, focus mode), and on-disk artifact
 * approval status to recommend a single next action.
 */
export function determineNextAction(options: NextActionOptions = {}): NextAction {
  const root = resolve(options.root || '.');
  const statePath = options.state_path || join(root, '.jumpstart', 'state', 'state.json');
  const configPath = options.config_path || join(root, '.jumpstart', 'config.yaml');

  if (!existsSync(configPath)) {
    return {
      action: 'init',
      current_phase: null,
      next_phase: null,
      next_agent: null,
      command: 'npx jumpstart-mode',
      message:
        'Project not initialized. Run `npx jumpstart-mode` to set up the JumpStart framework.',
      context_files: [],
    };
  }

  // Lightweight YAML parse — the TS port replaces parseSimpleYaml with
  // the unified yaml package; for next-phase we only need top-level
  // project.* and workflow.* fields, so any RFC-correct YAML parser
  // works.
  let config: { project?: { type?: string }; workflow?: { require_gate_approval?: boolean } } = {};
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = yamlParse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      config = parsed as typeof config;
    }
  } catch {
    // Config exists but is unreadable — treat as default
  }
  const projectType = config?.project?.type || 'greenfield';
  const requireApproval = config?.workflow?.require_gate_approval !== false;

  const focusConfig = readFocusFromConfig(configPath);

  const state = loadState(statePath);
  const currentPhase = state.current_phase;

  // ─── Case 1: Fresh project — no phase started ──────────────────────
  if (currentPhase === null || currentPhase === undefined) {
    const scoutArtifact = join(root, 'specs', 'codebase-context.md');
    const challengerArtifact = join(root, 'specs', 'challenger-brief.md');

    if (existsSync(challengerArtifact)) {
      const content = readFileSync(challengerArtifact, 'utf8');
      if (isArtifactApproved(content)) {
        return {
          action: 'proceed',
          current_phase: 0,
          next_phase: 1,
          next_agent: 'analyst',
          command: AGENT_COMMANDS.analyst,
          message: `Phase 0 (Challenger) is already approved. Next: Phase 1 — ${PHASE_DESCRIPTIONS['1']}`,
          context_files: getHandoff(0).context_files || [],
          focus: focusConfig?.enabled
            ? {
                active: true,
                start_phase: focusConfig.start_phase,
                end_phase: focusConfig.end_phase,
              }
            : undefined,
        };
      }
      return {
        action: 'approve',
        current_phase: 0,
        next_phase: 1,
        next_agent: 'challenger',
        command: '/jumpstart.review',
        artifact: 'specs/challenger-brief.md',
        message:
          'Phase 0 (Challenger) artifact exists but is not yet approved. Review and approve it to proceed.',
        context_files: [],
        focus: focusConfig?.enabled
          ? {
              active: true,
              start_phase: focusConfig.start_phase,
              end_phase: focusConfig.end_phase,
            }
          : undefined,
      };
    }

    if (focusConfig?.enabled) {
      const focusStart = focusConfig.start_phase;
      const agentNames: Record<string, string> = {
        '-1': 'scout',
        '0': 'challenger',
        '1': 'analyst',
        '2': 'pm',
        '3': 'architect',
        '4': 'developer',
      };
      const agent = agentNames[String(focusStart)];
      const command = AGENT_COMMANDS[agent];
      return {
        action: 'start',
        current_phase: null,
        next_phase: focusStart,
        next_agent: agent,
        command,
        message: `Focus mode active (${focusConfig.preset || 'custom'}). Start with Phase ${focusStart} — ${PHASE_DESCRIPTIONS[String(focusStart)]}`,
        context_files: [],
        focus: {
          active: true,
          start_phase: focusConfig.start_phase,
          end_phase: focusConfig.end_phase,
        },
      };
    }

    if (projectType === 'brownfield' && !existsSync(scoutArtifact)) {
      return {
        action: 'start',
        current_phase: null,
        next_phase: -1,
        next_agent: 'scout',
        command: AGENT_COMMANDS.scout,
        message: `Brownfield project detected. Start with the Scout to analyze the existing codebase. ${PHASE_DESCRIPTIONS['-1']}`,
        context_files: [],
      };
    }

    if (projectType === 'brownfield' && existsSync(scoutArtifact)) {
      const content = readFileSync(scoutArtifact, 'utf8');
      if (!isArtifactApproved(content)) {
        return {
          action: 'approve',
          current_phase: -1,
          next_phase: 0,
          next_agent: 'scout',
          command: '/jumpstart.review',
          artifact: 'specs/codebase-context.md',
          message:
            'Scout artifact exists but is not yet approved. Review and approve it to proceed to Phase 0.',
          context_files: [],
        };
      }
      return {
        action: 'proceed',
        current_phase: -1,
        next_phase: 0,
        next_agent: 'challenger',
        command: AGENT_COMMANDS.challenger,
        message: `Scout phase is approved. Next: Phase 0 — ${PHASE_DESCRIPTIONS['0']}`,
        context_files: getHandoff(-1).context_files || [],
      };
    }

    return {
      action: 'start',
      current_phase: null,
      next_phase: 0,
      next_agent: 'challenger',
      command: AGENT_COMMANDS.challenger,
      message: `Ready to begin! Start with Phase 0 — ${PHASE_DESCRIPTIONS['0']}`,
      context_files: [],
    };
  }

  // ─── Case 2: Final phase or focus end reached ──────────────────────
  if (
    currentPhase === 4 ||
    (focusConfig?.enabled && Number(currentPhase) > focusConfig.end_phase)
  ) {
    const focusNote = focusConfig?.enabled
      ? ` Focus mode (${focusConfig.preset || 'custom'}) workflow complete.`
      : '';
    return {
      action: 'complete',
      current_phase: currentPhase,
      next_phase: null,
      next_agent: null,
      command: '/jumpstart.status',
      message:
        currentPhase === 4
          ? 'Phase 4 (Developer) is the final phase. All specification phases are complete. Run `/jumpstart.status` for a full project overview, or `/jumpstart.deploy` for deployment planning.'
          : `Phase ${currentPhase} (${PHASE_NAMES[String(currentPhase)]}) reached the end of focus range.${focusNote} Run \`/jumpstart.status\` for a project overview.`,
      suggestions: ['/jumpstart.status', '/jumpstart.deploy', '/jumpstart.resume'],
      context_files: [],
      focus: focusConfig?.enabled
        ? {
            active: true,
            start_phase: focusConfig.start_phase,
            end_phase: focusConfig.end_phase,
          }
        : undefined,
    };
  }

  // ─── Case 3: Mid-workflow — check current artifact approval ────────
  const artifactRelPath = PHASE_ARTIFACTS[String(currentPhase)];

  if (artifactRelPath) {
    const artifactPath = join(root, artifactRelPath);

    if (!existsSync(artifactPath)) {
      const agentName = PHASE_NAMES[String(currentPhase)].toLowerCase();
      const command = AGENT_COMMANDS[agentName] || AGENT_COMMANDS[state.current_agent || ''];
      return {
        action: 'continue',
        current_phase: currentPhase,
        next_phase: currentPhase,
        next_agent: state.current_agent || agentName,
        command,
        artifact: artifactRelPath,
        message: `Phase ${currentPhase} (${PHASE_NAMES[String(currentPhase)]}) is in progress but the artifact hasn't been created yet. Continue with \`${command}\`.`,
        context_files: [],
      };
    }

    const content = readFileSync(artifactPath, 'utf8');

    if (!isArtifactApproved(content)) {
      if (requireApproval) {
        const phaseNum = Number(currentPhase);
        return {
          action: 'approve',
          current_phase: currentPhase,
          next_phase: phaseNum + 1,
          next_agent: state.current_agent,
          command: '/jumpstart.review',
          artifact: artifactRelPath,
          message: `Phase ${currentPhase} (${PHASE_NAMES[String(currentPhase)]}) artifact exists but needs approval. Review \`${artifactRelPath}\` and approve it to proceed to Phase ${phaseNum + 1}.`,
          context_files: [],
        };
      }
    }

    const handoff = getHandoff(currentPhase);

    if (!handoff?.ready) {
      return {
        action: 'complete',
        current_phase: currentPhase,
        next_phase: null,
        next_agent: null,
        command: '/jumpstart.status',
        message: 'Current phase is complete. No further phases available.',
        context_files: [],
      };
    }

    const nextAgent = handoff.next_agent ?? null;
    const nextPhase = handoff.next_phase ?? null;
    const command = nextAgent ? AGENT_COMMANDS[nextAgent] : '/jumpstart.status';

    if (focusConfig?.enabled && nextPhase !== null && !isPhaseInFocus(nextPhase, focusConfig)) {
      return {
        action: 'complete',
        current_phase: currentPhase,
        next_phase: null,
        next_agent: null,
        command: '/jumpstart.status',
        message: `Phase ${currentPhase} (${PHASE_NAMES[String(currentPhase)]}) is approved! Focus mode (${focusConfig.preset || 'custom'}) workflow complete — Phase ${nextPhase} is outside the focus range. Run \`/jumpstart.status\` for a project overview.`,
        context_files: [],
        focus: {
          active: true,
          start_phase: focusConfig.start_phase,
          end_phase: focusConfig.end_phase,
        },
      };
    }

    return {
      action: 'proceed',
      current_phase: currentPhase,
      next_phase: nextPhase,
      next_agent: nextAgent,
      command,
      message: `Phase ${currentPhase} (${PHASE_NAMES[String(currentPhase)]}) is approved! Next: Phase ${nextPhase} — ${PHASE_DESCRIPTIONS[String(nextPhase)]}`,
      context_files: handoff.context_files || [],
      focus: focusConfig?.enabled
        ? {
            active: true,
            start_phase: focusConfig.start_phase,
            end_phase: focusConfig.end_phase,
          }
        : undefined,
    };
  }

  return {
    action: 'unknown',
    current_phase: currentPhase,
    next_phase: null,
    next_agent: null,
    command: '/jumpstart.status',
    message: `Unable to determine next action for phase ${currentPhase}. Run \`/jumpstart.status\` to review the project state.`,
    context_files: [],
  };
}
