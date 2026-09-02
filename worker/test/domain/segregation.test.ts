import { describe, expect, it } from 'vitest';
import { createSegregationRuleSet, evaluateSegregation } from '../../src/domain/segregation';
import type { DgEntry } from '../../src/domain/types';

// Synthetic classes and rules for testing only. These have no regulatory
// meaning and must never be seeded into a production migration.
const TEST_RULES = createSegregationRuleSet([
  ['TEST_A', 'TEST_A', 0],
  ['TEST_A', 'TEST_C', 0],
  ['TEST_A', 'TEST_B', 2],
  ['TEST_B', 'TEST_C', 4],
]);

function makeEntry(overrides: Partial<DgEntry> = {}): DgEntry {
  return {
    unNumber: '0000',
    variantKey: 'default',
    primaryClass: 'TEST_A',
    subsidiaryRisks: [],
    segregationGroups: [],
    segregationCodes: [],
    compatibilityGroup: null,
    ...overrides,
  };
}

describe('evaluateSegregation', () => {
  it('returns CLEAR for a level-0 rule', () => {
    const a = makeEntry({ unNumber: '1111', primaryClass: 'TEST_A' });
    const c = makeEntry({ unNumber: '2222', primaryClass: 'TEST_C' });

    expect(evaluateSegregation(a, c, TEST_RULES)).toEqual({
      status: 'CLEAR',
      level: 0,
      reason: expect.any(String),
    });
  });

  it.each([
    ['TEST_A', 'TEST_B', 2],
    ['TEST_B', 'TEST_C', 4],
  ])('returns SEGREGATION_REQUIRED for %s + %s -> level %d', (classA, classB, level) => {
    const a = makeEntry({ unNumber: '1111', primaryClass: classA });
    const b = makeEntry({ unNumber: '2222', primaryClass: classB });

    expect(evaluateSegregation(a, b, TEST_RULES)).toEqual({
      status: 'SEGREGATION_REQUIRED',
      level,
      reason: expect.any(String),
    });
  });

  it('is symmetric: evaluate(A, B) equals evaluate(B, A)', () => {
    const a = makeEntry({ unNumber: '1111', primaryClass: 'TEST_B' });
    const b = makeEntry({ unNumber: '2222', primaryClass: 'TEST_C' });

    expect(evaluateSegregation(a, b, TEST_RULES)).toEqual(evaluateSegregation(b, a, TEST_RULES));
  });

  it('is symmetric for unsupported cases regardless of argument order', () => {
    const a = makeEntry({ unNumber: '1111', primaryClass: 'TEST_A', subsidiaryRisks: ['TEST_SUB'] });
    const b = makeEntry({ unNumber: '2222', primaryClass: 'TEST_B' });

    expect(evaluateSegregation(a, b, TEST_RULES)).toEqual(evaluateSegregation(b, a, TEST_RULES));
  });

  it('returns REVIEW_REQUIRED when no rule exists for the pair', () => {
    const a = makeEntry({ primaryClass: 'TEST_A' });
    const unknown = makeEntry({ primaryClass: 'TEST_UNKNOWN' });

    const decision = evaluateSegregation(a, unknown, TEST_RULES);

    expect(decision).toEqual({
      status: 'REVIEW_REQUIRED',
      level: null,
      reason: expect.any(String),
    });
  });

  it('returns REVIEW_REQUIRED when either entry has a subsidiary risk', () => {
    const a = makeEntry({ primaryClass: 'TEST_A', subsidiaryRisks: ['TEST_SUB'] });
    const b = makeEntry({ primaryClass: 'TEST_B' });

    const decision = evaluateSegregation(a, b, TEST_RULES);

    expect(decision.status).toBe('REVIEW_REQUIRED');
    expect(decision.level).toBeNull();
  });

  it('returns REVIEW_REQUIRED when either entry has a specific segregation code', () => {
    const a = makeEntry({ primaryClass: 'TEST_A' });
    const b = makeEntry({ primaryClass: 'TEST_B', segregationCodes: ['SGxx'] });

    const decision = evaluateSegregation(a, b, TEST_RULES);

    expect(decision.status).toBe('REVIEW_REQUIRED');
    expect(decision.level).toBeNull();
  });

  it('returns REVIEW_REQUIRED when either entry has an unsupported compatibility group', () => {
    const a = makeEntry({ primaryClass: 'TEST_A', compatibilityGroup: 'C' });
    const b = makeEntry({ primaryClass: 'TEST_B' });

    const decision = evaluateSegregation(a, b, TEST_RULES);

    expect(decision.status).toBe('REVIEW_REQUIRED');
    expect(decision.level).toBeNull();
  });

  it('does not treat mere segregation-group membership as proof of incompatibility', () => {
    const a = makeEntry({ primaryClass: 'TEST_A', segregationGroups: ['SGG1'] });
    const c = makeEntry({ primaryClass: 'TEST_C', segregationGroups: ['SGG1'] });

    expect(evaluateSegregation(a, c, TEST_RULES)).toEqual({
      status: 'CLEAR',
      level: 0,
      reason: expect.any(String),
    });
  });
});
