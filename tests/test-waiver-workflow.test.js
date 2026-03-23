/**
 * test-waiver-workflow.test.js — Tests for Exception & Waiver Workflow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-waiver-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  defaultState,
  loadState,
  saveState,
  requestWaiver,
  resolveWaiver,
  expireWaivers,
  listWaivers,
  WAIVER_STATUSES,
  WAIVER_CATEGORIES
} = require('../bin/lib/waiver-workflow');

describe('waiver-workflow', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'waivers.json');
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('exports waiver statuses', () => {
      expect(WAIVER_STATUSES).toEqual(['pending', 'approved', 'rejected', 'expired', 'revoked']);
    });

    it('exports waiver categories', () => {
      expect(WAIVER_CATEGORIES).toContain('security');
      expect(WAIVER_CATEGORIES).toContain('architecture');
      expect(WAIVER_CATEGORIES).toContain('compliance');
      expect(WAIVER_CATEGORIES).toContain('other');
      expect(WAIVER_CATEGORIES.length).toBe(7);
    });
  });

  describe('defaultState', () => {
    it('returns a fresh state with empty waivers', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.waivers).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.waivers).toEqual([]);
    });

    it('round-trips state', () => {
      const state = defaultState();
      state.waivers.push({ id: 'WVR-TEST', title: 'Test' });
      saveState(state, stateFile);

      const loaded = loadState(stateFile);
      expect(loaded.waivers).toHaveLength(1);
      expect(loaded.last_updated).toBeTruthy();
    });

    it('returns default state for corrupt file', () => {
      fs.writeFileSync(stateFile, '<<invalid>>', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
    });
  });

  describe('requestWaiver', () => {
    it('creates a pending waiver', () => {
      const result = requestWaiver({
        title: 'Skip TLS check',
        justification: 'Internal-only service',
        owner: 'alice',
        category: 'security'
      }, { stateFile });

      expect(result.success).toBe(true);
      expect(result.waiver.id).toMatch(/^WVR-/);
      expect(result.waiver.status).toBe('pending');
      expect(result.waiver.category).toBe('security');
      expect(result.waiver.owner).toBe('alice');
    });

    it('defaults category to "other" when not provided', () => {
      const result = requestWaiver({
        title: 'Generic waiver',
        justification: 'Reason',
        owner: 'bob'
      }, { stateFile });

      expect(result.success).toBe(true);
      expect(result.waiver.category).toBe('other');
    });

    it('returns error when required fields are missing', () => {
      const result = requestWaiver({}, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('title, justification, and owner are required');
    });

    it('returns error for null request', () => {
      const result = requestWaiver(null, { stateFile });
      expect(result.success).toBe(false);
    });

    it('returns error for invalid category', () => {
      const result = requestWaiver({
        title: 'Bad category',
        justification: 'test',
        owner: 'alice',
        category: 'invalid-category'
      }, { stateFile });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid category');
    });

    it('sets expiration based on expires_in_days', () => {
      const result = requestWaiver({
        title: 'Short waiver',
        justification: 'Temp fix',
        owner: 'alice',
        expires_in_days: 30
      }, { stateFile });

      expect(result.success).toBe(true);
      const expiresAt = new Date(result.waiver.expires_at);
      const now = new Date();
      const diffDays = (expiresAt - now) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(28);
      expect(diffDays).toBeLessThanOrEqual(31);
    });

    it('defaults expiration to 90 days', () => {
      const result = requestWaiver({
        title: 'Default expiry',
        justification: 'Reason',
        owner: 'alice'
      }, { stateFile });

      const expiresAt = new Date(result.waiver.expires_at);
      const now = new Date();
      const diffDays = (expiresAt - now) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(88);
      expect(diffDays).toBeLessThanOrEqual(91);
    });
  });

  describe('resolveWaiver', () => {
    let waiverId;

    beforeEach(() => {
      const result = requestWaiver({
        title: 'Test waiver',
        justification: 'Testing',
        owner: 'alice'
      }, { stateFile });
      waiverId = result.waiver.id;
    });

    it('approves a pending waiver', () => {
      const result = resolveWaiver(waiverId, 'approve', { stateFile, approver: 'manager' });
      expect(result.success).toBe(true);
      expect(result.waiver.status).toBe('approved');
      expect(result.waiver.approved_by).toBe('manager');
      expect(result.waiver.approved_at).toBeTruthy();
    });

    it('rejects a pending waiver', () => {
      const result = resolveWaiver(waiverId, 'reject', { stateFile });
      expect(result.success).toBe(true);
      expect(result.waiver.status).toBe('rejected');
    });

    it('returns error for invalid action', () => {
      const result = resolveWaiver(waiverId, 'cancel', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('action must be');
    });

    it('returns error for non-existent waiver', () => {
      const result = resolveWaiver('WVR-FAKE', 'approve', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Waiver not found');
    });

    it('returns error when resolving already-resolved waiver', () => {
      resolveWaiver(waiverId, 'approve', { stateFile });
      const result = resolveWaiver(waiverId, 'reject', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already approved');
    });
  });

  describe('expireWaivers', () => {
    it('expires approved waivers past their expiration date', () => {
      const state = defaultState();
      state.waivers.push({
        id: 'WVR-OLD',
        status: 'approved',
        expires_at: new Date(Date.now() - 86400000).toISOString()
      });
      saveState(state, stateFile);

      const result = expireWaivers({ stateFile });
      expect(result.success).toBe(true);
      expect(result.expired).toBe(1);

      const loaded = loadState(stateFile);
      expect(loaded.waivers[0].status).toBe('expired');
    });

    it('does not expire pending waivers', () => {
      const state = defaultState();
      state.waivers.push({
        id: 'WVR-PENDING',
        status: 'pending',
        expires_at: new Date(Date.now() - 86400000).toISOString()
      });
      saveState(state, stateFile);

      const result = expireWaivers({ stateFile });
      expect(result.expired).toBe(0);
    });

    it('does not expire waivers with future dates', () => {
      const state = defaultState();
      state.waivers.push({
        id: 'WVR-FUTURE',
        status: 'approved',
        expires_at: new Date(Date.now() + 86400000 * 30).toISOString()
      });
      saveState(state, stateFile);

      const result = expireWaivers({ stateFile });
      expect(result.expired).toBe(0);
    });

    it('returns total waiver count', () => {
      const state = defaultState();
      state.waivers.push(
        { id: 'W1', status: 'approved', expires_at: new Date(Date.now() - 1000).toISOString() },
        { id: 'W2', status: 'approved', expires_at: new Date(Date.now() + 86400000).toISOString() }
      );
      saveState(state, stateFile);

      const result = expireWaivers({ stateFile });
      expect(result.total_waivers).toBe(2);
      expect(result.expired).toBe(1);
    });
  });

  describe('listWaivers', () => {
    beforeEach(() => {
      requestWaiver({ title: 'W1', justification: 'J1', owner: 'alice', category: 'security' }, { stateFile });
      requestWaiver({ title: 'W2', justification: 'J2', owner: 'bob', category: 'testing' }, { stateFile });
      requestWaiver({ title: 'W3', justification: 'J3', owner: 'alice', category: 'security' }, { stateFile });
    });

    it('lists all waivers without filter', () => {
      const result = listWaivers({}, { stateFile });
      expect(result.success).toBe(true);
      expect(result.total).toBe(3);
    });

    it('filters by status', () => {
      const result = listWaivers({ status: 'pending' }, { stateFile });
      expect(result.total).toBe(3);

      const approved = listWaivers({ status: 'approved' }, { stateFile });
      expect(approved.total).toBe(0);
    });

    it('filters by category', () => {
      const result = listWaivers({ category: 'security' }, { stateFile });
      expect(result.total).toBe(2);
    });

    it('filters by owner', () => {
      const result = listWaivers({ owner: 'bob' }, { stateFile });
      expect(result.total).toBe(1);
      expect(result.waivers[0].owner).toBe('bob');
    });

    it('returns empty list when no matches', () => {
      const result = listWaivers({ owner: 'nobody' }, { stateFile });
      expect(result.total).toBe(0);
      expect(result.waivers).toEqual([]);
    });
  });
});
