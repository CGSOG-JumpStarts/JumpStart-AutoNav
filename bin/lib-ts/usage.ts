/**
 * usage.ts — agent cost & token tracking port (T4.3.1).
 *
 * Pure-library port of `bin/lib/usage.js`. Public surface preserved:
 *
 *   - `setUsageTimelineHook(timeline)`
 *   - `loadUsageLog(logPath)`
 *   - `logUsage(logPath, entry)`
 *   - `summarizeUsage(logPath)`
 *   - `generateUsageReport(logPath)`
 *
 * **ADR-012 redaction (NEW in this port).**
 *   Every persisted log entry runs through `redactSecrets` before
 *   being written to disk OR forwarded to the timeline hook. Closes
 *   the v1.1.14 leak-via-metadata risk where a model name, prompt,
 *   or any user-supplied metadata field could carry an embedded
 *   secret directly into `.jumpstart/usage-log.json`.
 *
 * @see bin/lib/usage.js (legacy reference)
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.3.1
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { redactSecrets } from './secret-scanner.js';

// Public types

export interface UsageEntry {
  timestamp: string;
  phase: string;
  agent: string;
  action: string;
  estimated_tokens: number;
  estimated_cost_usd: number;
  model: string | null;
  metadata: Record<string, unknown> | null;
}

export interface UsageEntryInput {
  phase?: string;
  agent?: string;
  action?: string;
  estimated_tokens?: number;
  estimated_cost_usd?: number;
  model?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UsageLog {
  entries: UsageEntry[];
  total_tokens: number;
  total_cost_usd: number;
}

export interface UsageBreakdown {
  tokens: number;
  cost_usd: number;
  sessions: number;
}

export interface UsageSummary {
  total_tokens: number;
  total_cost_usd: number;
  total_sessions: number;
  by_phase: Record<string, UsageBreakdown>;
  by_agent: Record<string, UsageBreakdown>;
}

export interface TimelineHook {
  recordEvent(event: {
    event_type: string;
    phase: string;
    agent: string;
    action: string;
    metadata?: Record<string, unknown>;
  }): void;
}

// Module-level timeline hook (preserved from legacy)

let _timelineHook: TimelineHook | null = null;

/** Set the timeline instance for recording usage events. Pass `null`
 *  to clear. */
export function setUsageTimelineHook(timeline: TimelineHook | null): void {
  _timelineHook = timeline;
}

// Implementation

/** Load the usage log from disk; returns zeroed defaults on missing/corrupt.
 *
 *  Pit Crew M4 Adversary F13: validates parsed shape before returning.
 *  A maliciously-crafted usage-log.json with non-object root would
 *  type-confuse downstream `log.entries.push` calls. Post-fix: enforce
 *  object root + array entries.
 */
export function loadUsageLog(logPath: string): UsageLog {
  const empty: UsageLog = { entries: [], total_tokens: 0, total_cost_usd: 0 };
  if (!existsSync(logPath)) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(logPath, 'utf8'));
  } catch {
    return empty;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return empty;
  }
  const data = parsed as Partial<UsageLog>;
  return {
    entries: Array.isArray(data.entries) ? data.entries : [],
    total_tokens: typeof data.total_tokens === 'number' ? data.total_tokens : 0,
    total_cost_usd: typeof data.total_cost_usd === 'number' ? data.total_cost_usd : 0,
  };
}

/**
 * Append a usage entry to the log.
 *
 * **ADR-012 redaction**: every entry is run through `redactSecrets`
 * before persistence AND before being forwarded to the timeline
 * hook. This catches:
 *   - secrets embedded in `metadata.*` fields (the most common leak
 *     surface — agent debug payloads, prompt fragments, error
 *     stacks)
 *   - secrets in `model` (unlikely but possible if a misconfigured
 *     environment passes a token-shaped string through to model id)
 *   - secrets in `action` description strings
 *
 * The numeric fields (`estimated_tokens`, `estimated_cost_usd`) and
 * structural fields (`timestamp`, `phase`, `agent`) are
 * pass-through-safe (primitives or formal-shape strings).
 */
