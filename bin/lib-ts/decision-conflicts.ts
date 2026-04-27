/**
 * decision-conflicts.ts — Decision Conflict Detection port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/decision-conflicts.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `CONFLICT_TYPES` (constant array)
 *   - `extractADRDecisions(decisionsDir)` => Decision[]
 *   - `extractArchDecisions(archPath)` => Decision[]
 *   - `extractPRDDecisions(prdPath)` => Decision[]
 *   - `extractTechReferences(text)` => string[]
 *   - `extractPatternReferences(text)` => string[]
 *   - `findConflicts(decisions)` => Conflict[]
 *   - `detectConflicts(root, options?)` => DetectResult
 *
 * Behavior parity:
 *   - Reads `specs/decisions/*.md`, `specs/architecture.md`, `specs/prd.md`.
 *   - Tech & pattern dictionaries identical to legacy.
 *   - Competing tech categories: frontend/backend/database/messaging/cloud.
 *   - Contradictory pattern pairs: monolith↔microservice, event sourcing↔cqrs,
 *     serverless↔kubernetes.
 *   - CLI entry-point intentionally omitted.
 *
 * @see bin/lib/decision-conflicts.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ConflictType = 'technology' | 'pattern' | 'constraint' | 'requirement' | 'terminology';

export interface Decision {
  source: string;
  type: 'adr' | 'architecture' | 'prd';
  title: string;
  status?: string;
  decision_text: string;
  technologies: string[];
  patterns: string[];
}

export interface Conflict {
  type: ConflictType;
  category?: string;
  description: string;
  technologies?: string[];
  patterns?: string[];
  sources: string[];
  severity: string;
}

export interface DetectOptions {
  [key: string]: unknown;
}

export interface DetectResult {
  success: boolean;
  conflicts: Conflict[];
  message?: string;
  total_decisions?: number;
  decisions_by_source?: {
    adr: number;
    architecture: number;
    prd: number;
  };
  summary?: {
    total_conflicts: number;
    technology_conflicts: number;
    pattern_conflicts: number;
    has_conflicts: boolean;
  };
}

export const CONFLICT_TYPES: ConflictType[] = [
  'technology',
  'pattern',
  'constraint',
  'requirement',
  'terminology',
];

const TECH_TERMS: string[] = [
  'react',
  'vue',
  'angular',
  'svelte',
  'next\\.js',
  'nuxt',
  'express',
  'fastify',
  'koa',
  'hapi',
  'nestjs',
  'postgresql',
  'mysql',
  'mongodb',
  'redis',
  'sqlite',
  'dynamodb',
  'docker',
  'kubernetes',
  'aws',
  'azure',
  'gcp',
  'graphql',
  'rest',
  'grpc',
  'websocket',
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
  'kafka',
  'rabbitmq',
  'sqs',
  'nats',
  'openai',
  'langchain',
  'pinecone',
  'chromadb',
];

const PATTERN_TERMS: string[] = [
  'microservice',
  'monolith',
  'serverless',
  'event-driven',
  'event sourcing',
  'cqrs',
  'saga',
  'domain-driven',
  'hexagonal',
  'clean architecture',
  'mvc',
  'mvvm',
  'repository pattern',
  'factory',
  'singleton',
  'pub-sub',
  'message queue',
  'circuit breaker',
  'api gateway',
  'rag',
  'agent',
  'multi-agent',
];

/**
 * Extract decisions from ADR files.
 */
export function extractADRDecisions(decisionsDir: string): Decision[] {
  const decisions: Decision[] = [];
  if (!existsSync(decisionsDir)) return decisions;

  const files = readdirSync(decisionsDir).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const content = readFileSync(join(decisionsDir, file), 'utf8');
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const statusMatch =
      content.match(/\*\*Status[:\s]*\*?\*?\s*(.+)/i) || content.match(/Status[:\s]+(.+)/i);
    const decisionMatch = content.match(/##\s+Decision\s*\n([\s\S]*?)(?=\n##|\n$|$)/i);

    decisions.push({
      source: `specs/decisions/${file}`,
      type: 'adr',
      title: titleMatch ? titleMatch[1].trim() : file,
      status: statusMatch ? statusMatch[1].trim().toLowerCase() : 'unknown',
      decision_text: decisionMatch ? decisionMatch[1].trim() : '',
      technologies: extractTechReferences(content),
      patterns: extractPatternReferences(content),
    });
  }

  return decisions;
}

/**
 * Extract decisions from architecture doc.
 */
