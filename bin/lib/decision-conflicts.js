/**
 * decision-conflicts.js — Decision Conflict Detection
 *
 * Detect when ADRs, PRD decisions, architecture docs, and code
 * choices contradict one another.
 *
 * Usage:
 *   node bin/lib/decision-conflicts.js detect|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CONFLICT_TYPES = ['technology', 'pattern', 'constraint', 'requirement', 'terminology'];

/**
 * Extract decisions from ADR files.
 * @param {string} decisionsDir - Path to specs/decisions/.
 * @returns {object[]}
 */
function extractADRDecisions(decisionsDir) {
  const decisions = [];

  if (!fs.existsSync(decisionsDir)) return decisions;

  const files = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(decisionsDir, file), 'utf8');
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const statusMatch = content.match(/\*\*Status[:\s]*\*?\*?\s*(.+)/i) || content.match(/Status[:\s]+(.+)/i);
    const decisionMatch = content.match(/##\s+Decision\s*\n([\s\S]*?)(?=\n##|\n$|$)/i);

    decisions.push({
      source: `specs/decisions/${file}`,
      type: 'adr',
      title: titleMatch ? titleMatch[1].trim() : file,
      status: statusMatch ? statusMatch[1].trim().toLowerCase() : 'unknown',
      decision_text: decisionMatch ? decisionMatch[1].trim() : '',
      technologies: extractTechReferences(content),
      patterns: extractPatternReferences(content)
    });
  }

  return decisions;
}

/**
 * Extract decisions from architecture doc.
 * @param {string} archPath
 * @returns {object[]}
 */
function extractArchDecisions(archPath) {
  if (!fs.existsSync(archPath)) return [];

  const content = fs.readFileSync(archPath, 'utf8');
  const decisions = [];
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
      patterns: extractPatternReferences(sectionContent)
    });
  }

  return decisions;
}

/**
 * Extract decisions from PRD.
 * @param {string} prdPath
 * @returns {object[]}
 */
