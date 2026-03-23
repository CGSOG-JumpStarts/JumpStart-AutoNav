/**
 * diagram-studio.js — Diagram Studio (Item 70)
 *
 * Generate, validate, compare, and refine C4, BPMN, sequence,
 * data flow, and deployment diagrams.
 *
 * Usage:
 *   node bin/lib/diagram-studio.js generate|validate|compare|list [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DIAGRAM_TYPES = ['c4-context', 'c4-container', 'c4-component', 'sequence', 'data-flow', 'deployment', 'bpmn', 'erd'];

const DIAGRAM_TEMPLATES = {
  'c4-context': '```mermaid\nC4Context\n  title System Context Diagram\n  Person(user, "User")\n  System(system, "System")\n  Rel(user, system, "Uses")\n```',
  'c4-container': '```mermaid\nC4Container\n  title Container Diagram\n  Container(api, "API", "Node.js")\n  ContainerDb(db, "Database", "PostgreSQL")\n  Rel(api, db, "Reads/Writes")\n```',
  'sequence': '```mermaid\nsequenceDiagram\n  participant Client\n  participant Server\n  Client->>Server: Request\n  Server-->>Client: Response\n```',
  'data-flow': '```mermaid\nflowchart LR\n  A[Input] --> B[Process]\n  B --> C[Output]\n```',
  'deployment': '```mermaid\nflowchart TB\n  subgraph Cloud\n    LB[Load Balancer]\n    APP[App Server]\n    DB[(Database)]\n  end\n  LB --> APP --> DB\n```'
};

/**
 * Generate a diagram template.
 */
function generateDiagram(type, options = {}) {
  if (!DIAGRAM_TYPES.includes(type)) {
    return { success: false, error: `Unknown type: ${type}. Valid: ${DIAGRAM_TYPES.join(', ')}` };
  }

  const template = DIAGRAM_TEMPLATES[type] || `\`\`\`mermaid\nflowchart LR\n  A[${type}] --> B[TODO]\n\`\`\``;
  
  return {
    success: true,
    type,
    content: template,
    editable: true,
    generated_at: new Date().toISOString()
  };
}

/**
 * Validate a mermaid diagram string.
 */
function validateDiagram(content, options = {}) {
  if (!content) return { success: false, error: 'Diagram content is required' };

  const issues = [];
  
  // Check for mermaid code block
  const hasFence = content.includes('```mermaid');
  if (!hasFence && !content.match(/^(graph|flowchart|sequenceDiagram|classDiagram|C4)/m)) {
    issues.push({ type: 'syntax', message: 'No recognized Mermaid diagram type found' });
  }

  // Check for balanced brackets
  const open = (content.match(/[\[{(]/g) || []).length;
  const close = (content.match(/[\]})]/g) || []).length;
  if (open !== close) {
    issues.push({ type: 'syntax', message: `Unbalanced brackets: ${open} open, ${close} close` });
  }

  // Check for empty nodes
  if (content.match(/\[\s*\]/)) {
    issues.push({ type: 'warning', message: 'Empty node labels detected' });
  }

  return {
    success: true,
    valid: issues.length === 0,
    issues,
    diagram_type: hasFence ? 'mermaid-fenced' : 'mermaid-raw'
  };
}

/**
 * Compare two diagrams.
 */
function compareDiagrams(diagramA, diagramB, options = {}) {
  if (!diagramA || !diagramB) return { success: false, error: 'Both diagrams are required' };

  const nodesA = new Set((diagramA.match(/\w+[\[({]/g) || []).map(n => n.slice(0, -1)));
  const nodesB = new Set((diagramB.match(/\w+[\[({]/g) || []).map(n => n.slice(0, -1)));

  const added = [...nodesB].filter(n => !nodesA.has(n));
  const removed = [...nodesA].filter(n => !nodesB.has(n));
  const unchanged = [...nodesA].filter(n => nodesB.has(n));

  return {
    success: true,
    added,
    removed,
    unchanged,
    has_changes: added.length > 0 || removed.length > 0
  };
}

/**
 * List available diagram types.
 */
function listDiagramTypes() {
  return {
    success: true,
    types: DIAGRAM_TYPES,
    templates_available: Object.keys(DIAGRAM_TEMPLATES)
  };
}

module.exports = {
  generateDiagram, validateDiagram, compareDiagrams, listDiagramTypes,
  DIAGRAM_TYPES, DIAGRAM_TEMPLATES
};
