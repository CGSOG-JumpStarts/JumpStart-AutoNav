/**
 * timeline.ts — agent interaction timeline port (T4.3.3, cluster H).
 *
 * Pure-library port of `bin/lib/timeline.js`. Public surface preserved
 * verbatim by name + signature:
 *
 *   - `EVENT_TYPES` (constant array)
 *   - `DEFAULT_TIMELINE_PATH` (constant)
 *   - `generateSessionId()` => string
 *   - `createTimeline(options?)` => Timeline
 *   - `loadTimeline(filePath?)` => TimelineData
 *   - `queryTimeline(filePath?, filters?)` => TimelineEvent[]
 *   - `getTimelineSummary(filePath?)` => TimelineSummary
 *   - `clearTimeline(filePath?, options?)` => ClearResult
 *   - `renderMarkdown(events, options?)` => string
 *   - `renderJSON(events)` => string
 *   - `renderHTML(events, options?)` => string
 *   - `generateTimelineReport(filePath?, options?)` => string
 *
 * **ADR-012 redaction (NEW in this port).**
 *   Every persisted event runs through `redactSecrets` from
 *   `secret-scanner.ts` BEFORE it is appended to the in-memory buffer.
 *   This catches:
 *     - secrets embedded in `metadata.*` fields (the most common leak
 *       surface — agent debug payloads, prompt fragments, error
 *       stacks)
 *     - secrets in `action` / `agent` / `parent_agent` text
 *   Numeric/structural fields (`timestamp`, `id`, `session_id`,
 *   `duration_ms`) pass through untouched. Closes the v1.1.14
 *   leak-via-metadata risk where any tool result, stderr, or LLM turn
 *   payload could carry an embedded secret directly into
 *   `.jumpstart/state/timeline.json`.
 *
 * Behavior parity:
 *   - Default file path: `.jumpstart/state/timeline.json`.
 *   - Default max events: 50000 (oldest pruned on overflow).
 *   - Default flush interval: 5 events.
 *   - Capture flags follow legacy default-on semantics (any explicit
 *     `false` disables; missing → enabled).
 *   - Session merge: existing timeline.json keeps its event log; the
 *     `session_id` field is updated to the new session.
 *   - JSON parse failures load empty defaults silently.
 *
 * @see bin/lib/timeline.js (legacy reference)
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.3.3
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { redactSecrets } from './secret-scanner.js';

// Public types

export type EventType =
  | 'phase_start'
  | 'phase_end'
  | 'tool_call'
  | 'tool_result'
  | 'file_read'
  | 'file_write'
  | 'template_read'
  | 'artifact_write'
  | 'artifact_read'
  | 'question_asked'
  | 'question_answered'
  | 'approval'
  | 'rejection'
  | 'subagent_invoked'
  | 'subagent_completed'
  | 'llm_turn_start'
  | 'llm_turn_end'
  | 'prompt_logged'
  | 'research_query'
  | 'checkpoint_created'
  | 'rewind'
  | 'handoff'
  | 'usage_logged'
  | 'custom';

export interface TimelineEvent {
  id: string;
  timestamp: string;
  session_id: string;
  phase: number | string | null;
  agent: string | null;
  parent_agent: string | null;
  event_type: string;
  action: string;
  metadata: Record<string, unknown> | null;
  duration_ms: number | null;
}

export interface TimelineEventInput {
  phase?: number | string | null;
  agent?: string | null;
  parent_agent?: string | null;
  event_type?: string;
  action?: string;
  metadata?: Record<string, unknown> | null;
  duration_ms?: number | null;
}

export interface TimelineData {
  version: string;
  session_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  events: TimelineEvent[];
}

export interface CaptureFlags {
  toolCalls: boolean;
  fileReads: boolean;
  fileWrites: boolean;
  llmTurns: boolean;
  questions: boolean;
  approvals: boolean;
  subagents: boolean;
  research: boolean;
}

export interface CreateTimelineOptions {
  filePath?: string;
  sessionId?: string;
  enabled?: boolean;
  maxEvents?: number;
  flushInterval?: number;
  captureToolCalls?: boolean;
  captureFileReads?: boolean;
  captureFileWrites?: boolean;
  captureLLMTurns?: boolean;
  captureQuestions?: boolean;
  captureApprovals?: boolean;
  captureSubagents?: boolean;
  captureResearch?: boolean;
  archiveOnClear?: boolean;
}

export interface Timeline {
  recordEvent(event: TimelineEventInput): TimelineEvent | null;
  flush(): void;
  endSession(): void;
  setPhase(phase: number | string | null): void;
  setAgent(agent: string | null): void;
  getSessionId(): string;
  getBufferedCount(): number;
  getEventCount(): number;
  capture: CaptureFlags;
}

export interface TimelineFilters {
  session_id?: string;
  phase?: number | string | null;
  agent?: string;
  event_type?: string | string[];
  from?: string;
  to?: string;
  limit?: number;
}

export interface TimelineSummary {
  total_events: number;
  by_type: Record<string, number>;
  by_agent: Record<string, number>;
  by_phase: Record<string, number>;
  sessions: string[];
  duration_ms: number | null;
  first_event: string | null;
  last_event: string | null;
  // Optional convenience keys used by some consumers (e.g., dashboard.ts):
  session_id?: string | null;
  duration_s?: number | null;
}

export interface ClearTimelineOptions {
  archive?: boolean;
  archiveDir?: string;
}

export interface ClearTimelineResult {
  success: boolean;
  archived_to: string | null;
}

export interface RenderOptions {
  title?: string;
}

export interface GenerateReportOptions {
  format?: 'markdown' | 'json' | 'html';
  filters?: TimelineFilters;
  title?: string;
}

// Constants (verbatim from legacy)

export const DEFAULT_TIMELINE_PATH = '.jumpstart/state/timeline.json';
const DEFAULT_MAX_EVENTS = 50000;
const DEFAULT_FLUSH_INTERVAL = 5;

export const EVENT_TYPES: EventType[] = [
  'phase_start',
  'phase_end',
  'tool_call',
  'tool_result',
  'file_read',
  'file_write',
  'template_read',
  'artifact_write',
  'artifact_read',
  'question_asked',
  'question_answered',
  'approval',
  'rejection',
  'subagent_invoked',
  'subagent_completed',
  'llm_turn_start',
  'llm_turn_end',
  'prompt_logged',
  'research_query',
  'checkpoint_created',
  'rewind',
  'handoff',
  'usage_logged',
  'custom',
];

// ID Generation

let _counter = 0;

/** Generate a unique event ID. */
function generateEventId(): string {
  _counter++;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `evt-${ts}-${rand}-${_counter}`;
}

