/**
 * complexity.ts — adaptive planning depth calculator (T4.1.7 batch).
 *
 * Pure-library port of `bin/lib/complexity.js`. Single export:
 * `calculateComplexity(input)`. Vocabulary lists
 * (`HIGH_COMPLEXITY_DOMAINS`, `MEDIUM_COMPLEXITY_DOMAINS`,
 * `RISK_KEYWORDS`) preserved verbatim and re-exported for downstream
 * tools that want to mirror the scoring rules.
 *
 * Score weighting and depth thresholds preserved verbatim:
 *   ≥50 → deep, ≥20 → standard, else quick.
 *
 * The legacy CLI driver block is intentionally NOT ported.
 *
 * @see bin/lib/complexity.js (legacy reference)
 * @see specs/implementation-plan.md T4.1.7
 */

export const HIGH_COMPLEXITY_DOMAINS: readonly string[] = [
  'healthcare',
  'fintech',
  'govtech',
  'aerospace',
  'automotive',
  'scientific',
  'legaltech',
  'energy',
  'process_control',
];

export const MEDIUM_COMPLEXITY_DOMAINS: readonly string[] = [
  'insuretech',
  'edtech',
  'building_automation',
];

export const RISK_KEYWORDS: readonly string[] = [
  'security',
  'compliance',
  'regulation',
  'gdpr',
  'hipaa',
  'pci',
  'real-time',
  'realtime',
  'distributed',
  'migration',
  'legacy',
  'multi-tenant',
  'concurrent',
  'encryption',
  'audit',
  'financial',
];

export interface ComplexityInput {
  description?: string;
  file_count?: number;
  dependency_count?: number;
  domain?: string;
  integrations?: number;
  stakeholder_count?: number;
  risk_signals?: string[];
}

export interface ComplexityBreakdown {
  risk_keywords: { score: number; matched: string[] };
  codebase_size: { score: number; file_count: number };
  dependencies: { score: number; count: number };
  domain: { score: number; domain: string };
  integrations: { score: number; count: number };
  stakeholders: { score: number; count: number };
}

export type RecommendedDepth = 'quick' | 'standard' | 'deep';

export interface ComplexityResult {
  recommended_depth: RecommendedDepth;
  score: number;
  breakdown: ComplexityBreakdown;
  reasoning: string;
}

/**
 * Score a project's complexity from supplied signals. Each axis
 * contributes a capped score; the depth recommendation falls out of
 * the total. All signal fields are optional — missing signals score 0.
 */
export function calculateComplexity(input: ComplexityInput): ComplexityResult {
  let score = 0;

  const desc = (input.description || '').toLowerCase();
  const matchedKeywords = RISK_KEYWORDS.filter((k) => desc.includes(k));
  const keywordScore = Math.min(matchedKeywords.length * 5, 25);
  score += keywordScore;

  const fileCount = input.file_count || 0;
  const sizeScore = fileCount > 200 ? 20 : fileCount > 50 ? 10 : fileCount > 10 ? 5 : 0;
  score += sizeScore;

  const depCount = input.dependency_count || 0;
  const depScore = depCount > 30 ? 15 : depCount > 15 ? 10 : depCount > 5 ? 5 : 0;
  score += depScore;

  const domain = (input.domain || '').toLowerCase();
  const domainScore = HIGH_COMPLEXITY_DOMAINS.includes(domain)
    ? 20
    : MEDIUM_COMPLEXITY_DOMAINS.includes(domain)
      ? 10
      : 0;
  score += domainScore;

  const integrations = input.integrations || 0;
  const intScore = integrations > 5 ? 15 : integrations > 2 ? 10 : integrations > 0 ? 5 : 0;
  score += intScore;

  const stakeholders = input.stakeholder_count || 0;
  const stakeScore = stakeholders > 5 ? 10 : stakeholders > 2 ? 5 : 0;
  score += stakeScore;

  const breakdown: ComplexityBreakdown = {
    risk_keywords: { score: keywordScore, matched: matchedKeywords },
    codebase_size: { score: sizeScore, file_count: fileCount },
    dependencies: { score: depScore, count: depCount },
    domain: { score: domainScore, domain: domain || 'general' },
    integrations: { score: intScore, count: integrations },
    stakeholders: { score: stakeScore, count: stakeholders },
  };

  let recommended_depth: RecommendedDepth;
  let reasoning: string;
  if (score >= 50) {
    recommended_depth = 'deep';
    reasoning = `High complexity score (${score}/100). Project involves ${
      matchedKeywords.length > 0
        ? `risk-sensitive areas (${matchedKeywords.join(', ')})`
        : 'significant complexity'
    }. Deep elicitation recommended to uncover non-obvious root causes and stakeholder concerns.`;
  } else if (score >= 20) {
    recommended_depth = 'standard';
    reasoning = `Moderate complexity score (${score}/100). Standard elicitation depth should provide adequate problem discovery while maintaining reasonable time investment.`;
  } else {
    recommended_depth = 'quick';
    reasoning = `Low complexity score (${score}/100). Quick elicitation is sufficient for this project's scope and risk profile.`;
  }

  return { recommended_depth, score, breakdown, reasoning };
}
