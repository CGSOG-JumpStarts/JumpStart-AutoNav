/**
 * config-yaml.ts — YAML config Document AST helpers (T4.1.8 port).
 *
 * Pure-library port of `bin/lib/config-yaml.cjs`. Five exports
 * preserved verbatim by name + signature:
 *   - `parseConfigDocument(path)` → `Document`
 *   - `writeConfigDocument(path, doc)` → void
 *   - `updateBootstrapAnswers(path, updates)` → `{ applied, changed }`
 *   - `setWorkflowCurrentPhase(path, phase)` → `{ changed, current_phase }`
 *   - `getWorkflowSettings(path)` → `{ auto_handoff, current_phase }`
 *
 * **The yaml package's `Document` AST is preserved verbatim** (per T4.1.8
 * spec). All edits go through `doc.setIn([...path], value)` so comments,
 * blank lines, and key ordering survive the round-trip — critical for
 * `config.yaml` consumers who expect their formatting preserved.
 *
 * Behavior parity:
 *   - `parseConfigDocument` throws the same `Error('Config file not
 *     found: <path>')` and `Error('Invalid YAML in <path>: <msg>')`
 *     shapes as the legacy. Errors are NOT wrapped as JumpstartError
 *     yet; callers in IPC mode get them via runIpc's catch-all path
 *     (exit 99).
 *   - `updateBootstrapAnswers` skips fields that are `undefined`,
 *     `null`, or `''` — matching legacy verbatim. Returns `applied:
 *     []` + `changed: false` when no fields apply.
 *
 * This module is library-only. The future IPC driver lives in
 * `bin/lib-ts/config-loader.ts` (T4.1.9) which composes config-yaml's
 * primitives with safePathSchema + runIpc.
 *
 * @see bin/lib/config-yaml.cjs (legacy reference)
 * @see specs/decisions/adr-003-yaml-roundtrip.md
 * @see specs/implementation-plan.md T4.1.8
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { type Document, parseDocument } from 'yaml';

/** Result of `updateBootstrapAnswers`. */
export interface BootstrapUpdateResult {
  applied: string[];
  changed: boolean;
}

/** Bootstrap-answer fields that can be applied via `updateBootstrapAnswers`. */
export interface BootstrapUpdates {
  projectName?: string | null;
  projectType?: string | null;
  approverName?: string | null;
}

/** Result of `setWorkflowCurrentPhase`. */
export interface PhaseUpdateResult {
  changed: true;
  current_phase: string;
}

/** Result of `getWorkflowSettings`. */
export interface WorkflowSettings {
  auto_handoff: boolean;
  current_phase: string | null;
}

/**
 * Parse `<configPath>` as a yaml `Document`. Throws on missing file or
 * invalid YAML — the message shapes match legacy verbatim so existing
 * grep-based error handlers in upstream tooling keep working.
 */
export function parseConfigDocument(configPath: string): Document.Parsed {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const content = readFileSync(configPath, 'utf8');
  const doc = parseDocument(content, {
    prettyErrors: true,
    strict: true,
  });

  if (doc.errors && doc.errors.length > 0) {
    const message = doc.errors.map((error) => error.message).join('; ');
    throw new Error(`Invalid YAML in ${configPath}: ${message}`);
  }

  return doc;
}

/**
 * Write `doc` back to disk at `configPath`, creating the parent
 * directory if needed. The yaml package's Document.toString() preserves
 * comments, blank lines, and key ordering from the original parse.
 */
export function writeConfigDocument(configPath: string, doc: Document): void {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, doc.toString(), 'utf8');
}

/**
 * Apply per-field updates to `project.{name,type,approver}` in the
 * config at `configPath`. Skips fields whose value is undefined/null/''
 * (legacy semantics). Returns the list of applied paths and a
 * `changed` flag — `false` when no field qualified.
 */
export function updateBootstrapAnswers(
  configPath: string,
  updates: BootstrapUpdates = {}
): BootstrapUpdateResult {
  const doc = parseConfigDocument(configPath);
  const applied: string[] = [];

  if (
    updates.projectName !== undefined &&
    updates.projectName !== null &&
    updates.projectName !== ''
  ) {
    doc.setIn(['project', 'name'], updates.projectName);
    applied.push('project.name');
  }

  if (
    updates.projectType !== undefined &&
    updates.projectType !== null &&
    updates.projectType !== ''
  ) {
    doc.setIn(['project', 'type'], updates.projectType);
    applied.push('project.type');
  }

  if (
    updates.approverName !== undefined &&
    updates.approverName !== null &&
    updates.approverName !== ''
  ) {
    doc.setIn(['project', 'approver'], updates.approverName);
    applied.push('project.approver');
  }

  if (applied.length === 0) {
    return { applied, changed: false };
  }

  writeConfigDocument(configPath, doc);
  return { applied, changed: true };
}

/**
 * Update `workflow.current_phase` in the config at `configPath`.
 * Always writes; always reports changed=true (legacy semantics —
 * idempotent rewrites count as "changed").
 */
export function setWorkflowCurrentPhase(configPath: string, phase: string): PhaseUpdateResult {
  const doc = parseConfigDocument(configPath);
  doc.setIn(['workflow', 'current_phase'], phase);
  writeConfigDocument(configPath, doc);
  return { changed: true, current_phase: phase };
}

/**
 * Read `workflow.{auto_handoff,current_phase}` from the config.
 * `auto_handoff` defaults to true if missing or any value other
 * than literal `false` (matching legacy `!== false` truthiness).
 */
export function getWorkflowSettings(configPath: string): WorkflowSettings {
  const doc = parseConfigDocument(configPath);
  const autoHandoffValue = doc.getIn(['workflow', 'auto_handoff']);
  const currentPhase = doc.getIn(['workflow', 'current_phase']);

  return {
    auto_handoff: autoHandoffValue !== false,
    current_phase: typeof currentPhase === 'string' ? currentPhase : null,
  };
}