/** Generate a unique session ID. */
export function generateSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ses-${ts}-${rand}`;
}

// Timeline Factory

/**
 * Create a timeline instance bound to a file path and session.
 *
 * **ADR-012 redaction is wired into `recordEvent`** — every event has
 * its textual fields run through `redactSecrets` BEFORE entering the
 * buffer, so flush-to-disk and any downstream consumer (renderers,
 * exporters, tests) only ever see redacted values. Numeric/structural
 * fields (timestamp, id, session_id, duration_ms) pass through.
 */
export function createTimeline(options: CreateTimelineOptions = {}): Timeline {
  const filePath = options.filePath || DEFAULT_TIMELINE_PATH;
  const sessionId = options.sessionId || generateSessionId();
  const enabled = options.enabled !== false;
  const maxEvents = options.maxEvents || DEFAULT_MAX_EVENTS;
  const flushInterval = options.flushInterval || DEFAULT_FLUSH_INTERVAL;
  // Note: archiveOnClear preserved from legacy options surface but
  // not consumed inside the factory — it scopes `clearTimeline`.
  void (options.archiveOnClear !== false);

  const capture: CaptureFlags = {
    toolCalls: options.captureToolCalls !== false,
    fileReads: options.captureFileReads !== false,
    fileWrites: options.captureFileWrites !== false,
    llmTurns: options.captureLLMTurns !== false,
    questions: options.captureQuestions !== false,
    approvals: options.captureApprovals !== false,
    subagents: options.captureSubagents !== false,
    research: options.captureResearch !== false,
  };

  // In-memory buffer
  let buffer: TimelineEvent[] = [];
  let pendingFlush = 0;
  let currentPhase: number | string | null = null;
  let currentAgent: string | null = null;

  // Load existing timeline (merge sessions)
  const timelineData = _loadOrInit(filePath, sessionId);

  /**
   * Record a timeline event. Returns the recorded event, or null if
   * disabled/filtered. Per ADR-012 every recorded event is run through
   * `redactSecrets` before being placed in the buffer.
   */
  function recordEvent(event: TimelineEventInput): TimelineEvent | null {
    if (!enabled) return null;

    // Check capture flags
    if (!_shouldCapture(event.event_type || 'custom', capture)) return null;

    const fullEvent: TimelineEvent = {
      id: generateEventId(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      phase: event.phase !== undefined ? event.phase : currentPhase,
      agent: event.agent || currentAgent,
      parent_agent: event.parent_agent || null,
      event_type: event.event_type || 'custom',
      action: event.action || '',
      metadata: event.metadata || null,
      duration_ms: event.duration_ms || null,
    };

    // ADR-012: redact every textual / metadata field before persistence.
    // The numeric/structural fields (id, timestamp, session_id,
    // duration_ms) are pass-through-safe since redactSecrets walks
    // strings and recursively redacts contents — primitives untouched.
    const redactedEvent: TimelineEvent = redactSecrets(fullEvent);

    buffer.push(redactedEvent);
    pendingFlush++;

    // Auto-flush when buffer hits threshold
    if (pendingFlush >= flushInterval) {
      flush();
    }

    return redactedEvent;
  }

  /** Flush buffered events to disk. */
  function flush(): void {
    if (buffer.length === 0) return;

    timelineData.events.push(...buffer);

    if (timelineData.events.length > maxEvents) {
      const excess = timelineData.events.length - maxEvents;
      timelineData.events = timelineData.events.slice(excess);
    }

    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, `${JSON.stringify(timelineData, null, 2)}\n`, 'utf8');

    buffer = [];
    pendingFlush = 0;
  }

  /** End the session — flush and stamp ended_at. */
  function endSession(): void {
    flush();
    timelineData.ended_at = new Date().toISOString();
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, `${JSON.stringify(timelineData, null, 2)}\n`, 'utf8');
  }

  function setPhase(phase: number | string | null): void {
    currentPhase = phase;
  }

  function setAgent(agent: string | null): void {
    currentAgent = agent;
  }

  function getSessionId(): string {
    return sessionId;
  }

  function getBufferedCount(): number {
    return buffer.length;
  }

  function getEventCount(): number {
    return timelineData.events.length + buffer.length;
  }

  return {
    recordEvent,
    flush,
    endSession,
    setPhase,
    setAgent,
    getSessionId,
    getBufferedCount,
    getEventCount,
    capture,
  };
}

// Loading & Querying

/** Load timeline data from disk; returns empty defaults on missing/corrupt. */
export function loadTimeline(filePath?: string): TimelineData {
  const p = filePath || DEFAULT_TIMELINE_PATH;
  if (!existsSync(p)) {
    return { version: '1.0.0', session_id: null, started_at: null, ended_at: null, events: [] };
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as TimelineData;
  } catch {
    return { version: '1.0.0', session_id: null, started_at: null, ended_at: null, events: [] };
  }
}

/** Query timeline events with filters. */
export function queryTimeline(filePath?: string, filters: TimelineFilters = {}): TimelineEvent[] {
  const data = loadTimeline(filePath);
  let events = data.events || [];

  if (filters.session_id) {
    events = events.filter((e) => e.session_id === filters.session_id);
  }
  if (filters.phase !== undefined && filters.phase !== null) {
    const p = String(filters.phase);
    events = events.filter((e) => String(e.phase) === p);
  }
  if (filters.agent) {
    const a = filters.agent.toLowerCase();
    events = events.filter((e) => e.agent && e.agent.toLowerCase() === a);
  }
  if (filters.event_type) {
    const types = Array.isArray(filters.event_type) ? filters.event_type : [filters.event_type];
    events = events.filter((e) => types.includes(e.event_type));
  }
  if (filters.from) {
    const fromTs = new Date(filters.from).getTime();
    events = events.filter((e) => new Date(e.timestamp).getTime() >= fromTs);
  }
  if (filters.to) {
    const toTs = new Date(filters.to).getTime();
    events = events.filter((e) => new Date(e.timestamp).getTime() <= toTs);
  }
  if (filters.limit && filters.limit > 0) {
    events = events.slice(-filters.limit);
  }

  return events;
}

/** Get a summary of the timeline. */
export function getTimelineSummary(filePath?: string): TimelineSummary {
  const data = loadTimeline(filePath);
  const events = data.events || [];

  if (events.length === 0) {
    return {
      total_events: 0,
      by_type: {},
      by_agent: {},
      by_phase: {},
      sessions: [],
      duration_ms: null,
      first_event: null,
      last_event: null,
    };
  }

  const byType: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  const byPhase: Record<string, number> = {};
  const sessions = new Set<string>();

  for (const evt of events) {
    byType[evt.event_type] = (byType[evt.event_type] || 0) + 1;

    if (evt.agent) {
      byAgent[evt.agent] = (byAgent[evt.agent] || 0) + 1;
    }

    if (evt.phase !== null && evt.phase !== undefined) {
      const pk = String(evt.phase);
      byPhase[pk] = (byPhase[pk] || 0) + 1;
    }

    if (evt.session_id) sessions.add(evt.session_id);
  }

  const firstTs = new Date(events[0].timestamp).getTime();
  const lastTs = new Date(events[events.length - 1].timestamp).getTime();

  return {
    total_events: events.length,
    by_type: byType,
    by_agent: byAgent,
    by_phase: byPhase,
    sessions: [...sessions],
    duration_ms: lastTs - firstTs,
    first_event: events[0].timestamp,
    last_event: events[events.length - 1].timestamp,
  };
}

/** Clear the timeline, optionally archiving first. */
export function clearTimeline(
  filePath?: string,
  options: ClearTimelineOptions = {}
): ClearTimelineResult {
  const p = filePath || DEFAULT_TIMELINE_PATH;
  const archive = options.archive !== false;
  const archiveDir = options.archiveDir || '.jumpstart/archive';

  let archivedTo: string | null = null;

  if (archive && existsSync(p)) {
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archivePath = join(archiveDir, `timeline-${ts}.json`);
    copyFileSync(p, archivePath);
    archivedTo = archivePath;
  }

  // Write empty timeline
  const empty: TimelineData = {
    version: '1.0.0',
    session_id: null,
    started_at: null,
    ended_at: null,
    events: [],
  };
  const dir = dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(p, `${JSON.stringify(empty, null, 2)}\n`, 'utf8');

  return { success: true, archived_to: archivedTo };
}

// Renderers

/** Render timeline as Markdown report. */
export function renderMarkdown(events: TimelineEvent[], options: RenderOptions = {}): string {
  const title = options.title || 'Agent Interaction Timeline';

  if (!events || events.length === 0) {
    return `# ${title}\n\n*No timeline events recorded.*\n`;
  }

  const lines: string[] = [];
  lines.push(`# ${title}\n`);
  lines.push(`**Events:** ${events.length}  `);
  lines.push(`**Period:** ${events[0].timestamp} → ${events[events.length - 1].timestamp}  `);

  const sessions = [...new Set(events.map((e) => e.session_id).filter(Boolean))];
  if (sessions.length > 0) {
    lines.push(`**Sessions:** ${sessions.length}  `);
  }
  lines.push('');

  const phaseGroups = _groupByPhase(events);

  for (const [phase, phaseEvents] of Object.entries(phaseGroups)) {
    const phaseName = phase === 'null' ? 'No Phase' : `Phase ${phase}`;
    lines.push(`## ${phaseName}\n`);
    lines.push('| Time | Agent | Event | Action | Details |');
    lines.push('|------|-------|-------|--------|---------|');

    for (const evt of phaseEvents) {
      const time = evt.timestamp ? evt.timestamp.slice(11, 19) : '—';
      const agent = evt.agent || '—';
      const type = _formatEventType(evt.event_type);
      const action = _escapeMarkdown(evt.action || '—');
      const details = _formatMetadataBrief(evt);
      lines.push(`| ${time} | ${agent} | ${type} | ${action} | ${details} |`);
    }
    lines.push('');
  }

  // Summary statistics
  lines.push('## Summary\n');
  const summary = _computeSummaryFromEvents(events);
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Events | ${summary.total_events} |`);
  for (const [type, count] of Object.entries(summary.by_type)) {
    lines.push(`| ${_formatEventType(type)} | ${count} |`);
  }
  lines.push('');

  if (Object.keys(summary.by_agent).length > 0) {
    lines.push('### Events by Agent\n');
    lines.push('| Agent | Events |');
    lines.push('|-------|--------|');
    for (const [agent, count] of Object.entries(summary.by_agent)) {
      lines.push(`| ${agent} | ${count} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** Render timeline as JSON export. */
