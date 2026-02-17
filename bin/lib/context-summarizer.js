/**
 * context-summarizer.js — Smart Context Summarizer (UX Feature 9)
 *
 * Generates compressed context packets for phase agents, reducing the
 * number of tokens needed to load upstream artifacts. Preserves critical
 * content verbatim (acceptance criteria, [NEEDS CLARIFICATION] tags,
 * NFR metrics, ADR decisions) while summarizing prose sections.
 *
 * Usage:
 *   echo '{"target_phase":4}' | node bin/lib/context-summarizer.js
 *   echo '{"target_phase":3,"root":".","format":"markdown"}' | node bin/lib/context-summarizer.js
 *
 * Output (stdout JSON):
 *   {
 *     "ok": true,
 *     "phase": 4,
 *     "files_summarized": 5,
 *     "sections": [...],
 *     "open_items": [...],
 *     "full_artifact_links": [...]
 *   }
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Phase Context Requirements ──────────────────────────────────────────────

/**
 * Maps target phases to the files they need to consume.
 * Mirrors PHASE_MAP.next_context from handoff.js.
 */
const PHASE_CONTEXT = {
  0: ['.jumpstart/config.yaml', '.jumpstart/roadmap.md'],
  1: ['.jumpstart/config.yaml', '.jumpstart/roadmap.md', 'specs/challenger-brief.md'],
  2: ['.jumpstart/config.yaml', '.jumpstart/roadmap.md', 'specs/challenger-brief.md', 'specs/product-brief.md'],
  3: ['.jumpstart/config.yaml', '.jumpstart/roadmap.md', 'specs/challenger-brief.md', 'specs/product-brief.md', 'specs/prd.md'],
  4: ['.jumpstart/config.yaml', '.jumpstart/roadmap.md', 'specs/prd.md', 'specs/architecture.md', 'specs/implementation-plan.md']
};

/**
 * Sections that must NEVER be truncated.
 * Content in these sections is preserved verbatim.
 */
const VERBATIM_PATTERNS = [
  /acceptance\s+criteria/i,
  /\[NEEDS\s+CLARIFICATION[^\]]*\]/,
  /NFR-\d+/,
  /Given\s.+When\s.+Then\s/i
];

/**
 * Max characters for prose section summaries.
 */
const PROSE_SUMMARY_LENGTH = 500;

// ─── Extraction Helpers ──────────────────────────────────────────────────────

/**
 * Extract YAML frontmatter from markdown content.
 *
 * @param {string} content - Markdown file content.
 * @returns {{ frontmatter: object|null, body: string }}
 */
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content };

  const frontmatter = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (kv) {
      let value = kv[2].trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (/^["'].*["']$/.test(value)) value = value.slice(1, -1);
      frontmatter[kv[1]] = value;
    }
  }

  return { frontmatter, body: match[2] };
}

/**
 * Extract all markdown sections (## and ### headings) with their content.
 *
 * @param {string} body - Markdown body (without frontmatter).
 * @returns {Array<{ level: number, heading: string, content: string }>}
 */
function extractSections(body) {
  const sections = [];
  const regex = /^(#{2,4})\s+(.+)$/gm;
  const matches = [...body.matchAll(regex)];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    const content = body.substring(start, end).trim();
    sections.push({
      level: matches[i][1].length,
      heading: matches[i][2].trim(),
      content
    });
  }

  return sections;
}

/**
 * Check if a section contains content that must be preserved verbatim.
 *
 * @param {string} heading - Section heading.
 * @param {string} content - Section content.
 * @returns {boolean}
 */
function isVerbatimSection(heading, content) {
  const combined = heading + '\n' + content;
  return VERBATIM_PATTERNS.some(p => p.test(combined));
}

/**
 * Extract all [NEEDS CLARIFICATION] tags from content.
 *
 * @param {string} content - Raw content.
 * @returns {string[]}
 */
