/**
 * proactive-validator.js — Proactive Validation & Suggestion Engine (UX Feature 7)
 *
 * Composes existing validation modules (spec-tester, smell-detector, validator,
 * spec-drift, crossref, traceability, coverage) into a unified diagnostic
 * pipeline. Each finding is normalized to an LSP-style diagnostic format:
 *   { line, column, severity, code, message, suggestion, source }
 *
 * Usage:
 *   echo '{"file":"specs/prd.md"}' | node bin/lib/proactive-validator.js
 *   echo '{"specs_dir":"specs/"}' | node bin/lib/proactive-validator.js
 *
 * Output (stdout JSON):
 *   { "ok": true, "files": [...], "cross_file": {...}, "summary": {...} }
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── CJS siblings ────────────────────────────────────────────────────────────
const specTester = require('./spec-tester');
const smellDetector = require('./smell-detector');
const validator = require('./validator');
const specDrift = require('./spec-drift');
const coverageMod = require('./coverage');

// ─── Diagnostic Codes ────────────────────────────────────────────────────────

/**
 * Canonical diagnostic codes. Each code has a default severity and description.
 */
const DIAGNOSTIC_CODES = {
  VAGUE_ADJ:       { severity: 'warning', description: 'Vague adjective without measurable metric' },
  PASSIVE_VOICE:   { severity: 'info',    description: 'Passive voice construction — prefer active voice' },
  GUESSING_LANG:   { severity: 'warning', description: 'Hedging/guessing language detected' },
  GWT_FORMAT:      { severity: 'info',    description: 'Acceptance criteria not in Given/When/Then format' },
  METRIC_GAP:      { severity: 'warning', description: 'Requirement lacks quantified acceptance metric' },
  SPEC_SMELL:      { severity: 'warning', description: 'Spec smell detected' },
  SCHEMA_ERROR:    { severity: 'error',   description: 'Schema/structural validation error' },
  MISSING_SECTION: { severity: 'error',   description: 'Required Markdown section missing' },
  APPROVAL_PENDING:{ severity: 'info',    description: 'Artifact Phase Gate not yet approved' },
  PLACEHOLDER:     { severity: 'warning', description: 'Unresolved placeholder found' },
  BROKEN_LINK:     { severity: 'error',   description: 'Cross-reference link target not found' },
  SPEC_DRIFT:      { severity: 'warning', description: 'Specification drift between artifacts' },
  COVERAGE_GAP:    { severity: 'warning', description: 'User story not covered by implementation tasks' },
  UNMAPPED_NFR:    { severity: 'warning', description: 'Non-functional requirement not mapped to architecture' }
};

// ─── Single-File Validation ──────────────────────────────────────────────────

/**
 * Infer the schema name for an artifact based on its filename.
 *
 * @param {string} basename - Filename (e.g., 'prd.md').
 * @returns {string|null} Schema name or null.
 */
function inferSchemaName(basename) {
  const map = {
    'challenger-brief.md': 'challenger-brief',
    'product-brief.md': 'product-brief',
    'prd.md': 'prd',
    'architecture.md': 'architecture',
    'implementation-plan.md': 'implementation-plan',
    'codebase-context.md': 'codebase-context'
  };
  return map[basename] || null;
}

/**
 * Run all relevant checks on a single artifact file and return
 * diagnostics in a unified format.
 *
 * @param {string} filePath - Absolute path to the artifact.
 * @param {object} [options] - Options.
 * @param {string} [options.schemas_dir] - Path to schema directory.
 * @param {boolean} [options.strict] - Use strict pass threshold (100).
 * @returns {{ file: string, score: number, pass: boolean, diagnostics: Array<object> }}
 */