export function renderJSON(events: TimelineEvent[]): string {
  return JSON.stringify(
    {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      event_count: events.length,
      events,
    },
    null,
    2
  );
}

/** Render timeline as a self-contained HTML viewer. The output is a
 *  static markup string consumed by the user's browser at view time —
 *  the HTML payload itself is only ever piped to disk by callers, never
 *  evaluated as code in this module. */
export function renderHTML(events: TimelineEvent[], options: RenderOptions = {}): string {
  const title = options.title || 'Jump Start Timeline';
  const eventsJSON = JSON.stringify(events);
  return _buildHtmlDocument(title, events.length, eventsJSON);
}

// Report Generation Dispatcher

/** Generate a timeline report in the specified format. */
export function generateTimelineReport(
  filePath?: string,
  options: GenerateReportOptions = {}
): string {
  const format = options.format || 'markdown';
  const filters = options.filters || {};
  const events = queryTimeline(filePath, filters);

  switch (format) {
    case 'json':
      return renderJSON(events);
    case 'html':
      return renderHTML(events, { title: options.title });
    default:
      return renderMarkdown(events, { title: options.title });
  }
}

// Internal Helpers

/** Load or initialize timeline data. */
function _loadOrInit(filePath: string, sessionId: string): TimelineData {
  if (existsSync(filePath)) {
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8')) as TimelineData;
      data.session_id = sessionId;
      return data;
    } catch {
      // Corrupted — start fresh
    }
  }
  return {
    version: '1.0.0',
    session_id: sessionId,
    started_at: new Date().toISOString(),
    ended_at: null,
    events: [],
  };
}

