/**
 * delivery-confidence.js — Delivery Confidence Scoring
 *
 * Score a planned or implemented feature on completeness, risk,
 * ambiguity, quality, and enterprise readiness.
 *
 * Usage:
 *   node bin/lib/delivery-confidence.js score|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DIMENSIONS = ['completeness', 'risk', 'ambiguity', 'quality', 'enterprise_readiness'];

const WEIGHT_DEFAULTS = {
  completeness: 0.25,
  risk: 0.20,
  ambiguity: 0.20,
  quality: 0.20,
  enterprise_readiness: 0.15
};

const CONFIDENCE_LEVELS = [
  { min: 90, label: 'Very High', emoji: '🟢' },
  { min: 75, label: 'High', emoji: '🟡' },
  { min: 50, label: 'Medium', emoji: '🟠' },
  { min: 25, label: 'Low', emoji: '🔴' },
  { min: 0, label: 'Very Low', emoji: '⛔' }
];

/**
 * Analyze completeness of an artifact.
 * @param {string} content
 * @param {string} artifactType
 * @returns {object}
 */
function analyzeCompleteness(content, artifactType) {
  const checks = [];
  const lines = content.split('\n');

  // Check for required sections
  const hasFrontmatter = content.startsWith('---');
  checks.push({ check: 'has_frontmatter', passed: hasFrontmatter });

  const hasApproval = content.includes('Phase Gate Approval');
  checks.push({ check: 'has_approval_section', passed: hasApproval });

  const headingCount = (content.match(/^#{1,4}\s+/gm) || []).length;
  checks.push({ check: 'has_sections', passed: headingCount >= 3 });

  // Check for placeholder content
  const placeholders = (content.match(/\[TODO\]|\[TBD\]|\[PLACEHOLDER\]|\[NEEDS CLARIFICATION\]/gi) || []).length;
  checks.push({ check: 'no_placeholders', passed: placeholders === 0 });

  // Check for empty sections
  const emptySections = [];
  let currentHeading = null;
  let hasContent = false;
  for (const line of lines) {
    if (/^#{1,4}\s+/.test(line)) {
      if (currentHeading && !hasContent) emptySections.push(currentHeading);
      currentHeading = line.trim();
      hasContent = false;
    } else if (line.trim().length > 0) {
      hasContent = true;
    }
  }
  checks.push({ check: 'no_empty_sections', passed: emptySections.length === 0 });

  // Check minimum content length
  checks.push({ check: 'sufficient_content', passed: content.length > 500 });

  const passed = checks.filter(c => c.passed).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    checks,
    gaps: checks.filter(c => !c.passed).map(c => c.check),
    placeholders_found: placeholders
  };
}

/**
 * Analyze risk factors.
 * @param {string} content
 * @returns {object}
 */
function analyzeRisk(content) {
  const risks = [];

  // Check for risk-related keywords
  const riskKeywords = ['risk', 'concern', 'unknown', 'assumption', 'constraint', 'blocker', 'dependency'];
  for (const keyword of riskKeywords) {
    const pattern = new RegExp(`\\b${keyword}s?\\b`, 'gi');
    const matches = content.match(pattern) || [];
    if (matches.length > 0) {
      risks.push({ factor: keyword, mentions: matches.length });
    }
  }

  // Check for explicit risk sections
  const hasRiskSection = /#{1,4}\s+.*risk/i.test(content);
  const hasMitigations = /mitigation|mitigate|contingency|fallback/i.test(content);

  // Score: more risk identification + mitigations = higher score (better managed)
  const riskIdentified = risks.length > 0;
  const score = riskIdentified
    ? (hasMitigations ? 85 : 55)
    : (hasRiskSection ? 70 : 40);

  return {
    score,
    risk_factors: risks,
    has_risk_section: hasRiskSection,
    has_mitigations: hasMitigations
  };
}

/**
 * Analyze ambiguity in content.
 * @param {string} content
 * @returns {object}
 */
function analyzeAmbiguity(content) {
  const ambiguousTerms = [
    'should', 'might', 'could', 'may', 'possibly', 'potentially',
    'approximately', 'roughly', 'maybe', 'etc', 'and so on',
    'as needed', 'as appropriate', 'if necessary', 'TBD', 'TBA'
  ];

  const findings = [];
  for (const term of ambiguousTerms) {
    const pattern = new RegExp(`\\b${term}\\b`, 'gi');
    const matches = content.match(pattern) || [];
    if (matches.length > 0) {
      findings.push({ term, count: matches.length });
    }
  }

  const totalAmbiguous = findings.reduce((sum, f) => sum + f.count, 0);
  const wordCount = content.split(/\s+/).length;
  const ambiguityRate = wordCount > 0 ? totalAmbiguous / wordCount : 0;

  // Lower ambiguity rate = higher score
  const score = Math.max(0, Math.round(100 - (ambiguityRate * 2000)));

  return {
    score,
    ambiguous_terms: findings,
    total_ambiguous: totalAmbiguous,
    word_count: wordCount,
    ambiguity_rate: Math.round(ambiguityRate * 10000) / 100
  };
}

/**
 * Analyze quality indicators.
 * @param {string} content
 * @param {string} root
 * @returns {object}
 */
function analyzeQuality(content, root) {
  const checks = [];

  // Check for acceptance criteria
  const hasAC = /acceptance\s+criteria/i.test(content);
  checks.push({ check: 'acceptance_criteria', passed: hasAC });

  // Check for test references
  const hasTests = /test|spec|verify|validate/i.test(content);
  checks.push({ check: 'test_references', passed: hasTests });

  // Check for diagrams
  const hasDiagrams = /```mermaid|flowchart|sequenceDiagram|classDiagram/i.test(content);
  checks.push({ check: 'has_diagrams', passed: hasDiagrams });

  // Check for traceability IDs
  const hasTracing = /\b(REQ-\d+|E\d+-S\d+|NFR-\d+|M\d+-T\d+)\b/.test(content);
  checks.push({ check: 'traceability_ids', passed: hasTracing });

  // Check for code examples
  const hasCodeExamples = /```\w+/.test(content);
  checks.push({ check: 'code_examples', passed: hasCodeExamples });

  // Check for cross-references
  const hasCrossRefs = /\[.*\]\(.*\.md\)/.test(content);
  checks.push({ check: 'cross_references', passed: hasCrossRefs });

  const passed = checks.filter(c => c.passed).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    checks,
    gaps: checks.filter(c => !c.passed).map(c => c.check)
  };
}