function validateArtifactProactive(filePath, options = {}) {
  const diagnostics = [];
  const basename = path.basename(filePath);
  const relPath = filePath; // caller can pass relative

  if (!fs.existsSync(filePath)) {
    return {
      file: relPath,
      score: 0,
      pass: false,
      diagnostics: [{ line: 0, column: 0, severity: 'error', code: 'SCHEMA_ERROR', message: `File not found: ${filePath}`, suggestion: 'Create the artifact using the appropriate template.', source: 'validator' }]
    };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) {
    return {
      file: relPath,
      score: 0,
      pass: false,
      diagnostics: [{ line: 0, column: 0, severity: 'error', code: 'SCHEMA_ERROR', message: 'Artifact is empty.', suggestion: 'Populate using the template from .jumpstart/templates/.', source: 'validator' }]
    };
  }

  // ─── 1. Spec-tester checks ────────────────────────────────────────────
  const ambiguity = specTester.checkAmbiguity(content);
  for (const issue of ambiguity.issues) {
    diagnostics.push({
      line: issue.line,
      column: 0,
      severity: 'warning',
      code: 'VAGUE_ADJ',
      message: `Vague adjective "${issue.word}" without measurable metric`,
      suggestion: `Add a quantified metric after "${issue.word}" (e.g., "${issue.word} — under 200ms p95").`,
      source: 'spec-tester'
    });
  }

  const passive = specTester.checkPassiveVoice(content);
  for (const issue of passive.issues) {
    diagnostics.push({
      line: issue.line,
      column: 0,
      severity: 'info',
      code: 'PASSIVE_VOICE',
      message: `Passive voice: "${issue.context.substring(0, 80)}"`,
      suggestion: 'Rewrite in active voice with a clear subject.',
      source: 'spec-tester'
    });
  }

  const guessing = specTester.checkGuessingLanguage(content);
  for (const issue of guessing.issues) {
    diagnostics.push({
      line: issue.line,
      column: 0,
      severity: 'warning',
      code: 'GUESSING_LANG',
      message: `Guessing language: "${issue.word}"`,
      suggestion: 'Replace with researched facts or tag with [NEEDS CLARIFICATION].',
      source: 'spec-tester'
    });
  }

  const gwt = specTester.checkGWTFormat(content);
  for (const issue of gwt.issues) {
    diagnostics.push({
      line: issue.line,
      column: 0,
      severity: 'info',
      code: 'GWT_FORMAT',
      message: 'Acceptance criterion not in Given/When/Then format',
      suggestion: 'Rewrite as: Given [context], When [action], Then [outcome].',
      source: 'spec-tester'
    });
  }

  const metrics = specTester.checkMetricCoverage(content);
  for (const gap of (metrics.gaps || [])) {
    diagnostics.push({
      line: gap.line || 0,
      column: 0,
      severity: 'warning',
      code: 'METRIC_GAP',
      message: gap.requirement ? `Requirement missing metric: "${gap.requirement.substring(0, 80)}"` : 'Requirement missing quantified metric',
      suggestion: 'Add a measurable acceptance criterion with numeric targets.',
      source: 'spec-tester'
    });
  }

  // Quality score from spec-tester
  const allChecks = specTester.runAllChecks(content);
  const score = allChecks.score;
  const passThreshold = options.strict ? 100 : 70;

  // ─── 2. Smell detection ───────────────────────────────────────────────
  const smells = smellDetector.detectSmells(content);
  for (const smell of smells.smells) {
    diagnostics.push({
      line: smell.line,
      column: 0,
      severity: smell.severity === 'major' ? 'warning' : 'info',
      code: `SPEC_SMELL`,
      message: `Spec smell (${smell.type}): "${smell.text.substring(0, 80)}"`,
      suggestion: smell.description || `Address the ${smell.type} pattern.`,
      source: 'smell-detector'
    });
  }

  // ─── 3. Schema/structural validation ──────────────────────────────────
  const schemaName = options.schema || inferSchemaName(basename);
  if (schemaName) {
    try {
      const vResult = validator.validateArtifact(filePath, schemaName, options.schemas_dir);
      for (const err of vResult.errors) {
        diagnostics.push({
          line: 0,
          column: 0,
          severity: 'error',
          code: 'SCHEMA_ERROR',
          message: typeof err === 'string' ? err : err.message || JSON.stringify(err),
          suggestion: 'Fix the frontmatter or structure to match the schema.',
          source: 'validator'
        });
      }
      for (const warn of vResult.warnings) {
        diagnostics.push({
          line: 0,
          column: 0,
          severity: 'warning',
          code: warn.includes('placeholder') ? 'PLACEHOLDER' : (warn.includes('Phase Gate') ? 'MISSING_SECTION' : 'SCHEMA_ERROR'),
          message: warn,
          suggestion: warn.includes('placeholder') ? 'Replace all [PLACEHOLDER] tags with real content.' : 'Add the missing section.',
          source: 'validator'
        });
      }
    } catch {
      // Schema not available — skip
    }
  }

  // ─── 4. Approval check ───────────────────────────────────────────────
  const approval = validator.checkApproval(filePath);
  if (!approval.approved) {
    diagnostics.push({
      line: 0,
      column: 0,
      severity: 'info',
      code: 'APPROVAL_PENDING',
      message: 'Artifact has not been approved (Phase Gate checkboxes incomplete or approver pending).',
      suggestion: 'Complete the Phase Gate Approval section and mark checkboxes [x].',
      source: 'validator'
    });
  }

  return {
    file: relPath,
    score,
    pass: score >= passThreshold,
    diagnostics
  };
}