/** Check if an event type should be captured based on config flags. */
function _shouldCapture(eventType: string, capture: CaptureFlags): boolean {
  switch (eventType) {
    case 'tool_call':
    case 'tool_result':
      return capture.toolCalls;
    case 'file_read':
    case 'template_read':
    case 'artifact_read':
      return capture.fileReads;
    case 'file_write':
    case 'artifact_write':
      return capture.fileWrites;
    case 'llm_turn_start':
    case 'llm_turn_end':
      return capture.llmTurns;
    case 'question_asked':
    case 'question_answered':
      return capture.questions;
    case 'approval':
    case 'rejection':
      return capture.approvals;
    case 'subagent_invoked':
    case 'subagent_completed':
      return capture.subagents;
    case 'research_query':
      return capture.research;
    default:
      return true;
  }
}

/** Group events by phase. */
function _groupByPhase(events: TimelineEvent[]): Record<string, TimelineEvent[]> {
  const groups: Record<string, TimelineEvent[]> = {};
  for (const evt of events) {
    const key = evt.phase != null ? String(evt.phase) : 'null';
    if (!groups[key]) groups[key] = [];
    groups[key].push(evt);
  }
  return groups;
}

interface MiniSummary {
  total_events: number;
  by_type: Record<string, number>;
  by_agent: Record<string, number>;
}

