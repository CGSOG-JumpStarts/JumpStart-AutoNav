/**
 * next-phase.js — Auto-Pilot Phase Progression (UX Feature 1)
 *
 * Reads workflow state, checks artifact approval status, and determines
 * the next recommended action for the user. Eliminates manual slash
 * command memorization by providing intelligent "what's next" guidance.
 *
 * Usage:
 *   echo '{}' | node bin/lib/next-phase.js
 *   echo '{"root":".","state_path":".jumpstart/state/state.json"}' | node bin/lib/next-phase.js
 *
 * Output (stdout JSON):
 *   {
 *     "ok": true,
 *     "action": "proceed|approve|start|complete",
 *     "current_phase": 0,
 *     "next_phase": 1,
 *     "next_agent": "analyst",
 *     "command": "/jumpstart.analyze",
 *     "message": "Phase 0 (Challenger) is approved. Next: Phase 1 — the Analyst defines personas and MVP scope.",
 *     "context_files": [...]
 *   }
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { readFileSync, existsSync } = require('fs');
const { join, resolve } = require('path');

// Import siblings
import { loadState } from './state-store.js';
import { getHandoff, isArtifactApproved } from './handoff.js';
import { parseSimpleYaml } from './config-loader.js';

/**
 * Phase-to-slash-command map.
 * Maps agent names to their activation commands.
 */
const AGENT_COMMANDS = {
  scout: '/jumpstart.scout',
  challenger: '/jumpstart.challenge',
  analyst: '/jumpstart.analyze',
  pm: '/jumpstart.plan',
  architect: '/jumpstart.architect',
  developer: '/jumpstart.build'
};

/**
 * Phase descriptions for user guidance.
 */
const PHASE_DESCRIPTIONS = {
  '-1': 'The Scout analyzes the existing codebase, creating C4 diagrams and mapping dependencies.',
  '0': 'The Challenger interrogates the problem, finds root causes, and reframes assumptions.',
  '1': 'The Analyst defines personas, user journeys, and MVP scope.',
  '2': 'The PM writes user stories, acceptance criteria, and non-functional requirements.',
  '3': 'The Architect selects the tech stack, models data, designs APIs, and plans implementation tasks.',
  '4': 'The Developer writes code and tests according to the implementation plan.'
};

/**
 * Phase names for display.
 */
const PHASE_NAMES = {
  '-1': 'Scout',
  '0': 'Challenger',
  '1': 'Analyst',
  '2': 'PM',
  '3': 'Architect',
  '4': 'Developer'
};

/**
 * Artifact paths for each phase (what the phase produces).
 */
const PHASE_ARTIFACTS = {
  '-1': 'specs/codebase-context.md',
  '0': 'specs/challenger-brief.md',
  '1': 'specs/product-brief.md',
  '2': 'specs/prd.md',
  '3': 'specs/architecture.md',
  '4': null
};

/**
 * Determine the next action the user should take.
 *
 * @param {object} [options] - Configuration options.
 * @param {string} [options.root] - Project root directory.
 * @param {string} [options.state_path] - Path to state.json.
 * @param {string} [options.config_path] - Path to config.yaml.
 * @returns {object} Next action recommendation.
 */
