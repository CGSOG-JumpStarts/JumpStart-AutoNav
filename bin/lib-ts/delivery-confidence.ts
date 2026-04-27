/**
 * delivery-confidence.ts — Delivery Confidence Scoring port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/delivery-confidence.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `DIMENSIONS` (constant array)
 *   - `WEIGHT_DEFAULTS` (constant map)
 *   - `CONFIDENCE_LEVELS` (constant array)
 *   - `analyzeCompleteness(content, artifactType)` => CompletenessResult
 *   - `analyzeRisk(content)` => RiskResult
 *   - `analyzeAmbiguity(content)` => AmbiguityResult
 *   - `analyzeQuality(content, root)` => QualityResult
 *   - `analyzeEnterpriseReadiness(content)` => EnterpriseReadinessResult
 *   - `scoreConfidence(content, options?)` => ScoreResult
 *   - `scoreFile(filePath, options?)` => ScoreResult
 *   - `scoreProject(root, options?)` => ProjectScoreResult
 *
 * Behavior parity:
 *   - Default weights: completeness 0.25, risk 0.20, ambiguity 0.20,
 *     quality 0.20, enterprise_readiness 0.15.
 *   - Confidence levels: Very High (90+), High (75+), Medium (50+),
 *     Low (25+), Very Low (0+).
 *   - Project artifacts scanned: challenger-brief / product-brief / prd /
 *     architecture / implementation-plan markdown files.
 *   - CLI entry-point intentionally omitted.
 *
 * @see bin/lib/delivery-confidence.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Dimension = 'completeness' | 'risk' | 'ambiguity' | 'quality' | 'enterprise_readiness';

export interface CheckEntry {
  check: string;
  passed: boolean;
}

export interface CompletenessResult {
  score: number;
  checks: CheckEntry[];
  gaps: string[];
  placeholders_found: number;
}

export interface RiskFactor {
  factor: string;
  mentions: number;
}

export interface RiskResult {
  score: number;
  risk_factors: RiskFactor[];
  has_risk_section: boolean;
  has_mitigations: boolean;
}

export interface AmbiguityFinding {
  term: string;
  count: number;
}

export interface AmbiguityResult {
  score: number;
  ambiguous_terms: AmbiguityFinding[];
  total_ambiguous: number;
  word_count: number;
  ambiguity_rate: number;
}

export interface QualityResult {
  score: number;
  checks: CheckEntry[];
  gaps: string[];
}

export interface EnterpriseReadinessResult {
  score: number;
  checks: CheckEntry[];
  gaps: string[];
}

export interface ConfidenceLevel {
  min: number;
  label: string;
  emoji: string;
}

export interface ScoreOptions {
  weights?: Partial<Record<Dimension, number>>;
  root?: string;
  artifactType?: string;
  [key: string]: unknown;
}

export interface ScoreResult {
  success: boolean;
  overall_score?: number;
  confidence_level?: string;
  confidence_emoji?: string;
  dimensions?: {
    completeness: CompletenessResult;
    risk: RiskResult;
    ambiguity: AmbiguityResult;
    quality: QualityResult;
    enterprise_readiness: EnterpriseReadinessResult;
  };
  top_gaps?: string[];
  weights_used?: Record<Dimension, number>;
  file?: string;
  error?: string;
}

export interface ProjectArtifactResult extends ScoreResult {
  artifact: string;
}

export interface ProjectScoreResult {
  success: boolean;
  project_score?: number;
  project_confidence?: string;
  project_emoji?: string;
  artifacts?: ProjectArtifactResult[];
  summary?: {
    artifacts_scored: number;
    average_score: number;
    highest: string | null;
    lowest: string | null;
  };
  error?: string;
}

export const DIMENSIONS: Dimension[] = [
  'completeness',
  'risk',
  'ambiguity',
  'quality',
  'enterprise_readiness',
];

export const WEIGHT_DEFAULTS: Record<Dimension, number> = {
  completeness: 0.25,
  risk: 0.2,
  ambiguity: 0.2,
  quality: 0.2,
  enterprise_readiness: 0.15,
};

export const CONFIDENCE_LEVELS: ConfidenceLevel[] = [
  { min: 90, label: 'Very High', emoji: '🟢' },
  { min: 75, label: 'High', emoji: '🟡' },
  { min: 50, label: 'Medium', emoji: '🟠' },
  { min: 25, label: 'Low', emoji: '🔴' },
  { min: 0, label: 'Very Low', emoji: '⛔' },
];

/**
 * Analyze completeness of an artifact.
 */