export function extractArchDecisions(archPath: string): Decision[] {
  if (!existsSync(archPath)) return [];

  const content = readFileSync(archPath, 'utf8');
  const decisions: Decision[] = [];
  const sections = content.split(/^##\s+/m);

  for (const section of sections) {
    if (section.trim().length === 0) continue;
    const titleLine = section.split('\n')[0].trim();
    const sectionContent = section.split('\n').slice(1).join('\n');

    decisions.push({
      source: 'specs/architecture.md',
      type: 'architecture',
      title: titleLine,
      decision_text: sectionContent.trim().slice(0, 500),
      technologies: extractTechReferences(sectionContent),
      patterns: extractPatternReferences(sectionContent),
    });
  }

  return decisions;
}

/**
 * Extract decisions from PRD.
 */
export function extractPRDDecisions(prdPath: string): Decision[] {
  if (!existsSync(prdPath)) return [];

  const content = readFileSync(prdPath, 'utf8');
  const decisions: Decision[] = [];

  const nfrSection = content.match(
    /##\s+(?:Non-Functional|NFR|Constraints).*?\n([\s\S]*?)(?=\n##|\n$|$)/i
  );
  if (nfrSection) {
    decisions.push({
      source: 'specs/prd.md',
      type: 'prd',
      title: 'Non-Functional Requirements',
      decision_text: nfrSection[1].trim().slice(0, 500),
      technologies: extractTechReferences(nfrSection[1]),
      patterns: extractPatternReferences(nfrSection[1]),
    });
  }

  const techSection = content.match(
    /##\s+(?:Tech|Technology|Stack|Technical).*?\n([\s\S]*?)(?=\n##|\n$|$)/i
  );
  if (techSection) {
    decisions.push({
      source: 'specs/prd.md',
      type: 'prd',
      title: 'Technology Decisions',
      decision_text: techSection[1].trim().slice(0, 500),
      technologies: extractTechReferences(techSection[1]),
      patterns: extractPatternReferences(techSection[1]),
    });
  }

  return decisions;
}

/**
 * Extract technology references from text.
 */
export function extractTechReferences(text: string): string[] {
  const found: string[] = [];
  for (const tech of TECH_TERMS) {
    const pattern = new RegExp(`\\b${tech}\\b`, 'gi');
    if (pattern.test(text)) {
      found.push(tech.replace(/\\\./g, '.'));
    }
  }
  return [...new Set(found)];
}

/**
 * Extract architectural pattern references from text.
 */
export function extractPatternReferences(text: string): string[] {
  const found: string[] = [];
  for (const pattern of PATTERN_TERMS) {
    const regex = new RegExp(`\\b${pattern}s?\\b`, 'gi');
    if (regex.test(text)) {
      found.push(pattern);
    }
  }
  return [...new Set(found)];
}

/**
 * Detect conflicts between decisions.
 */
export function findConflicts(decisions: Decision[]): Conflict[] {
  const conflicts: Conflict[] = [];

  const techBySource: Record<string, Decision[]> = {};
  for (const d of decisions) {
    for (const tech of d.technologies) {
      if (!techBySource[tech]) techBySource[tech] = [];
      techBySource[tech].push(d);
    }
  }

  const competing: Record<string, string[]> = {
    frontend: ['react', 'vue', 'angular', 'svelte'],
    backend: ['express', 'fastify', 'koa', 'hapi', 'nestjs'],
    database: ['postgresql', 'mysql', 'mongodb', 'sqlite', 'dynamodb'],
    messaging: ['kafka', 'rabbitmq', 'sqs', 'nats'],
    cloud: ['aws', 'azure', 'gcp'],
  };

  for (const [category, techs] of Object.entries(competing)) {
    const usedTechs = techs.filter((t) => techBySource[t]);
    if (usedTechs.length > 1) {
      const sources = usedTechs.flatMap((t) => techBySource[t].map((d) => d.source));
      conflicts.push({
        type: 'technology',
        category,
        description: `Competing ${category} technologies referenced: ${usedTechs.join(', ')}`,
        technologies: usedTechs,
        sources: [...new Set(sources)],
        severity: 'warning',
      });
    }
  }

  const patternBySource: Record<string, Decision[]> = {};
  for (const d of decisions) {
    for (const pattern of d.patterns) {
      if (!patternBySource[pattern]) patternBySource[pattern] = [];
      patternBySource[pattern].push(d);
    }
  }

  const contradictory: Array<[string, string]> = [
    ['microservice', 'monolith'],
    ['event sourcing', 'cqrs'],
    ['serverless', 'kubernetes'],
  ];

  for (const [p1, p2] of contradictory) {
    if (patternBySource[p1] && patternBySource[p2]) {
      const sources = [
        ...patternBySource[p1].map((d) => d.source),
        ...patternBySource[p2].map((d) => d.source),
      ];
      conflicts.push({
        type: 'pattern',
        description: `Potentially contradictory patterns: "${p1}" and "${p2}"`,
        patterns: [p1, p2],
        sources: [...new Set(sources)],
        severity: 'warning',
      });
    }
  }

  return conflicts;
}

/**
 * Detect decision conflicts across all project artifacts.
 */
export function detectConflicts(root: string, _options: DetectOptions = {}): DetectResult {
  const decisions: Decision[] = [];

  const decisionsDir = join(root, 'specs', 'decisions');
  decisions.push(...extractADRDecisions(decisionsDir));

  const archPath = join(root, 'specs', 'architecture.md');
  decisions.push(...extractArchDecisions(archPath));

  const prdPath = join(root, 'specs', 'prd.md');
  decisions.push(...extractPRDDecisions(prdPath));

  if (decisions.length === 0) {
    return { success: true, conflicts: [], message: 'No decisions found to analyze' };
  }

  const conflicts = findConflicts(decisions);

  return {
    success: true,
    total_decisions: decisions.length,
    decisions_by_source: {
      adr: decisions.filter((d) => d.type === 'adr').length,
      architecture: decisions.filter((d) => d.type === 'architecture').length,
      prd: decisions.filter((d) => d.type === 'prd').length,
    },
    conflicts,
    summary: {
      total_conflicts: conflicts.length,
      technology_conflicts: conflicts.filter((c) => c.type === 'technology').length,
      pattern_conflicts: conflicts.filter((c) => c.type === 'pattern').length,
      has_conflicts: conflicts.length > 0,
    },
  };
}