// ─── Directory-Wide Validation ───────────────────────────────────────────────

/**
 * Validate all artifacts in a specs directory plus cross-file checks.
 *
 * @param {string} specsDir - Absolute path to specs directory.
 * @param {object} [options] - Options.
 * @param {string} [options.root] - Project root (defaults to parent of specsDir).
 * @param {string} [options.schemas_dir] - Path to JSON schemas.
 * @param {boolean} [options.strict] - Strict pass threshold (100).
 * @returns {Promise<object>} Validation result with per-file and cross-file data.
 */
async function validateAllArtifacts(specsDir, options = {}) {
  const root = options.root || path.dirname(specsDir);
  const files = [];
  const crossFile = {
    drift: null,
    broken_links: null,
    coverage_gaps: null,
    unmapped_nfrs: null
  };

  // ─── Per-file validation ──────────────────────────────────────────────
  if (fs.existsSync(specsDir)) {
    const entries = fs.readdirSync(specsDir).filter(f => f.endsWith('.md'));
    for (const entry of entries) {
      const filePath = path.join(specsDir, entry);
      const result = validateArtifactProactive(filePath, { ...options, schemas_dir: options.schemas_dir });
      // Normalize the file path to relative
      result.file = `specs/${entry}`;
      files.push(result);
    }
  }

  // ─── Cross-file: Spec drift ──────────────────────────────────────────
  try {
    const driftResult = specDrift.checkSpecDrift(specsDir);
    if (driftResult && driftResult.drifts && driftResult.drifts.length > 0) {
      crossFile.drift = driftResult.drifts.map(d => ({
        severity: 'warning',
        code: 'SPEC_DRIFT',
        message: typeof d === 'string' ? d : (d.message || JSON.stringify(d)),
        source: 'spec-drift'
      }));
    }
  } catch { /* spec-drift not applicable */ }

  // ─── Cross-file: Broken links ────────────────────────────────────────
  try {
    const { validateCrossRefs } = await import('./crossref.js');
    const crossResult = validateCrossRefs(specsDir, root);
    if (crossResult && crossResult.broken_links && crossResult.broken_links.length > 0) {
      crossFile.broken_links = crossResult.broken_links.map(link => ({
        severity: 'error',
        code: 'BROKEN_LINK',
        message: typeof link === 'string' ? link : (link.text ? `Broken link: [${link.text}](${link.target}) in ${link.file || 'unknown'}` : JSON.stringify(link)),
        source: 'crossref'
      }));
    }
  } catch { /* crossref not applicable */ }

  // ─── Cross-file: Coverage gaps ───────────────────────────────────────
  const prdPath = path.join(specsDir, 'prd.md');
  const planPath = path.join(specsDir, 'implementation-plan.md');
  if (fs.existsSync(prdPath) && fs.existsSync(planPath)) {
    try {
      const covResult = coverageMod.computeCoverage(prdPath, planPath);
      if (covResult && covResult.uncovered && covResult.uncovered.length > 0) {
        crossFile.coverage_gaps = covResult.uncovered.map(id => ({
          severity: 'warning',
          code: 'COVERAGE_GAP',
          message: `User story ${id} is not covered by any implementation task`,
          source: 'coverage'
        }));
      }
    } catch { /* coverage not applicable */ }
  }

  // ─── Cross-file: Unmapped NFRs ──────────────────────────────────────
  try {
    const { buildNFRMap } = await import('./traceability.js');
    const nfrResult = buildNFRMap(root);
    if (nfrResult && nfrResult.mapping) {
      const unmapped = nfrResult.mapping.filter(m => !m.mapped_to || m.mapped_to.length === 0);
      if (unmapped.length > 0) {
        crossFile.unmapped_nfrs = unmapped.map(m => ({
          severity: 'warning',
          code: 'UNMAPPED_NFR',
          message: `NFR ${m.id || m.nfr_id || 'unknown'} is not mapped to any architecture component`,
          source: 'traceability'
        }));
      }
    }
  } catch { /* traceability not applicable */ }

  // ─── Summary ─────────────────────────────────────────────────────────
  const totalDiagnostics = files.reduce((sum, f) => sum + f.diagnostics.length, 0) +
    (crossFile.drift ? crossFile.drift.length : 0) +
    (crossFile.broken_links ? crossFile.broken_links.length : 0) +
    (crossFile.coverage_gaps ? crossFile.coverage_gaps.length : 0) +
    (crossFile.unmapped_nfrs ? crossFile.unmapped_nfrs.length : 0);

  const passCount = files.filter(f => f.pass).length;
  const failCount = files.filter(f => !f.pass).length;
  const avgScore = files.length > 0
    ? Math.round(files.reduce((sum, f) => sum + f.score, 0) / files.length)
    : null;

  return {
    files,
    cross_file: crossFile,
    summary: {
      total_files: files.length,
      total_diagnostics: totalDiagnostics,
      pass_count: passCount,
      fail_count: failCount,
      avg_score: avgScore
    }
  };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * Format a single diagnostic as an LSP-style string.
 *
 * @param {object} diag - Diagnostic object.
 * @param {string} [file] - Optional file context.
 * @returns {string} Formatted diagnostic string.
 */
function formatDiagnostic(diag, file) {
  const loc = file ? `${file}:${diag.line}:${diag.column}` : `line ${diag.line}`;
  const sev = diag.severity.toUpperCase().padEnd(7);
  const suggest = diag.suggestion ? ` — ${diag.suggestion}` : '';
  return `${loc} ${sev} [${diag.code}] ${diag.message}${suggest}`;
}

/**
 * Render a full validation report as Markdown.
 *
 * @param {object} result - Result from validateAllArtifacts.
 * @returns {string} Markdown report.
 */
function renderValidationReport(result) {
  const lines = [];
  lines.push('# Proactive Validation Report\n');
  lines.push(`**Files scanned:** ${result.summary.total_files}`);
  lines.push(`**Total diagnostics:** ${result.summary.total_diagnostics}`);
  lines.push(`**Passing:** ${result.summary.pass_count} | **Failing:** ${result.summary.fail_count}`);
  if (result.summary.avg_score !== null) {
    lines.push(`**Average quality score:** ${result.summary.avg_score}/100`);
  }
  lines.push('');

  // Per-file sections
  for (const file of result.files) {
    const statusIcon = file.pass ? '✅' : '❌';
    lines.push(`## ${statusIcon} ${file.file} (score: ${file.score}/100)\n`);
    if (file.diagnostics.length === 0) {
      lines.push('No issues found.\n');
    } else {
      lines.push(`| Line | Severity | Code | Message | Suggestion |`);
      lines.push(`|------|----------|------|---------|------------|`);
      for (const d of file.diagnostics) {
        lines.push(`| ${d.line} | ${d.severity} | ${d.code} | ${d.message.substring(0, 80)} | ${(d.suggestion || '').substring(0, 60)} |`);
      }
      lines.push('');
    }
  }

  // Cross-file section
  const hasAnyCross = Object.values(result.cross_file).some(v => v && v.length > 0);
  if (hasAnyCross) {
    lines.push('## Cross-File Analysis\n');
    for (const [category, items] of Object.entries(result.cross_file)) {
      if (items && items.length > 0) {
        lines.push(`### ${category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} (${items.length})\n`);
        for (const item of items) {
          lines.push(`- **[${item.code}]** ${item.message}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  DIAGNOSTIC_CODES,
  validateArtifactProactive,
  validateAllArtifacts,
  formatDiagnostic,
  renderValidationReport,
  inferSchemaName
};

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

if (require.main === module) {
  const io = require('./io');
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', async () => {
    try {
      const parsed = input.trim() ? JSON.parse(input) : {};
      if (parsed.file) {
        const result = validateArtifactProactive(path.resolve(parsed.file), parsed);
        io.writeResult(result);
      } else {
        const specsDir = path.resolve(parsed.specs_dir || 'specs');
        const result = await validateAllArtifacts(specsDir, parsed);
        io.writeResult(result);
      }
    } catch (err) {
      io.writeError('VALIDATION_ERROR', err.message);
      process.exit(2);
    }
  });

  if (process.stdin.isTTY) {
    validateAllArtifacts(path.resolve('specs')).then(result => {
      io.writeResult(result);
    }).catch(err => {
      io.writeError('VALIDATION_ERROR', err.message);
      process.exit(2);
    });
  }
}
