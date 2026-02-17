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
 * @returns {object} Bridge with .execute(), .getTodoState(), .getCallHistory()
 */
function createToolBridge(options = {}) {
  const { workspaceDir, tracer = null, dryRun = false, onUserProxyCall = null } = options;

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
