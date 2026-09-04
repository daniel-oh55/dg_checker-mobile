import { describe, expect, it } from 'vitest';
import { aggregatePairEvaluations } from '../../src/domain/aggregate-decision';
import type { PairEvaluation } from '../../src/domain/segregation';
import type { AdditionalRequirement } from '../../src/domain/sg-rules';

function requirement(code: string): AdditionalRequirement {
  return { code, source: 'SG', requiresConfirmation: true };
}

function clear(additionalRequirements: AdditionalRequirement[] = []): PairEvaluation {
  return {
    decision: { status: 'CLEAR', level: 0, reason: 'synthetic clear' },
    additionalRequirements,
    reviewBlockers: [],
  };
}

function segregation(level: 1 | 2 | 3 | 4, additionalRequirements: AdditionalRequirement[] = []): PairEvaluation {
  return {
    decision: { status: 'SEGREGATION_REQUIRED', level, reason: `synthetic level ${level}` },
    additionalRequirements,
    reviewBlockers: [],
  };
}

function review(blockers: string[], additionalRequirements: AdditionalRequirement[] = []): PairEvaluation {
  return {
    decision: { status: 'REVIEW_REQUIRED', level: null, reason: 'synthetic review' },
    additionalRequirements,
    reviewBlockers: blockers,
  };
}

describe('aggregatePairEvaluations', () => {
  it('passes a single CLEAR pair through as uniform', () => {
    const result = aggregatePairEvaluations([clear()]);

    expect(result.decision.status).toBe('CLEAR');
    expect(result.decision.level).toBe(0);
    expect(result.variantResolution).toBe('UNIFORM');
  });

  it('reports uniform CLEAR when every variant pair is CLEAR', () => {
    const result = aggregatePairEvaluations([clear(), clear(), clear()]);

    expect(result.decision).toEqual({
      status: 'CLEAR',
      level: 0,
      reason: 'All DG variant combinations produce the same clear segregation outcome.',
    });
    expect(result.variantResolution).toBe('UNIFORM');
  });

  it('reports uniform segregation when every variant pair agrees on the same level', () => {
    const result = aggregatePairEvaluations([segregation(2), segregation(2)]);

    expect(result.decision).toEqual({
      status: 'SEGREGATION_REQUIRED',
      level: 2,
      reason: 'All DG variant combinations require segregation level 2.',
    });
    expect(result.variantResolution).toBe('UNIFORM');
  });

  it('keeps the strictest result when a level-0 and a level-2 variant disagree', () => {
    const result = aggregatePairEvaluations([clear(), segregation(2)]);

    expect(result.decision.status).toBe('SEGREGATION_REQUIRED');
    expect(result.decision.level).toBe(2);
    expect(result.variantResolution).toBe('STRICTEST_OF_MULTIPLE_VARIANTS');
  });

  it('keeps the strictest result when a level-1 and a level-3 variant disagree', () => {
    const result = aggregatePairEvaluations([segregation(1), segregation(3)]);

    expect(result.decision.status).toBe('SEGREGATION_REQUIRED');
    expect(result.decision.level).toBe(3);
    expect(result.variantResolution).toBe('STRICTEST_OF_MULTIPLE_VARIANTS');
  });

  it('does not claim every variant requires the level when variants disagree', () => {
    const result = aggregatePairEvaluations([clear(), segregation(2)]);

    expect(result.decision.reason).not.toContain('All DG variant combinations');
    expect(result.decision.reason).toContain('strictest');
  });

  it('states that the specific variant is unresolved when reporting the strictest result', () => {
    const result = aggregatePairEvaluations([segregation(1), segregation(4)]);

    expect(result.decision.reason).toContain('unresolved');
  });

  it('fails closed to REVIEW_REQUIRED when any variant pair requires review', () => {
    const result = aggregatePairEvaluations([segregation(2), review(['MULTIPLE_SUBSIDIARY_RISKS'])]);

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.decision.level).toBeNull();
  });

  it('reports the union of blockers across every reviewing variant pair', () => {
    const result = aggregatePairEvaluations([
      review(['MULTIPLE_SUBSIDIARY_RISKS']),
      review(['CLASS1_TO_CLASS1_UNRESOLVED', 'MULTIPLE_SUBSIDIARY_RISKS']),
    ]);

    expect(result.decision.reason).toBe(
      'Manual review required: CLASS1_TO_CLASS1_UNRESOLVED, MULTIPLE_SUBSIDIARY_RISKS.',
    );
  });

  it('marks review as uniform when every variant pair reviews for the same reason', () => {
    const result = aggregatePairEvaluations([review(['CLASS1_TO_CLASS1_UNRESOLVED']), review(['CLASS1_TO_CLASS1_UNRESOLVED'])]);

    expect(result.variantResolution).toBe('UNIFORM');
  });

  it('unions and deduplicates additional requirements across variant pairs', () => {
    const result = aggregatePairEvaluations([
      segregation(2, [requirement('SG26'), requirement('SG50')]),
      segregation(2, [requirement('SG26'), requirement('SG29')]),
    ]);

    expect(result.additionalRequirements.map((entry) => entry.code)).toEqual(['SG26', 'SG29', 'SG50']);
  });

  it('keeps additional requirements from a variant pair that individually required review', () => {
    const result = aggregatePairEvaluations([
      segregation(2),
      review(['MULTIPLE_SUBSIDIARY_RISKS'], [requirement('SG53')]),
    ]);

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.additionalRequirements.map((entry) => entry.code)).toEqual(['SG53']);
  });

  it('reports an empty requirement list when no variant pair carries one', () => {
    const result = aggregatePairEvaluations([clear(), segregation(1)]);

    expect(result.additionalRequirements).toEqual([]);
  });
});