function extractClarificationTags(content) {
  const matches = content.match(/\[NEEDS\s+CLARIFICATION[^\]]*\]/g);
  return matches || [];
}

/**
 * Extract user stories (E##-S## patterns) with their acceptance criteria.
 *
 * @param {string} content - Raw markdown content.
 * @returns {Array<{ id: string, title: string, acceptance_criteria: string[] }>}
 */
function extractUserStories(content) {
  const stories = [];
  const storyRegex = /####\s+(E\d+-S\d+):\s*(.+)/g;
  let match;

  while ((match = storyRegex.exec(content)) !== null) {
    const storyStart = match.index + match[0].length;
    const nextStoryRegex = /####\s+E\d+-S\d+/g;
    nextStoryRegex.lastIndex = storyStart;
    const nextStory = nextStoryRegex.exec(content);
    const storySection = content.substring(storyStart, nextStory ? nextStory.index : storyStart + 2000);

    const criteriaMatches = storySection.match(/- (?:Given|When|Then|And).+/g);
    stories.push({
      id: match[1],
      title: match[2].trim(),
      acceptance_criteria: criteriaMatches ? criteriaMatches.map(c => c.replace(/^- /, '').trim()) : []
    });
  }

  return stories;
}

/**
 * Extract NFRs (NFR-## patterns) with their metrics.
 *
 * @param {string} content - Raw markdown content.
 * @returns {Array<{ id: string, title: string, metric: string|null }>}
 */
function extractNFRs(content) {
  const nfrs = [];
  const nfrRegex = /###\s+NFR-(\d+):\s*(.+)/g;
  let match;

  while ((match = nfrRegex.exec(content)) !== null) {
    const nfrStart = match.index + match[0].length;
    const nextSection = content.indexOf('\n### ', nfrStart);
    const nfrBody = content.substring(nfrStart, nextSection > 0 ? nextSection : nfrStart + 500).trim();

    const metricMatch = nfrBody.match(/(?:within|under|less than|at least|≥|>=|<=|<|>)?\s*\d+[\d.]*\s*(?:ms|s|%|req\/s|rps|MB|GB|KB)/i);

    nfrs.push({
      id: `NFR-${match[1]}`,
      title: match[2].trim(),
      metric: metricMatch ? metricMatch[0].trim() : null
    });
  }

  return nfrs;
}

/**
 * Extract tech stack table entries.
 *
 * @param {string} content - Raw markdown content.
 * @returns {Array<{ layer: string, technology: string, version: string }>}
 */
