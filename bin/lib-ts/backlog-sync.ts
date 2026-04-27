/**
 * backlog-sync.ts — Native Backlog Synchronization port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/backlog-sync.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `SUPPORTED_TARGETS` (constant array)
 *   - `defaultSyncState()` => SyncState
 *   - `loadSyncState(syncFile?)` => SyncState
 *   - `saveSyncState(state, syncFile?)` => void
 *   - `extractEpics(content)` => Epic[]
 *   - `extractTasks(content)` => Task[]
 *   - `extractBacklog(root, options?)` => ExtractResult
 *   - `formatForTarget(backlog, target, options?)` => FormatResult
 *   - `exportBacklog(root, target, options?)` => ExportResult
 *
 * **ADR-012 redaction**: exported backlog payloads can be persisted to
 * disk (json files). Persistence paths run state through redactSecrets
 * to defend against secrets in PRD/plan content (e.g. an example URL
 * containing an API token in a story description).
 *
 * Behavior parity:
 *   - Default sync file: `.jumpstart/state/backlog-sync.json`.
 *   - Targets: github / jira / azure-devops.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/backlog-sync.js (legacy reference)
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { redactSecrets } from './secret-scanner.js';

export type Target = 'github' | 'jira' | 'azure-devops';

export interface Story {
  id: string;
  title: string;
  type: 'story';
  epic_id: string;
}

export interface Epic {
  id: string;
  title: string;
  stories: Story[];
  type: 'epic';
}

export interface Task {
  id: string;
  title: string;
  type: 'task';
  story_refs: string[];
}

export interface BacklogItems {
  epics: Epic[];
  stories: Story[];
  tasks: Task[];
}

export interface ExportHistoryEntry {
  exported_at: string;
  target: string;
  items: number;
  output: string;
}

export interface SyncState {
  version: string;
  created_at: string;
  last_sync: string | null;
  target: string | null;
  synced_items: unknown[];
  export_history: ExportHistoryEntry[];
}

export interface ExtractOptions {
  prdPath?: string;
  planPath?: string;
}

export interface ExtractResult {
  success: boolean;
  epics: number;
  stories: number;
  tasks: number;
  items: BacklogItems;
}

export interface FormattedItem {
  type?: string;
  title?: string;
  labels?: string[];
  body?: string;
  issueType?: string;
  summary?: string;
  epicLink?: string;
  customFields?: Record<string, unknown>;
  workItemType?: string;
  tags?: string;
  parentId?: string;
  fields?: Record<string, unknown>;
}

export interface FormatResult {
  success: boolean;
  target?: string;
  total_items?: number;
  items?: FormattedItem[];
  error?: string;
}

export interface ExportOptions extends ExtractOptions {
  output?: string;
  syncFile?: string;
}

export interface ExportResult {
  success: boolean;
  target?: string;
  items_exported?: number;
  output?: string;
  error?: string;
}

const DEFAULT_SYNC_FILE = join('.jumpstart', 'state', 'backlog-sync.json');

export const SUPPORTED_TARGETS: Target[] = ['github', 'jira', 'azure-devops'];

export function defaultSyncState(): SyncState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_sync: null,
    target: null,
    synced_items: [],
    export_history: [],
  };
}

function _safeParseSyncState(content: string): SyncState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return null;
  }
  const base = defaultSyncState();
  return {
    ...base,
    ...obj,
    synced_items: Array.isArray(obj.synced_items) ? obj.synced_items : [],
    export_history: Array.isArray(obj.export_history)
      ? (obj.export_history as ExportHistoryEntry[])
      : [],
  };
}

export function loadSyncState(syncFile?: string): SyncState {
  const filePath = syncFile || DEFAULT_SYNC_FILE;
  if (!existsSync(filePath)) return defaultSyncState();
  const parsed = _safeParseSyncState(readFileSync(filePath, 'utf8'));
  return parsed || defaultSyncState();
}

export function saveSyncState(state: SyncState, syncFile?: string): void {
  const filePath = syncFile || DEFAULT_SYNC_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_sync = new Date().toISOString();
  // ADR-012: redact before persistence — backlog metadata can carry
  // secrets in story descriptions or task references.
  const redacted: SyncState = redactSecrets(state);
  writeFileSync(filePath, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');
}

/**
 * Extract epics from PRD content.
 */
