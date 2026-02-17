/**
 * test-context-summarizer.test.js — Tests for Smart Context Summarizer (UX Feature 9)
 *
 * Tests for bin/lib/context-summarizer.js covering:
 * - Frontmatter extraction
 * - Section extraction from markdown
 * - User story extraction (E##-S## patterns)
 * - NFR extraction with metrics
 * - Tech stack extraction from tables
 * - Component extraction
 * - Task extraction (M##-T## patterns)
 * - [NEEDS CLARIFICATION] tag preservation
 * - Verbatim section detection
 * - Prose summarization
 * - Context packet generation
 * - Markdown rendering
 * - Graceful handling of missing files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
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
  generateContextPacket,
  renderContextMarkdown,
  summarizeArtifact,
  PHASE_CONTEXT
} = require('../bin/lib/context-summarizer');

// ─── Frontmatter Extraction ──────────────────────────────────────────────────

describe('extractFrontmatter', () => {
  it('extracts YAML frontmatter from markdown', () => {
    const content = '---\nid: test-artifact\nphase: 2\napproved: true\n---\n# Content\n\nBody text.';
    const result = extractFrontmatter(content);
    expect(result.frontmatter.id).toBe('test-artifact');
    expect(result.frontmatter.phase).toBe('2');
    expect(result.frontmatter.approved).toBe(true);
    expect(result.body).toContain('# Content');
  });

  it('returns null frontmatter when no frontmatter exists', () => {
    const content = '# Just Content\n\nNo frontmatter here.';
    const result = extractFrontmatter(content);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
  });

  it('parses boolean values correctly', () => {
    const content = '---\nenabled: true\ndisabled: false\n---\n';
    const result = extractFrontmatter(content);
    expect(result.frontmatter.enabled).toBe(true);
    expect(result.frontmatter.disabled).toBe(false);
  });
});

// ─── Section Extraction ──────────────────────────────────────────────────────

describe('extractSections', () => {
  it('extracts ## and ### headings with content', () => {
    const body = '## Section One\n\nContent one.\n\n### Subsection\n\nSub content.\n\n## Section Two\n\nContent two.';
    const sections = extractSections(body);
    expect(sections.length).toBe(3);
    expect(sections[0].heading).toBe('Section One');
    expect(sections[0].level).toBe(2);
    expect(sections[1].heading).toBe('Subsection');
    expect(sections[1].level).toBe(3);
    expect(sections[2].heading).toBe('Section Two');
  });

  it('returns empty array for content without headings', () => {
    const sections = extractSections('Just plain text.\n\nAnother paragraph.');
    expect(sections).toEqual([]);
  });
});

// ─── User Story Extraction ───────────────────────────────────────────────────

describe('extractUserStories', () => {
  it('extracts E##-S## story patterns with acceptance criteria', () => {
    const content = `
#### E01-S01: User can create an account

- Given a new user visits the registration page
- When they fill out the form and submit
- Then an account is created

#### E01-S02: User can log in

- Given a registered user
- When they enter valid credentials
- Then they are redirected to the dashboard
`;
    const stories = extractUserStories(content);
    expect(stories.length).toBe(2);
    expect(stories[0].id).toBe('E01-S01');
    expect(stories[0].title).toBe('User can create an account');
    expect(stories[0].acceptance_criteria.length).toBe(3);
    expect(stories[0].acceptance_criteria[0]).toContain('Given a new user');
  });

  it('returns empty array when no stories found', () => {
    const stories = extractUserStories('No stories here.');
    expect(stories).toEqual([]);
  });
});

// ─── NFR Extraction ──────────────────────────────────────────────────────────

describe('extractNFRs', () => {
  it('extracts NFR patterns with metrics', () => {
    const content = `
### NFR-1: Response Time

API responses must be returned within 200ms for 95th percentile.

### NFR-2: Uptime

System must maintain at least 99.9% uptime.
`;
    const nfrs = extractNFRs(content);
    expect(nfrs.length).toBe(2);
    expect(nfrs[0].id).toBe('NFR-1');
    expect(nfrs[0].title).toBe('Response Time');
    expect(nfrs[0].metric).toContain('200ms');
    expect(nfrs[1].id).toBe('NFR-2');
    expect(nfrs[1].metric).toContain('99.9%');
  });

  it('handles NFRs without explicit metrics', () => {
    const content = '### NFR-1: Security\n\nAll data must be encrypted.\n';
    const nfrs = extractNFRs(content);
    expect(nfrs.length).toBe(1);
    expect(nfrs[0].metric).toBeNull();
  });
});

// ─── Tech Stack Extraction ───────────────────────────────────────────────────

describe('extractTechStack', () => {
  it('extracts tech stack from markdown tables', () => {
    const content = `
| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 20.x |
| Framework | Express | 4.18 |
| Database | PostgreSQL | 15 |
`;
    const stack = extractTechStack(content);
    expect(stack.length).toBe(3);
    expect(stack[0].layer).toBe('Runtime');
    expect(stack[0].technology).toBe('Node.js');
    expect(stack[0].version).toBe('20.x');
  });

  it('returns empty array for content without tables', () => {
    const stack = extractTechStack('No tables here.');
    expect(stack).toEqual([]);
  });
});

// ─── Component Extraction ────────────────────────────────────────────────────

describe('extractComponents', () => {
  it('extracts component definitions', () => {
    const content = `
### Component: AuthService

**Purpose:** Handles user authentication and authorization.

### Component: DataLayer

**Purpose:** Manages database connections and queries.
`;
    const components = extractComponents(content);
    expect(components.length).toBe(2);
    expect(components[0].name).toBe('AuthService');
    expect(components[0].purpose).toContain('authentication');
    expect(components[1].name).toBe('DataLayer');
  });
});

// ─── Task Extraction ─────────────────────────────────────────────────────────

describe('extractTasks', () => {
  it('extracts M##-T## task patterns', () => {
    const content = `
M01-T01: Set up project scaffolding
M01-T02: Configure build system
M02-T01: Implement authentication module
`;
    const tasks = extractTasks(content);
    expect(tasks.length).toBe(3);
    expect(tasks[0].id).toBe('M01-T01');
    expect(tasks[0].title).toBe('Set up project scaffolding');
    expect(tasks[0].milestone).toBe('M01');
    expect(tasks[2].milestone).toBe('M02');
  });
});

// ─── NEEDS CLARIFICATION Tags ────────────────────────────────────────────────

describe('extractClarificationTags', () => {
  it('extracts all [NEEDS CLARIFICATION] tags', () => {
    const content = `
Some text here.

[NEEDS CLARIFICATION: What authentication provider?]

More text.

[NEEDS CLARIFICATION: Database hosting provider unclear]
`;
    const tags = extractClarificationTags(content);
    expect(tags.length).toBe(2);
    expect(tags[0]).toContain('authentication provider');
    expect(tags[1]).toContain('Database hosting');
  });

  it('returns empty array when no tags found', () => {
    const tags = extractClarificationTags('No clarification needed.');
    expect(tags).toEqual([]);
  });
});

// ─── Verbatim Section Detection ──────────────────────────────────────────────

describe('isVerbatimSection', () => {
  it('detects acceptance criteria sections', () => {
    expect(isVerbatimSection('Acceptance Criteria', 'Given a user')).toBe(true);
  });

  it('detects NEEDS CLARIFICATION content', () => {
    expect(isVerbatimSection('Overview', '[NEEDS CLARIFICATION: something]')).toBe(true);
  });

  it('detects NFR references', () => {
    expect(isVerbatimSection('Requirements', 'Must satisfy NFR-1 latency requirement')).toBe(true);
  });

  it('returns false for regular prose', () => {
    expect(isVerbatimSection('Introduction', 'This is a regular paragraph.')).toBe(false);
  });
});

// ─── Prose Summarization ─────────────────────────────────────────────────────

describe('summarizeProseSection', () => {
  it('returns short content unchanged', () => {
    const short = 'This is a brief section.';
    expect(summarizeProseSection(short)).toBe(short);
  });

  it('truncates long content', () => {
    const long = 'A'.repeat(1000);
    const result = summarizeProseSection(long, 200);
    expect(result.length).toBeLessThan(300);
    expect(result).toContain('[Summarized');
  });

  it('preserves bullet points in summarized content', () => {
    const content = 'Introduction paragraph.\n\n- Point one\n- Point two\n- Point three\n\n' + 'A'.repeat(1000);
    const result = summarizeProseSection(content, 300);
    expect(result).toContain('Point one');
  });
});

// ─── PHASE_CONTEXT Map ───────────────────────────────────────────────────────

describe('PHASE_CONTEXT', () => {
  it('defines context files for phases 0-4', () => {
    expect(PHASE_CONTEXT).toHaveProperty('0');
    expect(PHASE_CONTEXT).toHaveProperty('1');
    expect(PHASE_CONTEXT).toHaveProperty('2');
    expect(PHASE_CONTEXT).toHaveProperty('3');
    expect(PHASE_CONTEXT).toHaveProperty('4');
  });

  it('Phase 4 requires the most context files', () => {
    expect(PHASE_CONTEXT[4].length).toBeGreaterThanOrEqual(PHASE_CONTEXT[1].length);
  });

  it('all phases include config and roadmap', () => {
    for (const phase of [0, 1, 2, 3, 4]) {
      expect(PHASE_CONTEXT[phase]).toContain('.jumpstart/config.yaml');
      expect(PHASE_CONTEXT[phase]).toContain('.jumpstart/roadmap.md');
    }
  });
});

// ─── Context Packet Generation ───────────────────────────────────────────────

describe('generateContextPacket', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-ctx-'));
    fs.mkdirSync(path.join(tmpDir, '.jumpstart'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'specs', 'decisions'), { recursive: true });

    // Create minimal config
    fs.writeFileSync(
      path.join(tmpDir, '.jumpstart', 'config.yaml'),
      'project:\n  name: test\n  type: greenfield\n',
      'utf8'
    );

    // Create minimal roadmap
    fs.writeFileSync(
      path.join(tmpDir, '.jumpstart', 'roadmap.md'),
      '# Roadmap\n\n## Article I\n\nLibrary-first architecture.\n',
      'utf8'
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates a packet for Phase 1 with minimal files', () => {
    // Phase 1 needs: config, roadmap, challenger-brief
    fs.writeFileSync(
      path.join(tmpDir, 'specs', 'challenger-brief.md'),
      '---\nid: test\n---\n# Challenger Brief\n\n## Problem Statement\n\nSome problem.\n',
      'utf8'
    );

    const packet = generateContextPacket({ target_phase: 1, root: tmpDir });
    expect(packet.phase).toBe(1);
    expect(packet.files_summarized).toBeGreaterThanOrEqual(2);
    expect(packet.summaries).toBeDefined();
    expect(Array.isArray(packet.open_items)).toBe(true);
  });

  it('preserves [NEEDS CLARIFICATION] tags in packet', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'specs', 'challenger-brief.md'),
      '# Brief\n\n[NEEDS CLARIFICATION: Target market unclear]\n\nSome content.\n',
      'utf8'
    );

    const packet = generateContextPacket({ target_phase: 1, root: tmpDir });
    expect(packet.open_items.length).toBe(1);
    expect(packet.open_items[0].tag).toContain('Target market');
  });

  it('returns error for invalid phase', () => {
    const packet = generateContextPacket({ target_phase: 99, root: tmpDir });
    expect(packet.error).toBeDefined();
    expect(packet.files_summarized).toBe(0);
  });

  it('handles missing upstream artifacts gracefully', () => {
    // Phase 4 requires many files, most won't exist
    const packet = generateContextPacket({ target_phase: 4, root: tmpDir });
    expect(packet.phase).toBe(4);
    // Should still return a valid packet with available files
    expect(packet.files_summarized).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(packet.full_artifact_links)).toBe(true);
  });

  it('includes ADRs for phase >= 3', () => {
    // Create an ADR
    fs.writeFileSync(
      path.join(tmpDir, 'specs', 'decisions', 'ADR-001.md'),
      '---\nstatus: accepted\n---\n# ADR-001: Use React\n\n## Decision\n\nWe will use React.\n',
      'utf8'
    );

    const packet = generateContextPacket({ target_phase: 3, root: tmpDir });
    const adrFiles = packet.full_artifact_links.filter(l => l.path.includes('decisions'));
    expect(adrFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('reports compression ratios', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'specs', 'challenger-brief.md'),
      '# Brief\n\n## Problem\n\n' + 'Long content. '.repeat(200) + '\n',
      'utf8'
    );

    const packet = generateContextPacket({ target_phase: 1, root: tmpDir });
    expect(packet.overall_compression).toBeDefined();
    expect(typeof packet.overall_compression).toBe('number');
  });
});

// ─── Markdown Rendering ──────────────────────────────────────────────────────

describe('renderContextMarkdown', () => {
  it('renders a packet with user stories as markdown table', () => {
    const packet = {
      phase: 3,
      phase_name: 'Architect',
      files_summarized: 2,
      total_original_chars: 5000,
      total_summary_chars: 2000,
      overall_compression: 60,
      summaries: [{
        file: 'specs/prd.md',
        frontmatter: {},
        original_chars: 3000,
        summary_chars: 1500,
        compression_ratio: 50,
        sections: [{ level: 2, heading: 'Overview', content: 'Test content.', summarized: true }],
        structured_data: {
          user_stories: [{ id: 'E01-S01', title: 'Create account', acceptance_criteria: ['Given a user'] }],
          nfrs: [{ id: 'NFR-1', title: 'Latency', metric: '200ms' }],
          tech_stack: [],
          components: [],
          tasks: []
        },
        clarifications: []
      }],
      open_items: [],
      full_artifact_links: [{ path: 'specs/prd.md', exists: true }]
    };

    const md = renderContextMarkdown(packet);
    expect(md).toContain('Phase 3 Context Summary');
    expect(md).toContain('E01-S01');
    expect(md).toContain('Create account');
    expect(md).toContain('NFR-1');
    expect(md).toContain('200ms');
    expect(md).toContain('Full Artifact Links');
  });

  it('renders open items when present', () => {
    const packet = {
      phase: 2,
      phase_name: 'PM',
      files_summarized: 1,
      total_original_chars: 1000,
      total_summary_chars: 500,
      overall_compression: 50,
      summaries: [{
        file: 'specs/product-brief.md',
        frontmatter: {},
        original_chars: 1000,
        summary_chars: 500,
        compression_ratio: 50,
        sections: [],
        structured_data: { user_stories: [], nfrs: [], tech_stack: [], components: [], tasks: [] },
        clarifications: ['[NEEDS CLARIFICATION: Target market]']
      }],
      open_items: [{ tag: '[NEEDS CLARIFICATION: Target market]', source: 'specs/product-brief.md' }],
      full_artifact_links: [{ path: 'specs/product-brief.md', exists: true }]
    };

    const md = renderContextMarkdown(packet);
    expect(md).toContain('Open Items');
    expect(md).toContain('Target market');
  });
});

// ─── Single Artifact Summarization ───────────────────────────────────────────

describe('summarizeArtifact', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-artifact-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for non-existent file', () => {
    const result = summarizeArtifact(path.join(tmpDir, 'nonexistent.md'), 'nonexistent.md');
    expect(result).toBeNull();
  });

  it('extracts structured data from a PRD-like artifact', () => {
    const prdContent = `---
id: test-prd
phase: 2
---

# PRD

## Product Overview

This is the product overview section.

#### E01-S01: User Registration

**Priority:** must-have

- Given a new visitor
- When they complete the registration form
- Then an account is created

### NFR-1: Performance

API response time must be under 200ms for 95th percentile.

### NFR-2: Availability

System uptime must be at least 99.9%.
`;
    const filePath = path.join(tmpDir, 'prd.md');
    fs.writeFileSync(filePath, prdContent, 'utf8');

    const result = summarizeArtifact(filePath, 'specs/prd.md');
    expect(result).not.toBeNull();
    expect(result.file).toBe('specs/prd.md');
    expect(result.frontmatter.id).toBe('test-prd');
    expect(result.structured_data.user_stories.length).toBe(1);
    expect(result.structured_data.user_stories[0].id).toBe('E01-S01');
    expect(result.structured_data.nfrs.length).toBe(2);
    expect(result.structured_data.nfrs[0].metric).toContain('200ms');
    expect(result.original_chars).toBeGreaterThan(0);
  });
});