export function logUsage(logPath: string, entry: UsageEntryInput): UsageLog {
  const log = loadUsageLog(logPath);

  const newEntry: UsageEntry = {
    timestamp: new Date().toISOString(),
    phase: entry.phase || 'unknown',
    agent: entry.agent || 'unknown',
    action: entry.action || 'unknown',
    estimated_tokens: entry.estimated_tokens || 0,
    estimated_cost_usd: entry.estimated_cost_usd || 0,
    model: entry.model || null,
    metadata: entry.metadata || null,
  };

  // ADR-012: redact every textual / metadata field before persistence.
  const redactedEntry: UsageEntry = redactSecrets(newEntry);

  log.entries.push(redactedEntry);
  log.total_tokens += redactedEntry.estimated_tokens;
  log.total_cost_usd += redactedEntry.estimated_cost_usd;

  const dir = path.dirname(logPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(logPath, `${JSON.stringify(log, null, 2)}\n`, 'utf8');

  // Forward to timeline (also redacted — the hook receives the
  // already-redacted entry).
  if (_timelineHook) {
    _timelineHook.recordEvent({
      event_type: 'usage_logged',
      phase: redactedEntry.phase,
      agent: redactedEntry.agent,
      action: `Usage logged: ${redactedEntry.estimated_tokens} tokens ($${redactedEntry.estimated_cost_usd.toFixed(4)})`,
      metadata: {
        estimated_tokens: redactedEntry.estimated_tokens,
        estimated_cost_usd: redactedEntry.estimated_cost_usd,
        model: redactedEntry.model,
      },
    });
  }

  return log;
}

/** Aggregate usage summary grouped by phase and agent. */
export function summarizeUsage(logPath: string): UsageSummary {
  const log = loadUsageLog(logPath);

  const byPhase: Record<string, UsageBreakdown> = {};
  const byAgent: Record<string, UsageBreakdown> = {};

  for (const entry of log.entries) {
    if (!byPhase[entry.phase]) {
      byPhase[entry.phase] = { tokens: 0, cost_usd: 0, sessions: 0 };
    }
    byPhase[entry.phase].tokens += entry.estimated_tokens;
    byPhase[entry.phase].cost_usd += entry.estimated_cost_usd;
    byPhase[entry.phase].sessions++;

    if (!byAgent[entry.agent]) {
      byAgent[entry.agent] = { tokens: 0, cost_usd: 0, sessions: 0 };
    }
    byAgent[entry.agent].tokens += entry.estimated_tokens;
    byAgent[entry.agent].cost_usd += entry.estimated_cost_usd;
    byAgent[entry.agent].sessions++;
  }

  return {
    total_tokens: log.total_tokens,
    total_cost_usd: Math.round(log.total_cost_usd * 10000) / 10000,
    total_sessions: log.entries.length,
    by_phase: byPhase,
    by_agent: byAgent,
  };
}

/** Markdown usage summary. */
export function generateUsageReport(logPath: string): string {
  const summary = summarizeUsage(logPath);

  let report = '## Usage Summary\n\n';
  report += '| Metric | Value |\n|--------|-------|\n';
  report += `| Total Tokens | ${summary.total_tokens.toLocaleString()} |\n`;
  report += `| Estimated Cost | $${summary.total_cost_usd.toFixed(4)} |\n`;
  report += `| Total Sessions | ${summary.total_sessions} |\n\n`;

  report += '### By Phase\n\n';
  report += '| Phase | Tokens | Cost | Sessions |\n|-------|--------|------|----------|\n';
  for (const [phase, data] of Object.entries(summary.by_phase)) {
    report += `| ${phase} | ${data.tokens.toLocaleString()} | $${data.cost_usd.toFixed(4)} | ${data.sessions} |\n`;
  }

  report += '\n### By Agent\n\n';
  report += '| Agent | Tokens | Cost | Sessions |\n|-------|--------|------|----------|\n';
  for (const [agent, data] of Object.entries(summary.by_agent)) {
    report += `| ${agent} | ${data.tokens.toLocaleString()} | $${data.cost_usd.toFixed(4)} | ${data.sessions} |\n`;
  }

  return report;
}
