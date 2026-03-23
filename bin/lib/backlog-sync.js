/**
 * backlog-sync.js — Native Backlog Synchronization
 *
 * Push epics, features, user stories, and tasks to
 * Azure DevOps, Jira, or GitHub Issues.
 *
 * Config: .jumpstart/backlog-sync.json
 *
 * Usage:
 *   node bin/lib/backlog-sync.js extract|preview|export|status [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SYNC_FILE = path.join('.jumpstart', 'state', 'backlog-sync.json');
const SUPPORTED_TARGETS = ['github', 'jira', 'azure-devops'];

/**
 * Default sync state.
 * @returns {object}
 */
function defaultSyncState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_sync: null,
    target: null,
    synced_items: [],
    export_history: []
  };
}

/**
 * Load sync state from disk.
 * @param {string} [syncFile]
 * @returns {object}
 */
function loadSyncState(syncFile) {
  const filePath = syncFile || DEFAULT_SYNC_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultSyncState();
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultSyncState();
  }
}

/**
 * Save sync state to disk.
 * @param {object} state
 * @param {string} [syncFile]
 */
function saveSyncState(state, syncFile) {
  const filePath = syncFile || DEFAULT_SYNC_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  state.last_sync = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Extract epics from PRD content.
 * @param {string} content - PRD markdown content.
 * @returns {object[]}
 */
function extractEpics(content) {
  const epics = [];
  const lines = content.split('\n');
  let currentEpic = null;

  for (const line of lines) {
    // Match epic headers like "### Epic 1: ...", "## E01: ...", "### E01 — ..."
    const epicMatch = line.match(/^#{2,4}\s+(?:Epic\s+)?(\d+|E\d+)[:\s—–-]+\s*(.+)$/i);
    if (epicMatch) {
      if (currentEpic) epics.push(currentEpic);
      currentEpic = {
        id: epicMatch[1].startsWith('E') ? epicMatch[1] : `E${epicMatch[1].padStart(2, '0')}`,
        title: epicMatch[2].trim(),
        stories: [],
        type: 'epic'
      };
      continue;
    }

    // Match stories like "- **E01-S01**: ...", "- E01-S01: ...", "#### Story: ..."
    if (currentEpic) {
      const storyMatch = line.match(/(?:^[-*]\s+\*{0,2})(E\d+-S\d+)(?:\*{0,2})[:\s—–-]+\s*(.+)/i);
      if (storyMatch) {
        currentEpic.stories.push({
          id: storyMatch[1],
          title: storyMatch[2].trim().replace(/\*{1,2}/g, ''),
          type: 'story',
          epic_id: currentEpic.id
        });
      }
    }
  }
  if (currentEpic) epics.push(currentEpic);

  return epics;
}

/**
 * Extract tasks from implementation plan content.
 * @param {string} content - Implementation plan markdown content.
 * @returns {object[]}
 */
function extractTasks(content) {
  const tasks = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match task patterns like "- M01-T01: ...", "### M01-T01 — ...", "- **M01-T01**: ..."
    const taskMatch = line.match(/(?:^#{2,4}\s+|^[-*]\s+\*{0,2})(M\d+-T\d+)(?:\*{0,2})[:\s—–-]+\s*(.+)/i);
    if (taskMatch) {
      const stories = [];
      // Extract story references from the line
      const storyRefs = line.match(/E\d+-S\d+/g) || [];
      tasks.push({
        id: taskMatch[1],
        title: taskMatch[2].trim().replace(/\*{1,2}/g, ''),
        type: 'task',
        story_refs: [...new Set(storyRefs)]
      });
    }
  }

  return tasks;
}

/**
 * Extract all backlog items from PRD and implementation plan.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function extractBacklog(root, options = {}) {
  const prdPath = options.prdPath || path.join(root, 'specs', 'prd.md');
  const planPath = options.planPath || path.join(root, 'specs', 'implementation-plan.md');

  const items = { epics: [], stories: [], tasks: [] };

  if (fs.existsSync(prdPath)) {
    const prdContent = fs.readFileSync(prdPath, 'utf8');
    const epics = extractEpics(prdContent);
    items.epics = epics;
    for (const epic of epics) {
      items.stories.push(...epic.stories);
    }
  }

  if (fs.existsSync(planPath)) {
    const planContent = fs.readFileSync(planPath, 'utf8');
    items.tasks = extractTasks(planContent);
  }

  return {
    success: true,
    epics: items.epics.length,
    stories: items.stories.length,
    tasks: items.tasks.length,
    items
  };
}

/**
 * Format backlog items for a specific target platform.
 *
 * @param {object} backlog - Extracted backlog from extractBacklog.
 * @param {string} target - Target platform (github, jira, azure-devops).
 * @param {object} [options]
 * @returns {object}
 */
function formatForTarget(backlog, target, options = {}) {
  if (!SUPPORTED_TARGETS.includes(target)) {
    return { success: false, error: `Unsupported target: ${target}. Supported: ${SUPPORTED_TARGETS.join(', ')}` };
  }

  const formatted = [];

  if (target === 'github') {
    // GitHub Issues format
    for (const epic of (backlog.items || backlog).epics || []) {
      formatted.push({
        type: 'issue',
        title: `[Epic] ${epic.id}: ${epic.title}`,
        labels: ['epic', 'jumpstart'],
        body: `## Epic: ${epic.title}\n\nID: ${epic.id}\nStories: ${epic.stories.length}\n\n_Auto-generated by JumpStart_`
      });
      for (const story of epic.stories) {
        formatted.push({
          type: 'issue',
          title: `[Story] ${story.id}: ${story.title}`,
          labels: ['user-story', 'jumpstart', epic.id.toLowerCase()],
          body: `## User Story: ${story.title}\n\nID: ${story.id}\nEpic: ${epic.id}\n\n_Auto-generated by JumpStart_`
        });
      }
    }
    for (const task of (backlog.items || backlog).tasks || []) {
      formatted.push({
        type: 'issue',
        title: `[Task] ${task.id}: ${task.title}`,
        labels: ['task', 'jumpstart'],
        body: `## Task: ${task.title}\n\nID: ${task.id}\nStories: ${task.story_refs.join(', ') || 'none'}\n\n_Auto-generated by JumpStart_`
      });
    }
  } else if (target === 'jira') {
    // Jira format
    for (const epic of (backlog.items || backlog).epics || []) {
      formatted.push({
        issueType: 'Epic',
        summary: `${epic.id}: ${epic.title}`,
        labels: ['jumpstart'],
        customFields: { jumpstart_id: epic.id }
      });
      for (const story of epic.stories) {
        formatted.push({
          issueType: 'Story',
          summary: `${story.id}: ${story.title}`,
          labels: ['jumpstart'],
          epicLink: epic.id,
          customFields: { jumpstart_id: story.id }
        });
      }
    }
    for (const task of (backlog.items || backlog).tasks || []) {
      formatted.push({
        issueType: 'Task',
        summary: `${task.id}: ${task.title}`,
        labels: ['jumpstart'],
        customFields: { jumpstart_id: task.id, story_refs: task.story_refs }
      });
    }
  } else if (target === 'azure-devops') {
    // Azure DevOps format
    for (const epic of (backlog.items || backlog).epics || []) {
      formatted.push({
        workItemType: 'Epic',
        title: `${epic.id}: ${epic.title}`,
        tags: 'jumpstart',
        fields: { 'Custom.JumpStartId': epic.id }
      });
      for (const story of epic.stories) {
        formatted.push({
          workItemType: 'User Story',
          title: `${story.id}: ${story.title}`,
          tags: 'jumpstart',
          parentId: epic.id,
          fields: { 'Custom.JumpStartId': story.id }
        });
      }
    }
    for (const task of (backlog.items || backlog).tasks || []) {
      formatted.push({
        workItemType: 'Task',
        title: `${task.id}: ${task.title}`,
        tags: 'jumpstart',
        fields: { 'Custom.JumpStartId': task.id }
      });
    }
  }

  return {
    success: true,
    target,
    total_items: formatted.length,
    items: formatted
  };
}

/**
 * Export backlog as a JSON file suitable for import.
 *
 * @param {string} root - Project root.
 * @param {string} target - Target platform.
 * @param {object} [options]
 * @returns {object}
 */
function exportBacklog(root, target, options = {}) {
  const backlog = extractBacklog(root, options);
  if (!backlog.success) return backlog;

  const formatted = formatForTarget(backlog, target, options);
  if (!formatted.success) return formatted;

  const outputPath = options.output || path.join(root, '.jumpstart', 'exports', `backlog-${target}.json`);
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const exportData = {
    exported_at: new Date().toISOString(),
    target,
    source: 'jumpstart',
    ...formatted
  };

  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2) + '\n', 'utf8');

  // Record in sync state
  const syncFile = options.syncFile || path.join(root, DEFAULT_SYNC_FILE);
  const state = loadSyncState(syncFile);
  state.export_history.push({
    exported_at: exportData.exported_at,
    target,
    items: formatted.total_items,
    output: path.relative(root, outputPath)
  });
  saveSyncState(state, syncFile);

  return {
    success: true,
    target,
    items_exported: formatted.total_items,
    output: outputPath
  };
}

module.exports = {
  defaultSyncState,
  loadSyncState,
  saveSyncState,
  extractEpics,
  extractTasks,
  extractBacklog,
  formatForTarget,
  exportBacklog,
  SUPPORTED_TARGETS
};
