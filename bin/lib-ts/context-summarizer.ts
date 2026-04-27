/**
 * context-summarizer.ts — smart context summarizer port (T4.3.3, cluster H).
 *
 * Pure-library port of `bin/lib/context-summarizer.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `PHASE_CONTEXT` (constant map)
 *   - `extractFrontmatter(content)`
 *   - `extractSections(body)`
 *   - `extractClarificationTags(content)`
 *   - `extractUserStories(content)`
 *   - `extractNFRs(content)`
 *   - `extractTechStack(content)`
 *   - `extractComponents(content)`
 *   - `extractTasks(content)`
 *   - `isVerbatimSection(heading, content)`
 *   - `summarizeProseSection(content, maxLength?)`
 *   - `summarizeArtifact(filePath, relPath)`
 *   - `generateContextPacket(options)`
 *   - `renderContextMarkdown(packet)`
 *
 * Behavior parity:
 *   - Verbatim section detection: acceptance-criteria keyword,
 *     `[NEEDS CLARIFICATION]` tag, `NFR-#` token, or `Given/When/Then`
 *     trio (regexes verbatim from legacy).
 *   - Default prose-summary length: 500 chars.
 *   - Phase context map verbatim from legacy `PHASE_CONTEXT`.
 *   - ADR scan only fires for `target_phase >= 3`.
 *   - Brownfield codebase context auto-included if it exists and isn't
 *     already in `contextFiles`.
 *
 * Pit Crew M3 H6 fix: uses `String.matchAll(globalPattern)` rather than
 * mutating `regex.lastIndex` and looping `regex.exec()`. The legacy
 * pattern allowed accidental drift if the regex was reused across
 * functions on the same input.
 *
 * @see bin/lib/context-summarizer.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.3
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Public types

export interface Frontmatter {
  [key: string]: string | boolean;
}

export interface SectionRaw {
  level: number;
  heading: string;
  content: string;
}

export interface SectionSummary extends SectionRaw {
  summarized: boolean;
}

export interface UserStory {
  id: string;
  title: string;
  acceptance_criteria: string[];
}

export interface NFR {
  id: string;
  title: string;
  metric: string | null;
}

export interface TechStackItem {
  layer: string;
  technology: string;
  version: string;
}

export interface ComponentEntry {
  name: string;
  purpose: string;
}

export interface TaskEntry {
  id: string;
  title: string;
  milestone: string;
}

export interface ClarificationItem {
  tag: string;
  source: string;
}

export interface ArtifactSummary {
  file: string;
  frontmatter: Frontmatter;
  original_chars: number;
  summary_chars: number;
  compression_ratio: number;
  sections: SectionSummary[];
  structured_data: {
    user_stories: UserStory[];
    nfrs: NFR[];
    tech_stack: TechStackItem[];
    components: ComponentEntry[];
    tasks: TaskEntry[];
  };
  clarifications: string[];
}

export interface ArtifactLink {
  path: string;
  exists: boolean;
}

export interface ContextPacket {
  phase: number;
  phase_name: string;
  files_summarized: number;
  total_original_chars: number;
  total_summary_chars: number;
  overall_compression: number;
  summaries: ArtifactSummary[];
  open_items: ClarificationItem[];
  full_artifact_links: ArtifactLink[];
  error?: string;
  sections?: SectionSummary[];
}

export interface GenerateContextOptions {
  target_phase: number;
  root?: string;
  specs_dir?: string;
}

// Constants (verbatim from legacy)

/**
 * Maps target phases to the files they need to consume.
 * Mirrors PHASE_MAP.next_context from handoff.js.
 */
export const PHASE_CONTEXT: Record<number, string[]> = {
  0: ['.jumpstart/config.yaml', '.jumpstart/roadmap.md'],
  1: ['.jumpstart/config.yaml', '.jumpstart/roadmap.md', 'specs/challenger-brief.md'],
  2: [
    '.jumpstart/config.yaml',
    '.jumpstart/roadmap.md',
    'specs/challenger-brief.md',
    'specs/product-brief.md',
  ],
  3: [
    '.jumpstart/config.yaml',
    '.jumpstart/roadmap.md',
    'specs/challenger-brief.md',
    'specs/product-brief.md',
    'specs/prd.md',
  ],
  4: [
    '.jumpstart/config.yaml',
    '.jumpstart/roadmap.md',
    'specs/prd.md',
    'specs/architecture.md',
    'specs/implementation-plan.md',
  ],
};