function extractTechStack(content) {
  const stack = [];
  const rows = content.match(/\|\s*(\w+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g) || [];

  for (const row of rows) {
    const cols = row.split('|').filter(c => c.trim()).map(c => c.trim());
    if (cols.length >= 3 && cols[0].toLowerCase() !== 'layer' && cols[0] !== '---') {
      stack.push({ layer: cols[0], technology: cols[1], version: cols[2] });
    }
  }

  return stack;
}

/**
 * Extract component definitions.
 *
 * @param {string} content - Raw markdown content.
 * @returns {Array<{ name: string, purpose: string }>}
 */
function extractComponents(content) {
  const components = [];
  const compRegex = /### Component:\s*(.+)/g;
  let match;

  while ((match = compRegex.exec(content)) !== null) {
    const compStart = match.index + match[0].length;
    const nextComp = content.indexOf('\n### ', compStart);
    const compBody = content.substring(compStart, nextComp > 0 ? nextComp : compStart + 500);

    const purposeMatch = compBody.match(/\*\*Purpose:\*\*\s*(.+)/);
    components.push({
      name: match[1].trim(),
      purpose: purposeMatch ? purposeMatch[1].trim() : 'Not specified'
    });
  }

  return components;
}

/**
 * Extract tasks (M##-T## patterns).
 *
 * @param {string} content - Raw markdown content.
 * @returns {Array<{ id: string, title: string, milestone: string }>}
 */
function extractTasks(content) {
  const tasks = [];
  const taskRegex = /(M\d+-T\d+)\s*[:\-]\s*(.+)/g;
  let match;

  while ((match = taskRegex.exec(content)) !== null) {
    tasks.push({
      id: match[1],
      title: match[2].trim(),
      milestone: match[1].split('-')[0]
    });
  }

  return tasks;
}

/**
 * Summarize a prose section by keeping the first N characters plus any bullet lists.
 *
 * @param {string} content - Section content.
 * @param {number} [maxLength] - Max characters for prose.
 * @returns {string} Summarized content.
 */
function summarizeProseSection(content, maxLength = PROSE_SUMMARY_LENGTH) {
  if (content.length <= maxLength) return content;

  // Keep bullet points intact
  const bullets = content.match(/^[-*]\s+.+$/gm) || [];
  const bulletText = bullets.join('\n');

  // Keep first paragraph
  const firstParagraph = content.split('\n\n')[0] || '';

  if (bulletText.length + firstParagraph.length <= maxLength) {
    return firstParagraph + (bulletText ? '\n\n' + bulletText : '') + '\n\n*[Summarized — see full artifact for details]*';
  }

  return content.substring(0, maxLength).replace(/\s+\S*$/, '') + '...\n\n*[Summarized — see full artifact for details]*';
}

// ─── Core Summarizer ─────────────────────────────────────────────────────────

/**
 * Summarize a single artifact file into a context section.
 *
 * @param {string} filePath - Absolute path to the artifact.
 * @param {string} relPath - Relative path for display.
 * @returns {object|null} Summarized section, or null if file missing.
 */
function summarizeArtifact(filePath, relPath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const originalLength = raw.length;
  const { frontmatter, body } = extractFrontmatter(raw);
  const sections = extractSections(body);

  // Extract structured data
  const userStories = extractUserStories(raw);
  const nfrs = extractNFRs(raw);
  const techStack = extractTechStack(raw);
  const components = extractComponents(raw);
  const tasks = extractTasks(raw);
  const clarifications = extractClarificationTags(raw);

  // Summarize sections
  const summarizedSections = sections.map(section => {
    if (isVerbatimSection(section.heading, section.content)) {
      return { ...section, summarized: false };
    }
    return {
      ...section,
      content: summarizeProseSection(section.content),
      summarized: true
    };
  });

  const summaryLength = summarizedSections.reduce((sum, s) => sum + s.content.length, 0);

  return {
    file: relPath,
    frontmatter: frontmatter || {},
    original_chars: originalLength,
    summary_chars: summaryLength,
    compression_ratio: originalLength > 0 ? Math.round((1 - summaryLength / originalLength) * 100) : 0,
    sections: summarizedSections,
    structured_data: {
      user_stories: userStories,
      nfrs: nfrs,
      tech_stack: techStack,
      components: components,
      tasks: tasks
    },
    clarifications
  };
}

/**
 * Generate a complete context packet for a target phase.
 *
 * @param {object} options - Options.
 * @param {number} options.target_phase - The phase that will consume this packet.
 * @param {string} [options.root] - Project root directory.
 * @param {string} [options.specs_dir] - Specs directory (relative to root).
 * @returns {object} Context packet.
 */
function generateContextPacket(options) {
  const { target_phase, root = '.', specs_dir = 'specs' } = options;
  const resolvedRoot = path.resolve(root);

  // Determine which files this phase needs
  const contextFiles = PHASE_CONTEXT[target_phase];
  if (!contextFiles) {
    return {
      error: `Unknown target phase: ${target_phase}. Valid phases: ${Object.keys(PHASE_CONTEXT).join(', ')}`,
      phase: target_phase,
      files_summarized: 0,
      sections: []
    };
  }

  // Also check for ADRs if phase >= 3
  const adrFiles = [];
  if (target_phase >= 3) {
    const adrDir = path.join(resolvedRoot, specs_dir, 'decisions');
    if (fs.existsSync(adrDir)) {
      const entries = fs.readdirSync(adrDir).filter(f => f.endsWith('.md'));
      entries.forEach(f => adrFiles.push(path.join(specs_dir, 'decisions', f)));
    }
  }

  // Also check for brownfield codebase context
  const codebaseContext = path.join(resolvedRoot, specs_dir, 'codebase-context.md');
  const allFiles = [...contextFiles];
  if (fs.existsSync(codebaseContext) && !allFiles.includes(`${specs_dir}/codebase-context.md`)) {
    allFiles.push(`${specs_dir}/codebase-context.md`);
  }
  allFiles.push(...adrFiles);

  // Summarize each file
  const summaries = [];
  const allClarifications = [];
  let totalOriginal = 0;
  let totalSummary = 0;

  for (const relPath of allFiles) {
    const absPath = path.join(resolvedRoot, relPath);
    const summary = summarizeArtifact(absPath, relPath);
    if (summary) {
      summaries.push(summary);
      totalOriginal += summary.original_chars;
      totalSummary += summary.summary_chars;
      allClarifications.push(...summary.clarifications.map(tag => ({ tag, source: relPath })));
    }
  }

  return {
    phase: target_phase,
    phase_name: ['Challenger', 'Analyst', 'PM', 'Architect', 'Developer'][target_phase] || `Phase ${target_phase}`,
    files_summarized: summaries.length,
    total_original_chars: totalOriginal,
    total_summary_chars: totalSummary,
    overall_compression: totalOriginal > 0 ? Math.round((1 - totalSummary / totalOriginal) * 100) : 0,
    summaries,
    open_items: allClarifications,
    full_artifact_links: allFiles.map(f => ({ path: f, exists: fs.existsSync(path.join(resolvedRoot, f)) }))
  };
}

/**
 * Render a context packet as readable Markdown.
 *
 * @param {object} packet - Context packet from generateContextPacket().
 * @returns {string} Markdown-formatted summary.
 */
function renderContextMarkdown(packet) {
  const lines = [];

  lines.push(`# Phase ${packet.phase} Context Summary — ${packet.phase_name}`);
  lines.push('');
  lines.push(`> **Files summarized:** ${packet.files_summarized} | **Compression:** ${packet.overall_compression}% reduction`);
  lines.push(`> **Original:** ~${Math.round(packet.total_original_chars / 1000)}K chars | **Summary:** ~${Math.round(packet.total_summary_chars / 1000)}K chars`);
  lines.push('');

  // Aggregate structured data
  const allStories = [];
  const allNfrs = [];
  const allStack = [];
  const allComponents = [];
  const allTasks = [];

  for (const summary of packet.summaries) {
    const sd = summary.structured_data;
    allStories.push(...sd.user_stories);
    allNfrs.push(...sd.nfrs);
    allStack.push(...sd.tech_stack);
    allComponents.push(...sd.components);
    allTasks.push(...sd.tasks);
  }

  // Requirements Overview
  if (allStories.length > 0) {
    lines.push('## Requirements Overview');
    lines.push('');
    lines.push('| ID | Story | Acceptance Criteria |');
    lines.push('|----|-------|---------------------|');
    for (const story of allStories) {
      const ac = story.acceptance_criteria.length > 0
        ? story.acceptance_criteria.join('; ')
        : '*See full artifact*';
      lines.push(`| ${story.id} | ${story.title} | ${ac} |`);
    }
    lines.push('');
  }

  // NFRs
  if (allNfrs.length > 0) {
    lines.push('## Non-Functional Requirements');
    lines.push('');
    lines.push('| ID | Requirement | Metric |');
    lines.push('|----|-------------|--------|');
    for (const nfr of allNfrs) {
      lines.push(`| ${nfr.id} | ${nfr.title} | ${nfr.metric || '*TBD*'} |`);
    }
    lines.push('');
  }

  // Tech Stack
  if (allStack.length > 0) {
    lines.push('## Technology Stack');
    lines.push('');
    lines.push('| Layer | Technology | Version |');
    lines.push('|-------|-----------|---------|');
    for (const item of allStack) {
      lines.push(`| ${item.layer} | ${item.technology} | ${item.version} |`);
    }
    lines.push('');
  }

  // Components
  if (allComponents.length > 0) {
    lines.push('## Architecture Components');
    lines.push('');
    for (const comp of allComponents) {
      lines.push(`- **${comp.name}:** ${comp.purpose}`);
    }
    lines.push('');
  }

  // Tasks
  if (allTasks.length > 0) {
    lines.push('## Implementation Tasks');
    lines.push('');
    const milestones = {};
    for (const task of allTasks) {
      if (!milestones[task.milestone]) milestones[task.milestone] = [];
      milestones[task.milestone].push(task);
    }
    for (const [milestone, tasks] of Object.entries(milestones)) {
      lines.push(`### ${milestone}`);
      for (const task of tasks) {
        lines.push(`- [ ] **${task.id}:** ${task.title}`);
      }
      lines.push('');
    }
  }

  // Open Items
  if (packet.open_items.length > 0) {
    lines.push('## Open Items');
    lines.push('');
    for (const item of packet.open_items) {
      lines.push(`- ${item.tag} *(from ${item.source})*`);
    }
    lines.push('');
  }

  // Key Sections (prose summaries from each artifact)
  lines.push('## Artifact Summaries');
  lines.push('');
  for (const summary of packet.summaries) {
    if (summary.file.endsWith('config.yaml') || summary.file.endsWith('roadmap.md')) continue;
    lines.push(`### ${summary.file}`);
    lines.push(`*Compression: ${summary.compression_ratio}% reduction*`);
    lines.push('');
    for (const section of summary.sections) {
      if (section.level <= 3 && section.content.length > 0) {
        const prefix = '#'.repeat(Math.min(section.level + 1, 5));
        lines.push(`${prefix} ${section.heading}`);
        lines.push('');
        lines.push(section.content);
        lines.push('');
      }
    }
  }

  // Drill-down links
  lines.push('## Full Artifact Links');
  lines.push('');
  lines.push('*For full detail on any section, read the complete artifact:*');
  lines.push('');
  for (const link of packet.full_artifact_links) {
    const status = link.exists ? '✓' : '✗ missing';
    lines.push(`- [${link.path}](${link.path}) ${status}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Public API ──────────────────────────────────────────────────────────────

module.exports = {
  generateContextPacket,
  renderContextMarkdown,
  summarizeArtifact,
  extractFrontmatter,
  extractSections,
  extractUserStories,
  extractNFRs,
  extractTechStack,
  extractComponents,
  extractTasks,
  extractClarificationTags,
  isVerbatimSection,
  summarizeProseSection,
  PHASE_CONTEXT
};

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const parsed = input.trim() ? JSON.parse(input) : {};
      const targetPhase = parsed.target_phase;

      if (targetPhase === undefined || targetPhase === null) {
        process.stderr.write(JSON.stringify({
          ok: false,
          error: 'Missing required field: target_phase (0-4)'
        }) + '\n');
        process.exit(2);
      }

      const packet = generateContextPacket({
        target_phase: targetPhase,
        root: parsed.root || '.',
        specs_dir: parsed.specs_dir || 'specs'
      });

      if (parsed.format === 'markdown') {
        process.stdout.write(renderContextMarkdown(packet) + '\n');
      } else {
        process.stdout.write(JSON.stringify({
          ok: true,
          timestamp: new Date().toISOString(),
          ...packet
        }, null, 2) + '\n');
      }
    } catch (err) {
      process.stderr.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
      process.exit(2);
    }
  });

  if (process.stdin.isTTY) {
    process.stderr.write(JSON.stringify({
      ok: false,
      error: 'Usage: echo \'{"target_phase":4}\' | node bin/lib/context-summarizer.js'
    }) + '\n');
    process.exit(1);
  }
}
