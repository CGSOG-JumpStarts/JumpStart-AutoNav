/**
 * tool-bridge.ts — VS Code Tool Emulation Bridge port (T4.6.3, M7).
 *
 * Pure-library port of `bin/lib/tool-bridge.js`. Public surface preserved
 * verbatim by name + signature shape:
 *
 *   - `createToolBridge(options)` => ToolBridge
 *     .execute(toolCall) -> Promise<{ content: string }>
 *     .getTodoState()    -> TodoItem[]
 *     .getCallHistory()  -> ToolCallRecord[]
 *
 * Behavior parity:
 *   - Tool dispatch keyed by `toolCall.function.name`. Unknown names
 *     return `{ error: "Unknown tool: <name>" }` JSON-stringified
 *     (matches legacy "do not throw" contract — the headless runner
 *     surfaces tool errors back to the LLM in-conversation).
 *   - Tool args parsed from `toolCall.function.arguments` (string JSON)
 *     with `{}` default when absent.
 *   - Timeline event emission preserved verbatim (granular file_read /
 *     artifact_read / template_read / file_write / artifact_write /
 *     question_asked events on top of the generic tool_call/tool_result
 *     pair).
 *   - Tracer forwarding: when `options.tracer` is provided AND has a
 *     `logToolInterception` method, every successful dispatch is logged.
 *
 * **ADR-012 redaction (NEW in this port).**
 *   The bridge itself doesn't write to disk, BUT it routes
 *   `marketplace_install` / `log_usage` / `record_timeline_event` calls
 *   through downstream modules whose ports already redact. The
 *   defense-in-depth posture here is to NOT add a second redaction
 *   layer (which would risk double-replacement of legitimately-quoted
 *   strings) — instead we trust the downstream usage.ts / timeline.ts /
 *   install.ts redaction wiring.
 *
 * **Path-safety hardening (NEW in this port).**
 *   `read_file` / `create_file` / `replace_string_in_file` accept
 *   absolute paths from the LLM. The legacy was permissive — we
 *   continue to be permissive on agent-supplied absolute paths
 *   (the bridge runs inside a workspace the user already trusts —
 *   the same threat model documented in ADR-009 for path-safety).
 *   `file_search` / `grep_search` walks remain rooted at
 *   `workspaceDir` and never follow paths outside it.
 *
 * **Cross-module dynamic imports.**
 *   Legacy uses CommonJS `require('./install')` for marketplace_install
 *   and dynamic `await import('./X.js')` for the item-tagged tools.
 *   The TS port keeps the dynamic import shape (so tools that aren't
 *   used don't get loaded) and uses static imports only for
 *   `secret-scanner` (already loaded by other modules) and `usage`.
 *
 *   - install / smoke-tester / secret-scanner / type-checker /
 *     uat-coverage are dispatched via dynamic `import()` keyed off the
 *     ported `.js` filename, falling back to the legacy `.js` path
 *     when the TS port hasn't landed yet (a strangler-phase necessity
 *     during M7 — adr-index, complexity, crossref, init, locks,
 *     timestamps, scanner, revert, type-checker, uat-coverage are
 *     STILL legacy in the JS sibling tree).
 *
 * **No `process.exit` in library code.**
 *   The legacy file has no CLI entry block, so nothing to skip.
 *
 * @see bin/lib/tool-bridge.js (legacy reference)
 * @see specs/decisions/adr-009-ipc-stdin-path-traversal.md
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.6.3
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertInsideRoot } from './path-safety.js';
import type { TimelineLike } from './simulation-tracer.js';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

/**
 * Minimal tracer duck-type. The bridge only cares that the object can
 * accept a tool-interception event.
 */
export interface TracerLike {
  logToolInterception?(toolName: string, args: unknown, result: unknown): void;
  // Allow forward-compat fields without surfacing `any`.
  [key: string]: unknown;
}

export type UserProxyCallback = (args: unknown) => Promise<unknown> | unknown;

export interface ToolBridgeOptions {
  workspaceDir: string;
  tracer?: TracerLike | null;
  dryRun?: boolean;
  onUserProxyCall?: UserProxyCallback | null;
  timeline?: TimelineLike | null;
}

export interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments?: string;
  };
}

export interface ToolCallRecord {
  id: string | undefined;
  name: string;
  args: Record<string, unknown>;
  timestamp: number;
}

export interface TodoItem {
  id: number;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed';
}

export interface ToolBridge {
  execute(toolCall: ToolCall): Promise<{ content: string }>;
  getTodoState(): TodoItem[];
  getCallHistory(): ToolCallRecord[];
}

type Handler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

// ─────────────────────────────────────────────────────────────────────────
// Helper utilities
// ─────────────────────────────────────────────────────────────────────────

/**
 * Try a list of module specifiers in order; return the first one that
 * resolves. Used by the item-tagged feature handlers so a partially-
 * ported sibling tree (some modules in `bin/lib-ts/`, others still in
 * `bin/lib/`) keeps working through the strangler phase.
 */
async function dynImportFirst(specifiers: string[]): Promise<Record<string, unknown> | null> {
  for (const spec of specifiers) {
    try {
      const mod = await import(spec);
      if (mod && typeof mod === 'object') {
        return mod as Record<string, unknown>;
      }
    } catch {
      // try next specifier
    }
  }
  return null;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// ─────────────────────────────────────────────────────────────────────────
// Bridge factory
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a tool bridge that executes tool calls against a workspace
 * directory.
 */
export function createToolBridge(options: ToolBridgeOptions): ToolBridge {
  const {
    workspaceDir,
    tracer = null,
    dryRun = false,
    onUserProxyCall = null,
    timeline = null,
  } = options;

  const callHistory: ToolCallRecord[] = [];
  let todoState: TodoItem[] = [];

  /**
   * Pit Crew M7 HIGH (Reviewer + Adversary): file-touching tools
   * (`read_file` / `create_file` / `replace_string_in_file` / `list_dir`)
   * previously accepted arbitrary absolute paths from the LLM, citing
   * "the bridge runs inside a workspace the user already trusts." The
   * threat model explicitly includes malicious .agent.md prompts —
   * which IS the attack vector for this surface. Post-fix: every
   * file-touching tool gates its path through `assertInsideRoot` against
   * `workspaceDir`. Returns a structured error result on escape so the
   * agent loop can keep going (vs throwing — `tool-bridge` returns
   * informational errors to the LLM by convention).
   */
  function gateInsideWorkspace(p: string): { error: string } | null {
    try {
      assertInsideRoot(p, workspaceDir, { schemaId: 'tool-bridge-path' });
      return null;
    } catch (err) {
      return { error: `Path escapes workspace: ${(err as Error).message}` };
    }
  }

  // ── Tool Handlers ─────────────────────────────────────────────────────
  const handlers: Record<string, Handler> = {
    async read_file(args) {
      const filePath = asString(args.filePath);
      if (!filePath) return { error: 'filePath is required' };
      const gateErr = gateInsideWorkspace(filePath);
      if (gateErr) return gateErr;
      const startLine = typeof args.startLine === 'number' ? args.startLine : 1;
      const endLine = typeof args.endLine === 'number' ? args.endLine : undefined;
      if (!existsSync(filePath)) {
        return { error: `File not found: ${filePath}` };
      }
      const raw = readFileSync(filePath, 'utf8');
      const lines = raw.split('\n');
      const totalLines = lines.length;
      const end = endLine != null ? Math.min(endLine, totalLines) : totalLines;
      const selected = lines.slice(startLine - 1, end);
      return { content: selected.join('\n'), totalLines };
    },

    async create_file(args) {
      const filePath = asString(args.filePath);
      const content = asString(args.content);
      if (!filePath) return { error: 'filePath is required' };
      if (content === undefined) return { error: 'content is required' };
      const gateErr = gateInsideWorkspace(filePath);
      if (gateErr) return gateErr;
      if (dryRun) {
        return { success: true, dryRun: true, filePath };
      }
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, content, 'utf8');
      return { success: true, filePath };
    },

    async list_dir(args) {
      const dirPath = asString(args.path);
      if (!dirPath) return { error: 'path is required' };
      const gateErr = gateInsideWorkspace(dirPath);
      if (gateErr) return gateErr;
      if (!existsSync(dirPath)) {
        return { error: `Directory not found: ${dirPath}` };
      }
      const entries = readdirSync(dirPath, { withFileTypes: true });
      const items = entries.map((e) => ({
        name: e.isDirectory() ? `${e.name}/` : e.name,
        type: e.isDirectory() ? 'directory' : 'file',
      }));
      return { items };
    },

    async replace_string_in_file(args) {
      const filePath = asString(args.filePath);
      const oldString = asString(args.oldString);
      const newString = asString(args.newString);
      if (!filePath) return { error: 'filePath is required' };
      if (oldString === undefined) return { error: 'oldString is required' };
      if (newString === undefined) return { error: 'newString is required' };
      const gateErr = gateInsideWorkspace(filePath);
      if (gateErr) return gateErr;
      if (!existsSync(filePath)) {
        return { error: `File not found: ${filePath}` };
      }
      if (dryRun) {
        return { success: true, dryRun: true };
      }
      let content = readFileSync(filePath, 'utf8');
      if (!content.includes(oldString)) {
        return { error: 'oldString not found in file' };
      }
      content = content.replace(oldString, newString);
      writeFileSync(filePath, content, 'utf8');
      return { success: true };
    },

    async file_search(args) {
      const query = asString(args.query);
      if (!query) return { matches: [] };
      const matches: string[] = [];
      // Convert glob to regex
      const pattern = query
        .replace(/\*\*/g, '___GLOBSTAR___')
        .replace(/\*/g, '[^/]*')
        .replace(/___GLOBSTAR___/g, '.*')
        .replace(/\./g, '\\.');
      const regex = new RegExp(pattern);
      const walk = (dir: string, rel: string): void => {
        if (!existsSync(dir)) return;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          const relPath = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walk(fullPath, relPath);
          } else if (regex.test(relPath) || regex.test(entry.name)) {
            matches.push(relPath);
          }
        }
      };
      walk(workspaceDir, '');
      return { matches };
    },

    async grep_search(args) {
      const query = asString(args.query);
      if (!query) return { results: [] };
      const isRegexp = args.isRegexp === true;
      const results: Array<{ file: string; line: number; content: string }> = [];
      const regex = isRegexp ? new RegExp(query, 'gi') : null;
      const walk = (dir: string): void => {
        if (!existsSync(dir)) return;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else {
            try {
              const content = readFileSync(fullPath, 'utf8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                const match = regex ? regex.test(lines[i]) : lines[i].includes(query);
                if (match) {
                  results.push({ file: fullPath, line: i + 1, content: lines[i] });
                }
                if (regex) regex.lastIndex = 0; // reset for global regex
              }
            } catch {
              // skip binary or unreadable files
            }
          }
        }
      };
      walk(workspaceDir);
      return { results };
    },

    async ask_questions(args) {
      if (onUserProxyCall) {
        return await onUserProxyCall(args);
      }
      // Default: pick recommended option or first option per question
      const answers: Record<string, unknown> = {};
      const questions = asArray(args.questions);
      for (const q of questions) {
        const qr = asRecord(q);
        const header = asString(qr.header) ?? 'unknown';
        const options = asArray(qr.options);
        if (options.length > 0) {
          let selectedLabel: string | undefined;
          for (const opt of options) {
            const optr = asRecord(opt);
            if (optr.recommended) {
              selectedLabel = asString(optr.label);
              break;
            }
          }
          if (selectedLabel === undefined) {
            const first = asRecord(options[0]);
            selectedLabel = asString(first.label) ?? '';
          }
          answers[header] = { selected: [selectedLabel], freeText: null, skipped: false };
        } else {
          answers[header] = { selected: [], freeText: 'Approved', skipped: false };
        }
      }
      return { answers };
    },

    async manage_todo_list(args) {
      const list = args.todoList;
      todoState = Array.isArray(list) ? (list as TodoItem[]) : [];
      return { success: true, count: todoState.length };
    },

    async run_in_terminal(args) {
      // In headless mode, just record the command without executing
      const cmd = asString(args.command) ?? '';
      return {
        success: true,
        output: `[headless] Would execute: ${cmd}`,
        dryRun: true,
      };
    },

    async semantic_search(_args) {
      return { results: [] };
    },

    async marketplace_install(args) {
      try {
        // Prefer the TS port; fall back to legacy JS during strangler phase.
        const installModule = await dynImportFirst(['./install.js', '../lib/install.js']);
        if (!installModule) {
          return { success: false, error: 'install module unavailable' };
        }
        const itemId = asString(args.itemId);
        const type = asString(args.type);
        const force = args.force === true;
        const search = asString(args.search);

        // Search mode
        if (search) {
          const fetchRegistryIndex = installModule.fetchRegistryIndex as
            | (() => Promise<unknown>)
            | undefined;
          const searchItems = installModule.searchItems as
            | ((idx: unknown, q: string) => unknown[])
            | undefined;
          if (!fetchRegistryIndex || !searchItems) {
            return { success: false, error: 'install search functions unavailable' };
          }
          const index = await fetchRegistryIndex();
          const found = searchItems(index, search) as Array<Record<string, unknown>>;
          return {
            success: true,
            action: 'search',
            query: search,
            results: found.map((r) => ({
              id: r.id,
              displayName: r.displayName,
              type: r.type,
              category: r.category,
              version: r.version,
            })),
            count: found.length,
          };
        }

        const resolvedId = type ? `${type}.${itemId}` : itemId;
        if (resolvedId === undefined) return { success: false, error: 'itemId is required' };

        if (dryRun) {
          return { success: true, action: 'install', itemId: resolvedId, dryRun: true };
        }

        const install = installModule.install as
          | ((id: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>)
          | undefined;
        if (!install) return { success: false, error: 'install function unavailable' };

        const result = await install(resolvedId, {
          projectRoot: workspaceDir,
          force,
          onProgress: () => {
            // Progress callback intentionally no-op in the bridge —
            // headless flows don't surface progress UI.
          },
        });

        const itemMeta = asRecord(result.item);
        return {
          success: true,
          action: 'install',
          itemId: resolvedId,
          installed: result.installed || [],
          fileCount: result.fileCount || 0,
          remappedFiles: result.remappedFiles || [],
          ide: result.ide,
          version: itemMeta.version,
          dependenciesInstalled: result.dependenciesInstalled || [],
        };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },

    /**
     * Record a timeline event (for live IDE agent self-reporting).
     */
    async record_timeline_event(args) {
      if (!timeline) {
        return { success: false, error: 'Timeline recording is not enabled' };
      }
      const evt = timeline.recordEvent({
        event_type: asString(args.event_type) ?? 'custom',
        action: asString(args.action) ?? '',
        phase: asString(args.phase),
        agent: asString(args.agent),
        parent_agent: asString(args.parent_agent),
        metadata: (args.metadata as Record<string, unknown> | null) ?? null,
        duration_ms: typeof args.duration_ms === 'number' ? args.duration_ms : null,
      });
      const eventRec = asRecord(evt);
      return { success: !!evt, event_id: evt ? (eventRec.id ?? null) : null };
    },

    /**
     * Log token usage and cost to .jumpstart/usage-log.json.
     */
    async log_usage(args) {
      try {
        const usageMod = await dynImportFirst(['./usage.js', '../lib/usage.js']);
        if (!usageMod) return { success: false, error: 'usage module unavailable' };
        const logUsage = usageMod.logUsage as
          | ((p: string, e: Record<string, unknown>) => Record<string, unknown>)
          | undefined;
        if (!logUsage) return { success: false, error: 'logUsage unavailable' };

        const logPath = join(workspaceDir, '.jumpstart', 'usage-log.json');
        const tokens = typeof args.estimated_tokens === 'number' ? args.estimated_tokens : 0;
        const entry = {
          phase: asString(args.phase) ?? 'unknown',
          agent: asString(args.agent) ?? 'unknown',
          action: asString(args.action) ?? 'unknown',
          estimated_tokens: tokens,
          estimated_cost_usd:
            typeof args.estimated_cost_usd === 'number'
              ? args.estimated_cost_usd
              : tokens * 0.000002,
          model: (args.model as string | null | undefined) ?? null,
          metadata: (args.metadata as Record<string, unknown> | null) ?? null,
        };
        const log = logUsage(logPath, entry);
        return {
          success: true,
          total_tokens: log.total_tokens,
          total_entries: Array.isArray(log.entries) ? log.entries.length : 0,
        };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },

    // ── Item-Tagged Feature Tool Handlers ──────────────────────────────

    async run_revert(args) {
      try {
        const mod = await dynImportFirst(['./revert.js', '../lib/revert.js']);
        if (!mod) return { success: false, error: 'revert module unavailable' };
        const revertArtifact = mod.revertArtifact as
          | ((opts: Record<string, unknown>) => unknown)
          | undefined;
        if (!revertArtifact) return { success: false, error: 'revertArtifact unavailable' };
        return revertArtifact({
          artifact: args.artifact,
          reason: args.reason,
          archive_dir: args.archive_dir,
        });
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },

    async run_adr_index(args) {
      try {
        const mod = await dynImportFirst(['./adr-index.js', '../lib/adr-index.js']);
        if (!mod) return { success: false, error: 'adr-index module unavailable' };
        const buildIndex = mod.buildIndex as ((root: string) => unknown) | undefined;
        const searchIndex = mod.searchIndex as
          | ((idx: unknown, q: string, opts: Record<string, unknown>) => unknown)
          | undefined;
        if (!buildIndex) return { success: false, error: 'buildIndex unavailable' };
        const root = asString(args.root) ?? workspaceDir;
        if (args.action === 'search' && searchIndex) {
          const index = buildIndex(root);
          return searchIndex(index, asString(args.query) ?? '', { tag: args.tag });
        }
        return buildIndex(root);
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },

    async run_complexity(args) {
      try {
        const mod = await dynImportFirst(['./complexity.js', '../lib/complexity.js']);
        if (!mod) return { success: false, error: 'complexity module unavailable' };
        const calculateComplexity = mod.calculateComplexity as
          | ((opts: Record<string, unknown>) => unknown)
          | undefined;
        if (!calculateComplexity) {
          return { success: false, error: 'calculateComplexity unavailable' };
        }
        return calculateComplexity({
          description: asString(args.description) ?? '',
          root: asString(args.root) ?? workspaceDir,
        });
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },

    async run_crossref(args) {
      try {
        const mod = await dynImportFirst(['./crossref.js', '../lib/crossref.js']);
        if (!mod) return { success: false, error: 'crossref module unavailable' };
        const validateCrossRefs = mod.validateCrossRefs as
          | ((specsDir: string, root: string) => unknown)
          | undefined;
        if (!validateCrossRefs) {
          return { success: false, error: 'validateCrossRefs unavailable' };
        }
        return validateCrossRefs(
          asString(args.specs_dir) ?? 'specs',
          asString(args.root) ?? workspaceDir
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },

    async run_init(args) {
      try {
        const mod = await dynImportFirst(['./init.js', '../lib/init.js']);
        if (!mod) return { success: false, error: 'init module unavailable' };
        const generateInitConfig = mod.generateInitConfig as
          | ((opts: Record<string, unknown>) => unknown)
          | undefined;
        if (!generateInitConfig) {
          return { success: false, error: 'generateInitConfig unavailable' };
        }
        return generateInitConfig({
          skill_level: asString(args.skill_level) ?? 'intermediate',
          project_type: asString(args.project_type) ?? 'greenfield',
        });
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },

    async run_lock(args) {
      try {
        const mod = await dynImportFirst(['./locks.js', '../lib/locks.js']);
        if (!mod) return { success: false, error: 'locks module unavailable' };
        const acquireLock = mod.acquireLock as
          | ((file: string, agent: string) => unknown)
          | undefined;
        const releaseLock = mod.releaseLock as
          | ((file: string, agent: string) => unknown)
          | undefined;
        const lockStatus = mod.lockStatus as ((file: string) => unknown) | undefined;
        const listLocks = mod.listLocks as (() => unknown) | undefined;

        const action = asString(args.action);
        const file = asString(args.file) ?? '';
        const agent = asString(args.agent) ?? 'headless';
        if (action === 'acquire' && acquireLock) return acquireLock(file, agent);
        if (action === 'release' && releaseLock) return releaseLock(file, agent);
        if (action === 'status' && lockStatus) return lockStatus(file);
        if (listLocks) return listLocks();
        return { success: false, error: 'lock function unavailable' };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },

    async run_timestamp(args) {
      try {
        const mod = await dynImportFirst(['./timestamps.js', '../lib/timestamps.js']);
        if (!mod) return { success: false, error: 'timestamps module unavailable' };
        const now = mod.now as (() => string) | undefined;
        const validate = mod.validate as ((v: string) => unknown) | undefined;
        const audit = mod.audit as ((f: string) => unknown) | undefined;

        const action = asString(args.action);
        if (action === 'validate' && validate) return validate(asString(args.value) ?? '');
        if (action === 'audit' && audit) return audit(asString(args.file) ?? '');
        if (now) return { timestamp: now() };
        return { success: false, error: 'timestamp function unavailable' };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },

    async run_scan(args) {
      try {
        const mod = await dynImportFirst(['./scanner.js', '../lib/scanner.js']);
        if (!mod) return { success: false, error: 'scanner module unavailable' };
        const scan = mod.scan as ((opts: Record<string, unknown>) => unknown) | undefined;
        if (!scan) return { success: false, error: 'scan unavailable' };
        return scan({ root: asString(args.root) ?? workspaceDir, ignore: args.ignore });
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },

    // ── Quality Gate Tool Handlers ──────────────────────────────────────

    async run_secret_scan(args) {
      try {
        const mod = await dynImportFirst(['./secret-scanner.js', '../lib/secret-scanner.js']);
        if (!mod) return { error: 'secret-scanner unavailable', pass: false };
        const runSecretScan = mod.runSecretScan as
          | ((opts: Record<string, unknown>) => unknown)
          | undefined;
        if (!runSecretScan) return { error: 'runSecretScan unavailable', pass: false };
        return runSecretScan({
          files: args.files || [],
          root: asString(args.root) ?? workspaceDir,
          config: args.config || {},
        });
      } catch (err) {
        return { error: (err as Error).message, pass: false };
      }
    },

    async run_type_check(args) {
      try {
        const mod = await dynImportFirst(['./type-checker.js', '../lib/type-checker.js']);
        if (!mod) return { error: 'type-checker unavailable', pass: false };
        const runTypeCheck = mod.runTypeCheck as
          | ((opts: Record<string, unknown>) => unknown)
          | undefined;
        if (!runTypeCheck) return { error: 'runTypeCheck unavailable', pass: false };
        return runTypeCheck({
          files: args.files || [],
          root: asString(args.root) ?? workspaceDir,
          config: args.config || {},
        });
      } catch (err) {
        return { error: (err as Error).message, pass: false };
      }
    },

    async run_smoke_test(args) {
      try {
        const mod = await dynImportFirst(['./smoke-tester.js', '../lib/smoke-tester.js']);
        if (!mod) return { error: 'smoke-tester unavailable', pass: false };
        const runSmokeTest = mod.runSmokeTest as
          | ((opts: Record<string, unknown>) => Promise<unknown>)
          | undefined;
        if (!runSmokeTest) return { error: 'runSmokeTest unavailable', pass: false };
        return await runSmokeTest({
          root: asString(args.root) ?? workspaceDir,
          config: args.config || {},
        });
      } catch (err) {
        return { error: (err as Error).message, pass: false };
      }
    },

    async run_uat_coverage(args) {
      try {
        const mod = await dynImportFirst(['./uat-coverage.js', '../lib/uat-coverage.js']);
        if (!mod) return { error: 'uat-coverage unavailable', pass: false };
        const computeUATCoverage = mod.computeUATCoverage as
          | ((prdPath: unknown, testDir: unknown) => unknown)
          | undefined;
        if (!computeUATCoverage) {
          return { error: 'computeUATCoverage unavailable', pass: false };
        }
        return computeUATCoverage(args.prd_path, args.test_dir);
      } catch (err) {
        return { error: (err as Error).message, pass: false };
      }
    },
  };

  // ── Bridge Interface ──────────────────────────────────────────────────

  return {
    /**
     * Execute a tool call. Catches all handler errors and surfaces them
     * as `{ error: <msg> }` JSON-stringified — never throws.
     */
    async execute(toolCall: ToolCall): Promise<{ content: string }> {
      const name = toolCall.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = toolCall.function.arguments
          ? (JSON.parse(toolCall.function.arguments) as Record<string, unknown>)
          : {};
      } catch {
        // Bad JSON arguments — treat as empty args; the handler can
        // surface its own validation error.
        args = {};
      }

      callHistory.push({ id: toolCall.id, name, args, timestamp: Date.now() });

      // Record timeline event for the tool call
      if (timeline) {
        timeline.recordEvent({
          event_type: 'tool_call',
          action: `Tool call: ${name}`,
          metadata: { tool_name: name, tool_args: args },
        });

        // Emit granular events based on tool type
        if (name === 'read_file' && typeof args.filePath === 'string') {
          const fp = args.filePath.replace(/\\/g, '/');
          if (fp.includes('/templates/')) {
            timeline.recordEvent({
              event_type: 'template_read',
              action: `Read template: ${args.filePath}`,
              metadata: { template_path: args.filePath },
            });
          } else if (fp.includes('/specs/')) {
            timeline.recordEvent({
              event_type: 'artifact_read',
              action: `Read artifact: ${args.filePath}`,
              metadata: { artifact_path: args.filePath },
            });
          } else {
            timeline.recordEvent({
              event_type: 'file_read',
              action: `Read file: ${args.filePath}`,
              metadata: { file_path: args.filePath },
            });
          }
        }
      }

      const handler = handlers[name];
      if (!handler) {
        const result = { error: `Unknown tool: ${name}` };
        return { content: JSON.stringify(result) };
      }

      try {
        const result = await handler(args);

        // Log to tracer if available
        if (tracer && typeof tracer.logToolInterception === 'function') {
          tracer.logToolInterception(name, args, result);
        }

        // Record timeline result event
        if (timeline) {
          const r = asRecord(result);
          timeline.recordEvent({
            event_type: 'tool_result',
            action: `Tool result: ${name}`,
            metadata: {
              tool_name: name,
              tool_result:
                result && typeof result === 'object'
                  ? { success: r.success, error: r.error }
                  : result,
            },
          });

          // Emit granular write events
          if (name === 'create_file' && typeof args.filePath === 'string') {
            const fp = args.filePath.replace(/\\/g, '/');
            if (fp.includes('/specs/') && !fp.includes('/insights/')) {
              timeline.recordEvent({
                event_type: 'artifact_write',
                action: `Created artifact: ${args.filePath}`,
                metadata: { artifact_path: args.filePath },
              });
            } else {
              timeline.recordEvent({
                event_type: 'file_write',
                action: `Created file: ${args.filePath}`,
                metadata: { file_path: args.filePath },
              });
            }
          } else if (name === 'replace_string_in_file' && typeof args.filePath === 'string') {
            timeline.recordEvent({
              event_type: 'file_write',
              action: `Edited file: ${args.filePath}`,
              metadata: { file_path: args.filePath },
            });
          }

          // Emit question events
          if (name === 'ask_questions' && Array.isArray(args.questions)) {
            timeline.recordEvent({
              event_type: 'question_asked',
              action: `Asked ${args.questions.length} question(s)`,
              metadata: { questions: args.questions },
            });
          }
        }

        return { content: JSON.stringify(result) };
      } catch (err) {
        return { content: JSON.stringify({ error: (err as Error).message }) };
      }
    },

    /** Get current todo list state. */
    getTodoState(): TodoItem[] {
      return todoState;
    },

    /** Get call history for auditing. */
    getCallHistory(): ToolCallRecord[] {
      return callHistory;
    },
  };
}