/** Sections that must NEVER be truncated. */
const VERBATIM_PATTERNS: readonly RegExp[] = [
  /acceptance\s+criteria/i,
  /\[NEEDS\s+CLARIFICATION[^\]]*\]/,
  /NFR-\d+/,
  /Given\s.+When\s.+Then\s/i,
];

/** Max characters for prose section summaries. */
const PROSE_SUMMARY_LENGTH = 500;

// Extraction Helpers

/** Extract YAML frontmatter from markdown content. */
export function extractFrontmatter(content: string): {
  frontmatter: Frontmatter | null;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content };

  const frontmatter: Frontmatter = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (kv) {
      const raw = kv[2].trim();
      let value: string | boolean = raw;
      if (raw === 'true') value = true;
      else if (raw === 'false') value = false;
      else if (/^["'].*["']$/.test(raw)) value = raw.slice(1, -1);
      frontmatter[kv[1]] = value;
    }
  }

  return { frontmatter, body: match[2] };
}

/** Extract all markdown sections (## and ### headings) with their content. */
export function extractSections(body: string): SectionRaw[] {
  const sections: SectionRaw[] = [];
  const regex = /^(#{2,4})\s+(.+)$/gm;
  const matches = [...body.matchAll(regex)];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const idx = m.index ?? 0;
    const start = idx + m[0].length;
    const next = matches[i + 1];
    const end = next ? (next.index ?? body.length) : body.length;
    const content = body.substring(start, end).trim();
    sections.push({
      level: m[1].length,
      heading: m[2].trim(),
      content,
    });
  }

  return sections;
}

/** Check if a section contains content that must be preserved verbatim. */
export function isVerbatimSection(heading: string, content: string): boolean {
  const combined = `${heading}\n${content}`;
  return VERBATIM_PATTERNS.some((p) => p.test(combined));
}

/** Extract all [NEEDS CLARIFICATION] tags from content. */
export function extractClarificationTags(content: string): string[] {
  const matches = content.match(/\[NEEDS\s+CLARIFICATION[^\]]*\]/g);
  return matches || [];
}

/** Extract user stories (E##-S## patterns) with their acceptance criteria. */
export function extractUserStories(content: string): UserStory[] {
  const stories: UserStory[] = [];
  const storyRegex = /####\s+(E\d+-S\d+):\s*(.+)/g;

  for (const match of content.matchAll(storyRegex)) {
    const matchIdx = match.index ?? 0;
    const storyStart = matchIdx + match[0].length;
    const nextStoryRegex = /####\s+E\d+-S\d+/g;
    nextStoryRegex.lastIndex = storyStart;
    const nextStory = nextStoryRegex.exec(content);
    const storySection = content.substring(
      storyStart,
      nextStory ? nextStory.index : storyStart + 2000
    );

    const criteriaMatches = storySection.match(/- (?:Given|When|Then|And).+/g);
    stories.push({
      id: match[1],
      title: match[2].trim(),
      acceptance_criteria: criteriaMatches
        ? criteriaMatches.map((c) => c.replace(/^- /, '').trim())
        : [],
    });
  }

  return stories;
}

/** Extract NFRs (NFR-## patterns) with their metrics. */
export function extractNFRs(content: string): NFR[] {
  const nfrs: NFR[] = [];
  const nfrRegex = /###\s+NFR-(\d+):\s*(.+)/g;

  for (const match of content.matchAll(nfrRegex)) {
    const matchIdx = match.index ?? 0;
    const nfrStart = matchIdx + match[0].length;
    const nextSection = content.indexOf('\n### ', nfrStart);
    const nfrBody = content
      .substring(nfrStart, nextSection > 0 ? nextSection : nfrStart + 500)
      .trim();

    const metricMatch = nfrBody.match(
      /(?:within|under|less than|at least|≥|>=|<=|<|>)?\s*\d+[\d.]*\s*(?:ms|s|%|req\/s|rps|MB|GB|KB)/i
    );

    nfrs.push({
      id: `NFR-${match[1]}`,
      title: match[2].trim(),
      metric: metricMatch ? metricMatch[0].trim() : null,
    });
  }

  return nfrs;
}

