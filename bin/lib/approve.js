/**
 * approve.js — Streamlined Approval & Rejection (UX Feature 4)
 *
 * Programmatic artifact approval / rejection without manually
 * editing Markdown checkboxes.
 *
 * Usage:
 *   npx jumpstart-mode approve [path] [--approver "Name"]
 *   npx jumpstart-mode reject  [path] --reason "Missing NFRs"
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } = require('fs');
const { join, dirname, basename, relative } = require('path');

import { isArtifactApproved, getHandoff } from './handoff.js';
import { loadState, saveState, updateState } from './state-store.js';
import { now } from './timestamps.js';

/**
 * Phase-to-artifact mapping (primary artifacts only).
 */
const PHASE_ARTIFACT_MAP = {
  '-1': 'specs/codebase-context.md',
  '0': 'specs/challenger-brief.md',
  '1': 'specs/product-brief.md',
  '2': 'specs/prd.md',
  '3': 'specs/architecture.md',
  '4': null
};

/**
 * Auto-detect the current phase's primary artifact from state.
 * @param {object} [options]
 * @param {string} [options.root] - Project root
 * @param {string} [options.statePath] - Custom state path
 * @returns {{ phase: number|null, artifact_path: string|null, exists: boolean }}
 */
export function detectCurrentArtifact(options = {}) {
  const root = options.root || process.cwd();
  const statePath = options.statePath || join(root, '.jumpstart', 'state', 'state.json');
  const state = loadState(statePath);

  const phase = state.current_phase;
  if (phase === null || phase === undefined) {
    return { phase: null, artifact_path: null, exists: false };
  }

  const artifact = PHASE_ARTIFACT_MAP[String(phase)];
  if (!artifact) {
    return { phase, artifact_path: null, exists: false };
  }

  const fullPath = join(root, artifact);
  return { phase, artifact_path: artifact, exists: existsSync(fullPath) };
}

/**
 * Approve an artifact by checking all gate checkboxes, setting approver,
 * date, and status, then updating workflow state.
 *
 * @param {string} filePath - Relative or absolute path to the artifact
 * @param {object} [options]
 * @param {string} [options.approver] - Approver name (default: "Human")
 * @param {string} [options.root] - Project root
 * @param {string} [options.statePath] - Custom state path
 * @returns {{ success: boolean, artifact: string, approver: string, date: string, handoff_info?: object, error?: string }}
 */
export function approveArtifact(filePath, options = {}) {
  const root = options.root || process.cwd();
  const fullPath = filePath.startsWith('/') || filePath.includes(':') ? filePath : join(root, filePath);
  const relPath = relative(root, fullPath).replace(/\\/g, '/');
  const approver = options.approver || 'Human';
  const statePath = options.statePath || join(root, '.jumpstart', 'state', 'state.json');

  if (!existsSync(fullPath)) {
    return { success: false, error: `Artifact not found: ${filePath}` };
  }

  let content = readFileSync(fullPath, 'utf8');

  // Find the Phase Gate Approval section
  if (!/## Phase Gate Approval/i.test(content)) {
    return { success: false, error: 'No "## Phase Gate Approval" section found in artifact' };
  }

  // Check all unchecked boxes
  content = content.replace(/- \[ \]/g, '- [x]');

  // Set Approved by
  content = content.replace(
    /(\*\*Approved by:\*\*)\s*.+/i,
    `$1 ${approver}`
  );

  // Set Approval date
  const dateStr = now().split('T')[0]; // YYYY-MM-DD
  content = content.replace(
    /(\*\*Approval date:\*\*)\s*.+/i,
    `$1 ${dateStr}`
  );

  // Set Status to Approved
  content = content.replace(
    /(\*\*Status:\*\*)\s*.+/i,
    '$1 Approved'
  );

  writeFileSync(fullPath, content, 'utf8');

  // Update state
  updateState({ approved_artifact: relPath }, statePath);

  // Get handoff info for next phase
  const state = loadState(statePath);
  let handoffInfo = null;
  if (state.current_phase !== null && state.current_phase !== undefined) {
    handoffInfo = getHandoff(state.current_phase);
  }

  return {
    success: true,
    artifact: relPath,
    approver,
    date: dateStr,
    handoff_info: handoffInfo
  };
}

/**
 * Reject an artifact by unchecking all gate checkboxes, resetting status
 * to Draft, and logging the rejection reason.
 *
 * @param {string} filePath - Relative or absolute path to the artifact
 * @param {object} [options]
 * @param {string} [options.reason] - Rejection reason (required)
 * @param {string} [options.root] - Project root
 * @param {string} [options.statePath] - Custom state path
 * @returns {{ success: boolean, artifact: string, reason: string, logged_to: string|null, error?: string }}
 */