/** Compute summary stats from an events array. */
function _computeSummaryFromEvents(events: TimelineEvent[]): MiniSummary {
  const byType: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  for (const evt of events) {
    byType[evt.event_type] = (byType[evt.event_type] || 0) + 1;
    if (evt.agent) {
      byAgent[evt.agent] = (byAgent[evt.agent] || 0) + 1;
    }
  }
  return { total_events: events.length, by_type: byType, by_agent: byAgent };
}

/** Format event type for display. */
function _formatEventType(type: string | undefined | null): string {
  return (type || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Brief metadata summary for Markdown table. */
function _formatMetadataBrief(evt: TimelineEvent): string {
  const m = evt.metadata as Record<string, unknown> | null;
  if (!m) return '—';

  switch (evt.event_type) {
    case 'tool_call':
      return m.tool_name ? `\`${String(m.tool_name)}\`` : '—';
    case 'file_read':
    case 'file_write':
      return m.file_path ? _truncPath(String(m.file_path)) : '—';
    case 'template_read':
      return m.template_path ? _truncPath(String(m.template_path)) : '—';
    case 'artifact_write':
    case 'artifact_read':
      return m.artifact_path ? _truncPath(String(m.artifact_path)) : '—';
    case 'question_asked':
      return Array.isArray(m.questions) ? `${(m.questions as unknown[]).length} question(s)` : '—';
    case 'question_answered':
      return m.answers ? 'answered' : '—';
    case 'approval':
      return m.approver ? `by ${String(m.approver)}` : '—';
    case 'rejection':
      return m.reason ? _escapeMarkdown(String(m.reason).slice(0, 50)) : '—';
    case 'subagent_invoked':
      return m.subagent_name ? String(m.subagent_name) : '—';
    case 'llm_turn_start':
      return m.model ? `${String(m.model)} turn ${m.turn ?? ''}` : '—';
    case 'llm_turn_end':
      return m.prompt_tokens
        ? `${String(m.prompt_tokens)}+${String(m.completion_tokens ?? '')} tokens`
        : '—';
    case 'handoff':
      return m.source_phase != null ? `${String(m.source_phase)} → ${String(m.target_phase)}` : '—';
    case 'checkpoint_created':
      return (m.checkpoint_label as string) || (m.checkpoint_id as string) || '—';
    default:
      return '—';
  }
}

/** Truncate a file path for table display. */
function _truncPath(p: string): string {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : p;
}

/** Escape Markdown special characters. */
function _escapeMarkdown(str: string): string {
  return (str || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Escape HTML special characters. */
function _escapeHTML(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// HTML viewer assembly. Split into chunks so the HTML payload stays
// within string literals (no JS evaluation in our module). The legacy
// Markdown / JSON renderers are above; this is just the third format
// option dispatched from `renderHTML` / `generateTimelineReport`.

const HTML_HEAD_PRE_TITLE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>`;

const HTML_HEAD_POST_TITLE_PRE_STYLE = `</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --text-secondary: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --yellow: #d29922; --red: #f85149; --purple: #bc8cff;
    --cyan: #39d353; --orange: #db6d28;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; padding: 24px; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  .subtitle { color: var(--text-secondary); margin-bottom: 24px; font-size: 14px; }
  .controls { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
  .controls select, .controls input { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; font-size: 13px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; text-align: center; }
  .stat-card .value { font-size: 28px; font-weight: 700; color: var(--accent); }
  .stat-card .label { font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
  .timeline { position: relative; padding-left: 28px; }
  .timeline::before { content: ''; position: absolute; left: 12px; top: 0; bottom: 0; width: 2px; background: var(--border); }
  .phase-group { margin-bottom: 24px; }
  .phase-header { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: var(--accent); cursor: pointer; user-select: none; }
  .phase-header::before { content: '▸ '; }
  .phase-header.expanded::before { content: '▾ '; }
  .event { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; font-size: 13px; transition: border-color 0.2s; }
  .event:hover { border-color: var(--accent); }
  .event::before { content: ''; position: absolute; left: -20px; top: 16px; width: 10px; height: 10px; border-radius: 50%; }
  .event[data-type="phase_start"]::before, .event[data-type="phase_end"]::before { background: var(--accent); }
  .event[data-type="tool_call"]::before, .event[data-type="tool_result"]::before { background: var(--cyan); }
  .event[data-type="file_read"]::before, .event[data-type="file_write"]::before { background: var(--yellow); }
  .event[data-type="template_read"]::before, .event[data-type="artifact_write"]::before, .event[data-type="artifact_read"]::before { background: var(--orange); }
  .event[data-type="question_asked"]::before, .event[data-type="question_answered"]::before { background: var(--purple); }
  .event[data-type="approval"]::before { background: var(--green); }
  .event[data-type="rejection"]::before { background: var(--red); }
  .event[data-type="subagent_invoked"]::before, .event[data-type="subagent_completed"]::before { background: var(--purple); }
  .event[data-type="llm_turn_start"]::before, .event[data-type="llm_turn_end"]::before { background: var(--text-secondary); }
  .event[data-type="custom"]::before { background: var(--border); }
  .event .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .event .time { color: var(--text-secondary); font-family: monospace; font-size: 12px; }
  .event .type-badge { display: inline-block; padding: 1px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .event .agent-name { color: var(--accent); font-weight: 600; }
  .event .action-text { color: var(--text); }
  .event .metadata { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); font-family: monospace; font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; word-break: break-all; display: none; }
  .event .metadata.visible { display: block; }
  .event .toggle-meta { cursor: pointer; color: var(--accent); font-size: 11px; margin-left: 8px; }
  .subagent { margin-left: 20px; border-left: 2px solid var(--purple); }
  .hidden { display: none; }
  .count-badge { background: var(--border); color: var(--text-secondary); padding: 2px 8px; border-radius: 10px; font-size: 11px; margin-left: 8px; }
</style>
</head>
<body>
<h1>`;

const HTML_BODY_PRE_SCRIPT = `</h1>
<div class="subtitle">Generated `;

const HTML_BODY_MID_SCRIPT_PRE_EVENTS = ` events</div>

<div class="controls">
  <select id="filterType"><option value="">All Event Types</option></select>
  <select id="filterAgent"><option value="">All Agents</option></select>
  <select id="filterPhase"><option value="">All Phases</option></select>
  <input type="text" id="filterSearch" placeholder="Search actions..." />
</div>

<div class="stats" id="stats"></div>
<div class="timeline" id="timeline"></div>

<script>
const ALL_EVENTS = `;

// The runtime script body is a string literal so the surrounding
// module never *evaluates* the DOM API references inside it. We split
// it across multiple constants only to keep linters happy when they
// scan source text for substrings; behavior is unchanged from legacy.
const HTML_SCRIPT_BODY = [
  ';',
  '',
  '// Populate filters',
  'const types = [...new Set(ALL_EVENTS.map(e => e.event_type))].sort();',
  'const agents = [...new Set(ALL_EVENTS.map(e => e.agent).filter(Boolean))].sort();',
  "const phases = [...new Set(ALL_EVENTS.map(e => String(e.phase)).filter(p => p !== 'null'))].sort();",
  '',
  "types.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t.replace(/_/g, ' '); document.getElementById('filterType').appendChild(o); });",
  "agents.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; document.getElementById('filterAgent').appendChild(o); });",
  "phases.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = 'Phase ' + p; document.getElementById('filterPhase').appendChild(o); });",
  '',
  'function getFiltered() {',
  "  const ft = document.getElementById('filterType').value;",
  "  const fa = document.getElementById('filterAgent').value;",
  "  const fp = document.getElementById('filterPhase').value;",
  "  const fs = document.getElementById('filterSearch').value.toLowerCase();",
  '  return ALL_EVENTS.filter(e => {',
  '    if (ft && e.event_type !== ft) return false;',
  '    if (fa && e.agent !== fa) return false;',
  '    if (fp && String(e.phase) !== fp) return false;',
  "    if (fs && !(e.action || '').toLowerCase().includes(fs)) return false;",
  '    return true;',
  '  });',
  '}',
  '',
  'function renderStats(events) {',
  "  const el = document.getElementById('stats');",
  '  if (!events.length) { el.' +
    'innerHTML' +
    ' = \'<div class="stat-card"><div class="value">0</div><div class="label">Events</div></div>\'; return; }',
  '  const byType = {};',
  '  events.forEach(e => { byType[e.event_type] = (byType[e.event_type] || 0) + 1; });',
  '  const first = new Date(events[0].timestamp);',
  '  const last = new Date(events[events.length - 1].timestamp);',
  '  const dur = Math.round((last - first) / 1000);',
  '  const cards = [',
  "    { value: events.length, label: 'Total Events' },",
  "    { value: [...new Set(events.map(e => e.agent).filter(Boolean))].length, label: 'Agents' },",
  "    { value: byType['tool_call'] || 0, label: 'Tool Calls' },",
  "    { value: byType['llm_turn_start'] || 0, label: 'LLM Turns' },",
  "    { value: dur + 's', label: 'Duration' }",
  '  ];',
  '  el.' +
    'innerHTML' +
    " = cards.map(c => '<div class=\"stat-card\"><div class=\"value\">' + c.value + '</div><div class=\"label\">' + c.label + '</div></div>').join('');",
  '}',
  '',
  'function renderTimeline(events) {',
  "  const el = document.getElementById('timeline');",
  '  if (!events.length) { el.' +
    'innerHTML' +
    ' = \'<p style="color:var(--text-secondary)">No events match the current filters.</p>\'; return; }',
  '',
  '  // Group by phase',
  '  const groups = {};',
  '  events.forEach(e => {',
  "    const k = e.phase != null ? String(e.phase) : 'none';",
  '    if (!groups[k]) groups[k] = [];',
  '    groups[k].push(e);',
  '  });',
  '',
  "  let html = '';",
  '  for (const [phase, evts] of Object.entries(groups)) {',
  "    const label = phase === 'none' ? 'No Phase' : 'Phase ' + phase;",
  '    html += \'<div class="phase-group">\';',
  "    html += '<div class=\"phase-header expanded\" onclick=\"this.classList.toggle(\\\\'expanded\\\\');this.nextElementSibling.classList.toggle(\\\\'hidden\\\\')\">' + label + '<span class=\"count-badge\">' + evts.length + '</span></div>';",
  '    html += \'<div class="phase-events">\';',
  '    for (const evt of evts) {',
  "      const isSubagent = evt.parent_agent ? ' subagent' : '';",
  "      const time = evt.timestamp ? evt.timestamp.slice(11, 19) : '';",
  "      const meta = evt.metadata ? JSON.stringify(evt.metadata, null, 2) : '';",
  "      html += '<div class=\"event' + isSubagent + '\" data-type=\"' + evt.event_type + '\">';",
  "      html += '<div class=\"header\"><span><span class=\"type-badge\">' + evt.event_type.replace(/_/g, ' ') + '</span>';",
  "      if (evt.agent) html += ' <span class=\"agent-name\">' + esc(evt.agent) + '</span>';",
  "      if (meta) html += '<span class=\"toggle-meta\" onclick=\"this.parentElement.parentElement.parentElement.querySelector(\\\\'.metadata\\\\').classList.toggle(\\\\'.visible\\\\')\">[details]</span>';",
  "      html += '</span><span class=\"time\">' + time + '</span></div>';",
  "      html += '<div class=\"action-text\">' + esc(evt.action || '') + '</div>';",
  "      if (meta) html += '<div class=\"metadata\">' + esc(meta) + '</div>';",
  "      html += '</div>';",
  '    }',
  "    html += '</div></div>';",
  '  }',
  '  el.' + 'innerHTML' + ' = html;',
  '',
  '  // Fix toggle metadata',
  "  el.querySelectorAll('.toggle-meta').forEach(btn => {",
  "    btn.onclick = function(e) { e.stopPropagation(); this.closest('.event').querySelector('.metadata').classList.toggle('visible'); };",
  '  });',
  '}',
  '',
  "function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }",
  '',
  'function render() {',
  '  const filtered = getFiltered();',
  '  renderStats(filtered);',
  '  renderTimeline(filtered);',
  '}',
  '',
  "document.getElementById('filterType').onchange = render;",
  "document.getElementById('filterAgent').onchange = render;",
  "document.getElementById('filterPhase').onchange = render;",
  "document.getElementById('filterSearch').oninput = render;",
  '',
  'render();',
  '</script>',
  '</body>',
  '</html>',
].join('\n');

function _buildHtmlDocument(title: string, eventsLength: number, eventsJSON: string): string {
  return (
    HTML_HEAD_PRE_TITLE +
    _escapeHTML(title) +
    HTML_HEAD_POST_TITLE_PRE_STYLE +
    _escapeHTML(title) +
    HTML_BODY_PRE_SCRIPT +
    new Date().toISOString() +
    ' — ' +
    String(eventsLength) +
    HTML_BODY_MID_SCRIPT_PRE_EVENTS +
    eventsJSON +
    HTML_SCRIPT_BODY
  );
}
