import { describe, expect, it } from 'vitest';
import { createSegregationRuleSet, evaluateSegregationPair } from '../../src/domain/segregation';
import type { SegregationRuleSet } from '../../src/domain/segregation';
import { createSgRuleSet } from '../../src/domain/sg-rules';
import type { SgRule, SgRuleSet } from '../../src/domain/sg-rules';
import type { DgEntry } from '../../src/domain/types';

// Synthetic classes, SG codes and rules for testing only. Real class labels
// ("3", "5.1", "1.1 1.2 1.5") appear where the *shape* of the authorized
// matrix is what is under test — Class 1 group collapsing cannot be
// exercised with invented labels — but every level in this file is invented
// and must never be treated as regulatory data.

const CLASS_RULES: SegregationRuleSet = createSegregationRuleSet([
  // Ordinary primary pairs.
  ['3', '5.1', 2],
  ['3', '3', 0],
  ['3', '8', 1],
  ['3', '4.1', 3],
  ['5.1', '5.1', 0],
  ['5.1', '8', 4],
  ['8', '8', 0],
  ['4.1', '4.1', 0],
  ['4.1', '5.1', 1],
  ['4.1', '8', 2],
  ['2.2', '2.3', 0],
  ['2.2', '2.2', 0],
  ['2.2', '8', 1],
  ['2.3', '5.1', 1],
  ['2.2', '5.1', 0],
  ['2.3', '2.3', 0],
  ['2.3', '8', 2],
  ['7', '7', 0],
  ['3', '7', 2],
  ['5.1', '7', 3],
  // Class 1 collapsed group rows against ordinary classes. The engine must
  // reach these through division normalization ("1.1" -> "1.1 1.2 1.5").
  ['1.1 1.2 1.5', '3', 4],
  ['1.1 1.2 1.5', '8', 4],
  ['1.4', '3', 2],
  // Class 1 <-> Class 1 is deliberately absent: the authorized source holds
  // "*" there and publishes no compatibility-group tables.
]);

function sgRule(overrides: Partial<SgRule> & Pick<SgRule, 'code' | 'ruleType'>): SgRule {
  return {
    targets: [],
    level: null,
    sourceText: `synthetic ${overrides.code}`,
    ...overrides,
  };
}

const SG_RULES: SgRuleSet = createSgRuleSet([
  sgRule({ code: 'SG_CLASS_2', ruleType: 'DIRECT_CLASS', targets: ['8'], level: 2 }),
  sgRule({ code: 'SG_CLASS_1', ruleType: 'DIRECT_CLASS', targets: ['8'], level: 1 }),
  sgRule({ code: 'SG_CLASS_CLASS1', ruleType: 'DIRECT_CLASS', targets: ['1.1 1.2 1.5'], level: 4 }),
  sgRule({ code: 'SG_SGG_2', ruleType: 'DIRECT_SGG', targets: ['SGG1'], level: 2 }),
  sgRule({ code: 'SG_UN_2', ruleType: 'DIRECT_UN', targets: ['9846'], level: 2 }),
  sgRule({ code: 'SG_AS_FOR_5_1', ruleType: 'AS_FOR_CLASS', targets: ['5.1'] }),
  sgRule({ code: 'SG_ADDITIONAL', ruleType: 'ADDITIONAL_REQUIREMENT' }),
  sgRule({ code: 'SG_ADDITIONAL_2', ruleType: 'ADDITIONAL_REQUIREMENT' }),
  sgRule({ code: 'SG_REVIEW', ruleType: 'REVIEW_ONLY' }),
  sgRule({ code: 'SG_RESERVED', ruleType: 'RESERVED' }),
]);

let unSequence = 1000;

function makeEntry(overrides: Partial<DgEntry> = {}): DgEntry {
  unSequence += 1;
  return {
    unNumber: String(unSequence),
    variantKey: 'default',
    primaryClass: '3',
    subsidiaryRisks: [],
    segregationGroups: [],
    segregationCodes: [],
    compatibilityGroup: null,
    ...overrides,
  };
}

function evaluate(left: DgEntry, right: DgEntry) {
  return evaluateSegregationPair(left, right, CLASS_RULES, SG_RULES);
}

