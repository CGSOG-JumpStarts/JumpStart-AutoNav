/**
 * project-memory.ts — persistent project memory port (T4.3.3, cluster H).
 *
 * Pure-library port of `bin/lib/project-memory.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `MEMORY_TYPES` (constant array)
 *   - `defaultMemoryStore()` => MemoryStore
 *   - `loadMemoryStore(memoryFile?)` => MemoryStore
 *   - `saveMemoryStore(store, memoryFile?)`
 *   - `addMemory(entry, options?)` => AddMemoryResult
 *   - `listMemories(filter?, options?)` => ListMemoriesResult
 *   - `searchMemories(keyword, options?)` => SearchMemoriesResult
 *   - `recallMemory(id, options?)` => RecallMemoryResult
 *   - `deleteMemory(id, options?)` => DeleteMemoryResult
 *   - `getMemoryStats(options?)` => MemoryStats
 *
 * Behavior parity:
 *   - Default state file: `.jumpstart/state/project-memory.json`.
 *   - Memory ID format: `mem-<unix-ms>-<random6>`.
 *   - Default type if omitted: `other`. Type lookup is lower-cased.
 *   - JSON parse failures load default store silently.
 *
 * @see bin/lib/project-memory.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Public types

export type MemoryType = 'decision' | 'rejection' | 'pitfall' | 'tribal' | 'insight' | 'other';

export interface MemoryEntry {
  id: string;
  type: string;
  title: string;
  content: string;
  tags: string[];
  author: string | null;
  phase: number | string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryEntryInput {
  type?: string;
  title?: string;
  content?: string;
  tags?: string[];
  author?: string | null;
  phase?: number | string | null;
}

export interface MemoryStore {
  version: string;
  created_at: string;
  last_updated: string | null;
  entries: MemoryEntry[];
}

export interface MemoryFileOptions {
  memoryFile?: string;
}

export interface AddMemoryResult {
  success: boolean;
  entry?: MemoryEntry;
  total?: number;
  error?: string;
}

export interface ListMemoriesFilter {
  type?: string;
  tag?: string;
  phase?: number | string | null;
}

export interface ListMemoriesResult {
  success: boolean;
  entries: MemoryEntry[];
  total: number;
}

export interface SearchMemoriesResult {
  success: boolean;
  keyword?: string;
  entries?: MemoryEntry[];
  total?: number;
  error?: string;
}

export interface RecallMemoryResult {
  success: boolean;
  entry?: MemoryEntry;
  error?: string;
}

export interface DeleteMemoryResult {
  success: boolean;
  removed?: MemoryEntry;
  total?: number;
  error?: string;
}

export interface MemoryStats {
  total: number;
  by_type: Record<string, number>;
  last_updated: string | null;
}

// Constants (verbatim from legacy)

const DEFAULT_MEMORY_FILE = join('.jumpstart', 'state', 'project-memory.json');

export const MEMORY_TYPES: MemoryType[] = [
  'decision',
  'rejection',
  'pitfall',
  'tribal',
  'insight',
  'other',
];

// Implementation

/** Default memory store structure. */
export function defaultMemoryStore(): MemoryStore {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    entries: [],
  };
}

/** Load the memory store from disk; defaults on missing/corrupt. */
export function loadMemoryStore(memoryFile?: string): MemoryStore {
  // Pit Crew M4 Adversary F13: validate parsed shape before returning.
  // Soft-fall to default on any shape mismatch.
  const filePath = memoryFile || DEFAULT_MEMORY_FILE;
  if (!existsSync(filePath)) {
    return defaultMemoryStore();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return defaultMemoryStore();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaultMemoryStore();
  }
  const obj = parsed as Partial<MemoryStore>;
  if (!Array.isArray(obj.entries)) {
    return defaultMemoryStore();
  }
  const base = defaultMemoryStore();
  return {
    version: typeof obj.version === 'string' ? obj.version : base.version,
    created_at: typeof obj.created_at === 'string' ? obj.created_at : base.created_at,
    last_updated: typeof obj.last_updated === 'string' ? obj.last_updated : null,
    entries: obj.entries,
  };
}

