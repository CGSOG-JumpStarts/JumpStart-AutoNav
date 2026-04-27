/**
 * test-config-yaml.test.ts — T4.1.8 unit tests for config-yaml.ts.
 *
 * @see bin/lib-ts/config-yaml.ts
 * @see bin/lib/config-yaml.cjs (legacy reference)
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getWorkflowSettings,
  parseConfigDocument,
  setWorkflowCurrentPhase,
  updateBootstrapAnswers,
  writeConfigDocument,
} from '../bin/lib-ts/config-yaml.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'config-yaml-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, body: string): string {
  const p = path.join(tmpDir, name);
  writeFileSync(p, body, 'utf8');
  return p;
}

describe('parseConfigDocument', () => {
  it('parses a valid yaml file into a Document AST', () => {
    const file = writeFixture('config.yaml', 'project:\n  name: test\n');
    const doc = parseConfigDocument(file);
    expect(doc.getIn(['project', 'name'])).toBe('test');
  });

  it('throws "Config file not found" on missing file (legacy message preserved)', () => {
    expect(() => parseConfigDocument(path.join(tmpDir, 'nope.yaml'))).toThrow(
      /Config file not found:/
    );
  });

  it('throws "Invalid YAML in <path>" on malformed yaml', () => {
    const file = writeFixture('bad.yaml', 'project:\n  - this\n  is bad: { unclosed');
    expect(() => parseConfigDocument(file)).toThrow(/Invalid YAML in /);
  });
});

describe('writeConfigDocument', () => {
  it('round-trips through the Document AST preserving comments + key order', () => {
    const file = writeFixture(
      'config.yaml',
      [
        '# Top comment',
        'project:',
        '  # inline comment',
        '  name: test',
        '  type: brownfield',
        '',
        'workflow:',
        '  current_phase: scout',
        '',
      ].join('\n')
    );
    const doc = parseConfigDocument(file);
    writeConfigDocument(file, doc);
    const re = readFileSync(file, 'utf8');
    expect(re).toContain('# Top comment');
    expect(re).toContain('# inline comment');
    expect(re.indexOf('project')).toBeLessThan(re.indexOf('workflow'));
  });

  it('creates parent directories as needed', () => {
    const nested = path.join(tmpDir, 'deep', 'nested', 'dir', 'config.yaml');
    const seedFile = writeFixture('seed.yaml', 'k: v\n');
    const doc = parseConfigDocument(seedFile);
    writeConfigDocument(nested, doc);
    expect(readFileSync(nested, 'utf8')).toContain('k: v');
  });
});

describe('updateBootstrapAnswers', () => {
  it('applies all 3 fields when provided + writes to disk', () => {
    const file = writeFixture('config.yaml', 'project: {}\n');
    const result = updateBootstrapAnswers(file, {
      projectName: 'My Project',
      projectType: 'brownfield',
      approverName: 'Samuel',
    });
    expect(result.applied).toEqual(['project.name', 'project.type', 'project.approver']);
    expect(result.changed).toBe(true);
    const after = readFileSync(file, 'utf8');
    expect(after).toContain('My Project');
    expect(after).toContain('brownfield');
    expect(after).toContain('Samuel');
  });

  it('skips undefined / null / empty-string fields (legacy semantics)', () => {
    const file = writeFixture('config.yaml', 'project: {}\n');
    const result = updateBootstrapAnswers(file, {
      projectName: 'Set Me',
      projectType: undefined,
      approverName: null,
    });
    expect(result.applied).toEqual(['project.name']);
  });

  it('returns changed=false when no fields applied (no disk write)', () => {
    const file = writeFixture('config.yaml', 'project:\n  name: original\n');
    const before = readFileSync(file, 'utf8');
    const result = updateBootstrapAnswers(file, {
      projectName: '',
      projectType: null,
      approverName: undefined,
    });
    expect(result.applied).toEqual([]);
    expect(result.changed).toBe(false);
    // File untouched.
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('handles empty `updates` object as a no-op', () => {
    const file = writeFixture('config.yaml', 'project: {}\n');
    const result = updateBootstrapAnswers(file);
    expect(result.changed).toBe(false);
  });
});

describe('setWorkflowCurrentPhase', () => {
  it('updates workflow.current_phase + persists', () => {
    const file = writeFixture('config.yaml', 'workflow:\n  current_phase: scout\n');
    const result = setWorkflowCurrentPhase(file, 'analyst');
    expect(result.changed).toBe(true);
    expect(result.current_phase).toBe('analyst');
    expect(readFileSync(file, 'utf8')).toContain('current_phase: analyst');
  });

  it('reports changed=true even when the value is unchanged (legacy idempotency)', () => {
    const file = writeFixture('config.yaml', 'workflow:\n  current_phase: scout\n');
    expect(setWorkflowCurrentPhase(file, 'scout').changed).toBe(true);
  });
});

describe('getWorkflowSettings', () => {
  it('reads auto_handoff + current_phase', () => {
    const file = writeFixture(
      'config.yaml',
      'workflow:\n  auto_handoff: true\n  current_phase: pm\n'
    );
    expect(getWorkflowSettings(file)).toEqual({
      auto_handoff: true,
      current_phase: 'pm',
    });
  });

  it('treats missing auto_handoff as TRUE (legacy `!== false` truthiness)', () => {
    const file = writeFixture('config.yaml', 'workflow:\n  current_phase: pm\n');
    expect(getWorkflowSettings(file).auto_handoff).toBe(true);
  });

  it('treats explicit auto_handoff: false as false', () => {
    const file = writeFixture(
      'config.yaml',
      'workflow:\n  auto_handoff: false\n  current_phase: pm\n'
    );
    expect(getWorkflowSettings(file).auto_handoff).toBe(false);
  });

  it('returns null current_phase when missing', () => {
    const file = writeFixture('config.yaml', 'workflow:\n  auto_handoff: true\n');
    expect(getWorkflowSettings(file).current_phase).toBeNull();
  });
});