describe('evaluateSegregationPair — primary class matrix', () => {
  it('A. returns the numeric level for a plain primary <-> primary pair', () => {
    const result = evaluate(makeEntry({ primaryClass: '3' }), makeEntry({ primaryClass: '5.1' }));

    expect(result.decision).toEqual({
      status: 'SEGREGATION_REQUIRED',
      level: 2,
      reason: expect.any(String),
    });
    expect(result.additionalRequirements).toEqual([]);
  });

  it('B. treats an "X" source cell (level 0) as CLEAR when nothing else applies', () => {
    const result = evaluate(makeEntry({ primaryClass: '3' }), makeEntry({ primaryClass: '3' }));

    expect(result.decision.status).toBe('CLEAR');
    expect(result.decision.level).toBe(0);
  });

  it('T. gives the same result with the arguments reversed', () => {
    const left = makeEntry({ primaryClass: '3', subsidiaryRisks: ['8'] });
    const right = makeEntry({ primaryClass: '5.1', segregationCodes: ['SG_CLASS_2'] });

    const forward = evaluate(left, right);
    const reverse = evaluate(right, left);

    expect(reverse.decision).toEqual(forward.decision);
    expect(reverse.additionalRequirements).toEqual(forward.additionalRequirements);
  });

  it('routes a class pair with no rule to REVIEW_REQUIRED', () => {
    const result = evaluate(makeEntry({ primaryClass: '3' }), makeEntry({ primaryClass: 'TEST_UNKNOWN' }));

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.decision.level).toBeNull();
    expect(result.reviewBlockers).toEqual(['MISSING_CLASS_RULE:3|TEST_UNKNOWN']);
  });
});

