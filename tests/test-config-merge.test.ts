/**
 * test-config-merge.test.ts — T4.1.10 unit tests.
 *
 * Pin the three-way merge contract from the legacy upgrade flow.
 *
 * @see bin/lib-ts/config-merge.ts
 * @see bin/lib/config-merge.js (legacy reference)
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  flattenYaml,
  mergeConfigs,
  readConfig,
  writeConfig,
  writeConflictsFile,
} from '../bin/lib-ts/config-merge.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'cfg-merge-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('flattenYaml', () => {
  it('flattens nested keys to dotted paths', () => {
    const yaml = ['project:', '  name: test', '  type: brownfield', ''].join('\n');
    expect(flattenYaml(yaml)).toEqual({
      'project.name': 'test',
      'project.type': 'brownfield',
    });
  });

  it('returns RAW VALUE STRINGS (no type coercion)', () => {
    const yaml = ['enabled: true', 'count: 42', ''].join('\n');
    const flat = flattenYaml(yaml);
    expect(flat.enabled).toBe('true'); // string, not boolean
    expect(flat.count).toBe('42'); // string, not number
  });

  it('strips inline comments after values', () => {
    const yaml = 'theme: dark  # users prefer dark\n';
    expect(flattenYaml(yaml).theme).toBe('dark');
  });

  it('skips empty + comment-only lines', () => {
    const yaml = ['# top comment', '', 'k: v', '   ', '# another comment', ''].join('\n');
    expect(flattenYaml(yaml)).toEqual({ k: 'v' });
  });

  it('handles deep nesting (3+ levels)', () => {
    const yaml = ['hooks:', '  pre:', '    upgrade: ./pre.sh', ''].join('\n');
    expect(flattenYaml(yaml)).toEqual({ 'hooks.pre.upgrade': './pre.sh' });
  });
});

describe('mergeConfigs — adopt new default when user kept old default', () => {
  it('updates the YAML in place when user did not customize', () => {
    const oldDefault = 'theme: light\n';
    const newDefault = 'theme: dark\n';
    const userCurrent = 'theme: light\n';
    const result = mergeConfigs(oldDefault, newDefault, userCurrent);
    expect(result.mergedYaml).toContain('theme: dark');
    expect(result.conflicts).toEqual([]);
    expect(result.newKeys).toEqual([]);
  });
});

describe('mergeConfigs — preserve user customization', () => {
  it('keeps user value when user changed from old default', () => {
    const oldDefault = 'theme: light\n';
    const newDefault = 'theme: dark\n';
    const userCurrent = 'theme: solarized\n';
    const result = mergeConfigs(oldDefault, newDefault, userCurrent);
    expect(result.mergedYaml).toContain('theme: solarized');
    // Both user and framework changed → conflict reported.
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toEqual({
      key: 'theme',
      oldDefault: 'light',
      newDefault: 'dark',
      userValue: 'solarized',
    });
  });

  it('does NOT report a conflict when only the user changed (framework default unchanged)', () => {
    const oldDefault = 'theme: light\n';
    const newDefault = 'theme: light\n';
    const userCurrent = 'theme: solarized\n';
    const result = mergeConfigs(oldDefault, newDefault, userCurrent);
    expect(result.mergedYaml).toContain('theme: solarized');
    expect(result.conflicts).toEqual([]);
  });
});

describe('mergeConfigs — protected prefixes', () => {
  it('NEVER overwrites the hooks: section', () => {
    const oldDefault = ['hooks:', '  pre: ./old-pre.sh', ''].join('\n');
    const newDefault = ['hooks:', '  pre: ./new-pre.sh', ''].join('\n');
    const userCurrent = ['hooks:', '  pre: ./user-pre.sh', ''].join('\n');
    const result = mergeConfigs(oldDefault, newDefault, userCurrent);
    expect(result.mergedYaml).toContain('./user-pre.sh');
    expect(result.mergedYaml).not.toContain('./new-pre.sh');
    expect(result.conflicts).toEqual([]);
  });

  it('NEVER overwrites project.name / project.description / project.approver', () => {
    const oldDefault = ['project:', '  name: old', '  description: old desc', ''].join('\n');
    const newDefault = ['project:', '  name: new', '  description: new desc', ''].join('\n');
    const userCurrent = ['project:', '  name: mine', '  description: my desc', ''].join('\n');
    const result = mergeConfigs(oldDefault, newDefault, userCurrent);
    expect(result.mergedYaml).toContain('name: mine');
    expect(result.mergedYaml).toContain('description: my desc');
  });
});

describe('mergeConfigs — new keys', () => {
  it('appends new keys at end with the upgrade comment block', () => {
    const oldDefault = 'theme: light\n';
    const newDefault = ['theme: light', 'editor:', '  tab_width: 2', ''].join('\n');
    const userCurrent = 'theme: light\n';
    const result = mergeConfigs(oldDefault, newDefault, userCurrent);
    expect(result.newKeys).toContain('editor.tab_width');
    expect(result.mergedYaml).toContain('# New settings added by framework upgrade');
    expect(result.mergedYaml).toContain('editor:');
    expect(result.mergedYaml).toContain('tab_width: 2');
  });

  it('does NOT add the new-keys block when there are no new keys', () => {
    const oldDefault = 'theme: light\n';
    const newDefault = 'theme: dark\n';
    const userCurrent = 'theme: dark\n';
    const result = mergeConfigs(oldDefault, newDefault, userCurrent);
    expect(result.newKeys).toEqual([]);
    expect(result.mergedYaml).not.toContain('# New settings added');
  });
});

describe('readConfig + writeConfig', () => {
  it('reads back what writeConfig wrote', () => {
    mkdirSync(path.join(tmpDir, '.jumpstart'), { recursive: true });
    writeConfig(tmpDir, 'theme: dark\n');
    expect(readConfig(tmpDir)).toBe('theme: dark\n');
  });

  it('readConfig returns null when no config exists', () => {
    expect(readConfig(tmpDir)).toBeNull();
  });
});

describe('writeConflictsFile', () => {
  it('writes a structured per-conflict file', () => {
    mkdirSync(path.join(tmpDir, '.jumpstart'), { recursive: true });
    writeConflictsFile(
      tmpDir,
      [{ key: 'theme', oldDefault: 'light', newDefault: 'dark', userValue: 'solarized' }],
      '1.0.0',
      '1.1.0'
    );
    const content = readFileSync(path.join(tmpDir, '.jumpstart', 'config.yaml.conflicts'), 'utf8');
    expect(content).toContain('1.0.0 → 1.1.0');
    expect(content).toContain('## theme');
    expect(content).toContain('Your value (preserved):    solarized');
    expect(content).toContain('Old default:               light');
    expect(content).toContain('New default (recommended):  dark');
  });
});
