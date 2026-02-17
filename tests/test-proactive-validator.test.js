/**
 * test-proactive-validator.test.js — Tests for Proactive Validation Engine (UX Feature 7)
 *
 * Tests for bin/lib/proactive-validator.js covering:
 * - Single-file validation (clean, vague, smelly, missing sections)
 * - Directory-wide validation
 * - Cross-file drift / broken links / coverage gap detection
 * - Diagnostic formatting
 * - Report rendering
 * - Severity mapping
 * - Pass/fail thresholds
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const {
  DIAGNOSTIC_CODES,
  validateArtifactProactive,
  validateAllArtifacts,
  formatDiagnostic,
  renderValidationReport,
  inferSchemaName
} = require('../bin/lib/proactive-validator');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-pv-'));
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function writeSpec(tmpDir, name, content) {
  fs.writeFileSync(path.join(tmpDir, 'specs', name), content, 'utf8');
}

function makeCleanArtifact() {
  return [
    '---',
    'id: test-artifact',
    'phase: 0',
    'status: approved',
    '---',
    '',
    '# Test Artifact',
    '',
    'The system processes 100 requests per second with 99.9% uptime.',
    'Response time is under 200ms at the 95th percentile.',
    '',
    '## Requirements',
    '',
    'Users can log in within 2 seconds.',
    '',
    '## Phase Gate Approval',
    '',
    '- [x] All criteria met',
    '- [x] Quality gates passed',
    '',
    '**Approved by:** Human',
    '**Approval date:** 2026-01-01'
  ].join('\n');
}

function makeVagueArtifact() {
  return [
    '# Vague Artifact',
    '',
    'The system should be fast and scalable.',
    'It needs to be robust and user-friendly.',
    'We probably need a flexible architecture.',
    '',
    '## Phase Gate Approval',
    '',
    '- [ ] All criteria met',
    '',
    '**Approved by:** Pending'
  ].join('\n');
}

function makeSmellyArtifact() {
  return [
    '# Smelly Artifact',
    '',
    'The system should handle many requests, etc.',
    'Various components will be implemented and so on.',
    'Several different services will communicate somehow.',
    '',
    '## Phase Gate Approval',
    '',
    '- [ ] All criteria met',
    '',
    '**Approved by:** Pending'
  ].join('\n');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('proactive-validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── DIAGNOSTIC_CODES ────────────────────────────────────────────────

  describe('DIAGNOSTIC_CODES', () => {
    it('has all expected diagnostic codes', () => {
      const expectedCodes = [
        'VAGUE_ADJ', 'PASSIVE_VOICE', 'GUESSING_LANG', 'GWT_FORMAT',
        'METRIC_GAP', 'SPEC_SMELL', 'SCHEMA_ERROR', 'MISSING_SECTION',
        'APPROVAL_PENDING', 'PLACEHOLDER', 'BROKEN_LINK', 'SPEC_DRIFT',
        'COVERAGE_GAP', 'UNMAPPED_NFR'
      ];
      for (const code of expectedCodes) {
        expect(DIAGNOSTIC_CODES).toHaveProperty(code);
        expect(DIAGNOSTIC_CODES[code]).toHaveProperty('severity');
        expect(DIAGNOSTIC_CODES[code]).toHaveProperty('description');
      }
    });

    it('has valid severity values', () => {
      const validSeverities = ['error', 'warning', 'info'];
      for (const entry of Object.values(DIAGNOSTIC_CODES)) {
        expect(validSeverities).toContain(entry.severity);
      }
    });
  });

  // ─── inferSchemaName ─────────────────────────────────────────────────

  describe('inferSchemaName', () => {
    it('maps known artifact filenames to schema names', () => {
      expect(inferSchemaName('prd.md')).toBe('prd');
      expect(inferSchemaName('architecture.md')).toBe('architecture');
      expect(inferSchemaName('challenger-brief.md')).toBe('challenger-brief');
      expect(inferSchemaName('product-brief.md')).toBe('product-brief');
    });

    it('returns null for unknown filenames', () => {
      expect(inferSchemaName('random-file.md')).toBeNull();
      expect(inferSchemaName('notes.md')).toBeNull();
    });
  });

  // ─── validateArtifactProactive — clean artifact ──────────────────────

  describe('validateArtifactProactive — clean artifact', () => {
    it('returns a high score with few diagnostics', () => {
      const filePath = path.join(tmpDir, 'specs', 'clean.md');
      writeSpec(tmpDir, 'clean.md', makeCleanArtifact());

      const result = validateArtifactProactive(filePath);

      expect(result.file).toBe(filePath);
      expect(typeof result.score).toBe('number');
      expect(result.score).toBeGreaterThanOrEqual(60);
      expect(result.pass).toBe(true);
    });
  });

  // ─── validateArtifactProactive — vague artifact ──────────────────────

  describe('validateArtifactProactive — vague artifact', () => {
    it('produces VAGUE_ADJ diagnostics', () => {
      const filePath = path.join(tmpDir, 'specs', 'vague.md');
      writeSpec(tmpDir, 'vague.md', makeVagueArtifact());

      const result = validateArtifactProactive(filePath);

      const vagueIssues = result.diagnostics.filter(d => d.code === 'VAGUE_ADJ');
      expect(vagueIssues.length).toBeGreaterThan(0);
      expect(vagueIssues[0].severity).toBe('warning');
      expect(vagueIssues[0].suggestion).toBeDefined();
    });

    it('produces GUESSING_LANG diagnostics for hedging words', () => {
      const filePath = path.join(tmpDir, 'specs', 'vague.md');
      writeSpec(tmpDir, 'vague.md', makeVagueArtifact());

      const result = validateArtifactProactive(filePath);

      const guessingIssues = result.diagnostics.filter(d => d.code === 'GUESSING_LANG');
      expect(guessingIssues.length).toBeGreaterThan(0);
    });

    it('produces APPROVAL_PENDING for unapproved artifact', () => {
      const filePath = path.join(tmpDir, 'specs', 'vague.md');
      writeSpec(tmpDir, 'vague.md', makeVagueArtifact());

      const result = validateArtifactProactive(filePath);

      const approvalIssues = result.diagnostics.filter(d => d.code === 'APPROVAL_PENDING');
      expect(approvalIssues.length).toBe(1);
    });
  });

  // ─── validateArtifactProactive — smelly artifact ─────────────────────

  describe('validateArtifactProactive — smelly artifact', () => {
    it('produces SPEC_SMELL diagnostics', () => {
      const filePath = path.join(tmpDir, 'specs', 'smelly.md');
      writeSpec(tmpDir, 'smelly.md', makeSmellyArtifact());

      const result = validateArtifactProactive(filePath);

      const smellIssues = result.diagnostics.filter(d => d.code === 'SPEC_SMELL');
      expect(smellIssues.length).toBeGreaterThan(0);
    });
  });

  // ─── validateArtifactProactive — edge cases ──────────────────────────

  describe('validateArtifactProactive — edge cases', () => {
    it('handles non-existent file gracefully', () => {
      const result = validateArtifactProactive(path.join(tmpDir, 'nonexistent.md'));

      expect(result.score).toBe(0);
      expect(result.pass).toBe(false);
      expect(result.diagnostics.length).toBe(1);
      expect(result.diagnostics[0].code).toBe('SCHEMA_ERROR');
    });

    it('handles empty file', () => {
      const filePath = path.join(tmpDir, 'specs', 'empty.md');
      writeSpec(tmpDir, 'empty.md', '');

      const result = validateArtifactProactive(filePath);

      expect(result.score).toBe(0);
      expect(result.pass).toBe(false);
    });

    it('uses strict threshold when strict option is true', () => {
      const filePath = path.join(tmpDir, 'specs', 'clean.md');
      writeSpec(tmpDir, 'clean.md', makeCleanArtifact());

      const normal = validateArtifactProactive(filePath, { strict: false });
      const strict = validateArtifactProactive(filePath, { strict: true });

      // Both should have the same score but might differ in pass
      expect(normal.score).toBe(strict.score);
      // strict requires 100 to pass
      if (strict.score < 100) {
        expect(strict.pass).toBe(false);
      }
    });
  });

  // ─── validateArtifactProactive — diagnostic shape ────────────────────

  describe('diagnostic shape', () => {
    it('every diagnostic has required fields', () => {
      const filePath = path.join(tmpDir, 'specs', 'vague.md');
      writeSpec(tmpDir, 'vague.md', makeVagueArtifact());

      const result = validateArtifactProactive(filePath);

      for (const diag of result.diagnostics) {
        expect(diag).toHaveProperty('line');
        expect(diag).toHaveProperty('column');
        expect(diag).toHaveProperty('severity');
        expect(diag).toHaveProperty('code');
        expect(diag).toHaveProperty('message');
        expect(diag).toHaveProperty('suggestion');
        expect(diag).toHaveProperty('source');
        expect(typeof diag.line).toBe('number');
        expect(['error', 'warning', 'info']).toContain(diag.severity);
      }
    });
  });

  // ─── validateAllArtifacts ────────────────────────────────────────────

  describe('validateAllArtifacts', () => {
    it('returns zero files for empty specs directory', async () => {
      const result = await validateAllArtifacts(path.join(tmpDir, 'specs'));

      expect(result.files).toEqual([]);
      expect(result.summary.total_files).toBe(0);
      expect(result.summary.total_diagnostics).toBe(0);
    });

    it('scans multiple artifacts and aggregates', async () => {
      writeSpec(tmpDir, 'clean.md', makeCleanArtifact());
      writeSpec(tmpDir, 'vague.md', makeVagueArtifact());

      const result = await validateAllArtifacts(path.join(tmpDir, 'specs'), { root: tmpDir });

      expect(result.files.length).toBe(2);
      expect(result.summary.total_files).toBe(2);
      expect(result.summary.total_diagnostics).toBeGreaterThan(0);
    });

    it('normalizes file paths to specs/ relative format', async () => {
      writeSpec(tmpDir, 'test-doc.md', makeCleanArtifact());

      const result = await validateAllArtifacts(path.join(tmpDir, 'specs'), { root: tmpDir });

      expect(result.files[0].file).toBe('specs/test-doc.md');
    });

    it('returns cross_file structure', async () => {
      writeSpec(tmpDir, 'prd.md', makeCleanArtifact());

      const result = await validateAllArtifacts(path.join(tmpDir, 'specs'), { root: tmpDir });

      expect(result).toHaveProperty('cross_file');
      expect(result.cross_file).toHaveProperty('drift');
      expect(result.cross_file).toHaveProperty('broken_links');
      expect(result.cross_file).toHaveProperty('coverage_gaps');
      expect(result.cross_file).toHaveProperty('unmapped_nfrs');
    });

    it('computes summary averages', async () => {
      writeSpec(tmpDir, 'clean.md', makeCleanArtifact());
      writeSpec(tmpDir, 'vague.md', makeVagueArtifact());

      const result = await validateAllArtifacts(path.join(tmpDir, 'specs'), { root: tmpDir });

      expect(typeof result.summary.avg_score).toBe('number');
      expect(result.summary.pass_count + result.summary.fail_count).toBe(result.summary.total_files);
    });
  });

  // ─── formatDiagnostic ───────────────────────────────────────────────

  describe('formatDiagnostic', () => {
    it('formats with file context', () => {
      const diag = { line: 10, column: 5, severity: 'warning', code: 'VAGUE_ADJ', message: 'Vague word "fast"', suggestion: 'Add metric' };
      const formatted = formatDiagnostic(diag, 'specs/prd.md');

      expect(formatted).toContain('specs/prd.md:10:5');
      expect(formatted).toContain('WARNING');
      expect(formatted).toContain('[VAGUE_ADJ]');
      expect(formatted).toContain('Vague word');
    });

    it('formats without file context', () => {
      const diag = { line: 5, column: 0, severity: 'error', code: 'SCHEMA_ERROR', message: 'Missing field', suggestion: null };
      const formatted = formatDiagnostic(diag);

      expect(formatted).toContain('line 5');
      expect(formatted).toContain('ERROR');
      expect(formatted).toContain('[SCHEMA_ERROR]');
    });
  });

  // ─── renderValidationReport ──────────────────────────────────────────

  describe('renderValidationReport', () => {
    it('produces a Markdown report with expected sections', () => {
      const result = {
        files: [
          { file: 'specs/prd.md', score: 75, pass: true, diagnostics: [] },
          { file: 'specs/vague.md', score: 45, pass: false, diagnostics: [
            { line: 3, column: 0, severity: 'warning', code: 'VAGUE_ADJ', message: 'Vague "fast"', suggestion: 'Add metric' }
          ]}
        ],
        cross_file: { drift: null, broken_links: null, coverage_gaps: null, unmapped_nfrs: null },
        summary: { total_files: 2, total_diagnostics: 1, pass_count: 1, fail_count: 1, avg_score: 60 }
      };

      const report = renderValidationReport(result);

      expect(report).toContain('# Proactive Validation Report');
      expect(report).toContain('specs/prd.md');
      expect(report).toContain('specs/vague.md');
      expect(report).toContain('60/100');
    });

    it('includes cross-file section when findings exist', () => {
      const result = {
        files: [],
        cross_file: {
          drift: [{ severity: 'warning', code: 'SPEC_DRIFT', message: 'Story E01-S01 references changed', source: 'spec-drift' }],
          broken_links: null,
          coverage_gaps: null,
          unmapped_nfrs: null
        },
        summary: { total_files: 0, total_diagnostics: 1, pass_count: 0, fail_count: 0, avg_score: null }
      };

      const report = renderValidationReport(result);

      expect(report).toContain('Cross-File');
      expect(report).toContain('SPEC_DRIFT');
    });
  });
});