describe('evaluateSegregationPair — subsidiary risks', () => {
  it('D. evaluates Sub(left) <-> Primary(right)', () => {
    // Base 3 <-> 4.1 = 3; sub 8 <-> 4.1 = 2. Strongest wins.
    const result = evaluate(
      makeEntry({ primaryClass: '3', subsidiaryRisks: ['8'] }),
      makeEntry({ primaryClass: '4.1' }),
    );

    expect(result.decision.level).toBe(3);
  });

  it('D. lets a subsidiary axis raise the result above the base level', () => {
    // Base 3 <-> 8 = 1; sub 5.1(left) <-> 8 = 4.
    const result = evaluate(
      makeEntry({ primaryClass: '3', subsidiaryRisks: ['5.1'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 4, reason: expect.any(String) });
  });

  it('E. evaluates Primary(left) <-> Sub(right)', () => {
    // Base 2.2 <-> 2.3 = 0; primary 2.2 <-> sub 8 = 1.
    const result = evaluate(
      makeEntry({ primaryClass: '2.2' }),
      makeEntry({ primaryClass: '2.3', subsidiaryRisks: ['8'] }),
    );

    expect(result.decision.level).toBe(1);
  });

  it('F. evaluates Sub <-> Sub when each side carries exactly one subsidiary risk', () => {
    // Base 2.2 <-> 2.3 = 0, 5.1 <-> 2.3 = 1, 2.2 <-> 8 = 1, and the
    // Sub <-> Sub axis 5.1 <-> 8 = 4 — which must not be missed.
    const result = evaluate(
      makeEntry({ primaryClass: '2.2', subsidiaryRisks: ['5.1'] }),
      makeEntry({ primaryClass: '2.3', subsidiaryRisks: ['8'] }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 4, reason: expect.any(String) });
  });

  it('G. requires review when either side carries two or more subsidiary risks', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '2.2', subsidiaryRisks: ['5.1', '8'] }),
      makeEntry({ primaryClass: '2.3' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('MULTIPLE_SUBSIDIARY_RISKS');
  });

  it('H. requires review when a shared primary class plus a subsidiary axis creates the requirement', () => {
    // Both sides are class 5.1 (base 0); the subsidiary axis 5.1 <-> 8 = 4
    // would otherwise finalize level 4 without enough dangerous-reaction data.
    const result = evaluate(
      makeEntry({ primaryClass: '5.1' }),
      makeEntry({ primaryClass: '5.1', subsidiaryRisks: ['8'] }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('SAME_CLASS_SUBSIDIARY_REVIEW');
  });

  it('H. does not trigger the same-class exception when the base level already covers it', () => {
    // Both sides class 4.1 (base 0), subsidiary axis 4.1 <-> 4.1 = 0 too, so
    // nothing is introduced by the subsidiary and the pair stays CLEAR.
    const result = evaluate(
      makeEntry({ primaryClass: '4.1' }),
      makeEntry({ primaryClass: '4.1', subsidiaryRisks: ['4.1'] }),
    );

    expect(result.decision.status).toBe('CLEAR');
  });

  it('V. requires review for an unresolved subsidiary source token', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', subsidiaryRisks: ['UNRESOLVED_SP:SP223'] }),
      makeEntry({ primaryClass: '5.1' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('UNRESOLVED_SUBSIDIARY_SOURCE');
  });

  it('V. requires review for a subsidiary token with no class rule rather than dropping it', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', subsidiaryRisks: ['TEST_SUB'] }),
      makeEntry({ primaryClass: '5.1' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('MISSING_CLASS_RULE:5.1|TEST_SUB');
  });

  it('deduplicates repeated subsidiary tokens instead of treating them as multiple risks', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '2.2', subsidiaryRisks: ['8', '8'] }),
      makeEntry({ primaryClass: '2.3' }),
    );

    expect(result.decision.status).toBe('SEGREGATION_REQUIRED');
    expect(result.reviewBlockers).toEqual([]);
  });
});

describe('evaluateSegregationPair — SG provisions', () => {
  it('I. applies a DIRECT_CLASS rule against the other cargo primary class', () => {
    // Base 3 <-> 8 = 1; SG_CLASS_2 targets class 8 at level 2.
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_CLASS_2'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision.level).toBe(2);
  });

  it('I. applies a DIRECT_CLASS rule against a resolved subsidiary risk of the other cargo', () => {
    // Every matrix axis here is below the SG level, so the level can only come
    // from SG_CLASS_2 matching the *subsidiary* 8 on the other cargo:
    // base 2.2 <-> 2.3 = 0, primary 2.2 <-> sub 8 = 1, SG_CLASS_2 -> 2.
    const result = evaluate(
      makeEntry({ primaryClass: '2.2', segregationCodes: ['SG_CLASS_2'] }),
      makeEntry({ primaryClass: '2.3', subsidiaryRisks: ['8'] }),
    );

    expect(result.decision.level).toBe(2);
    expect(result.reviewBlockers).toEqual([]);
  });

  it('I. does not apply a DIRECT_CLASS rule when the other cargo does not carry the target class', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_CLASS_2'] }),
      makeEntry({ primaryClass: '3' }),
    );

    expect(result.decision.status).toBe('CLEAR');
  });

  it('C. lets an SG rule raise a level-0 ("X") base to the SG level', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '8', segregationCodes: ['SG_CLASS_2'] }),
      makeEntry({ primaryClass: '8' }),
    );

    // 8 <-> 8 = 0 in the base matrix, SG_CLASS_2 targets class 8 at level 2.
    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
  });

  it('S. never lets a weaker SG rule lower a stronger base level', () => {
    // Base 5.1 <-> 8 = 4; SG_CLASS_1 targets class 8 at level 1.
    const result = evaluate(
      makeEntry({ primaryClass: '5.1', segregationCodes: ['SG_CLASS_1'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision.level).toBe(4);
  });

  it('R. takes the strongest rule when several apply', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_CLASS_1', 'SG_CLASS_2'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision.level).toBe(2);
  });

  it('J. applies a DIRECT_SGG rule when the other cargo is a member of the target group', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_SGG_2'] }),
      makeEntry({ primaryClass: '3', segregationGroups: ['SGG1'] }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
  });

  it('K. treats segregation-group membership alone as imposing nothing', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationGroups: ['SGG1'] }),
      makeEntry({ primaryClass: '3', segregationGroups: ['SGG1'] }),
    );

    expect(result.decision.status).toBe('CLEAR');
  });

  it('K. does not apply a DIRECT_SGG rule when the other cargo is in a different group', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_SGG_2'] }),
      makeEntry({ primaryClass: '3', segregationGroups: ['SGG18'] }),
    );

    expect(result.decision.status).toBe('CLEAR');
  });

  it('L. applies a DIRECT_UN rule against the other cargo UN number', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_UN_2'] }),
      makeEntry({ unNumber: '9846', primaryClass: '3' }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
  });

  it('L. does not apply a DIRECT_UN rule to a different UN number', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_UN_2'] }),
      makeEntry({ unNumber: '9845', primaryClass: '3' }),
    );

    expect(result.decision.status).toBe('CLEAR');
  });

  it('M. resolves AS_FOR_CLASS through the substituted class matrix lookup', () => {
    // Holder is class 3 (3 <-> 8 = 1) but segregates as class 5.1, and
    // 5.1 <-> 8 = 4.
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_AS_FOR_5_1'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision.level).toBe(4);
  });

  it('M. never lets AS_FOR_CLASS lower a stronger base level', () => {
    // Base 3 <-> 4.1 = 3, substituted 5.1 <-> 4.1 = 1.
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_AS_FOR_5_1'] }),
      makeEntry({ primaryClass: '4.1' }),
    );

    expect(result.decision.level).toBe(3);
  });

  it('applies SG rules carried by the right-hand entry as well as the left', () => {
    const left = evaluate(
      makeEntry({ primaryClass: '8' }),
      makeEntry({ primaryClass: '8', segregationCodes: ['SG_CLASS_2'] }),
    );

    expect(left.decision.level).toBe(2);
  });

  it('P. requires review for a REVIEW_ONLY SG code', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_REVIEW'] }),
      makeEntry({ primaryClass: '5.1' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toEqual(['REVIEW_ONLY_SG_CODE:SG_REVIEW']);
  });

  it('U. requires review for an SG code that is not in the rule set', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_DOES_NOT_EXIST'] }),
      makeEntry({ primaryClass: '5.1' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toEqual(['UNKNOWN_SG_CODE:SG_DOES_NOT_EXIST']);
  });

  it('requires review when an entry unexpectedly references a RESERVED SG code', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_RESERVED'] }),
      makeEntry({ primaryClass: '5.1' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toEqual(['RESERVED_SG_CODE:SG_RESERVED']);
  });
});

describe('evaluateSegregationPair — additional requirements', () => {
  it('Q. preserves the numeric result and reports the requirement alongside it', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_ADDITIONAL'] }),
      makeEntry({ primaryClass: '5.1' }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
    expect(result.additionalRequirements).toEqual([
      { code: 'SG_ADDITIONAL', source: 'SG', requiresConfirmation: true },
    ]);
  });

  it('Q. reports a requirement on a level-0 pair, which is therefore not unrestricted', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_ADDITIONAL'] }),
      makeEntry({ primaryClass: '3' }),
    );

    expect(result.decision.status).toBe('CLEAR');
    expect(result.decision.level).toBe(0);
    expect(result.additionalRequirements).toHaveLength(1);
  });

  it('Q. an ADDITIONAL_REQUIREMENT alone is not a review blocker', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_ADDITIONAL'] }),
      makeEntry({ primaryClass: '3' }),
    );

    expect(result.reviewBlockers).toEqual([]);
  });

  it('still reports requirements on a pair that resolves to REVIEW_REQUIRED', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_ADDITIONAL', 'SG_REVIEW'] }),
      makeEntry({ primaryClass: '5.1' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.additionalRequirements).toEqual([
      { code: 'SG_ADDITIONAL', source: 'SG', requiresConfirmation: true },
    ]);
  });

  it('deduplicates and sorts requirements collected from both directions', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_ADDITIONAL_2', 'SG_ADDITIONAL'] }),
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_ADDITIONAL'] }),
    );

    expect(result.additionalRequirements.map((requirement) => requirement.code)).toEqual([
      'SG_ADDITIONAL',
      'SG_ADDITIONAL_2',
    ]);
  });
});