export function analyzeCompleteness(content: string, _artifactType: string): CompletenessResult {
  const checks: CheckEntry[] = [];
  const lines = content.split('\n');

  const hasFrontmatter = content.startsWith('---');
  checks.push({ check: 'has_frontmatter', passed: hasFrontmatter });

  const hasApproval = content.includes('Phase Gate Approval');
  checks.push({ check: 'has_approval_section', passed: hasApproval });

  const headingCount = (content.match(/^#{1,4}\s+/gm) || []).length;
  checks.push({ check: 'has_sections', passed: headingCount >= 3 });

  const placeholders = (
    content.match(/\[TODO\]|\[TBD\]|\[PLACEHOLDER\]|\[NEEDS CLARIFICATION\]/gi) || []
  ).length;
  checks.push({ check: 'no_placeholders', passed: placeholders === 0 });

  const emptySections: string[] = [];
  let currentHeading: string | null = null;
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

  checks.push({ check: 'sufficient_content', passed: content.length > 500 });

  const passed = checks.filter((c) => c.passed).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    checks,
    gaps: checks.filter((c) => !c.passed).map((c) => c.check),
    placeholders_found: placeholders,
  };
}

/**
 * Analyze risk factors.
 */
export function analyzeRisk(content: string): RiskResult {
  const risks: RiskFactor[] = [];
  const riskKeywords = [
    'risk',
    'concern',
    'unknown',
    'assumption',
    'constraint',
    'blocker',
    'dependency',
  ];
  for (const keyword of riskKeywords) {
    const pattern = new RegExp(`\\b${keyword}s?\\b`, 'gi');
    const matches = content.match(pattern) || [];
    if (matches.length > 0) {
      risks.push({ factor: keyword, mentions: matches.length });
    }
  }

  const hasRiskSection = /#{1,4}\s+.*risk/i.test(content);
  const hasMitigations = /mitigation|mitigate|contingency|fallback/i.test(content);

  const riskIdentified = risks.length > 0;
  const score = riskIdentified ? (hasMitigations ? 85 : 55) : hasRiskSection ? 70 : 40;

  return {
    score,
    risk_factors: risks,
    has_risk_section: hasRiskSection,
    has_mitigations: hasMitigations,
  };
}

/**
 * Analyze ambiguity in content.
 */
export function analyzeAmbiguity(content: string): AmbiguityResult {
  const ambiguousTerms = [
    'should',
    'might',
    'could',
    'may',
    'possibly',
    'potentially',
    'approximately',
    'roughly',
    'maybe',
    'etc',
    'and so on',
    'as needed',
    'as appropriate',
    'if necessary',
    'TBD',
    'TBA',
  ];

  const findings: AmbiguityFinding[] = [];
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

  const score = Math.max(0, Math.round(100 - ambiguityRate * 2000));

  return {
    score,
    ambiguous_terms: findings,
    total_ambiguous: totalAmbiguous,
    word_count: wordCount,
    ambiguity_rate: Math.round(ambiguityRate * 10000) / 100,
  };
}

/**
 * Analyze quality indicators.
 */
export function analyzeQuality(content: string, _root: string): QualityResult {
  const checks: CheckEntry[] = [];

  const hasAC = /acceptance\s+criteria/i.test(content);
  checks.push({ check: 'acceptance_criteria', passed: hasAC });

  const hasTests = /test|spec|verify|validate/i.test(content);
  checks.push({ check: 'test_references', passed: hasTests });

  const hasDiagrams = /```mermaid|flowchart|sequenceDiagram|classDiagram/i.test(content);
  checks.push({ check: 'has_diagrams', passed: hasDiagrams });

  const hasTracing = /\b(REQ-\d+|E\d+-S\d+|NFR-\d+|M\d+-T\d+)\b/.test(content);
  checks.push({ check: 'traceability_ids', passed: hasTracing });

  const hasCodeExamples = /```\w+/.test(content);
  checks.push({ check: 'code_examples', passed: hasCodeExamples });

  const hasCrossRefs = /\[.*\]\(.*\.md\)/.test(content);
  checks.push({ check: 'cross_references', passed: hasCrossRefs });

  const passed = checks.filter((c) => c.passed).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    checks,
    gaps: checks.filter((c) => !c.passed).map((c) => c.check),
  };
}

/**
 * Analyze enterprise readiness.
 */
