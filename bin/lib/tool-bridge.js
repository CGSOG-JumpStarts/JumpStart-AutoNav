/**
 * tool-bridge.js — VS Code Tool Emulation Bridge
 *
 * Emulates VS Code Copilot tools (read_file, create_file, list_dir, etc.)
 * so the headless runner can execute agent tool calls against a real filesystem.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Create a tool bridge that executes tool calls against a workspace directory.
 *
 * @param {object} options
 * @param {string} options.workspaceDir — Root directory for file operations
 * @param {object} [options.tracer] — SimulationTracer instance for logging
 * @param {boolean} [options.dryRun=false] — If true, skip file writes
 * @param {Function} [options.onUserProxyCall] — Callback for ask_questions routing
 * @param {object} [options.timeline] — Timeline instance for event recording
 * @returns {object} Bridge with .execute(), .getTodoState(), .getCallHistory()
 */
function createToolBridge(options = {}) {
  const { workspaceDir, tracer = null, dryRun = false, onUserProxyCall = null, timeline = null } = options;

  const callHistory = [];
  let todoState = [];

  // ── Tool Handlers ─────────────────────────────────────────────────────────

  const handlers = {
    async read_file(args) {
      const { filePath, startLine = 1, endLine } = args;
      if (!fs.existsSync(filePath)) {
        return { error: `File not found: ${filePath}` };
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.split('\n');
      const totalLines = lines.length;
      const end = endLine != null ? Math.min(endLine, totalLines) : totalLines;
      const selected = lines.slice(startLine - 1, end);
      return { content: selected.join('\n'), totalLines };
    },

    async create_file(args) {
      const { filePath, content } = args;
      if (dryRun) {
        return { success: true, dryRun: true, filePath };
      }
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, 'utf8');
      return { success: true, filePath };
    },

    async list_dir(args) {
      const dirPath = args.path;
      if (!fs.existsSync(dirPath)) {
        return { error: `Directory not found: ${dirPath}` };
      }
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const items = entries.map(e => ({
        name: e.isDirectory() ? `${e.name}/` : e.name,
        type: e.isDirectory() ? 'directory' : 'file'
      }));
      return { items };
    },

    async replace_string_in_file(args) {
      const { filePath, oldString, newString } = args;
      if (!fs.existsSync(filePath)) {
        return { error: `File not found: ${filePath}` };
      }
      if (dryRun) {
        return { success: true, dryRun: true };
      }
      let content = fs.readFileSync(filePath, 'utf8');
      if (!content.includes(oldString)) {
        return { error: 'oldString not found in file' };
      }
      content = content.replace(oldString, newString);
      fs.writeFileSync(filePath, content, 'utf8');
      return { success: true };
    },

    async file_search(args) {
      const { query } = args;
      // Simple glob-like search: walk workspace and match filenames
      const matches = [];
      function walk(dir, rel) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walk(fullPath, relPath);
          } else {
            // Simple pattern match: convert glob to regex
            const pattern = query
              .replace(/\*\*/g, '___GLOBSTAR___')
              .replace(/\*/g, '[^/]*')
              .replace(/___GLOBSTAR___/g, '.*')
              .replace(/\./g, '\\.');
            const regex = new RegExp(pattern);
            if (regex.test(relPath) || regex.test(entry.name)) {
              matches.push(relPath);
            }
          }
        }
      }
      walk(workspaceDir, '');
      return { matches };
    },

    async grep_search(args) {
      const { query, isRegexp = false } = args;
      const results = [];
      function walk(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else {
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              const lines = content.split('\n');
              const regex = isRegexp ? new RegExp(query, 'gi') : null;
              for (let i = 0; i < lines.length; i++) {
                const match = isRegexp
                  ? regex.test(lines[i])
                  : lines[i].includes(query);
                if (match) {
                  results.push({
                    file: fullPath,
                    line: i + 1,
                    content: lines[i]
                  });
                }
                if (regex) regex.lastIndex = 0; // reset for global regex
              }
            } catch {
              // Skip binary or unreadable files
            }
          }
        }
      }
      walk(workspaceDir);
      return { results };
    },

    async ask_questions(args) {
      // Route to user proxy callback if provided
      if (onUserProxyCall) {
        return await onUserProxyCall(args);
      }

      // Default: pick recommended option or first option per question
      const answers = {};
      for (const q of args.questions) {
        if (q.options && q.options.length > 0) {
          const recommended = q.options.find(o => o.recommended);
          const selected = recommended ? recommended.label : q.options[0].label;
          answers[q.header] = { selected: [selected], freeText: null, skipped: false };
        } else {
          answers[q.header] = { selected: [], freeText: 'Approved', skipped: false };
        }
      }
      return { answers };
    },

    async manage_todo_list(args) {
      todoState = args.todoList || [];
      return { success: true, count: todoState.length };
    },

    async run_in_terminal(args) {
      // In headless mode, just record the command without executing
      return { success: true, output: `[headless] Would execute: ${args.command || ''}`, dryRun: true };
    },

    async semantic_search(args) {
      return { results: [] };
    },

    async marketplace_install(args) {
      // Marketplace installer tool — available to architect + developer phases
      try {
        const installModule = await import('./install.js');
        const { itemId, type, force, search } = args;

        // Search mode
        if (search) {
          const index = await installModule.fetchRegistryIndex();
          const results = installModule.searchItems(index, search);
          return {
            success: true,
            action: 'search',
            query: search,
            results: results.map(r => ({ id: r.id, displayName: r.displayName, type: r.type, category: r.category, version: r.version })),
            count: results.length
          };
        }

        // Normalize item ID
        const resolvedId = type ? `${type}.${itemId}` : itemId;

        if (dryRun) {
          return { success: true, action: 'install', itemId: resolvedId, dryRun: true };
        }

        const result = await installModule.install(resolvedId, {
          projectRoot: workspaceDir,
          force: force || false,
          onProgress: () => {},
        });

        return {
          success: true,
          action: 'install',
          itemId: resolvedId,
          installed: result.installed || [],
          fileCount: result.fileCount || 0,
          remappedFiles: result.remappedFiles || [],
          ide: result.ide,
          version: result.item?.version,
          dependenciesInstalled: result.dependenciesInstalled || [],
        };
      } catch (err) {
        return { success: false, error: err.message };
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
        event_type: args.event_type || 'custom',
        action: args.action || '',
        phase: args.phase,
        agent: args.agent,
        parent_agent: args.parent_agent,
        metadata: args.metadata || null,
        duration_ms: args.duration_ms || null
      });
      return { success: !!evt, event_id: evt ? evt.id : null };
    },

    // ── Item-Tagged Feature Tool Handlers ──────────────────────────────────

    async run_revert(args) {
      try {
        const { revertArtifact } = await import('./revert.js');
        return revertArtifact({ artifact: args.artifact, reason: args.reason, archive_dir: args.archive_dir });
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    async run_adr_index(args) {
      try {
        const { buildIndex, searchIndex } = await import('./adr-index.js');
        const root = args.root || workspaceDir;
        if (args.action === 'search') {
          const index = buildIndex(root);
          return searchIndex(index, args.query || '', { tag: args.tag });
        }
        return buildIndex(root);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    async run_complexity(args) {
      try {
        const { calculateComplexity } = await import('./complexity.js');
        return calculateComplexity({ description: args.description || '', root: args.root || workspaceDir });
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    async run_crossref(args) {
      try {
        const { validateCrossRefs } = await import('./crossref.js');
        return validateCrossRefs(args.specs_dir || 'specs', args.root || workspaceDir);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    async run_init(args) {
      try {
        const { generateInitConfig } = await import('./init.js');
        return generateInitConfig({ skill_level: args.skill_level || 'intermediate', project_type: args.project_type || 'greenfield' });
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    async run_lock(args) {
      try {
        const { acquireLock, releaseLock, lockStatus, listLocks } = await import('./locks.js');
        if (args.action === 'acquire') return acquireLock(args.file, args.agent || 'headless');
        if (args.action === 'release') return releaseLock(args.file, args.agent || 'headless');
        if (args.action === 'status') return lockStatus(args.file);
        return listLocks();
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    async run_timestamp(args) {
      try {
        const { now, validate, audit } = await import('./timestamps.js');
        if (args.action === 'validate') return validate(args.value);
        if (args.action === 'audit') return audit(args.file);
        return { timestamp: now() };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    async run_scan(args) {
      try {
        const { scan } = await import('./scanner.js');
        return scan({ root: args.root || workspaceDir, ignore: args.ignore });
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    // ── Quality Gate Tool Handlers ──────────────────────────────────────────

    async run_secret_scan(args) {
      try {
        const { runSecretScan } = require('./secret-scanner.js');
        return runSecretScan({
          files: args.files || [],
          root: args.root || workspaceDir,
          config: args.config || {}
        });
      } catch (err) {
        return { error: err.message, pass: false };
      }
    },

    async run_type_check(args) {
      try {
        const { runTypeCheck } = require('./type-checker.js');
        return runTypeCheck({
          files: args.files || [],
          root: args.root || workspaceDir,
          config: args.config || {}
        });
      } catch (err) {
        return { error: err.message, pass: false };
      }
    },

    async run_smoke_test(args) {
      try {
        const { runSmokeTest } = require('./smoke-tester.js');
        return await runSmokeTest({
          root: args.root || workspaceDir,
          config: args.config || {}
        });
      } catch (err) {
        return { error: err.message, pass: false };
      }
    },

    async run_uat_coverage(args) {
      try {
        const { computeUATCoverage } = require('./uat-coverage.js');
        return computeUATCoverage(
          args.prd_path,
          args.test_dir
        );
      } catch (err) {
        return { error: err.message, pass: false };
      }
    }
  };

  // ── Bridge Interface ──────────────────────────────────────────────────────

  return {
    /**
     * Execute a tool call.
     * @param {object} toolCall — OpenAI-style tool_call object
     * @returns {Promise<{content: string}>}
     */
    async execute(toolCall) {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments || '{}');

      callHistory.push({ id: toolCall.id, name, args, timestamp: Date.now() });

      // Record timeline event for the tool call
      if (timeline) {
        timeline.recordEvent({
          event_type: 'tool_call',
          action: `Tool call: ${name}`,
          metadata: { tool_name: name, tool_args: args }
        });

        // Emit granular events based on tool type
        if (name === 'read_file' && args.filePath) {
          const fp = args.filePath.replace(/\\/g, '/');
          if (fp.includes('/templates/')) {
            timeline.recordEvent({ event_type: 'template_read', action: `Read template: ${args.filePath}`, metadata: { template_path: args.filePath } });
          } else if (fp.includes('/specs/')) {
            timeline.recordEvent({ event_type: 'artifact_read', action: `Read artifact: ${args.filePath}`, metadata: { artifact_path: args.filePath } });
          } else {
            timeline.recordEvent({ event_type: 'file_read', action: `Read file: ${args.filePath}`, metadata: { file_path: args.filePath } });
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
          timeline.recordEvent({
            event_type: 'tool_result',
            action: `Tool result: ${name}`,
            metadata: { tool_name: name, tool_result: typeof result === 'object' ? { success: result.success, error: result.error } : result }
          });

          // Emit granular write events
          if (name === 'create_file' && args.filePath) {
            const fp = args.filePath.replace(/\\/g, '/');
            if (fp.includes('/specs/') && !fp.includes('/insights/')) {
              timeline.recordEvent({ event_type: 'artifact_write', action: `Created artifact: ${args.filePath}`, metadata: { artifact_path: args.filePath } });
            } else {
              timeline.recordEvent({ event_type: 'file_write', action: `Created file: ${args.filePath}`, metadata: { file_path: args.filePath } });
            }
          } else if (name === 'replace_string_in_file' && args.filePath) {
            timeline.recordEvent({ event_type: 'file_write', action: `Edited file: ${args.filePath}`, metadata: { file_path: args.filePath } });
          }

          // Emit question events
          if (name === 'ask_questions' && args.questions) {
            timeline.recordEvent({ event_type: 'question_asked', action: `Asked ${args.questions.length} question(s)`, metadata: { questions: args.questions } });
          }
        }

        return { content: JSON.stringify(result) };
      } catch (err) {
        return { content: JSON.stringify({ error: err.message }) };
      }
    },

    /** Get current todo list state. */
    getTodoState() {
      return todoState;
    },

    /** Get call history for auditing. */
    getCallHistory() {
      return callHistory;
    }
  };
}

module.exports = { createToolBridge };