function extractPRDDecisions(prdPath) {
  if (!fs.existsSync(prdPath)) return [];

  const content = fs.readFileSync(prdPath, 'utf8');
  const decisions = [];

  // Extract NFRs and constraints
  const nfrSection = content.match(/##\s+(?:Non-Functional|NFR|Constraints).*?\n([\s\S]*?)(?=\n##|\n$|$)/i);
  if (nfrSection) {
    decisions.push({
      source: 'specs/prd.md',
      type: 'prd',
      title: 'Non-Functional Requirements',
      decision_text: nfrSection[1].trim().slice(0, 500),
      technologies: extractTechReferences(nfrSection[1]),
      patterns: extractPatternReferences(nfrSection[1])
    });
  }

  // Extract technology decisions mentioned in PRD
  const techSection = content.match(/##\s+(?:Tech|Technology|Stack|Technical).*?\n([\s\S]*?)(?=\n##|\n$|$)/i);
  if (techSection) {
    decisions.push({
      source: 'specs/prd.md',
      type: 'prd',
      title: 'Technology Decisions',
      decision_text: techSection[1].trim().slice(0, 500),
      technologies: extractTechReferences(techSection[1]),
      patterns: extractPatternReferences(techSection[1])
    });
  }

  return decisions;
}

/**
 * Extract technology references from text.
 * @param {string} text
 * @returns {string[]}
 */
function extractTechReferences(text) {
  const techTerms = [
    'react', 'vue', 'angular', 'svelte', 'next\\.js', 'nuxt',
    'express', 'fastify', 'koa', 'hapi', 'nestjs',
    'postgresql', 'mysql', 'mongodb', 'redis', 'sqlite', 'dynamodb',
    'docker', 'kubernetes', 'aws', 'azure', 'gcp',
    'graphql', 'rest', 'grpc', 'websocket',
    'typescript', 'javascript', 'python', 'go', 'rust', 'java',
    'kafka', 'rabbitmq', 'sqs', 'nats',
    'openai', 'langchain', 'pinecone', 'chromadb'
  ];

  const found = [];
  for (const tech of techTerms) {
    const pattern = new RegExp(`\\b${tech}\\b`, 'gi');
    if (pattern.test(text)) {
      found.push(tech.replace(/\\\./g, '.'));
    }
  }
  return [...new Set(found)];
}

/**
 * Extract architectural pattern references from text.
 * @param {string} text
 * @returns {string[]}
 */
function extractPatternReferences(text) {
  const patternTerms = [
    'microservice', 'monolith', 'serverless', 'event-driven', 'event sourcing',
    'cqrs', 'saga', 'domain-driven', 'hexagonal', 'clean architecture',
    'mvc', 'mvvm', 'repository pattern', 'factory', 'singleton',
    'pub-sub', 'message queue', 'circuit breaker', 'api gateway',
    'rag', 'agent', 'multi-agent'
  ];

  const found = [];
  for (const pattern of patternTerms) {
    const regex = new RegExp(`\\b${pattern}s?\\b`, 'gi');
    if (regex.test(text)) {
      found.push(pattern);
    }
  }
  return [...new Set(found)];
}

/**
 * Detect conflicts between decisions.
 *
 * @param {object[]} decisions - Array of extracted decisions.
 * @returns {object[]}
 */
function findConflicts(decisions) {
  const conflicts = [];

  // Technology conflicts: same category but different choices
  const techBySource = {};
  for (const d of decisions) {
    for (const tech of d.technologies) {
      if (!techBySource[tech]) techBySource[tech] = [];
      techBySource[tech].push(d);
    }
  }

  // Check for competing technologies in the same category
  const competing = {
    frontend: ['react', 'vue', 'angular', 'svelte'],
    backend: ['express', 'fastify', 'koa', 'hapi', 'nestjs'],
    database: ['postgresql', 'mysql', 'mongodb', 'sqlite', 'dynamodb'],
    messaging: ['kafka', 'rabbitmq', 'sqs', 'nats'],
    cloud: ['aws', 'azure', 'gcp']
  };

  for (const [category, techs] of Object.entries(competing)) {
    const usedTechs = techs.filter(t => techBySource[t]);
    if (usedTechs.length > 1) {
      const sources = usedTechs.flatMap(t => techBySource[t].map(d => d.source));
      conflicts.push({
        type: 'technology',
        category,
        description: `Competing ${category} technologies referenced: ${usedTechs.join(', ')}`,
        technologies: usedTechs,
        sources: [...new Set(sources)],
        severity: 'warning'
      });
    }
  }

  // Pattern conflicts: contradictory patterns
  const patternBySource = {};
  for (const d of decisions) {
    for (const pattern of d.patterns) {
      if (!patternBySource[pattern]) patternBySource[pattern] = [];
      patternBySource[pattern].push(d);
    }
  }

  const contradictory = [
    ['microservice', 'monolith'],
    ['event sourcing', 'cqrs'],
    ['serverless', 'kubernetes']
  ];

  for (const [p1, p2] of contradictory) {
    if (patternBySource[p1] && patternBySource[p2]) {
      const sources = [
        ...patternBySource[p1].map(d => d.source),
        ...patternBySource[p2].map(d => d.source)
      ];
      conflicts.push({
        type: 'pattern',
        description: `Potentially contradictory patterns: "${p1}" and "${p2}"`,
        patterns: [p1, p2],
        sources: [...new Set(sources)],
        severity: 'warning'
      });
    }
  }

  return conflicts;
}

/**
 * Detect decision conflicts across all project artifacts.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function detectConflicts(root, options = {}) {
  const decisions = [];

  // Collect decisions from all sources
  const decisionsDir = path.join(root, 'specs', 'decisions');
  decisions.push(...extractADRDecisions(decisionsDir));

  const archPath = path.join(root, 'specs', 'architecture.md');
  decisions.push(...extractArchDecisions(archPath));

  const prdPath = path.join(root, 'specs', 'prd.md');
  decisions.push(...extractPRDDecisions(prdPath));

  if (decisions.length === 0) {
    return { success: true, conflicts: [], message: 'No decisions found to analyze' };
  }

  const conflicts = findConflicts(decisions);

  return {
    success: true,
    total_decisions: decisions.length,
    decisions_by_source: {
      adr: decisions.filter(d => d.type === 'adr').length,
      architecture: decisions.filter(d => d.type === 'architecture').length,
      prd: decisions.filter(d => d.type === 'prd').length
    },
    conflicts,
    summary: {
      total_conflicts: conflicts.length,
      technology_conflicts: conflicts.filter(c => c.type === 'technology').length,
      pattern_conflicts: conflicts.filter(c => c.type === 'pattern').length,
      has_conflicts: conflicts.length > 0
    }
  };
}

module.exports = {
  extractADRDecisions,
  extractArchDecisions,
  extractPRDDecisions,
  extractTechReferences,
  extractPatternReferences,
  findConflicts,
  detectConflicts,
  CONFLICT_TYPES
};