export function analyzeEnterpriseReadiness(content: string): EnterpriseReadinessResult {
  const checks: CheckEntry[] = [];

  const hasSecurity = /security|auth|encryption|RBAC|access control|OWASP/i.test(content);
  checks.push({ check: 'security_considerations', passed: hasSecurity });

  const hasScalability = /scalab|performance|latency|throughput|load/i.test(content);
  checks.push({ check: 'scalability', passed: hasScalability });

  const hasCompliance = /compliance|regulatory|GDPR|HIPAA|SOC|PCI|audit/i.test(content);
  checks.push({ check: 'compliance', passed: hasCompliance });

  const hasMonitoring = /monitor|observab|logging|tracing|alert|metric/i.test(content);
  checks.push({ check: 'monitoring', passed: hasMonitoring });

  const hasDeployment = /deploy|CI\/CD|pipeline|container|kubernetes|docker/i.test(content);
  checks.push({ check: 'deployment', passed: hasDeployment });

  const hasDocumentation = /document|README|runbook|wiki|onboard/i.test(content);
  checks.push({ check: 'documentation', passed: hasDocumentation });

  const passed = checks.filter((c) => c.passed).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    checks,
    gaps: checks.filter((c) => !c.passed).map((c) => c.check),
  };
}

/**
 * Compute overall delivery confidence score.
 */
export function scoreConfidence(content: string, options: ScoreOptions = {}): ScoreResult {
  const weights: Record<Dimension, number> = { ...WEIGHT_DEFAULTS, ...(options.weights || {}) };
  const root = options.root || '.';
  const artifactType = options.artifactType || 'generic';

  const dimensions = {
    completeness: analyzeCompleteness(content, artifactType),
    risk: analyzeRisk(content),
    ambiguity: analyzeAmbiguity(content),
    quality: analyzeQuality(content, root),
    enterprise_readiness: analyzeEnterpriseReadiness(content),
  };

  const weightedScore = Math.round(
    dimensions.completeness.score * weights.completeness +
      dimensions.risk.score * weights.risk +
      dimensions.ambiguity.score * weights.ambiguity +
      dimensions.quality.score * weights.quality +
      dimensions.enterprise_readiness.score * weights.enterprise_readiness
  );

  const level =
    CONFIDENCE_LEVELS.find((l) => weightedScore >= l.min) ||
    CONFIDENCE_LEVELS[CONFIDENCE_LEVELS.length - 1];

  const allGaps = [
    ...(dimensions.completeness.gaps || []),
    ...(dimensions.quality.gaps || []),
    ...(dimensions.enterprise_readiness.gaps || []),
  ];

  return {
    success: true,
    overall_score: weightedScore,
    confidence_level: level.label,
    confidence_emoji: level.emoji,
    dimensions,
    top_gaps: allGaps.slice(0, 5),
    weights_used: weights,
  };
}

/**
 * Score a file on disk.
 */
export function scoreFile(filePath: string, options: ScoreOptions = {}): ScoreResult {
  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const content = readFileSync(filePath, 'utf8');
  const result = scoreConfidence(content, options);
  result.file = filePath;
  return result;
}

/**
 * Score all spec artifacts in a project.
 */
export function scoreProject(root: string, options: ScoreOptions = {}): ProjectScoreResult {
  const specsDir = join(root, 'specs');
  if (!existsSync(specsDir)) {
    return { success: false, error: 'specs/ directory not found' };
  }

  const results: ProjectArtifactResult[] = [];
  const artifacts = [
    'challenger-brief.md',
    'product-brief.md',
    'prd.md',
    'architecture.md',
    'implementation-plan.md',
  ];

  for (const artifact of artifacts) {
    const fullPath = join(specsDir, artifact);
    if (existsSync(fullPath)) {
      const result = scoreFile(fullPath, { ...options, root });
      results.push({ artifact, ...result });
    }
  }

  const avgScore =
    results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + (r.overall_score || 0), 0) / results.length)
      : 0;

  const level =
    CONFIDENCE_LEVELS.find((l) => avgScore >= l.min) ||
    CONFIDENCE_LEVELS[CONFIDENCE_LEVELS.length - 1];

  return {
    success: true,
    project_score: avgScore,
    project_confidence: level.label,
    project_emoji: level.emoji,
    artifacts: results,
    summary: {
      artifacts_scored: results.length,
      average_score: avgScore,
      highest:
        results.length > 0
          ? results.reduce((a, b) => ((a.overall_score || 0) > (b.overall_score || 0) ? a : b))
              .artifact
          : null,
      lowest:
        results.length > 0
          ? results.reduce((a, b) => ((a.overall_score || 0) < (b.overall_score || 0) ? a : b))
              .artifact
          : null,
    },
  };
}