export function rejectArtifact(filePath, options = {}) {
  const root = options.root || process.cwd();
  const fullPath = filePath.startsWith('/') || filePath.includes(':') ? filePath : join(root, filePath);
  const relPath = relative(root, fullPath).replace(/\\/g, '/');
  const reason = options.reason || 'No reason provided';
  const statePath = options.statePath || join(root, '.jumpstart', 'state', 'state.json');

  if (!existsSync(fullPath)) {
    return { success: false, error: `Artifact not found: ${filePath}` };
  }

  let content = readFileSync(fullPath, 'utf8');

  // Find the Phase Gate Approval section
  if (!/## Phase Gate Approval/i.test(content)) {
    return { success: false, error: 'No "## Phase Gate Approval" section found in artifact' };
  }

  // Uncheck all boxes
  content = content.replace(/- \[x\]/gi, '- [ ]');

  // Reset Approved by to Pending
  content = content.replace(
    /(\*\*Approved by:\*\*)\s*.+/i,
    '$1 Pending'
  );

  // Reset Approval date to Pending
  content = content.replace(
    /(\*\*Approval date:\*\*)\s*.+/i,
    '$1 Pending'
  );

  // Reset Status to Draft
  content = content.replace(
    /(\*\*Status:\*\*)\s*.+/i,
    '$1 Draft'
  );

  writeFileSync(fullPath, content, 'utf8');

  // Remove from approved_artifacts in state
  const state = loadState(statePath);
  state.approved_artifacts = (state.approved_artifacts || []).filter(a => a !== relPath);
  saveState(state, statePath);

  // Log rejection to insights
  let loggedTo = null;
  try {
    const insightsDir = join(root, 'specs', 'insights');
    if (!existsSync(insightsDir)) {
      mkdirSync(insightsDir, { recursive: true });
    }
    const logFile = join(insightsDir, 'rejection-log.md');
    loggedTo = 'specs/insights/rejection-log.md';

    const entry = `\n## Rejection — ${now()}\n\n- **Artifact:** ${relPath}\n- **Reason:** ${reason}\n- **Date:** ${now()}\n\n---\n`;

    if (!existsSync(logFile)) {
      writeFileSync(logFile, `# Rejection Log\n\nAudit trail of artifact rejections.\n${entry}`, 'utf8');
    } else {
      appendFileSync(logFile, entry, 'utf8');
    }
  } catch {
    // Non-fatal — log failure is okay
  }

  return {
    success: true,
    artifact: relPath,
    reason,
    logged_to: loggedTo
  };
}

/**
 * Render human-readable approval result.
 * @param {object} result
 * @returns {string}
 */
export function renderApprovalResult(result) {
  if (!result.success) {
    return `\n  ❌ Approval failed: ${result.error}\n`;
  }

  const lines = [];
  lines.push('');
  lines.push(`  ✅ Approved: ${result.artifact}`);
  lines.push(`     Approver: ${result.approver}`);
  lines.push(`     Date: ${result.date}`);

  if (result.handoff_info && result.handoff_info.ready) {
    lines.push('');
    lines.push(`  ▶ Next: Phase ${result.handoff_info.next_phase} — ${result.handoff_info.next_agent}`);
    lines.push(`    Run /jumpstart.next to continue`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Render human-readable rejection result.
 * @param {object} result
 * @returns {string}
 */
export function renderRejectionResult(result) {
  if (!result.success) {
    return `\n  ❌ Rejection failed: ${result.error}\n`;
  }

  const lines = [];
  lines.push('');
  lines.push(`  🚫 Rejected: ${result.artifact}`);
  lines.push(`     Reason: ${result.reason}`);
  if (result.logged_to) {
    lines.push(`     Logged to: ${result.logged_to}`);
  }
  lines.push('');
  lines.push('  Revision needed — update the artifact and re-approve when ready.');
  lines.push('');
  return lines.join('\n');
}

// CLI mode
if (process.argv[1] && process.argv[1].endsWith('approve.js')) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input || '{}');
      const action = data.action || 'approve';
      let result;
      if (action === 'reject') {
        result = rejectArtifact(data.artifact, {
          reason: data.reason,
          root: data.root
        });
      } else {
        result = approveArtifact(data.artifact, {
          approver: data.approver,
          root: data.root
        });
      }
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message }) + '\n');
      process.exit(1);
    }
  });
}