export function determineNextAction(options = {}) {
  const root = resolve(options.root || '.');
  const statePath = options.state_path || join(root, '.jumpstart', 'state', 'state.json');
  const configPath = options.config_path || join(root, '.jumpstart', 'config.yaml');

  // Check if project is initialized
  if (!existsSync(configPath)) {
    return {
      action: 'init',
      current_phase: null,
      next_phase: null,
      next_agent: null,
      command: 'npx jumpstart-mode',
      message: 'Project not initialized. Run `npx jumpstart-mode` to set up the JumpStart framework.',
      context_files: []
    };
  }

  // Load config to check project type and workflow settings
  // Use sync YAML parse directly — next-phase only needs basic config fields,
  // not the full async loadConfig with ceremony profile expansion.
  let config = {};
  try {
    const raw = readFileSync(configPath, 'utf8');
    config = parseSimpleYaml(raw);
  } catch {
    // Config exists but is unreadable — treat as default
  }
  const projectType = config?.project?.type || 'greenfield';
  const requireApproval = config?.workflow?.require_gate_approval !== false;

  // Load current state
  const state = loadState(statePath);
  const currentPhase = state.current_phase;

  // ─── Case 1: Fresh project — no phase started ──────────────────────────────
  if (currentPhase === null || currentPhase === undefined) {
    // Check if any artifacts already exist (user may have run a phase without state tracking)
    const scoutArtifact = join(root, 'specs', 'codebase-context.md');
    const challengerArtifact = join(root, 'specs', 'challenger-brief.md');

    if (existsSync(challengerArtifact)) {
      // Challenger brief exists — check if approved
      const content = readFileSync(challengerArtifact, 'utf8');
      if (isArtifactApproved(content)) {
        return {
          action: 'proceed',
          current_phase: 0,
          next_phase: 1,
          next_agent: 'analyst',
          command: AGENT_COMMANDS.analyst,
          message: 'Phase 0 (Challenger) is already approved. Next: Phase 1 — ' + PHASE_DESCRIPTIONS['1'],
          context_files: getHandoff(0).context_files || []
        };
      }
      return {
        action: 'approve',
        current_phase: 0,
        next_phase: 1,
        next_agent: 'challenger',
        command: '/jumpstart.review',
        artifact: 'specs/challenger-brief.md',
        message: 'Phase 0 (Challenger) artifact exists but is not yet approved. Review and approve it to proceed.',
        context_files: []
      };
    }

    if (projectType === 'brownfield' && !existsSync(scoutArtifact)) {
      return {
        action: 'start',
        current_phase: null,
        next_phase: -1,
        next_agent: 'scout',
        command: AGENT_COMMANDS.scout,
        message: 'Brownfield project detected. Start with the Scout to analyze the existing codebase. ' + PHASE_DESCRIPTIONS['-1'],
        context_files: []
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
          message: 'Scout artifact exists but is not yet approved. Review and approve it to proceed to Phase 0.',
          context_files: []
        };
      }
      return {
        action: 'proceed',
        current_phase: -1,
        next_phase: 0,
        next_agent: 'challenger',
        command: AGENT_COMMANDS.challenger,
        message: 'Scout phase is approved. Next: Phase 0 — ' + PHASE_DESCRIPTIONS['0'],
        context_files: getHandoff(-1).context_files || []
      };
    }

    // Greenfield, no artifacts yet
    return {
      action: 'start',
      current_phase: null,
      next_phase: 0,
      next_agent: 'challenger',
      command: AGENT_COMMANDS.challenger,
      message: 'Ready to begin! Start with Phase 0 — ' + PHASE_DESCRIPTIONS['0'],
      context_files: []
    };
  }

  // ─── Case 2: Final phase (4) — check completion ───────────────────────────
  if (currentPhase === 4) {
    return {
      action: 'complete',
      current_phase: 4,
      next_phase: null,
      next_agent: null,
      command: '/jumpstart.status',
      message: 'Phase 4 (Developer) is the final phase. All specification phases are complete. Run `/jumpstart.status` for a full project overview, or `/jumpstart.deploy` for deployment planning.',
      suggestions: ['/jumpstart.status', '/jumpstart.deploy', '/jumpstart.resume'],
      context_files: []
    };
  }

  // ─── Case 3: Mid-workflow — check current artifact approval ────────────────
  const artifactRelPath = PHASE_ARTIFACTS[String(currentPhase)];

  if (artifactRelPath) {
    const artifactPath = join(root, artifactRelPath);

    if (!existsSync(artifactPath)) {
      // Artifact doesn't exist yet — agent hasn't finished
      const agentName = PHASE_NAMES[String(currentPhase)].toLowerCase();
      const command = AGENT_COMMANDS[agentName] || AGENT_COMMANDS[state.current_agent];
      return {
        action: 'continue',
        current_phase: currentPhase,
        next_phase: currentPhase,
        next_agent: state.current_agent || agentName,
        command: command,
        artifact: artifactRelPath,
        message: `Phase ${currentPhase} (${PHASE_NAMES[String(currentPhase)]}) is in progress but the artifact hasn't been created yet. Continue with \`${command}\`.`,
        context_files: []
      };
    }

    const content = readFileSync(artifactPath, 'utf8');

    if (!isArtifactApproved(content)) {
      if (requireApproval) {
        return {
          action: 'approve',
          current_phase: currentPhase,
          next_phase: currentPhase + 1,
          next_agent: state.current_agent,
          command: '/jumpstart.review',
          artifact: artifactRelPath,
          message: `Phase ${currentPhase} (${PHASE_NAMES[String(currentPhase)]}) artifact exists but needs approval. Review \`${artifactRelPath}\` and approve it to proceed to Phase ${currentPhase + 1}.`,
          context_files: []
        };
      }
    }

    // Artifact is approved — recommend next phase
    const handoff = getHandoff(currentPhase);

    if (!handoff || !handoff.ready) {
      return {
        action: 'complete',
        current_phase: currentPhase,
        next_phase: null,
        next_agent: null,
        command: '/jumpstart.status',
        message: 'Current phase is complete. No further phases available.',
        context_files: []
      };
    }

    const nextAgent = handoff.next_agent;
    const nextPhase = handoff.next_phase;
    const command = AGENT_COMMANDS[nextAgent];

    return {
      action: 'proceed',
      current_phase: currentPhase,
      next_phase: nextPhase,
      next_agent: nextAgent,
      command: command,
      message: `Phase ${currentPhase} (${PHASE_NAMES[String(currentPhase)]}) is approved! Next: Phase ${nextPhase} — ${PHASE_DESCRIPTIONS[String(nextPhase)]}`,
      context_files: handoff.context_files || []
    };
  }

  // Fallback — shouldn't normally reach here
  return {
    action: 'unknown',
    current_phase: currentPhase,
    next_phase: null,
    next_agent: null,
    command: '/jumpstart.status',
    message: `Unable to determine next action for phase ${currentPhase}. Run \`/jumpstart.status\` to review the project state.`,
    context_files: []
  };
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

if (process.argv[1] && (
  process.argv[1].endsWith('next-phase.js') ||
  process.argv[1].endsWith('next-phase')
)) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const parsed = input.trim() ? JSON.parse(input) : {};
      const result = determineNextAction(parsed);
      process.stdout.write(JSON.stringify({ ok: true, timestamp: new Date().toISOString(), ...result }, null, 2) + '\n');
    } catch (err) {
      process.stderr.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
      process.exit(2);
    }
  });

  if (process.stdin.isTTY) {
    const result = determineNextAction({});
    process.stdout.write(JSON.stringify({ ok: true, timestamp: new Date().toISOString(), ...result }, null, 2) + '\n');
  }
}
