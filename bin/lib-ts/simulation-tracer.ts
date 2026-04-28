/**
 * simulation-tracer.ts — Headless Agent Simulation Tracer port (T4.6.3, M7).
 *
 * Pure-library port of `bin/lib/simulation-tracer.js`. Public surface
 * preserved verbatim by name + signature shape:
 *
 *   - `class SimulationTracer`
 *     constructor(workspaceDir, scenario)
 *     setTimeline(timeline)
 *     startPhase(name) / endPhase(name, status)
 *     logArtifact(artifactName)
 *     logLLMCall(model, promptTokens, completionTokens, cost?)
 *     logToolInterception(toolName, args, result)
 *     logUserProxyExchange(questionArgs, answer)
 *     logError(message, phase?) / logWarning(message)
 *     logSubagentVerified(agent)
 *     logDocumentCreation(document, status)
 *     logCostTracking(promptTokens, completionTokens)
 *     logHandoffValidation(status, report?)
 *     getLLMUsageSummary() / getConversationTranscript()
 *     getReport() / generateReport()
 *     printSummary() / saveReport(reportPath)
 *
 * Behavior parity:
 *   - All collectors (errors, warnings, verifiedSubagents, documentCreations,
 *     handoffValidations, costTracking) initialised on construction even
 *     for pure-headless runs — downstream consumers rely on field presence.
 *   - `success` semantics in getReport(): true ↔ phases.length > 0 AND no
 *     FAIL phase AND no FAIL handoff AND errors.length === 0 (verbatim
 *     from legacy).
 *   - `generateReport` is an alias for `getReport`.
 *
 * **ADR-012 redaction (NEW in this port).**
 *   `saveReport()` runs the full report through `redactSecrets` before
 *   `writeFileSync`. Trace logs may carry tool-call payloads, LLM model
 *   ids, error messages, and user-proxy answers — any of which can
 *   contain bearer tokens, OpenAI keys, or webhook URLs. The redaction
 *   pass closes the leak surface that the legacy file silently allowed.
 *
 * **Timeline forwarding preserved.**
 *   All event-emission calls are gated on `_timeline` presence; when
 *   set via `setTimeline()`, every tracer hook also records a structured
 *   timeline event. Identical to legacy.
 *
 * @see bin/lib/simulation-tracer.js (legacy reference)
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.6.3
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { redactSecrets } from './secret-scanner.js';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export type PhaseStatus = 'RUNNING' | 'PASS' | 'FAIL' | 'INCOMPLETE';
export type HandoffStatus = 'PASS' | 'FAIL' | 'SKIP';
export type DocumentStatus = 'CREATED' | 'MISSING';

export interface PhaseRecord {
  name: string;
  status: PhaseStatus;
  startTime: number;
  endTime: number | null;
  artifacts: string[];
  toolCalls: number;
  llmCalls: number;
  errors: string[];
  promptTokens: number;
  completionTokens: number;
}

export interface PhaseReport {
  name: string;
  status: PhaseStatus;
  artifacts: string[];
  duration_ms: number | null;
  toolCalls: number;
  llmCalls: number;
  errors: string[];
  promptTokens: number;
  completionTokens: number;
}

export interface LLMCallRecord {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  timestamp: number;
}

export interface TranscriptEntry {
  type: 'tool_call' | 'user_proxy_question' | 'user_proxy_response';
  tool?: string;
  args?: unknown;
  result?: unknown;
  data?: unknown;
  timestamp: number;
}

export interface ErrorRecord {
  message: string;
  phase: string | null;
  timestamp: number;
}

export interface SubagentVerifiedRecord {
  agent: string;
  phase: string | null;
  timestamp: number;
}

export interface DocumentCreationRecord {
  document: string;
  status: DocumentStatus;
  timestamp: number;
}

export interface HandoffValidationRecord {
  status: HandoffStatus;
  phase: string | null;
  errors: string[];
  timestamp: number;
}

export interface HandoffReport {
  errors?: string[];
  // Tolerate forward-compat fields the validator may emit alongside `errors`.
  [key: string]: unknown;
}

export interface CostTracking {
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

export interface LLMUsageByModel {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
}

export interface LLMUsageSummary {
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  byModel: Record<string, LLMUsageByModel>;
}

/**
 * Minimal duck-type for the timeline interface this module forwards to.
 * Mirrors `bin/lib-ts/timeline.ts` without taking a hard dependency on
 * its concrete shape — `SimulationTracer` is happy with any object that
 * exposes `setPhase` + `recordEvent`.
 */