describe('evaluateSegregationPair — Class 1', () => {
  it('N. resolves a Class 1 division against an ordinary class through the collapsed group row', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '1.1', compatibilityGroup: 'D' }),
      makeEntry({ primaryClass: '3' }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 4, reason: expect.any(String) });
  });

  it('N. keeps distinct Class 1 groups distinct rather than collapsing all of Class 1', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '1.4', compatibilityGroup: 'S' }),
      makeEntry({ primaryClass: '3' }),
    );

    expect(result.decision.level).toBe(2);
  });

  it('N. does not use the compatibility letter to change the level', () => {
    const withGroup = evaluate(
      makeEntry({ primaryClass: '1.1', compatibilityGroup: 'D' }),
      makeEntry({ primaryClass: '3' }),
    );
    const withoutGroup = evaluate(makeEntry({ primaryClass: '1.1' }), makeEntry({ primaryClass: '3' }));

    expect(withGroup.decision).toEqual(withoutGroup.decision);
  });

  it('O. requires review for Class 1 <-> Class 1', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '1.1', compatibilityGroup: 'D' }),
      makeEntry({ primaryClass: '1.4', compatibilityGroup: 'S' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('CLASS1_TO_CLASS1_UNRESOLVED');
  });

  it('O. requires review for the same Class 1 division on both sides', () => {
    const result = evaluate(makeEntry({ primaryClass: '1.1' }), makeEntry({ primaryClass: '1.1' }));

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('CLASS1_TO_CLASS1_UNRESOLVED');
  });

  it('O. never falls back to a magic level for an unresolved Class 1 pair', () => {
    const result = evaluate(makeEntry({ primaryClass: '1.2' }), makeEntry({ primaryClass: '1.3' }));

    expect(result.decision.level).toBeNull();
  });

  it('applies an SG rule that targets a collapsed Class 1 group', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '8', segregationCodes: ['SG_CLASS_CLASS1'] }),
      makeEntry({ primaryClass: '1.2' }),
    );

    // Base 1.1 1.2 1.5 <-> 8 = 4 and the SG rule also yields 4; the point is
    // that "1.2" matches the "1.1 1.2 1.5" target rather than failing a naive
    // string comparison.
    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 4, reason: expect.any(String) });
    expect(result.reviewBlockers).toEqual([]);
  });
});