/**
 * Analyze enterprise readiness.
 * @param {string} content
 * @returns {object}
 */
function analyzeEnterpriseReadiness(content) {
  const checks = [];

  // Security considerations
  const hasSecurity = /security|auth|encryption|RBAC|access control|OWASP/i.test(content);
  checks.push({ check: 'security_considerations', passed: hasSecurity });

  // Scalability
  const hasScalability = /scalab|performance|latency|throughput|load/i.test(content);
  checks.push({ check: 'scalability', passed: hasScalability });

  // Compliance
  const hasCompliance = /compliance|regulatory|GDPR|HIPAA|SOC|PCI|audit/i.test(content);
  checks.push({ check: 'compliance', passed: hasCompliance });

  // Monitoring / Observability
  const hasMonitoring = /monitor|observab|logging|tracing|alert|metric/i.test(content);
  checks.push({ check: 'monitoring', passed: hasMonitoring });

  // Deployment
  const hasDeployment = /deploy|CI\/CD|pipeline|container|kubernetes|docker/i.test(content);
  checks.push({ check: 'deployment', passed: hasDeployment });

  // Documentation
  const hasDocumentation = /document|README|runbook|wiki|onboard/i.test(content);
  checks.push({ check: 'documentation', passed: hasDocumentation });

  const passed = checks.filter(c => c.passed).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    checks,
    gaps: checks.filter(c => !c.passed).map(c => c.check)
  };
}

/**
 * Compute overall delivery confidence score.
 *
 * @param {string} content - Artifact content.
 * @param {object} [options]
 * @returns {object}
 */
function scoreConfidence(content, options = {}) {
  const weights = { ...WEIGHT_DEFAULTS, ...options.weights };
  const root = options.root || '.';
  const artifactType = options.artifactType || 'generic';

  const dimensions = {
    completeness: analyzeCompleteness(content, artifactType),
    risk: analyzeRisk(content),
    ambiguity: analyzeAmbiguity(content),
    quality: analyzeQuality(content, root),
    enterprise_readiness: analyzeEnterpriseReadiness(content)
  };

  const weightedScore = Math.round(
    dimensions.completeness.score * weights.completeness +
    dimensions.risk.score * weights.risk +
    dimensions.ambiguity.score * weights.ambiguity +
    dimensions.quality.score * weights.quality +
    dimensions.enterprise_readiness.score * weights.enterprise_readiness
  );

  const level = CONFIDENCE_LEVELS.find(l => weightedScore >= l.min) || CONFIDENCE_LEVELS[CONFIDENCE_LEVELS.length - 1];

  const allGaps = [
    ...(dimensions.completeness.gaps || []),
    ...(dimensions.quality.gaps || []),
    ...(dimensions.enterprise_readiness.gaps || [])
  ];

  return {
    success: true,
    overall_score: weightedScore,
    confidence_level: level.label,
    confidence_emoji: level.emoji,
    dimensions,
    top_gaps: allGaps.slice(0, 5),
    weights_used: weights
  };
}

/**
 * Score a file on disk.
 *
 * @param {string} filePath - Path to artifact.
 * @param {object} [options]
 * @returns {object}
 */
function scoreFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const result = scoreConfidence(content, options);
  result.file = filePath;
  return result;
}

/**
 * Score all spec artifacts in a project.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function scoreProject(root, options = {}) {
  const specsDir = path.join(root, 'specs');
  if (!fs.existsSync(specsDir)) {
    return { success: false, error: 'specs/ directory not found' };
  }

  const results = [];
  const artifacts = ['challenger-brief.md', 'product-brief.md', 'prd.md', 'architecture.md', 'implementation-plan.md'];

  for (const artifact of artifacts) {
    const fullPath = path.join(specsDir, artifact);
    if (fs.existsSync(fullPath)) {
      const result = scoreFile(fullPath, { ...options, root });
      results.push({ artifact, ...result });
    }
  }

  const avgScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + (r.overall_score || 0), 0) / results.length)
    : 0;

  const level = CONFIDENCE_LEVELS.find(l => avgScore >= l.min) || CONFIDENCE_LEVELS[CONFIDENCE_LEVELS.length - 1];

  return {
    success: true,
    project_score: avgScore,
    project_confidence: level.label,
    project_emoji: level.emoji,
    artifacts: results,
    summary: {
      artifacts_scored: results.length,
      average_score: avgScore,
      highest: results.length > 0 ? results.reduce((a, b) => (a.overall_score || 0) > (b.overall_score || 0) ? a : b).artifact : null,
      lowest: results.length > 0 ? results.reduce((a, b) => (a.overall_score || 0) < (b.overall_score || 0) ? a : b).artifact : null
    }
  };
}

module.exports = {
  analyzeCompleteness,
  analyzeRisk,
  analyzeAmbiguity,
  analyzeQuality,
  analyzeEnterpriseReadiness,
  scoreConfidence,
  scoreFile,
  scoreProject,
  DIMENSIONS,
  WEIGHT_DEFAULTS,
  CONFIDENCE_LEVELS
};
