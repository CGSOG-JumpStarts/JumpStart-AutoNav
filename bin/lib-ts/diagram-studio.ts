/**
 * diagram-studio.ts — Diagram Studio port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/diagram-studio.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `DIAGRAM_TYPES` (constant array)
 *   - `DIAGRAM_TEMPLATES` (constant map)
 *   - `generateDiagram(type, options?)` => GenerateResult
 *   - `validateDiagram(content, options?)` => ValidateResult
 *   - `compareDiagrams(a, b, options?)` => CompareResult
 *   - `listDiagramTypes()` => ListResult
 *
 * Behavior parity:
 *   - Preserves the exact mermaid templates from legacy.
 *   - Bracket balance check + fence detection identical to legacy.
 *
 * @see bin/lib/diagram-studio.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

export type DiagramType =
  | 'c4-context'
  | 'c4-container'
  | 'c4-component'
  | 'sequence'
  | 'data-flow'
  | 'deployment'
  | 'bpmn'
  | 'erd';

export interface DiagramOptions {
  [key: string]: unknown;
}

export interface GenerateResult {
  success: boolean;
  type?: string;
  content?: string;
  editable?: boolean;
  generated_at?: string;
  error?: string;
}

export interface ValidationIssue {
  type: string;
  message: string;
}

export interface ValidateResult {
  success: boolean;
  valid?: boolean;
  issues?: ValidationIssue[];
  diagram_type?: string;
  error?: string;
}

export interface CompareResult {
  success: boolean;
  added?: string[];
  removed?: string[];
  unchanged?: string[];
  has_changes?: boolean;
  error?: string;
}

export interface ListResult {
  success: boolean;
  types: string[];
  templates_available: string[];
}

export const DIAGRAM_TYPES: DiagramType[] = [
  'c4-context',
  'c4-container',
  'c4-component',
  'sequence',
  'data-flow',
  'deployment',
  'bpmn',
  'erd',
];

export const DIAGRAM_TEMPLATES: Record<string, string> = {
  'c4-context':
    '```mermaid\nC4Context\n  title System Context Diagram\n  Person(user, "User")\n  System(system, "System")\n  Rel(user, system, "Uses")\n```',
  'c4-container':
    '```mermaid\nC4Container\n  title Container Diagram\n  Container(api, "API", "Node.js")\n  ContainerDb(db, "Database", "PostgreSQL")\n  Rel(api, db, "Reads/Writes")\n```',
  sequence:
    '```mermaid\nsequenceDiagram\n  participant Client\n  participant Server\n  Client->>Server: Request\n  Server-->>Client: Response\n```',
  'data-flow': '```mermaid\nflowchart LR\n  A[Input] --> B[Process]\n  B --> C[Output]\n```',
  deployment:
    '```mermaid\nflowchart TB\n  subgraph Cloud\n    LB[Load Balancer]\n    APP[App Server]\n    DB[(Database)]\n  end\n  LB --> APP --> DB\n```',
};

/**
 * Generate a diagram template.
 */
export function generateDiagram(type: string, _options: DiagramOptions = {}): GenerateResult {
  if (!DIAGRAM_TYPES.includes(type as DiagramType)) {
    return {
      success: false,
      error: `Unknown type: ${type}. Valid: ${DIAGRAM_TYPES.join(', ')}`,
    };
  }

  const template =
    DIAGRAM_TEMPLATES[type] || `\`\`\`mermaid\nflowchart LR\n  A[${type}] --> B[TODO]\n\`\`\``;

  return {
    success: true,
    type,
    content: template,
    editable: true,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Validate a mermaid diagram string.
 */
export function validateDiagram(content: string, _options: DiagramOptions = {}): ValidateResult {
  if (!content) return { success: false, error: 'Diagram content is required' };

  const issues: ValidationIssue[] = [];

  const hasFence = content.includes('```mermaid');
  if (!hasFence && !content.match(/^(graph|flowchart|sequenceDiagram|classDiagram|C4)/m)) {
    issues.push({ type: 'syntax', message: 'No recognized Mermaid diagram type found' });
  }

  const open = (content.match(/[[{(]/g) || []).length;
  const close = (content.match(/[\]})]/g) || []).length;
  if (open !== close) {
    issues.push({ type: 'syntax', message: `Unbalanced brackets: ${open} open, ${close} close` });
  }

  if (content.match(/\[\s*\]/)) {
    issues.push({ type: 'warning', message: 'Empty node labels detected' });
  }

  return {
    success: true,
    valid: issues.length === 0,
    issues,
    diagram_type: hasFence ? 'mermaid-fenced' : 'mermaid-raw',
  };
}

/**
 * Compare two diagrams.
 */
export function compareDiagrams(
  diagramA: string,
  diagramB: string,
  _options: DiagramOptions = {}
): CompareResult {
  if (!diagramA || !diagramB) return { success: false, error: 'Both diagrams are required' };

  const nodesA = new Set((diagramA.match(/\w+[[({]/g) || []).map((n) => n.slice(0, -1)));
  const nodesB = new Set((diagramB.match(/\w+[[({]/g) || []).map((n) => n.slice(0, -1)));

  const added = [...nodesB].filter((n) => !nodesA.has(n));
  const removed = [...nodesA].filter((n) => !nodesB.has(n));
  const unchanged = [...nodesA].filter((n) => nodesB.has(n));

  return {
    success: true,
    added,
    removed,
    unchanged,
    has_changes: added.length > 0 || removed.length > 0,
  };
}

/**
 * List available diagram types.
 */
export function listDiagramTypes(): ListResult {
  return {
    success: true,
    types: DIAGRAM_TYPES,
    templates_available: Object.keys(DIAGRAM_TEMPLATES),
  };
}
