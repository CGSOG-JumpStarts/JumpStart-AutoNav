/**
 * handoff-validator.ts — Layer 2 Handoff Contract Testing port (T4.6.x, M7).
 *
 * Pure-library port of `bin/lib/handoff-validator.js`. Public surface
 * preserved verbatim by name + signature shape:
 *
 *   - `extractHandoffPayload(artifactPath, targetPhase)` => HandoffPayload
 *   - `validateHandoff(payload, schemaName, handoffsDir?)` => ValidationOutcome
 *   - `checkPhantomRequirements(upstreamPayload, downstreamContent)` =>
 *       PhantomCheckResult
 *   - `generateHandoffReport(fromArtifactPath, fromPhase, toPhase, handoffsDir?)`
 *       => HandoffReport
 *
 * **Path-safety hardening (NEW in this port).**
 *   `validateHandoff` resolves `path.join(handoffsDir, schemaName)` from
 *   caller-supplied input. The schema name is reused by callers that
 *   construct it from runtime data (LLM tool args). Reject traversal-
 *   shaped names that would escape `handoffsDir`.
 *
 * **JSON shape validation.**
 *   The schema file loaded by `validateHandoff` may have been touched
 *   by an attacker on disk. Use the deep `safeParseJson` helper to
 *   reject `__proto__` / `constructor` / `prototype` keys recursively
 *   and reject non-object roots — mirrors the M6 install.ts pattern.
 *
 * **Deferred to M9 ESM cutover:**
 *   Legacy used `path.join(__dirname, '..', '..', '.jumpstart',
 *   'handoffs')` for the default handoffs dir. The TS port replaces
 *   `__dirname` with a `process.cwd()`-relative default so the module
 *   stays importable under ESM. Callers that need a different root
 *   pass `handoffsDir` explicitly.
 *
 * @see bin/lib/handoff-validator.js (legacy reference, 389L)
 * @see specs/decisions/adr-009-ipc-stdin-path-traversal.md
 * @see specs/implementation-plan.md T4.6.x
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { ValidationError } from './errors.js';
import { extractFrontmatter, validate } from './validator.js';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export type TargetPhase = 'architect' | 'dev' | 'developer' | 'qa';

export interface UserStory {
  id: string;
  title: string;
  acceptance_criteria: string[];
}

export interface FunctionalRequirement {
  id: string;
  description: string;
  priority: string;
  source_story?: string;
}

export interface NonFunctionalRequirement {
  id: string;
  category: string;
  description: string;
  metric: string;
}

export interface DomainContext {
  domain: string;
  problem_statement: string;
}

export interface PmToArchitectPayload {
  functional_requirements: FunctionalRequirement[];
  non_functional_requirements: NonFunctionalRequirement[];
  user_stories: UserStory[];
  constraints: Record<string, unknown>;
  domain_context: DomainContext;
}

export interface TechStackEntry {
  name: string;
  version: string;
}

export interface TechnologyStack {
  runtime: TechStackEntry;
  framework: TechStackEntry;
  database?: TechStackEntry;
}

export interface ComponentDescriptor {
  name: string;
  purpose: string;
  interface: string;
}

export interface TaskListEntry {
  id: string;
  title: string;
  milestone: string;
}

export interface DeploymentStrategy {
  environment: string;
}

export interface ArchitectToDevPayload {
  technology_stack: TechnologyStack;
  components: ComponentDescriptor[];
  data_model: { entities: unknown[]; relationships: unknown[] };
  task_list: TaskListEntry[];
  deployment_strategy: DeploymentStrategy;
}

export interface ImplementedTask {
  id: string;
  status: string;
  files_changed: string[];
}

export interface DevToQaPayload {
  implemented_tasks: ImplementedTask[];
  test_coverage: { unit_tests: number; coverage_pct: number };
  known_issues: unknown[];
  build_artifacts: { build_command: string; output_dir: string };
  environment_setup: { prerequisites: string[]; setup_steps: string[] };
}

export type HandoffPayload = PmToArchitectPayload | ArchitectToDevPayload | DevToQaPayload;

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
}

export interface PhantomCheckResult {
  phantoms: string[];
  traced: string[];
}

export interface HandoffReport extends ValidationOutcome {
  transition?: string;
  schema?: string;
  payload_keys?: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────

/** Default handoffs schema directory, relative to `process.cwd()`. */
const HANDOFFS_DIR_DEFAULT = path.join(process.cwd(), '.jumpstart', 'handoffs');