/** Persist the memory store to disk. Stamps last_updated, trailing newline. */
export function saveMemoryStore(store: MemoryStore, memoryFile?: string): void {
  const filePath = memoryFile || DEFAULT_MEMORY_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  store.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

/** Append a new memory entry to the store. */
export function addMemory(
  entry: MemoryEntryInput,
  options: MemoryFileOptions = {}
): AddMemoryResult {
  if (!entry?.title || !entry.content) {
    return { success: false, error: 'entry.title and entry.content are required' };
  }

  const type = (entry.type || 'other').toLowerCase();
  if (!MEMORY_TYPES.includes(type as MemoryType)) {
    return { success: false, error: `type must be one of: ${MEMORY_TYPES.join(', ')}` };
  }

  const memoryFile = options.memoryFile || DEFAULT_MEMORY_FILE;
  const store = loadMemoryStore(memoryFile);

  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newEntry: MemoryEntry = {
    id,
    type,
    title: entry.title.trim(),
    content: entry.content.trim(),
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    author: entry.author || null,
    phase: entry.phase !== undefined ? entry.phase : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  store.entries.push(newEntry);
  saveMemoryStore(store, memoryFile);

  return { success: true, entry: newEntry, total: store.entries.length };
}

/** List memory entries, optionally filtered by type/tag/phase. */
export function listMemories(
  filter: ListMemoriesFilter = {},
  options: MemoryFileOptions = {}
): ListMemoriesResult {
  const memoryFile = options.memoryFile || DEFAULT_MEMORY_FILE;
  const store = loadMemoryStore(memoryFile);

  let entries = store.entries;

  if (filter.type) {
    entries = entries.filter((e) => e.type === filter.type);
  }

  if (filter.tag) {
    entries = entries.filter((e) => e.tags?.includes(filter.tag as string));
  }

  if (filter.phase !== undefined && filter.phase !== null) {
    entries = entries.filter((e) => e.phase === filter.phase);
  }

  return { success: true, entries, total: entries.length };
}

/** Search memory entries by keyword in title, content, or tags. */
export function searchMemories(
  keyword: string,
  options: MemoryFileOptions = {}
): SearchMemoriesResult {
  if (!keyword || typeof keyword !== 'string') {
    return { success: false, error: 'keyword is required' };
  }

  const memoryFile = options.memoryFile || DEFAULT_MEMORY_FILE;
  const store = loadMemoryStore(memoryFile);

  const lower = keyword.toLowerCase();
  const entries = store.entries.filter(
    (e) =>
      e.title.toLowerCase().includes(lower) ||
      e.content.toLowerCase().includes(lower) ||
      e.tags?.some((t) => t.toLowerCase().includes(lower))
  );

  return { success: true, keyword, entries, total: entries.length };
}

/** Recall (get) a specific memory entry by ID. */
export function recallMemory(id: string, options: MemoryFileOptions = {}): RecallMemoryResult {
  const memoryFile = options.memoryFile || DEFAULT_MEMORY_FILE;
  const store = loadMemoryStore(memoryFile);

  const entry = store.entries.find((e) => e.id === id);
  if (!entry) {
    return { success: false, error: `Memory entry not found: ${id}` };
  }

  return { success: true, entry };
}

/** Delete a memory entry by ID. */
export function deleteMemory(id: string, options: MemoryFileOptions = {}): DeleteMemoryResult {
  const memoryFile = options.memoryFile || DEFAULT_MEMORY_FILE;
  const store = loadMemoryStore(memoryFile);

  const idx = store.entries.findIndex((e) => e.id === id);
  if (idx === -1) {
    return { success: false, error: `Memory entry not found: ${id}` };
  }

  const [removed] = store.entries.splice(idx, 1);
  saveMemoryStore(store, memoryFile);

  return { success: true, removed, total: store.entries.length };
}

/** Aggregated memory statistics grouped by type. */
export function getMemoryStats(options: MemoryFileOptions = {}): MemoryStats {
  const memoryFile = options.memoryFile || DEFAULT_MEMORY_FILE;
  const store = loadMemoryStore(memoryFile);

  const byType: Record<string, number> = {};
  for (const type of MEMORY_TYPES) {
    byType[type] = store.entries.filter((e) => e.type === type).length;
  }

  return {
    total: store.entries.length,
    by_type: byType,
    last_updated: store.last_updated,
  };
}