/** Extract tech stack table entries. */
export function extractTechStack(content: string): TechStackItem[] {
  const stack: TechStackItem[] = [];
  const rows = content.match(/\|\s*(\w+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g) || [];

  for (const row of rows) {
    const cols = row
      .split('|')
      .filter((c) => c.trim())
      .map((c) => c.trim());
    if (cols.length >= 3 && cols[0].toLowerCase() !== 'layer' && cols[0] !== '---') {
      stack.push({ layer: cols[0], technology: cols[1], version: cols[2] });
    }
  }

  return stack;
}

/** Extract component definitions. */
export function extractComponents(content: string): ComponentEntry[] {
  const components: ComponentEntry[] = [];
  const compRegex = /### Component:\s*(.+)/g;

  for (const match of content.matchAll(compRegex)) {
    const matchIdx = match.index ?? 0;
    const compStart = matchIdx + match[0].length;
    const nextComp = content.indexOf('\n### ', compStart);
    const compBody = content.substring(compStart, nextComp > 0 ? nextComp : compStart + 500);

    const purposeMatch = compBody.match(/\*\*Purpose:\*\*\s*(.+)/);
    components.push({
      name: match[1].trim(),
      purpose: purposeMatch ? purposeMatch[1].trim() : 'Not specified',
    });
  }

  return components;
}

/** Extract tasks (M##-T## patterns). */
export function extractTasks(content: string): TaskEntry[] {
  const tasks: TaskEntry[] = [];
  const taskRegex = /(M\d+-T\d+)\s*[:-]\s*(.+)/g;

  for (const match of content.matchAll(taskRegex)) {
    tasks.push({
      id: match[1],
      title: match[2].trim(),
      milestone: match[1].split('-')[0],
    });
  }

  return tasks;
}

/** Summarize a prose section by keeping the first N characters plus any bullet lists. */
export function summarizeProseSection(
  content: string,
  maxLength: number = PROSE_SUMMARY_LENGTH
): string {
  if (content.length <= maxLength) return content;

  const bullets = content.match(/^[-*]\s+.+$/gm) || [];
  const bulletText = bullets.join('\n');

  const firstParagraph = content.split('\n\n')[0] || '';

  if (bulletText.length + firstParagraph.length <= maxLength) {
    return `${firstParagraph}${bulletText ? `\n\n${bulletText}` : ''}\n\n*[Summarized — see full artifact for details]*`;
  }

  return `${content.substring(0, maxLength).replace(/\s+\S*$/, '')}...\n\n*[Summarized — see full artifact for details]*`;
}

// Core Summarizer

/** Summarize a single artifact file into a context section. */
export function summarizeArtifact(filePath: string, relPath: string): ArtifactSummary | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, 'utf8');
  const originalLength = raw.length;
  const { frontmatter, body } = extractFrontmatter(raw);
  const sections = extractSections(body);

  const userStories = extractUserStories(raw);
  const nfrs = extractNFRs(raw);
  const techStack = extractTechStack(raw);
  const components = extractComponents(raw);
  const tasks = extractTasks(raw);
  const clarifications = extractClarificationTags(raw);

  const summarizedSections: SectionSummary[] = sections.map((section) => {
    if (isVerbatimSection(section.heading, section.content)) {
      return { ...section, summarized: false };
    }
    return {
      ...section,
      content: summarizeProseSection(section.content),
      summarized: true,
    };
  });

  const summaryLength = summarizedSections.reduce((sum, s) => sum + s.content.length, 0);

  return {
    file: relPath,
    frontmatter: frontmatter || {},
    original_chars: originalLength,
    summary_chars: summaryLength,
    compression_ratio:
      originalLength > 0 ? Math.round((1 - summaryLength / originalLength) * 100) : 0,
    sections: summarizedSections,
    structured_data: {
      user_stories: userStories,
      nfrs,
      tech_stack: techStack,
      components,
      tasks,
    },
    clarifications,
  };
}

