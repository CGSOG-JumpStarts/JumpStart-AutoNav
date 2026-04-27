/**
 * test-complexity.test.ts — T4.1.7 batch (2/4).
 *
 * @see bin/lib-ts/complexity.ts
 */

import { describe, expect, it } from 'vitest';
import {
  calculateComplexity,
  HIGH_COMPLEXITY_DOMAINS,
  MEDIUM_COMPLEXITY_DOMAINS,
  RISK_KEYWORDS,
} from '../bin/lib-ts/complexity.js';

describe('vocabulary constants', () => {
  it('lists healthcare + fintech as high-complexity domains', () => {
    expect(HIGH_COMPLEXITY_DOMAINS).toContain('healthcare');
    expect(HIGH_COMPLEXITY_DOMAINS).toContain('fintech');
  });
  it('lists insuretech as medium-complexity', () => {
    expect(MEDIUM_COMPLEXITY_DOMAINS).toContain('insuretech');
  });
  it('lists hipaa + pci as risk keywords', () => {
    expect(RISK_KEYWORDS).toContain('hipaa');
    expect(RISK_KEYWORDS).toContain('pci');
  });
});

describe('calculateComplexity', () => {
  it('returns quick + score 0 for empty input', () => {
    const r = calculateComplexity({});
    expect(r.recommended_depth).toBe('quick');
    expect(r.score).toBe(0);
  });

  it('caps risk-keyword score at 25 (5+ keywords)', () => {
    const r = calculateComplexity({
      description: 'security compliance regulation gdpr hipaa pci audit',
    });
    expect(r.breakdown.risk_keywords.score).toBe(25);
  });

  it('scores codebase size with the 200/50/10 buckets', () => {
    expect(calculateComplexity({ file_count: 250 }).breakdown.codebase_size.score).toBe(20);
    expect(calculateComplexity({ file_count: 100 }).breakdown.codebase_size.score).toBe(10);
    expect(calculateComplexity({ file_count: 25 }).breakdown.codebase_size.score).toBe(5);
    expect(calculateComplexity({ file_count: 5 }).breakdown.codebase_size.score).toBe(0);
  });

  it('scores high-complexity domains at 20', () => {
    expect(calculateComplexity({ domain: 'healthcare' }).breakdown.domain.score).toBe(20);
    expect(calculateComplexity({ domain: 'edtech' }).breakdown.domain.score).toBe(10);
    expect(calculateComplexity({ domain: 'general' }).breakdown.domain.score).toBe(0);
  });

  it('promotes to standard at score >= 20', () => {
    const r = calculateComplexity({ domain: 'healthcare' }); // 20 alone
    expect(r.recommended_depth).toBe('standard');
  });

  it('promotes to deep at score >= 50', () => {
    const r = calculateComplexity({
      description: 'security compliance gdpr hipaa pci',
      file_count: 250,
      domain: 'healthcare',
    });
    expect(r.recommended_depth).toBe('deep');
    expect(r.score).toBeGreaterThanOrEqual(50);
  });

  it('reasoning string mentions matched keywords on deep recommendations', () => {
    const r = calculateComplexity({
      description: 'security compliance gdpr',
      file_count: 250,
      domain: 'healthcare',
      integrations: 6,
    });
    expect(r.reasoning).toContain('risk-sensitive areas');
  });

  it('reasoning string for low score does not mention keywords', () => {
    const r = calculateComplexity({});
    expect(r.reasoning).toContain('Quick elicitation');
  });
});
