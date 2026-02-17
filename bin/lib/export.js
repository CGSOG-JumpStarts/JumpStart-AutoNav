/**
 * export.js — Portable Handoff Package (UX Feature 14)
 *
 * Generates a self-contained handoff package with all approved specs,
 * key decisions, implementation status, and coverage data.
 *
 * Usage:
 *   npx jumpstart-mode handoff
 *   npx jumpstart-mode handoff --output ./handoff.md --json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { summarizeArtifact } = require('./context-summarizer');

/**
 * Phase definitions for artifact mapping.
 */
const PHASES = [
  { phase: -1, name: 'Scout',      artifact: 'specs/codebase-context.md' },
  { phase: 0,  name: 'Challenger', artifact: 'specs/challenger-brief.md' },
  { phase: 1,  name: 'Analyst',    artifact: 'specs/product-brief.md' },
  { phase: 2,  name: 'PM',         artifact: 'specs/prd.md' },
  { phase: 3,  name: 'Architect',  artifact: 'specs/architecture.md' },
  { phase: 4,  name: 'Developer',  artifact: null }
];

/**
 * Additional artifacts produced by specific phases.
 */
const SECONDARY_ARTIFACTS = [
  'specs/implementation-plan.md'
];

/**
 * Check if a file contains an approved Phase Gate section.
 * @param {string} content
 * @returns {boolean}
 */