/** Generate a complete context packet for a target phase. */
export function generateContextPacket(options: GenerateContextOptions): ContextPacket {
  const { target_phase, root = '.', specs_dir = 'specs' } = options;
  const resolvedRoot = resolve(root);

  const contextFiles = PHASE_CONTEXT[target_phase];
  if (!contextFiles) {
    return {
      error: `Unknown target phase: ${target_phase}. Valid phases: ${Object.keys(PHASE_CONTEXT).join(', ')}`,
      phase: target_phase,
      phase_name: `Phase ${target_phase}`,
      files_summarized: 0,
      total_original_chars: 0,
      total_summary_chars: 0,
      overall_compression: 0,
      summaries: [],
      open_items: [],
      full_artifact_links: [],
      sections: [],
    };
  }

  const adrFiles: string[] = [];
  if (target_phase >= 3) {
    const adrDir = join(resolvedRoot, specs_dir, 'decisions');
    if (existsSync(adrDir)) {
      const entries = readdirSync(adrDir).filter((f) => f.endsWith('.md'));
      for (const f of entries) {
        adrFiles.push(join(specs_dir, 'decisions', f));
      }
    }
  }

  const codebaseContext = join(resolvedRoot, specs_dir, 'codebase-context.md');
  const allFiles = [...contextFiles];
  if (existsSync(codebaseContext) && !allFiles.includes(`${specs_dir}/codebase-context.md`)) {
    allFiles.push(`${specs_dir}/codebase-context.md`);
  }
  allFiles.push(...adrFiles);

  const summaries: ArtifactSummary[] = [];
  const allClarifications: ClarificationItem[] = [];
  let totalOriginal = 0;
  let totalSummary = 0;

  for (const relPath of allFiles) {
    const absPath = join(resolvedRoot, relPath);
    const summary = summarizeArtifact(absPath, relPath);
    if (summary) {
      summaries.push(summary);
      totalOriginal += summary.original_chars;
      totalSummary += summary.summary_chars;
      allClarifications.push(...summary.clarifications.map((tag) => ({ tag, source: relPath })));
    }
  }

  const phaseNames = ['Challenger', 'Analyst', 'PM', 'Architect', 'Developer'];
  return {
    phase: target_phase,
    phase_name: phaseNames[target_phase] || `Phase ${target_phase}`,
    files_summarized: summaries.length,
    total_original_chars: totalOriginal,
    total_summary_chars: totalSummary,
    overall_compression:
      totalOriginal > 0 ? Math.round((1 - totalSummary / totalOriginal) * 100) : 0,
    summaries,
    open_items: allClarifications,
    full_artifact_links: allFiles.map((f) => ({
      path: f,
      exists: existsSync(join(resolvedRoot, f)),
    })),
  };
}

/** Render a context packet as readable Markdown. */
export function renderContextMarkdown(packet: ContextPacket): string {
  const lines: string[] = [];

  lines.push(`# Phase ${packet.phase} Context Summary — ${packet.phase_name}`);
  lines.push('');
  lines.push(
    `> **Files summarized:** ${packet.files_summarized} | **Compression:** ${packet.overall_compression}% reduction`
  );
  lines.push(
    `> **Original:** ~${Math.round(packet.total_original_chars / 1000)}K chars | **Summary:** ~${Math.round(packet.total_summary_chars / 1000)}K chars`
  );
  lines.push('');

  const allStories: UserStory[] = [];
  const allNfrs: NFR[] = [];
  const allStack: TechStackItem[] = [];
  const allComponents: ComponentEntry[] = [];
  const allTasks: TaskEntry[] = [];

  for (const summary of packet.summaries) {
    const sd = summary.structured_data;
    allStories.push(...sd.user_stories);
    allNfrs.push(...sd.nfrs);
    allStack.push(...sd.tech_stack);
    allComponents.push(...sd.components);
    allTasks.push(...sd.tasks);
  }

  if (allStories.length > 0) {
    lines.push('## Requirements Overview');
    lines.push('');
    lines.push('| ID | Story | Acceptance Criteria |');
    lines.push('|----|-------|---------------------|');
    for (const story of allStories) {
      const ac =
        story.acceptance_criteria.length > 0
          ? story.acceptance_criteria.join('; ')
          : '*See full artifact*';
      lines.push(`| ${story.id} | ${story.title} | ${ac} |`);
    }
    lines.push('');
  }

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

  if (allComponents.length > 0) {
    lines.push('## Architecture Components');
    lines.push('');
    for (const comp of allComponents) {
      lines.push(`- **${comp.name}:** ${comp.purpose}`);
    }
    lines.push('');
  }

  if (allTasks.length > 0) {
    lines.push('## Implementation Tasks');
    lines.push('');
    const milestones: Record<string, TaskEntry[]> = {};
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

  if (packet.open_items.length > 0) {
    lines.push('## Open Items');
    lines.push('');
    for (const item of packet.open_items) {
      lines.push(`- ${item.tag} *(from ${item.source})*`);
    }
    lines.push('');
  }

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