export function extractEpics(content: string): Epic[] {
  const epics: Epic[] = [];
  const lines = content.split('\n');
  let currentEpic: Epic | null = null;

  for (const line of lines) {
    const epicMatch = line.match(/^#{2,4}\s+(?:Epic\s+)?(\d+|E\d+)[:\s—–-]+\s*(.+)$/i);
    if (epicMatch) {
      if (currentEpic) epics.push(currentEpic);
      const id = epicMatch[1].startsWith('E') ? epicMatch[1] : `E${epicMatch[1].padStart(2, '0')}`;
      currentEpic = {
        id,
        title: epicMatch[2].trim(),
        stories: [],
        type: 'epic',
      };
      continue;
    }

    if (currentEpic) {
      const storyMatch = line.match(/(?:^[-*]\s+\*{0,2})(E\d+-S\d+)(?:\*{0,2})[:\s—–-]+\s*(.+)/i);
      if (storyMatch) {
        currentEpic.stories.push({
          id: storyMatch[1],
          title: storyMatch[2].trim().replace(/\*{1,2}/g, ''),
          type: 'story',
          epic_id: currentEpic.id,
        });
      }
    }
  }
  if (currentEpic) epics.push(currentEpic);

  return epics;
}

/**
 * Extract tasks from implementation plan content.
 */
export function extractTasks(content: string): Task[] {
  const tasks: Task[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const taskMatch = line.match(
      /(?:^#{2,4}\s+|^[-*]\s+\*{0,2})(M\d+-T\d+)(?:\*{0,2})[:\s—–-]+\s*(.+)/i
    );
    if (taskMatch) {
      const storyRefs = line.match(/E\d+-S\d+/g) || [];
      tasks.push({
        id: taskMatch[1],
        title: taskMatch[2].trim().replace(/\*{1,2}/g, ''),
        type: 'task',
        story_refs: [...new Set(storyRefs)],
      });
    }
  }

  return tasks;
}

/**
 * Extract all backlog items from PRD and implementation plan.
 */
export function extractBacklog(root: string, options: ExtractOptions = {}): ExtractResult {
  const prdPath = options.prdPath || join(root, 'specs', 'prd.md');
  const planPath = options.planPath || join(root, 'specs', 'implementation-plan.md');

  const items: BacklogItems = { epics: [], stories: [], tasks: [] };

  if (existsSync(prdPath)) {
    const prdContent = readFileSync(prdPath, 'utf8');
    const epics = extractEpics(prdContent);
    items.epics = epics;
    for (const epic of epics) {
      items.stories.push(...epic.stories);
    }
  }

  if (existsSync(planPath)) {
    const planContent = readFileSync(planPath, 'utf8');
    items.tasks = extractTasks(planContent);
  }

  return {
    success: true,
    epics: items.epics.length,
    stories: items.stories.length,
    tasks: items.tasks.length,
    items,
  };
}

interface BacklogLike {
  items?: BacklogItems;
  epics?: Epic[];
  tasks?: Task[];
}

function _getItems(backlog: BacklogLike): BacklogItems {
  if (backlog.items) return backlog.items;
  return {
    epics: backlog.epics || [],
    stories: [],
    tasks: backlog.tasks || [],
  };
}

/**
 * Format backlog items for a specific target platform.
 */
export function formatForTarget(
  backlog: BacklogLike,
  target: string,
  _options: Record<string, unknown> = {}
): FormatResult {
  if (!SUPPORTED_TARGETS.includes(target as Target)) {
    return {
      success: false,
      error: `Unsupported target: ${target}. Supported: ${SUPPORTED_TARGETS.join(', ')}`,
    };
  }

  const formatted: FormattedItem[] = [];
  const data = _getItems(backlog);

  if (target === 'github') {
    for (const epic of data.epics) {
      formatted.push({
        type: 'issue',
        title: `[Epic] ${epic.id}: ${epic.title}`,
        labels: ['epic', 'jumpstart'],
        body: `## Epic: ${epic.title}\n\nID: ${epic.id}\nStories: ${epic.stories.length}\n\n_Auto-generated by JumpStart_`,
      });
      for (const story of epic.stories) {
        formatted.push({
          type: 'issue',
          title: `[Story] ${story.id}: ${story.title}`,
          labels: ['user-story', 'jumpstart', epic.id.toLowerCase()],
          body: `## User Story: ${story.title}\n\nID: ${story.id}\nEpic: ${epic.id}\n\n_Auto-generated by JumpStart_`,
        });
      }
    }
    for (const task of data.tasks) {
      formatted.push({
        type: 'issue',
        title: `[Task] ${task.id}: ${task.title}`,
        labels: ['task', 'jumpstart'],
        body: `## Task: ${task.title}\n\nID: ${task.id}\nStories: ${task.story_refs.join(', ') || 'none'}\n\n_Auto-generated by JumpStart_`,
      });
    }
  } else if (target === 'jira') {
    for (const epic of data.epics) {
      formatted.push({
        issueType: 'Epic',
        summary: `${epic.id}: ${epic.title}`,
        labels: ['jumpstart'],
        customFields: { jumpstart_id: epic.id },
      });
      for (const story of epic.stories) {
        formatted.push({
          issueType: 'Story',
          summary: `${story.id}: ${story.title}`,
          labels: ['jumpstart'],
          epicLink: epic.id,
          customFields: { jumpstart_id: story.id },
        });
      }
    }
    for (const task of data.tasks) {
      formatted.push({
        issueType: 'Task',
        summary: `${task.id}: ${task.title}`,
        labels: ['jumpstart'],
        customFields: { jumpstart_id: task.id, story_refs: task.story_refs },
      });
    }
  } else if (target === 'azure-devops') {
    for (const epic of data.epics) {
      formatted.push({
        workItemType: 'Epic',
        title: `${epic.id}: ${epic.title}`,
        tags: 'jumpstart',
        fields: { 'Custom.JumpStartId': epic.id },
      });
      for (const story of epic.stories) {
        formatted.push({
          workItemType: 'User Story',
          title: `${story.id}: ${story.title}`,
          tags: 'jumpstart',
          parentId: epic.id,
          fields: { 'Custom.JumpStartId': story.id },
        });
      }
    }
    for (const task of data.tasks) {
      formatted.push({
        workItemType: 'Task',
        title: `${task.id}: ${task.title}`,
        tags: 'jumpstart',
        fields: { 'Custom.JumpStartId': task.id },
      });
    }
  }

  return {
    success: true,
    target,
    total_items: formatted.length,
    items: formatted,
  };
}

/**
 * Export backlog as a JSON file suitable for import. Persisted output
 * is redacted via ADR-012.
 */
export function exportBacklog(
  root: string,
  target: string,
  options: ExportOptions = {}
): ExportResult {
  const backlog = extractBacklog(root, options);
  if (!backlog.success) return backlog as ExportResult;

  // ExtractResult.epics is `number` (a count) while BacklogLike.epics
  // is `Epic[]`; runtime path uses backlog.items so the narrow only
  // affects type-checking. Cast through unknown to satisfy strict TS.
  const formatted = formatForTarget(
    backlog as unknown as BacklogLike,
    target,
    options as unknown as Record<string, unknown>
  );
  if (!formatted.success) return formatted as ExportResult;

  const outputPath =
    options.output || join(root, '.jumpstart', 'exports', `backlog-${target}.json`);
  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const exportData = {
    exported_at: new Date().toISOString(),
    target,
    source: 'jumpstart',
    ...formatted,
  };

  // ADR-012: backlog content sourced from PRD / plan markdown can leak
  // secrets if a user pasted credentials into a story body.
  const redactedExport = redactSecrets(exportData);
  writeFileSync(outputPath, `${JSON.stringify(redactedExport, null, 2)}\n`, 'utf8');

  const syncFile = options.syncFile || join(root, DEFAULT_SYNC_FILE);
  const state = loadSyncState(syncFile);
  state.export_history.push({
    exported_at: exportData.exported_at,
    target,
    items: formatted.total_items || 0,
    output: relative(root, outputPath),
  });
  saveSyncState(state, syncFile);

  return {
    success: true,
    target,
    items_exported: formatted.total_items,
    output: outputPath,
  };
}