export interface TimelineLike {
  setPhase(name: string): void;
  recordEvent(event: {
    event_type: string;
    action: string;
    phase?: string;
    agent?: string;
    parent_agent?: string;
    metadata?: Record<string, unknown> | null;
    duration_ms?: number | null;
  }): unknown;
}

export interface SimulationReport {
  scenario: string;
  timestamp: string;
  success: boolean;
  phases: PhaseReport[];
  errors: ErrorRecord[];
  warnings: ErrorRecord[];
  verifiedSubagents: SubagentVerifiedRecord[];
  documentCreations: DocumentCreationRecord[];
  handoffValidations: HandoffValidationRecord[];
  costTracking: CostTracking;
  headless: {
    llm_usage: LLMUsageSummary;
    tool_interceptions: number;
    transcript_length: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SimulationTracer
// ─────────────────────────────────────────────────────────────────────────

export class SimulationTracer {
  workspaceDir: string;
  scenario: string;
  phases: PhaseRecord[];
  currentPhase: PhaseRecord | null;
  transcript: TranscriptEntry[];
  llmCalls: LLMCallRecord[];
  toolInterceptionCount: number;

  errors: ErrorRecord[];
  warnings: ErrorRecord[];
  verifiedSubagents: SubagentVerifiedRecord[];
  documentCreations: DocumentCreationRecord[];
  handoffValidations: HandoffValidationRecord[];
  costTracking: CostTracking;

  private _timeline: TimelineLike | null;

  constructor(workspaceDir: string, scenario: string) {
    this.workspaceDir = workspaceDir;
    this.scenario = scenario;
    this.phases = [];
    this.currentPhase = null;
    this.transcript = [];
    this.llmCalls = [];
    this.toolInterceptionCount = 0;

    this.errors = [];
    this.warnings = [];
    this.verifiedSubagents = [];
    this.documentCreations = [];
    this.handoffValidations = [];
    this.costTracking = { totalPromptTokens: 0, totalCompletionTokens: 0 };

    this._timeline = null;
  }

  /**
   * Attach a timeline instance for event delegation.
   */
  setTimeline(timeline: TimelineLike | null): void {
    this._timeline = timeline;
  }

  /**
   * Mark the start of a phase.
   */
  startPhase(name: string): void {
    this.currentPhase = {
      name,
      status: 'RUNNING',
      startTime: Date.now(),
      endTime: null,
      artifacts: [],
      toolCalls: 0,
      llmCalls: 0,
      errors: [],
      promptTokens: 0,
      completionTokens: 0,
    };
    this.phases.push(this.currentPhase);
    if (this._timeline) {
      this._timeline.setPhase(name);
      this._timeline.recordEvent({
        event_type: 'phase_start',
        action: `Phase started: ${name}`,
        metadata: { phase: name },
      });
    }
  }

  /**
   * Mark the end of a phase.
   */
  endPhase(name: string, status: PhaseStatus): void {
    if (this.currentPhase && this.currentPhase.name === name) {
      this.currentPhase.status = status;
      this.currentPhase.endTime = Date.now();
      if (this._timeline) {
        this._timeline.recordEvent({
          event_type: 'phase_end',
          action: `Phase ended: ${name} (${status})`,
          metadata: { phase: name, status },
          duration_ms: this.currentPhase.endTime - this.currentPhase.startTime,
        });
      }
    }
  }

  /** Log an artifact created during the current phase. */
  logArtifact(artifactName: string): void {
    if (this.currentPhase) {
      this.currentPhase.artifacts.push(artifactName);
    }
    if (this._timeline) {
      this._timeline.recordEvent({
        event_type: 'artifact_write',
        action: `Artifact created: ${artifactName}`,
        metadata: { file: artifactName },
      });
    }
  }

  /** Log an LLM API call. */
  logLLMCall(model: string, promptTokens: number, completionTokens: number, cost?: number): void {
    const entry: LLMCallRecord = {
      model,
      promptTokens,
      completionTokens,
      cost: cost || 0,
      timestamp: Date.now(),
    };
    this.llmCalls.push(entry);

    if (this.currentPhase) {
      this.currentPhase.llmCalls++;
    }
    if (this._timeline) {
      this._timeline.recordEvent({
        event_type: 'llm_turn_end',
        action: `LLM call: ${model}`,
        metadata: {
          model,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          cost_usd: cost || 0,
        },
      });
    }
  }

  /** Log a tool call interception. */
  logToolInterception(toolName: string, args: unknown, result: unknown): void {
    this.toolInterceptionCount++;
    this.transcript.push({
      type: 'tool_call',
      tool: toolName,
      args,
      result,
      timestamp: Date.now(),
    });

    if (this.currentPhase) {
      this.currentPhase.toolCalls++;
    }
    if (this._timeline) {
      this._timeline.recordEvent({
        event_type: 'tool_call',
        action: `Tool: ${toolName}`,
        metadata: {
          tool: toolName,
          args_keys:
            args && typeof args === 'object' && !Array.isArray(args)
              ? Object.keys(args as Record<string, unknown>)
              : [],
        },
      });
    }
  }

  /** Log a user proxy question-answer exchange. */
  logUserProxyExchange(questionArgs: unknown, answer: unknown): void {
    this.transcript.push({
      type: 'user_proxy_question',
      data: questionArgs,
      timestamp: Date.now(),
    });
    this.transcript.push({
      type: 'user_proxy_response',
      data: answer,
      timestamp: Date.now(),
    });
    if (this._timeline) {
      const questions =
        questionArgs &&
        typeof questionArgs === 'object' &&
        !Array.isArray(questionArgs) &&
        Array.isArray((questionArgs as { questions?: unknown[] }).questions)
          ? ((questionArgs as { questions?: unknown[] }).questions as unknown[]).length
          : 1;
      this._timeline.recordEvent({
        event_type: 'question_asked',
        action: 'User proxy question',
        metadata: { question_count: questions },
      });
      this._timeline.recordEvent({
        event_type: 'question_answered',
        action: 'User proxy response',
        metadata: {
          answer_preview: typeof answer === 'string' ? answer.slice(0, 200) : '(object)',
        },
      });
    }
  }

  /** Log an error encountered during the current (or named) phase. */
  logError(message: string, phase?: string): void {
    const phaseName = phase || (this.currentPhase ? this.currentPhase.name : null);
    const entry: ErrorRecord = { message, phase: phaseName, timestamp: Date.now() };
    this.errors.push(entry);
    if (this.currentPhase) {
      this.currentPhase.errors.push(message);
    }
    if (this._timeline) {
      this._timeline.recordEvent({
        event_type: 'error',
        action: `Error: ${message}`,
        metadata: { phase: phaseName },
      });
    }
  }

  /** Log a non-fatal warning. */
  logWarning(message: string): void {
    const phaseName = this.currentPhase ? this.currentPhase.name : null;
    const entry: ErrorRecord = { message, phase: phaseName, timestamp: Date.now() };
    this.warnings.push(entry);
    if (this._timeline) {
      this._timeline.recordEvent({
        event_type: 'warning',
        action: `Warning: ${message}`,
        metadata: { phase: phaseName },
      });
    }
  }

  /** Log that a subagent trace was verified present in insights. */
  logSubagentVerified(agent: string): void {
    const phaseName = this.currentPhase ? this.currentPhase.name : null;
    const entry: SubagentVerifiedRecord = {
      agent,
      phase: phaseName,
      timestamp: Date.now(),
    };
    this.verifiedSubagents.push(entry);
    if (this._timeline) {
      this._timeline.recordEvent({
        event_type: 'subagent_verified',
        action: `Subagent verified: ${agent}`,
        metadata: { ...entry },
      });
    }
  }

  /** Log the outcome of a final-state document check. */
  logDocumentCreation(document: string, status: DocumentStatus): void {
    const entry: DocumentCreationRecord = { document, status, timestamp: Date.now() };
    this.documentCreations.push(entry);
    if (this._timeline) {
      this._timeline.recordEvent({
        event_type: 'document_check',
        action: `Document ${document}: ${status}`,
        metadata: { ...entry },
      });
    }
  }

  /** Log aggregated cost for a phase. */
  logCostTracking(promptTokens: number, completionTokens: number): void {
    this.costTracking.totalPromptTokens += promptTokens || 0;
    this.costTracking.totalCompletionTokens += completionTokens || 0;
    if (this.currentPhase) {
      this.currentPhase.promptTokens += promptTokens || 0;
      this.currentPhase.completionTokens += completionTokens || 0;
    }
  }

  /** Log the outcome of a cross-phase handoff validation. */
  logHandoffValidation(status: HandoffStatus, report?: HandoffReport): void {
    const phaseName = this.currentPhase ? this.currentPhase.name : null;
    const entry: HandoffValidationRecord = {
      status,
      phase: phaseName,
      errors: report && Array.isArray(report.errors) ? report.errors : [],
      timestamp: Date.now(),
    };
    this.handoffValidations.push(entry);
    if (this._timeline) {
      this._timeline.recordEvent({
        event_type: 'handoff_validation',
        action: `Handoff: ${status}`,
        metadata: { phase: phaseName, status, error_count: entry.errors.length },
      });
    }
  }

  /** Get LLM usage summary across all calls. */
  getLLMUsageSummary(): LLMUsageSummary {
    const byModel: Record<string, LLMUsageByModel> = {};
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCost = 0;

    for (const call of this.llmCalls) {
      totalPromptTokens += call.promptTokens;
      totalCompletionTokens += call.completionTokens;
      totalCost += call.cost;

      if (!byModel[call.model]) {
        byModel[call.model] = { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
      }
      byModel[call.model].calls++;
      byModel[call.model].promptTokens += call.promptTokens;
      byModel[call.model].completionTokens += call.completionTokens;
      byModel[call.model].cost += call.cost;
    }

    return {
      totalCalls: this.llmCalls.length,
      totalPromptTokens,
      totalCompletionTokens,
      totalCost,
      byModel,
    };
  }

  /** Get the full conversation transcript. */
  getConversationTranscript(): TranscriptEntry[] {
    return this.transcript;
  }

  /**
   * Generate a structured report of the simulation. `success` is true
   * only when every phase passed, no errors were recorded, and no
   * handoff validation FAILed (verbatim semantics from legacy).
   */
  getReport(): SimulationReport {
    const phases: PhaseReport[] = this.phases.map((p) => ({
      name: p.name,
      status: p.status,
      artifacts: p.artifacts,
      duration_ms: p.endTime ? p.endTime - p.startTime : null,
      toolCalls: p.toolCalls,
      llmCalls: p.llmCalls,
      errors: Array.isArray(p.errors) ? [...p.errors] : [],
      promptTokens: p.promptTokens || 0,
      completionTokens: p.completionTokens || 0,
    }));

    const hasFailedPhase = phases.some((p) => p.status === 'FAIL');
    const hasFailedHandoff = this.handoffValidations.some((h) => h.status === 'FAIL');
    const success =
      phases.length > 0 && !hasFailedPhase && !hasFailedHandoff && this.errors.length === 0;

    return {
      scenario: this.scenario,
      timestamp: new Date().toISOString(),
      success,
      phases,
      errors: this.errors,
      warnings: this.warnings,
      verifiedSubagents: this.verifiedSubagents,
      documentCreations: this.documentCreations,
      handoffValidations: this.handoffValidations,
      costTracking: {
        totalPromptTokens: this.costTracking.totalPromptTokens,
        totalCompletionTokens: this.costTracking.totalCompletionTokens,
      },
      headless: {
        llm_usage: this.getLLMUsageSummary(),
        tool_interceptions: this.toolInterceptionCount,
        transcript_length: this.transcript.length,
      },
    };
  }

  /** Alias for getReport(). */
  generateReport(): SimulationReport {
    return this.getReport();
  }

  /**
   * Print a human-readable summary of the simulation to stdout.
   */
  printSummary(): void {
    const r = this.getReport();
    const line = '─'.repeat(60);
    const passedPhases = r.phases.filter((p) => p.status === 'PASS').length;
    const failedPhases = r.phases.filter((p) => p.status === 'FAIL').length;
    const handoffPass = r.handoffValidations.filter((h) => h.status === 'PASS').length;
    const handoffFail = r.handoffValidations.filter((h) => h.status === 'FAIL').length;
    const handoffSkip = r.handoffValidations.filter((h) => h.status === 'SKIP').length;
    const artifactsTotal = r.phases.reduce((n, p) => n + (p.artifacts ? p.artifacts.length : 0), 0);

    console.log(`\n${line}`);
    console.log(`  Scenario:            ${this.scenario}`);
    console.log(`  Result:              ${r.success ? '✓ PASS' : '✗ FAIL'}`);
    console.log(line);
    console.log(
      `  Phases:              ${r.phases.length} (${passedPhases} passed, ${failedPhases} failed)`
    );
    console.log(`  Artifacts logged:    ${artifactsTotal}`);
    console.log(`  Tool calls:          ${this.toolInterceptionCount}`);
    console.log(`  LLM calls:           ${this.llmCalls.length}`);
    console.log(`  Prompt tokens:       ${r.costTracking.totalPromptTokens}`);
    console.log(`  Completion tokens:   ${r.costTracking.totalCompletionTokens}`);
    console.log(`  Subagents verified:  ${this.verifiedSubagents.length}`);
    console.log(
      `  Handoff validations: ${r.handoffValidations.length} (${handoffPass} pass, ${handoffFail} fail, ${handoffSkip} skip)`
    );
    console.log(`  Documents checked:   ${r.documentCreations.length}`);
    console.log(`  Warnings:            ${this.warnings.length}`);
    console.log(`  Errors:              ${this.errors.length}`);
    console.log(line);

    if (this.errors.length) {
      console.log('  Errors:');
      for (const e of this.errors) {
        console.log(`    ✗ [${e.phase || '?'}] ${e.message}`);
      }
    }
    if (this.warnings.length && this.warnings.length <= 10) {
      console.log('  Warnings:');
      for (const w of this.warnings) {
        console.log(`    ⚠ ${w.message}`);
      }
    } else if (this.warnings.length > 10) {
      console.log(`  Warnings: ${this.warnings.length} (suppressed from summary; see report JSON)`);
    }
    console.log('');
  }

  /**
   * Persist the report as JSON. ADR-012: redact secrets before write.
   * Trace logs may carry tool-call payloads, LLM model ids, error
   * messages, and user-proxy answers — any of which can contain bearer
   * tokens, OpenAI keys, or webhook URLs.
   */
  saveReport(reportPath: string): void {
    const dir = dirname(reportPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const report = this.getReport();
    const redacted = redactSecrets(report);
    // Pit Crew M7 MED (Reviewer): add trailing newline for consistency
    // with sibling persistence sites (holodeck.saveReport,
    // headless-runner persistence) — newline-sensitive diff tools and
    // POSIX text-file conventions both expect one.
    writeFileSync(reportPath, `${JSON.stringify(redacted, null, 2)}\n`);
  }
}
