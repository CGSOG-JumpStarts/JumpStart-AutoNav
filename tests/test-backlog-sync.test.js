/**
 * test-backlog-sync.test.js — Tests for Native Backlog Synchronization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-backlog-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  defaultSyncState,
  loadSyncState,
  saveSyncState,
  extractEpics,
  extractTasks,
  extractBacklog,
  formatForTarget,
  exportBacklog,
  SUPPORTED_TARGETS
} = require('../bin/lib/backlog-sync');

describe('backlog-sync', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('defaultSyncState', () => {
    it('returns valid default structure', () => {
      const s = defaultSyncState();
      expect(s.version).toBe('1.0.0');
      expect(s.synced_items).toEqual([]);
      expect(s.export_history).toEqual([]);
    });
  });

  describe('SUPPORTED_TARGETS', () => {
    it('includes github, jira, azure-devops', () => {
      expect(SUPPORTED_TARGETS).toContain('github');
      expect(SUPPORTED_TARGETS).toContain('jira');
      expect(SUPPORTED_TARGETS).toContain('azure-devops');
    });
  });

  describe('extractEpics', () => {
    it('extracts epics from PRD content', () => {
      const content = '## Epic 1: User Management\n\n- **E01-S01**: As a user I can register\n- **E01-S02**: As a user I can login\n\n## Epic 2: Admin\n\n- **E02-S01**: Admin dashboard\n';
      const epics = extractEpics(content);
      expect(epics).toHaveLength(2);
      expect(epics[0].id).toBe('E01');
      expect(epics[0].stories).toHaveLength(2);
      expect(epics[1].stories).toHaveLength(1);
    });

    it('handles E01 style headers', () => {
      const content = '## E01: User Auth\n\n- **E01-S01**: Login\n';
      const epics = extractEpics(content);
      expect(epics).toHaveLength(1);
      expect(epics[0].id).toBe('E01');
    });

    it('returns empty for no epics', () => {
      expect(extractEpics('no epics')).toEqual([]);
    });
  });

  describe('extractTasks', () => {
    it('extracts tasks from plan content', () => {
      const content = '- **M01-T01**: Set up project scaffold\n- **M01-T02**: Implement auth (E01-S01)\n';
      const tasks = extractTasks(content);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('M01-T01');
      expect(tasks[1].story_refs).toContain('E01-S01');
    });

    it('returns empty for no tasks', () => {
      expect(extractTasks('no tasks here')).toEqual([]);
    });
  });

  describe('extractBacklog', () => {
    it('extracts from PRD and plan', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'),
        '## Epic 1: Auth\n\n- **E01-S01**: Login\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'implementation-plan.md'),
        '- **M01-T01**: Build auth\n', 'utf8');

      const result = extractBacklog(tmpDir);
      expect(result.success).toBe(true);
      expect(result.epics).toBeGreaterThanOrEqual(1);
      expect(result.stories).toBeGreaterThanOrEqual(1);
      expect(result.tasks).toBeGreaterThanOrEqual(1);
    });

    it('handles missing files gracefully', () => {
      const result = extractBacklog(tmpDir);
      expect(result.success).toBe(true);
      expect(result.epics).toBe(0);
    });
  });

  describe('formatForTarget', () => {
    const backlog = {
      items: {
        epics: [{ id: 'E01', title: 'Auth', stories: [{ id: 'E01-S01', title: 'Login', epic_id: 'E01' }] }],
        tasks: [{ id: 'M01-T01', title: 'Build auth', story_refs: ['E01-S01'] }]
      }
    };

    it('formats for GitHub', () => {
      const result = formatForTarget(backlog, 'github');
      expect(result.success).toBe(true);
      expect(result.total_items).toBeGreaterThan(0);
      expect(result.items[0].type).toBe('issue');
      expect(result.items[0].labels).toContain('jumpstart');
    });

    it('formats for Jira', () => {
      const result = formatForTarget(backlog, 'jira');
      expect(result.success).toBe(true);
      expect(result.items[0].issueType).toBe('Epic');
    });

    it('formats for Azure DevOps', () => {
      const result = formatForTarget(backlog, 'azure-devops');
      expect(result.success).toBe(true);
      expect(result.items[0].workItemType).toBe('Epic');
    });

    it('errors for unsupported target', () => {
      const result = formatForTarget(backlog, 'unsupported');
      expect(result.success).toBe(false);
    });
  });

  describe('exportBacklog', () => {
    it('exports backlog to file', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'),
        '## Epic 1: Auth\n\n- **E01-S01**: Login\n', 'utf8');

      const outputPath = path.join(tmpDir, '.jumpstart', 'exports', 'backlog-github.json');
      const result = exportBacklog(tmpDir, 'github', {
        output: outputPath,
        syncFile: path.join(tmpDir, '.jumpstart', 'state', 'backlog-sync.json')
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(outputPath)).toBe(true);
    });
  });
});
