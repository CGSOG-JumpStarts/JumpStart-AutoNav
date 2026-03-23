/**
 * test-plan-executor.test.js — Tests for Rich Plan Execution Engine
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-executor-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  defaultExecutionState,
  loadExecutionState,
  saveExecutionState,
  parsePlanToJobs,
  initializeExecution,
  getExecutionStatus,
  updateJobStatus,
  verifyJob,
  resetExecution,
  TASK_STATUSES
} = require('../bin/lib/plan-executor');

describe('plan-executor', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('defaultExecutionState', () => {
    it('returns valid default structure', () => {
      const s = defaultExecutionState();
      expect(s.version).toBe('1.0.0');
      expect(s.jobs).toEqual([]);
      expect(s.execution_log).toEqual([]);
    });
  });

  describe('TASK_STATUSES', () => {
    it('includes expected statuses', () => {
      expect(TASK_STATUSES).toContain('pending');
      expect(TASK_STATUSES).toContain('in_progress');
      expect(TASK_STATUSES).toContain('completed');
      expect(TASK_STATUSES).toContain('failed');
    });
  });

  describe('parsePlanToJobs', () => {
    it('parses tasks from implementation plan', () => {
      const content = '## Milestone 1: Setup\n\n- **M01-T01**: Project scaffold\n- **M01-T02**: Database setup\n\n## Milestone 2: Features\n\n- **M02-T01**: Auth system (E01-S01)\n';
      const jobs = parsePlanToJobs(content);
      expect(jobs).toHaveLength(3);
      expect(jobs[0].id).toBe('M01-T01');
      expect(jobs[0].milestone).toBe('M01');
      expect(jobs[2].story_refs).toContain('E01-S01');
    });

    it('returns empty for no tasks', () => {
      expect(parsePlanToJobs('no tasks')).toEqual([]);
    });

    it('extracts dependency references', () => {
      const content = '- **M01-T02**: Build auth, depends on M01-T01\n';
      const jobs = parsePlanToJobs(content);
      expect(jobs[0].dependencies).toContain('M01-T01');
    });
  });

  describe('initializeExecution', () => {
    it('initializes from implementation plan', () => {
      const stateFile = path.join(tmpDir, '.jumpstart', 'state', 'plan-execution.json');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'implementation-plan.md'),
        '## Milestone 1: Setup\n\n- **M01-T01**: Scaffold\n- **M01-T02**: Config\n', 'utf8');

      const result = initializeExecution(tmpDir, { stateFile });
      expect(result.success).toBe(true);
      expect(result.total_jobs).toBe(2);
      expect(result.milestones).toContain('M01');
    });

    it('fails when plan not found', () => {
      const result = initializeExecution(tmpDir, {
        stateFile: path.join(tmpDir, '.jumpstart', 'state', 'plan-execution.json')
      });
      expect(result.success).toBe(false);
    });
  });

  describe('getExecutionStatus', () => {
    it('reports uninitialized state', () => {
      const result = getExecutionStatus({
        stateFile: path.join(tmpDir, '.jumpstart', 'state', 'plan-execution.json')
      });
      expect(result.initialized).toBe(false);
    });

    it('reports status after initialization', () => {
      const stateFile = path.join(tmpDir, '.jumpstart', 'state', 'plan-execution.json');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'implementation-plan.md'),
        '- **M01-T01**: Task 1\n- **M01-T02**: Task 2\n', 'utf8');
      initializeExecution(tmpDir, { stateFile });

      const result = getExecutionStatus({ stateFile });
      expect(result.initialized).toBe(true);
      expect(result.total_jobs).toBe(2);
      expect(result.progress).toBe(0);
      expect(result.next_tasks.length).toBeGreaterThan(0);
    });
  });

  describe('updateJobStatus', () => {
    it('updates job status', () => {
      const stateFile = path.join(tmpDir, '.jumpstart', 'state', 'plan-execution.json');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'implementation-plan.md'),
        '- **M01-T01**: Task 1\n', 'utf8');
      initializeExecution(tmpDir, { stateFile });

      const result = updateJobStatus('M01-T01', 'in_progress', { stateFile });
      expect(result.success).toBe(true);
      expect(result.previous_status).toBe('pending');
      expect(result.new_status).toBe('in_progress');
    });

    it('errors for invalid status', () => {
      const result = updateJobStatus('M01-T01', 'invalid', {
        stateFile: path.join(tmpDir, '.jumpstart', 'state', 'plan-execution.json')
      });
      expect(result.success).toBe(false);
    });

    it('errors for unknown job', () => {
      const stateFile = path.join(tmpDir, '.jumpstart', 'state', 'plan-execution.json');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'implementation-plan.md'),
        '- **M01-T01**: Task 1\n', 'utf8');
      initializeExecution(tmpDir, { stateFile });

      const result = updateJobStatus('M99-T99', 'completed', { stateFile });
      expect(result.success).toBe(false);
    });
  });

  describe('verifyJob', () => {
    it('verifies a completed job', () => {
      const stateFile = path.join(tmpDir, '.jumpstart', 'state', 'plan-execution.json');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'implementation-plan.md'),
        '- **M01-T01**: Task 1\n', 'utf8');
      initializeExecution(tmpDir, { stateFile });
      updateJobStatus('M01-T01', 'completed', { stateFile });

      const result = verifyJob('M01-T01', tmpDir, { stateFile });
      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
    });
  });

  describe('resetExecution', () => {
    it('resets all jobs to pending', () => {
      const stateFile = path.join(tmpDir, '.jumpstart', 'state', 'plan-execution.json');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'implementation-plan.md'),
        '- **M01-T01**: Task 1\n', 'utf8');
      initializeExecution(tmpDir, { stateFile });
      updateJobStatus('M01-T01', 'completed', { stateFile });

      const result = resetExecution({ stateFile });
      expect(result.success).toBe(true);
      expect(result.jobs_reset).toBe(1);

      const status = getExecutionStatus({ stateFile });
      expect(status.status_counts.completed).toBe(0);
      expect(status.status_counts.pending).toBe(1);
    });
  });
});