function isApproved(content) {
  if (!content) return false;
  if (!/## Phase Gate Approval/i.test(content)) return false;
  const match = content.match(/\*\*Approved by:\*\*\s*(.+)/i);
  if (!match || match[1].trim().toLowerCase() === 'pending') return false;
  const gateSection = content.split(/## Phase Gate Approval/i)[1] || '';
  const unchecked = gateSection.match(/- \[ \]/g);
  return !unchecked || unchecked.length === 0;
}

/**
 * Gather all data needed for the handoff package.
 *
 * @param {object} [options]
 * @param {string} [options.root] - Project root
 * @param {string} [options.specsDir] - Specs directory
 * @returns {object} Handoff data payload
 */
function gatherHandoffData(options = {}) {
  const root = options.root || process.cwd();
  const specsDir = options.specsDir || path.join(root, 'specs');

  // Load state
  let state = { current_phase: null, approved_artifacts: [], phase_history: [], resume_context: null };
  try {
    const statePath = path.join(root, '.jumpstart', 'state', 'state.json');
    if (fs.existsSync(statePath)) {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    }
  } catch { /* use defaults */ }

  // Load config for project name
  let projectName = path.basename(root);
  try {
    const configPath = path.join(root, '.jumpstart', 'config.yaml');
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const nameMatch = configContent.match(/name:\s*['"]?([^'"\n]+)/);
      if (nameMatch) projectName = nameMatch[1].trim();
    }
  } catch { /* use default */ }

  // Gather phase status and summaries
  const phases = [];
  const summaries = [];
  const approvedArtifacts = [];

  for (const p of PHASES) {
    if (!p.artifact) {
      phases.push({ phase: p.phase, name: p.name, status: 'n/a', artifact: null });
      continue;
    }

    const artifactPath = path.join(root, p.artifact);
    let status = 'not-started';
    let approved = false;

    if (fs.existsSync(artifactPath)) {
      const content = fs.readFileSync(artifactPath, 'utf8');
      approved = isApproved(content);
      status = approved ? 'approved' : 'draft';

      if (approved) approvedArtifacts.push(p.artifact);

      // Summarize the artifact
      try {
        const summary = summarizeArtifact(artifactPath, p.artifact);
        summaries.push({
          file: p.artifact,
          phase: p.phase,
          phase_name: p.name,
          approved,
          frontmatter: summary.frontmatter || {},
          sections: summary.sections || [],
          structured_data: summary.structured_data || {}
        });
      } catch {
        summaries.push({ file: p.artifact, phase: p.phase, phase_name: p.name, approved, error: 'Could not summarize' });
      }
    }

    phases.push({ phase: p.phase, name: p.name, status, artifact: p.artifact });
  }

  // Check secondary artifacts (implementation-plan.md)
  for (const sa of SECONDARY_ARTIFACTS) {
    const saPath = path.join(root, sa);
    if (fs.existsSync(saPath)) {
      const content = fs.readFileSync(saPath, 'utf8');
      const approved = isApproved(content);
      if (approved) approvedArtifacts.push(sa);
      try {
        const summary = summarizeArtifact(saPath, sa);
        summaries.push({
          file: sa,
          phase: 3,
          phase_name: 'Architect',
          approved,
          frontmatter: summary.frontmatter || {},
          sections: summary.sections || [],
          structured_data: summary.structured_data || {}
        });
      } catch { /* skip */ }
    }
  }

  // Gather ADRs from specs/decisions/
  const decisions = [];
  const decisionsDir = path.join(specsDir, 'decisions');
  if (fs.existsSync(decisionsDir)) {
    try {
      const files = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.md'));
      for (const f of files) {
        const content = fs.readFileSync(path.join(decisionsDir, f), 'utf8');
        const titleMatch = content.match(/^#\s+(.+)/m);
        const statusMatch = content.match(/\*\*Status:\*\*\s*(.+)/i);
        decisions.push({
          file: `specs/decisions/${f}`,
          title: titleMatch ? titleMatch[1].trim() : f,
          status: statusMatch ? statusMatch[1].trim() : 'Unknown'
        });
      }
    } catch { /* skip */ }
  }

  // Coverage data
  let coverage = null;
  const prdPath = path.join(root, 'specs/prd.md');
  const planPath = path.join(root, 'specs/implementation-plan.md');
  if (fs.existsSync(prdPath) && fs.existsSync(planPath)) {
    try {
      const { computeCoverage } = require('./coverage');
      coverage = computeCoverage(prdPath, planPath);
    } catch { /* skip */ }
  }

  // Open clarifications
  const openItems = [];
  for (const s of summaries) {
    if (s.structured_data && s.structured_data.clarifications) {
      for (const c of s.structured_data.clarifications) {
        openItems.push({ file: s.file, tag: c });
      }
    }
  }

  // Scan for [NEEDS CLARIFICATION] in all spec files
  if (fs.existsSync(specsDir)) {
    try {
      const specFiles = _walkFiles(specsDir).filter(f => f.endsWith('.md'));
      for (const sf of specFiles) {
        const content = fs.readFileSync(sf, 'utf8');
        const matches = content.match(/\[NEEDS CLARIFICATION[^\]]*\]/g);
        if (matches) {
          const relPath = path.relative(root, sf).replace(/\\/g, '/');
          for (const m of matches) {
            if (!openItems.find(o => o.file === relPath && o.tag === m)) {
              openItems.push({ file: relPath, tag: m });
            }
          }
        }
      }
    } catch { /* skip */ }
  }

  return {
    project_name: projectName,
    exported_at: new Date().toISOString(),
    phases,
    approved_artifacts: approvedArtifacts,
    summaries,
    decisions,
    coverage,
    open_items: openItems,
    implementation_status: {
      current_phase: state.current_phase,
      current_agent: state.current_agent,
      phase_history: state.phase_history || [],
      resume_context: state.resume_context
    }
  };
}

/**
 * Render handoff data as a self-contained Markdown document.
 * @param {object} data - Data from gatherHandoffData
 * @returns {string}
 */
function renderHandoffMarkdown(data) {
  const lines = [];

  lines.push(`# Handoff Package — ${data.project_name}`);
  lines.push('');
  lines.push(`> Exported: ${data.exported_at}`);
  lines.push('');

  // Phase Status Table
  lines.push('## Phase Status');
  lines.push('');
  lines.push('| Phase | Name | Status | Artifact |');
  lines.push('|-------|------|--------|----------|');
  for (const p of data.phases) {
    const statusIcon = p.status === 'approved' ? '✅' : p.status === 'draft' ? '📝' : p.status === 'n/a' ? '—' : '⬜';
    lines.push(`| ${p.phase} | ${p.name} | ${statusIcon} ${p.status} | ${p.artifact || '—'} |`);
  }
  lines.push('');

  // Approved Artifacts
  if (data.approved_artifacts.length > 0) {
    lines.push('## Approved Artifacts');
    lines.push('');
    for (const a of data.approved_artifacts) {
      lines.push(`- ✅ ${a}`);
    }
    lines.push('');
  }

  // Summaries
  if (data.summaries.length > 0) {
    lines.push('## Artifact Summaries');
    lines.push('');
    for (const s of data.summaries) {
      lines.push(`### ${s.phase_name} — ${s.file}`);
      lines.push('');
      if (s.error) {
        lines.push(`_${s.error}_`);
      } else {
        if (s.sections && s.sections.length > 0) {
          for (const sec of s.sections) {
            lines.push(`**${sec.heading}**`);
            if (sec.summary) lines.push(sec.summary);
            lines.push('');
          }
        }
        // Structured data highlights
        const sd = s.structured_data || {};
        if (sd.user_stories && sd.user_stories.length > 0) {
          lines.push(`**User Stories:** ${sd.user_stories.length} stories`);
        }
        if (sd.nfrs && sd.nfrs.length > 0) {
          lines.push(`**NFRs:** ${sd.nfrs.length} requirements`);
        }
        if (sd.components && sd.components.length > 0) {
          lines.push(`**Components:** ${sd.components.join(', ')}`);
        }
        if (sd.tech_stack && sd.tech_stack.length > 0) {
          lines.push(`**Tech Stack:** ${sd.tech_stack.join(', ')}`);
        }
      }
      lines.push('');
    }
  }

  // Decisions
  if (data.decisions.length > 0) {
    lines.push('## Architecture Decisions');
    lines.push('');
    for (const d of data.decisions) {
      lines.push(`- **${d.title}** — _${d.status}_ (${d.file})`);
    }
    lines.push('');
  }

  // Coverage
  if (data.coverage) {
    lines.push('## Coverage');
    lines.push('');
    lines.push(`- **Stories covered:** ${data.coverage.covered ? data.coverage.covered.length : 0} / ${data.coverage.total_stories || 0}`);
    lines.push(`- **Coverage:** ${data.coverage.coverage_pct != null ? data.coverage.coverage_pct + '%' : 'N/A'}`);
    if (data.coverage.uncovered && data.coverage.uncovered.length > 0) {
      lines.push(`- **Uncovered:** ${data.coverage.uncovered.join(', ')}`);
    }
    lines.push('');
  }

  // Open Items
  if (data.open_items.length > 0) {
    lines.push('## Open Clarifications');
    lines.push('');
    for (const item of data.open_items) {
      lines.push(`- ${item.file}: ${item.tag}`);
    }
    lines.push('');
  }

  // Implementation Status
  lines.push('## Implementation Status');
  lines.push('');
  const is = data.implementation_status;
  lines.push(`- **Current Phase:** ${is.current_phase !== null ? is.current_phase : 'Not started'}`);
  lines.push(`- **Current Agent:** ${is.current_agent || 'None'}`);
  if (is.phase_history && is.phase_history.length > 0) {
    lines.push(`- **Completed Phases:** ${is.phase_history.length}`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('_Generated by JumpStart `/jumpstart.handoff`_');
  lines.push('');

  return lines.join('\n');
}

/**
 * Export a complete handoff package to a file.
 *
 * @param {object} [options]
 * @param {string} [options.root] - Project root
 * @param {string} [options.output] - Output file path (default: specs/handoff-package.md)
 * @param {boolean} [options.json] - Export as JSON instead of Markdown
 * @returns {{ success: boolean, output_path: string, stats: object }}
 */
function exportHandoffPackage(options = {}) {
  const root = options.root || process.cwd();
  const data = gatherHandoffData({ root, specsDir: path.join(root, 'specs') });

  const outputPath = options.output || path.join(root, 'specs', 'handoff-package.md');
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let content;
  if (options.json) {
    content = JSON.stringify(data, null, 2) + '\n';
  } else {
    content = renderHandoffMarkdown(data);
  }

  fs.writeFileSync(outputPath, content, 'utf8');

  return {
    success: true,
    output_path: outputPath,
    stats: {
      phases: data.phases.length,
      approved: data.approved_artifacts.length,
      summaries: data.summaries.length,
      decisions: data.decisions.length,
      open_items: data.open_items.length,
      has_coverage: data.coverage !== null
    }
  };
}

/**
 * Walk a directory recursively and return file paths.
 * @param {string} dir
 * @returns {string[]}
 */
function _walkFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(..._walkFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

module.exports = {
  gatherHandoffData,
  renderHandoffMarkdown,
  exportHandoffPackage,
  isApproved,
  PHASES,
  SECONDARY_ARTIFACTS
};

// CLI mode
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input || '{}');
      const result = exportHandoffPackage({
        root: data.root || process.cwd(),
        output: data.output,
        json: data.json
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message }) + '\n');
      process.exit(1);
    }
  });
}