// ─────────────────────────────────────────────────────────────────────────
// JSON shape validation — mirrors install.ts safeParseInstalled (M6)
// ─────────────────────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Recursively check that no key in the parsed JSON tree is one of
 * `__proto__` / `constructor` / `prototype`.
 */
function hasForbiddenKey(value: unknown): boolean {
  if (!isPlainObject(value)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (hasForbiddenKey(item)) return true;
      }
    }
    return false;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKey(value[key])) return true;
  }
  return false;
}

/**
 * Safely parse a JSON document into a plain object, rejecting prototype-
 * pollution keys and non-object roots.
 */
function safeParseJsonObject(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  if (hasForbiddenKey(parsed)) return null;
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────
// Payload Extraction
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extract a structured handoff payload from a spec artifact.
 */
export function extractHandoffPayload(
  artifactPath: string,
  targetPhase: TargetPhase | string
): HandoffPayload {
  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}`);
  }

  const content = readFileSync(artifactPath, 'utf8');
  const frontmatter = extractFrontmatter(content) ?? {};

  if (targetPhase === 'architect') {
    return extractPmToArchitect(content, frontmatter);
  }
  if (targetPhase === 'dev' || targetPhase === 'developer') {
    return extractArchitectToDev(content, frontmatter);
  }
  if (targetPhase === 'qa') {
    return extractDevToQa(content, frontmatter);
  }

  throw new Error(`Unknown target phase: ${targetPhase}`);
}

function extractPmToArchitect(
  content: string,
  frontmatter: Record<string, unknown>
): PmToArchitectPayload {
  const payload: PmToArchitectPayload = {
    functional_requirements: [],
    non_functional_requirements: [],
    user_stories: [],
    constraints: {},
    domain_context: {
      domain: typeof frontmatter.domain === 'string' ? frontmatter.domain : 'general',
      problem_statement: '',
    },
  };

  // Extract user stories (E##-S## patterns)
  const storyRegex = /####\s+(E\d+-S\d+):\s*(.+)/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec idiom
  while ((match = storyRegex.exec(content)) !== null) {
    const story: UserStory = {
      id: match[1],
      title: match[2].trim(),
      acceptance_criteria: [],
    };

    // Look for acceptance criteria after this story heading
    const storyStart = match.index + match[0].length;
    const nextStoryRegex = /####\s+E\d+-S\d+/g;
    nextStoryRegex.lastIndex = storyStart;
    const nextStory = nextStoryRegex.exec(content);
    const storySection = content.substring(
      storyStart,
      nextStory ? nextStory.index : storyStart + 2000
    );

    const criteriaMatches = storySection.match(/- (?:Given|When|Then|And).+/g);
    if (criteriaMatches) {
      story.acceptance_criteria = criteriaMatches.map((c) => c.replace(/^- /, '').trim());
    } else {
      story.acceptance_criteria = ['Acceptance criteria defined'];
    }

    payload.user_stories.push(story);
    payload.functional_requirements.push({
      id: story.id,
      description: story.title,
      priority: extractPriority(storySection) ?? 'must-have',
      source_story: story.id,
    });
  }

  // Extract NFRs
  const nfrRegex = /###\s+NFR-(\d+):\s*(.+)/g;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec idiom
  while ((match = nfrRegex.exec(content)) !== null) {
    const nfrStart = match.index + match[0].length;
    const nextSection = content.indexOf('\n### ', nfrStart);
    const nfrBody = content
      .substring(nfrStart, nextSection > 0 ? nextSection : nfrStart + 500)
      .trim();

    payload.non_functional_requirements.push({
      id: `NFR-${match[1]}`,
      category: inferNfrCategory(match[2]),
      description: match[2].trim(),
      metric: extractMetric(nfrBody) ?? 'To be defined',
    });
  }

  // Extract problem statement from Product Overview
  const overviewMatch = content.match(/## Product Overview\s*\n([\s\S]*?)(?=\n## )/);
  if (overviewMatch) {
    payload.domain_context.problem_statement = overviewMatch[1].trim().substring(0, 500);
  }
  if (
    !payload.domain_context.problem_statement ||
    payload.domain_context.problem_statement.length < 20
  ) {
    payload.domain_context.problem_statement =
      'Problem statement extracted from upstream PRD document';
  }

  return payload;
}

function extractArchitectToDev(
  content: string,
  _frontmatter: Record<string, unknown>
): ArchitectToDevPayload {
  const payload: ArchitectToDevPayload = {
    technology_stack: {
      runtime: { name: 'unknown', version: 'unknown' },
      framework: { name: 'unknown', version: 'unknown' },
    },
    components: [],
    data_model: { entities: [], relationships: [] },
    task_list: [],
    deployment_strategy: { environment: 'unknown' },
  };

  // Extract tech stack from table
  const stackRows = content.match(/\|\s*(\w+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g) ?? [];
  for (const row of stackRows) {
    const cols = row
      .split('|')
      .filter((c) => c.trim())
      .map((c) => c.trim());
    if (cols.length >= 3) {
      const layer = cols[0].toLowerCase();
      if (layer === 'runtime') {
        payload.technology_stack.runtime = { name: cols[1], version: cols[2] };
      } else if (layer === 'framework') {
        payload.technology_stack.framework = { name: cols[1], version: cols[2] };
      } else if (layer === 'database') {
        payload.technology_stack.database = { name: cols[1], version: cols[2] };
      }
    }
  }

  // Extract components
  const compRegex = /### Component:\s*(.+)/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec idiom
  while ((match = compRegex.exec(content)) !== null) {
    const compStart = match.index + match[0].length;
    const nextComp = content.indexOf('\n### ', compStart);
    const compBody = content.substring(compStart, nextComp > 0 ? nextComp : compStart + 1000);

    const purposeMatch = compBody.match(/\*\*Purpose:\*\*\s*(.+)/);
    const interfaceMatch = compBody.match(/\*\*Interface:\*\*\s*(.+)/);

    payload.components.push({
      name: match[1].trim(),
      purpose: purposeMatch ? purposeMatch[1].trim() : 'Not specified',
      interface: interfaceMatch ? interfaceMatch[1].trim() : 'Not specified',
    });
  }

  // Extract tasks (M##-T## patterns)
  const taskRegex = /(M\d+-T\d+)\s*[:-]\s*(.+)/g;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec idiom
  while ((match = taskRegex.exec(content)) !== null) {
    payload.task_list.push({
      id: match[1],
      title: match[2].trim(),
      milestone: match[1].split('-')[0],
    });
  }

  // Extract deployment info
  const deployMatch = content.match(/## Deployment\s*\n([\s\S]*?)(?=\n## |$)/);
  if (deployMatch) {
    const body = deployMatch[1];
    const envMatch = body.match(/\*\*Environment:\*\*\s*(.+)/);
    payload.deployment_strategy.environment = envMatch ? envMatch[1].trim() : 'production';
  }

  return payload;
}

function extractDevToQa(content: string, _frontmatter: Record<string, unknown>): DevToQaPayload {
  const payload: DevToQaPayload = {
    implemented_tasks: [],
    test_coverage: { unit_tests: 0, coverage_pct: 0 },
    known_issues: [],
    build_artifacts: { build_command: 'npm run build', output_dir: 'dist' },
    environment_setup: {
      prerequisites: ['Node.js >= 14'],
      setup_steps: ['npm install', 'npm run build'],
    },
  };

  // Extract completed tasks
  const taskPattern = /\b(M\d+-T\d+)\b/g;
  const seenTasks = new Set<string>();
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec idiom
  while ((match = taskPattern.exec(content)) !== null) {
    if (!seenTasks.has(match[1])) {
      seenTasks.add(match[1]);
      payload.implemented_tasks.push({
        id: match[1],
        status: 'completed',
        files_changed: ['src/'],
      });
    }
  }

  if (payload.implemented_tasks.length === 0) {
    payload.implemented_tasks.push({
      id: 'M1-T01',
      status: 'completed',
      files_changed: ['src/index.js'],
    });
  }

  return payload;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validate a handoff payload against the corresponding schema.
 *
 * @param payload - Handoff payload to validate.
 * @param schemaName - Schema filename (e.g., 'pm-to-architect.schema.json').
 * @param handoffsDir - Directory containing handoff schemas.
 */
export function validateHandoff(
  payload: unknown,
  schemaName: string,
  handoffsDir?: string
): ValidationOutcome {
  const dir = handoffsDir ?? HANDOFFS_DIR_DEFAULT;

  // Pit Crew M7 HIGH (Adversary 5): the pre-fix containment check
  // accepted `handoffsDir = "/"` + `schemaName = "etc/passwd"` because
  // the resolved schemaPath (`/etc/passwd`) trivially started with
  // resolvedDir (`/`) + path.sep. Post-fix: reject filesystem-root
  // handoffsDir values explicitly, AND require handoffsDir to lexically
  // resolve to a proper sub-path (not just `/`). Callers that need a
  // custom handoffsDir must pass an absolute path under the project
  // tree.
  const resolvedDir = path.resolve(dir);
  if (resolvedDir === path.parse(resolvedDir).root) {
    throw new ValidationError(
      `handoffsDir cannot be filesystem root ("${resolvedDir}").`,
      'handoff-validator-validateHandoff',
      []
    );
  }

  // Path-safety: reject schema names that would escape the handoffs dir
  // (e.g. `../../etc/passwd`, absolute paths, null-byte injection,
  // backslash-prefixed Windows-style paths, path separators that
  // attempt to walk into sub-directories).
  if (
    typeof schemaName !== 'string' ||
    schemaName.length === 0 ||
    schemaName.includes('..') ||
    schemaName.includes('/') ||
    schemaName.includes('\\') ||
    path.isAbsolute(schemaName) ||
    schemaName.includes('\0')
  ) {
    throw new ValidationError(
      `Invalid schema name: ${schemaName}`,
      'handoff-validator-validateHandoff',
      []
    );
  }

  const schemaPath = path.resolve(dir, schemaName);
  if (!(schemaPath === resolvedDir || schemaPath.startsWith(`${resolvedDir}${path.sep}`))) {
    throw new ValidationError(
      `Schema path escapes handoffs directory: ${schemaName}`,
      'handoff-validator-validateHandoff',
      []
    );
  }

  if (!existsSync(schemaPath)) {
    return { valid: false, errors: [`Handoff schema not found: ${schemaPath}`] };
  }

  const raw = readFileSync(schemaPath, 'utf8');
  const schema = safeParseJsonObject(raw);
  if (!schema) {
    return {
      valid: false,
      errors: [`Handoff schema malformed or rejected by shape validation: ${schemaPath}`],
    };
  }

  return validate(payload, schema, dir);
}

// ─────────────────────────────────────────────────────────────────────────
// Phantom Requirements
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check for phantom requirements — requirements that appear in the
 * downstream artifact but have no source in the upstream artifact.
 */
export function checkPhantomRequirements(
  upstreamPayload: Partial<PmToArchitectPayload & ArchitectToDevPayload & DevToQaPayload> &
    Record<string, unknown>,
  downstreamContent: string
): PhantomCheckResult {
  const phantoms: string[] = [];
  const traced: string[] = [];

  // Collect all known IDs from upstream
  const knownIds = new Set<string>();
  if (Array.isArray(upstreamPayload.user_stories)) {
    for (const s of upstreamPayload.user_stories as Array<{ id: string }>) {
      if (s && typeof s.id === 'string') knownIds.add(s.id);
    }
  }
  if (Array.isArray(upstreamPayload.functional_requirements)) {
    for (const r of upstreamPayload.functional_requirements as Array<{ id: string }>) {
      if (r && typeof r.id === 'string') knownIds.add(r.id);
    }
  }
  if (Array.isArray(upstreamPayload.task_list)) {
    for (const t of upstreamPayload.task_list as Array<{ id: string }>) {
      if (t && typeof t.id === 'string') knownIds.add(t.id);
    }
  }
  if (Array.isArray(upstreamPayload.implemented_tasks)) {
    for (const t of upstreamPayload.implemented_tasks as Array<{ id: string }>) {
      if (t && typeof t.id === 'string') knownIds.add(t.id);
    }
  }

  // Find all ID-like references in downstream content
  const idPatterns: RegExp[] = [
    /\b(E\d+-S\d+)\b/g,
    /\b(M\d+-T\d+)\b/g,
    /\b(NFR-\d+)\b/g,
    /\b(FR-\d+)\b/g,
  ];

  const downstreamIds = new Set<string>();
  for (const pattern of idPatterns) {
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec idiom
    while ((m = pattern.exec(downstreamContent)) !== null) {
      downstreamIds.add(m[1]);
    }
  }

  // Classify each downstream ID
  for (const id of downstreamIds) {
    if (knownIds.has(id)) {
      traced.push(id);
    } else {
      phantoms.push(id);
    }
  }

  return { phantoms, traced };
}

// ─────────────────────────────────────────────────────────────────────────
// Report Generation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate a full handoff validation report.
 */
export function generateHandoffReport(
  fromArtifactPath: string,
  fromPhase: string,
  toPhase: TargetPhase | string,
  handoffsDir?: string
): HandoffReport {
  const schemaMap: Record<string, string> = {
    architect: 'pm-to-architect.schema.json',
    dev: 'architect-to-dev.schema.json',
    developer: 'architect-to-dev.schema.json',
    qa: 'dev-to-qa.schema.json',
  };

  const schemaName = schemaMap[toPhase];
  if (!schemaName) {
    return {
      valid: false,
      errors: [`No handoff schema for transition to '${toPhase}'`],
    };
  }

  let payload: HandoffPayload;
  try {
    payload = extractHandoffPayload(fromArtifactPath, toPhase);
  } catch (err) {
    return {
      valid: false,
      errors: [`Payload extraction failed: ${(err as Error).message}`],
    };
  }

  const validation = validateHandoff(payload, schemaName, handoffsDir);

  return {
    transition: `${fromPhase} → ${toPhase}`,
    schema: schemaName,
    payload_keys: Object.keys(payload),
    ...validation,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────

function inferNfrCategory(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('performance') || lower.includes('speed') || lower.includes('latency'))
    return 'performance';
  if (lower.includes('security') || lower.includes('auth') || lower.includes('encrypt'))
    return 'security';
  if (lower.includes('scal')) return 'scalability';
  if (lower.includes('reliab') || lower.includes('uptime') || lower.includes('availab'))
    return 'reliability';
  if (lower.includes('usab') || lower.includes('ux')) return 'usability';
  if (lower.includes('maintain')) return 'maintainability';
  if (lower.includes('compl') || lower.includes('gdpr') || lower.includes('hipaa'))
    return 'compliance';
  if (lower.includes('access')) return 'accessibility';
  return 'performance';
}

function extractMetric(text: string): string | null {
  const metricMatch = text.match(
    /(?:within|under|less than|at least|≥|>=|<=|<|>)?\s*\d+[\d.]*\s*(?:ms|s|%|req\/s|rps|MB|GB|KB)/i
  );
  return metricMatch ? metricMatch[0].trim() : null;
}

function extractPriority(text: string): string | null {
  const m = text.match(/\*\*Priority:\*\*\s*(.+)/i);
  if (!m) return null;
  const p = m[1].trim().toLowerCase();
  if (p.includes('must')) return 'must-have';
  if (p.includes('should')) return 'should-have';
  if (p.includes('could')) return 'could-have';
  if (p.includes('won')) return 'wont-have';
  return 'must-have';
}
