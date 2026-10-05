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
  sgRule({ code: 'SG_EXEMPTION', ruleType: 'EXEMPTION' }),
  sgRule({ code: 'SG_AWAY_FROM_8', ruleType: 'DIRECT_CLASS', targets: ['8'], level: 1 }),
  sgRule({ code: 'SG_SEPARATED_FROM_8', ruleType: 'DIRECT_CLASS', targets: ['8'], level: 2 }),
  sgRule({ code: 'SG_LEVEL3_VS_8', ruleType: 'DIRECT_CLASS', targets: ['8'], level: 3 }),
  sgRule({ code: 'SG_LEVEL4_VS_8', ruleType: 'DIRECT_CLASS', targets: ['8'], level: 4 }),
  sgRule({ code: 'SG_MALFORMED_DIRECT', ruleType: 'DIRECT_CLASS', targets: ['8'], level: null }),
  sgRule({ code: 'SG_AS_FOR_2_2', ruleType: 'AS_FOR_CLASS', targets: ['2.2'] }),
  sgRule({ code: 'SG_DIRECT_NO_TARGETS', ruleType: 'DIRECT_CLASS', targets: [], level: 2 }),
]);

let unSequence = 1000;

function makeEntry(overrides: Partial<DgEntry> = {}): DgEntry {
  unSequence += 1;
  return {
    unNumber: String(unSequence),
    variantKey: 'default',
    // Null by default: the segregation engine never reads the proper shipping
    // name, so these fixtures deliberately do not carry one.
    properShippingName: null,
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

  it('G. takes the column 16b provisions, not the subsidiary axes, for two or more subsidiary risks', () => {
    // Holder is class 2.2 with subsidiary 5.1 and 8. Enumerating those axes
    // would reach 2.3 <-> 5.1 = 1 and 2.3 <-> 8 = 2; the applicable
    // provisions are instead the ones its column 16b carries, here a
    // DIRECT_CLASS rule at level 2 that does not target class 2.3.
    const result = evaluate(
      makeEntry({ primaryClass: '2.2', subsidiaryRisks: ['5.1', '8'], segregationCodes: ['SG_CLASS_2'] }),
      makeEntry({ primaryClass: '2.3' }),
    );

    // 2.2 <-> 2.3 = 0, and no provision applies to a plain class 2.3 cargo.
    expect(result.decision.status).toBe('CLEAR');
    expect(result.reviewBlockers).toEqual([]);
  });

  it('G. still applies a column 16b provision carried alongside two or more subsidiary risks', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '2.2', subsidiaryRisks: ['5.1', '8'], segregationCodes: ['SG_CLASS_2'] }),
      makeEntry({ primaryClass: '8' }),
    );

    // 2.2 <-> 8 = 1 from the table, raised to 2 by the provision targeting class 8.
    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
  });

  it('G. fails closed when two or more subsidiary risks come with no column 16b provision at all', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '2.2', subsidiaryRisks: ['5.1', '8'] }),
      makeEntry({ primaryClass: '2.3' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('MULTIPLE_SUBSIDIARY_RISKS_NO_PROVISION');
  });

  it('G. keeps the single-subsidiary axis, which is not governed by column 16b', () => {
    // One subsidiary label, so its own provisions apply and take precedence
    // where more stringent: 2.2 <-> 2.3 = 0 but 8 <-> 2.3 = 2.
    const result = evaluate(
      makeEntry({ primaryClass: '2.2', subsidiaryRisks: ['8'] }),
      makeEntry({ primaryClass: '2.3' }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
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

  it('M. substitutes the holder class rather than adding a second candidate level', () => {
    // The holder's own row would give 3 <-> 4.1 = 3, but "segregation as for
    // class 5.1" replaces that basis and 5.1 <-> 4.1 = 1. Keeping the holder's
    // own row as well would hold the pair at 3 and over-segregate it.
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_AS_FOR_5_1'] }),
      makeEntry({ primaryClass: '4.1' }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 1, reason: expect.any(String) });
  });

  it('M. lets the substituted basis fall to no requirement where the holder class had one', () => {
    // 3 <-> 5.1 = 2 on the holder's own row; as for class 5.1 it is
    // 5.1 <-> 5.1 = 0, and no provision targets the other cargo.
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_AS_FOR_5_1'] }),
      makeEntry({ primaryClass: '5.1' }),
    );

    expect(result.decision.status).toBe('CLEAR');
    expect(result.reviewBlockers).toEqual([]);
  });

  it('M. still applies the holder\'s other column 16b provisions on top of the substituted basis', () => {
    // Substituted basis 5.1 <-> 8 = 4 here, and the DIRECT_CLASS rule at
    // level 2 targeting class 8 cannot lower it.
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_AS_FOR_5_1', 'SG_CLASS_2'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision.level).toBe(4);
  });

  it('M. does not let a substitution change what another cargo\'s provision matches against', () => {
    // The holder is class 3 segregating as for class 5.1. The other cargo's
    // rule targets class 8, which the holder neither is nor is substituted
    // to, so nothing matches and only the table applies: 5.1 <-> 4.1 = 1.
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_AS_FOR_5_1'] }),
      makeEntry({ primaryClass: '4.1', segregationCodes: ['SG_CLASS_2'] }),
    );

    expect(result.decision.level).toBe(1);
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

describe('evaluateSegregationPair — final semantics regression', () => {
  it('5. raises a level-0 base to level 1 for an "away from" provision', () => {
    // 3 <-> 3 = 0 (an "X" cell) with an away-from provision targeting the
    // other cargo's class.
    const result = evaluate(
      makeEntry({ primaryClass: '8', segregationCodes: ['SG_AWAY_FROM_8'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 1, reason: expect.any(String) });
  });

  it('6. raises a level-0 base to level 2 for a "separated from" provision', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '8', segregationCodes: ['SG_SEPARATED_FROM_8'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
  });

  it('12a. keeps the stronger table level when a provision imposes a weaker one', () => {
    // Table 4.1 <-> 8 = 2, provision "away from class 8" = 1. The provision
    // adds a requirement, it does not cap the table, so 2 stands.
    const result = evaluate(
      makeEntry({ primaryClass: '4.1', segregationCodes: ['SG_AWAY_FROM_8'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision.level).toBe(2);
  });

  it('12b. takes the provision level when it is stronger than the table', () => {
    // Table 3 <-> 8 = 1, provision targeting class 8 = 3.
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_LEVEL3_VS_8'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision.level).toBe(3);
  });

  it('12c. an "as for class" substitution lowers the basis where an ordinary provision could not', () => {
    // The two directions are not symmetric by accident: an ordinary provision
    // is cumulative with the table (12a), while "segregation as for class"
    // replaces the holder's basis outright. Table 3 <-> 8 = 1, but as for
    // class 2.2 it is 2.2 <-> 8 = 1 as well — so compare against class 5.1,
    // where the holder's own row gives 2 and the substituted row gives 0.
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_AS_FOR_2_2'] }),
      makeEntry({ primaryClass: '5.1' }),
    );

    expect(result.decision.status).toBe('CLEAR');
  });

  it('13. reports level 1', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '4.1' }),
      makeEntry({ primaryClass: '5.1' }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 1, reason: expect.any(String) });
  });

  it('14. reports level 2', () => {
    const result = evaluate(makeEntry({ primaryClass: '3' }), makeEntry({ primaryClass: '5.1' }));

    expect(result.decision.level).toBe(2);
  });

  it('15. reports level 3', () => {
    const result = evaluate(makeEntry({ primaryClass: '3' }), makeEntry({ primaryClass: '4.1' }));

    expect(result.decision.level).toBe(3);
  });

  it('16. reports level 4', () => {
    const result = evaluate(makeEntry({ primaryClass: '5.1' }), makeEntry({ primaryClass: '8' }));

    expect(result.decision.level).toBe(4);
  });

  it('W. treats a subsidiary hazard of class 1 as the division 1.3 row', () => {
    // The 1.3 1.6 row is not in the synthetic matrix, so the lookup fails
    // closed on that label rather than on the 1.1 1.2 1.5 row the raw
    // division would otherwise have produced.
    const result = evaluate(
      makeEntry({ primaryClass: '3', subsidiaryRisks: ['1.1'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('MISSING_CLASS_RULE:1.3 1.6|8');
    expect(result.reviewBlockers).not.toContain('MISSING_CLASS_RULE:1.1 1.2 1.5|8');
  });

  it('X. fails an unverifiable exemption to review instead of applying or reporting it', () => {
    // The relaxation is not granted and the un-relaxed figure is not
    // published as a final answer either: the condition may hold, so the
    // strict number would be wrong in the other direction. No level is
    // lowered, and the operator is never shown a relaxation as an obligation.
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_EXEMPTION'] }),
      makeEntry({ primaryClass: '5.1' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.decision.level).toBeNull();
    expect(result.reviewBlockers).toContain('EXEMPTION_REQUIRES_REVIEW');
    expect(result.additionalRequirements).toEqual([]);
  });

  it('X. does not publish the un-relaxed numeric requirement alongside an exemption', () => {
    // Table 3 <-> 8 = 1, raised to 3 by the provision targeting class 8. That
    // un-relaxed level keeps accumulating internally, but the exemption
    // blocker dominates the public decision.
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_LEVEL3_VS_8', 'SG_EXEMPTION'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision).toEqual({ status: 'REVIEW_REQUIRED', level: null, reason: expect.any(String) });
    expect(result.reviewBlockers).toContain('EXEMPTION_REQUIRES_REVIEW');
  });

  it('X. applies the exemption blocker from either side of the pair', () => {
    const left = makeEntry({ primaryClass: '3' });
    const right = makeEntry({ primaryClass: '5.1', segregationCodes: ['SG_EXEMPTION'] });

    const forward = evaluate(left, right);
    const reverse = evaluate(right, left);

    expect(forward.decision.status).toBe('REVIEW_REQUIRED');
    expect(reverse.decision).toEqual(forward.decision);
    expect(reverse.reviewBlockers).toEqual(forward.reviewBlockers);
  });

  it('Y. fails closed on an unresolved segregation source value without echoing it', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['UNRESOLVED_SOURCE:synthetic private wording'] }),
      makeEntry({ primaryClass: '3' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toEqual(['UNRESOLVED_SEGREGATION_SOURCE']);
    expect(JSON.stringify(result)).not.toContain('synthetic private wording');
  });

  it('Z. fails closed on a stored DIRECT_CLASS rule with no level', () => {
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_MALFORMED_DIRECT'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toEqual(['MALFORMED_SG_RULE:SG_MALFORMED_DIRECT']);
  });

  it('T2. stays symmetric across a substitution and a multi-subsidiary side', () => {
    const left = makeEntry({
      primaryClass: '2.2',
      subsidiaryRisks: ['5.1', '8'],
      segregationCodes: ['SG_AS_FOR_5_1', 'SG_SEPARATED_FROM_8'],
    });
    const right = makeEntry({ primaryClass: '8', segregationGroups: ['SGG1'], segregationCodes: ['SG_SGG_2'] });

    const forward = evaluate(left, right);
    const reverse = evaluate(right, left);

    expect(reverse.decision).toEqual(forward.decision);
    expect(reverse.reviewBlockers).toEqual(forward.reviewBlockers);
  });
});

describe('evaluateSegregationPair - multi-subsidiary completeness', () => {
  // Completeness for a 2+-subsidiary entry is judged on the *resolved* rules
  // its column 16b yields, not on how many source tokens the column held. A
  // token that resolves to nothing evaluable cannot stand in for the
  // provision the regulation says supplies the requirement.
  const MULTI_SUBS = ['5.1', '8'];

  function multi(codes: readonly string[]): DgEntry {
    return makeEntry({ primaryClass: '2.2', subsidiaryRisks: MULTI_SUBS, segregationCodes: [...codes] });
  }

  it('C1. evaluates a DIRECT_CLASS provision mechanically', () => {
    // Table 2.2 <-> 8 = 1, raised to 2 by the provision targeting class 8.
    const result = evaluate(multi(['SG_CLASS_2']), makeEntry({ primaryClass: '8' }));

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
    expect(result.reviewBlockers).toEqual([]);
  });

  it('C1. evaluates a DIRECT_SGG provision mechanically', () => {
    const result = evaluate(
      multi(['SG_SGG_2']),
      makeEntry({ primaryClass: '2.3', segregationGroups: ['SGG1'] }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
    expect(result.reviewBlockers).toEqual([]);
  });

  it('C1. evaluates a DIRECT_UN provision mechanically', () => {
    const result = evaluate(multi(['SG_UN_2']), makeEntry({ primaryClass: '2.3', unNumber: '9846' }));

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
    expect(result.reviewBlockers).toEqual([]);
  });

  it('C2. evaluates an AS_FOR_CLASS substitution mechanically', () => {
    // The substituted basis 5.1 governs the lookup: 5.1 <-> 8 = 4.
    const result = evaluate(multi(['SG_AS_FOR_5_1']), makeEntry({ primaryClass: '8' }));

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 4, reason: expect.any(String) });
    expect(result.reviewBlockers).toEqual([]);
  });

  it('C3. requires review when column 16b carries only an ADDITIONAL_REQUIREMENT', () => {
    // A non-level obligation accompanies a requirement; it does not supply
    // one. The obligation must still reach the operator.
    const result = evaluate(multi(['SG_ADDITIONAL']), makeEntry({ primaryClass: '8' }));

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('MULTIPLE_SUBSIDIARY_RISKS_NO_PROVISION');
    expect(result.additionalRequirements).toEqual([
      { code: 'SG_ADDITIONAL', source: 'SG', requiresConfirmation: true },
    ]);
  });

  it('C4. requires review when column 16b carries only a REVIEW_ONLY provision', () => {
    const result = evaluate(multi(['SG_REVIEW']), makeEntry({ primaryClass: '8' }));

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('REVIEW_ONLY_SG_CODE:SG_REVIEW');
    expect(result.reviewBlockers).toContain('MULTIPLE_SUBSIDIARY_RISKS_NO_PROVISION');
  });

  it('C5. requires review when column 16b carries only an EXEMPTION', () => {
    const result = evaluate(multi(['SG_EXEMPTION']), makeEntry({ primaryClass: '8' }));

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('EXEMPTION_REQUIRES_REVIEW');
    expect(result.reviewBlockers).toContain('MULTIPLE_SUBSIDIARY_RISKS_NO_PROVISION');
  });

  it('C6. requires review when column 16b carries only a RESERVED code', () => {
    const result = evaluate(multi(['SG_RESERVED']), makeEntry({ primaryClass: '8' }));

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('RESERVED_SG_CODE:SG_RESERVED');
    expect(result.reviewBlockers).toContain('MULTIPLE_SUBSIDIARY_RISKS_NO_PROVISION');
  });

  it('C7. requires review when column 16b carries only an unknown code', () => {
    const result = evaluate(multi(['SG_NOT_IN_RULE_SET']), makeEntry({ primaryClass: '8' }));

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('UNKNOWN_SG_CODE:SG_NOT_IN_RULE_SET');
    expect(result.reviewBlockers).toContain('MULTIPLE_SUBSIDIARY_RISKS_NO_PROVISION');
  });

  it('C8. requires review when column 16b carries only an unresolved source token', () => {
    const result = evaluate(
      multi(['UNRESOLVED_SOURCE:synthetic private wording']),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('UNRESOLVED_SEGREGATION_SOURCE');
    expect(result.reviewBlockers).toContain('MULTIPLE_SUBSIDIARY_RISKS_NO_PROVISION');
    expect(JSON.stringify(result)).not.toContain('synthetic private wording');
  });

  it('C9. does not let a malformed DIRECT rule stand in for a real provision', () => {
    const result = evaluate(multi(['SG_MALFORMED_DIRECT']), makeEntry({ primaryClass: '8' }));

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('MALFORMED_SG_RULE:SG_MALFORMED_DIRECT');
    expect(result.reviewBlockers).toContain('MULTIPLE_SUBSIDIARY_RISKS_NO_PROVISION');
  });

  it('C9. does not let a targetless DIRECT rule stand in for a real provision', () => {
    const result = evaluate(multi(['SG_DIRECT_NO_TARGETS']), makeEntry({ primaryClass: '8' }));

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('MULTIPLE_SUBSIDIARY_RISKS_NO_PROVISION');
  });

  it('C10. accepts the entry when one evaluable provision sits beside non-evaluable ones', () => {
    // The ADDITIONAL_REQUIREMENT does not establish the requirement, but the
    // DIRECT_CLASS provision beside it does, so completeness is satisfied.
    const result = evaluate(multi(['SG_ADDITIONAL', 'SG_CLASS_2']), makeEntry({ primaryClass: '8' }));

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
    expect(result.reviewBlockers).toEqual([]);
    expect(result.additionalRequirements).toEqual([
      { code: 'SG_ADDITIONAL', source: 'SG', requiresConfirmation: true },
    ]);
  });

  it('C11. still refuses to enumerate the individual subsidiary axes', () => {
    // Enumerating 5.1 and 8 against class 2.3 would reach 2.3 <-> 8 = 2; the
    // applicable provisions are the ones column 16b carries instead, and the
    // DIRECT_CLASS rule here does not target class 2.3.
    const result = evaluate(multi(['SG_CLASS_2']), makeEntry({ primaryClass: '2.3' }));

    expect(result.decision.status).toBe('CLEAR');
    expect(result.reviewBlockers).toEqual([]);
  });
});

describe('evaluateSegregationPair - same primary class provenance', () => {
  // 7.2.6.1 relieves only segregation required by subsidiary hazard label(s),
  // and only where the substances do not react dangerously. The engine
  // therefore has to tell a subsidiary-driven requirement from an ordinary
  // DGL-specific one before deciding whether the pair sits on that exception.

  it('D1. requires review when an AS_FOR_CLASS substitution supplies the multi-subsidiary treatment', () => {
    // Both sides are class 3 (3 <-> 3 = 0). The left entry carries two
    // subsidiary labels, so its column 16b substitution *is* its subsidiary
    // treatment: the substituted basis 5.1 gives 5.1 <-> 3 = 2.
    const result = evaluate(
      makeEntry({ primaryClass: '3', subsidiaryRisks: ['5.1', '8'], segregationCodes: ['SG_AS_FOR_5_1'] }),
      makeEntry({ primaryClass: '3' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('SAME_CLASS_SUBSIDIARY_REVIEW');
  });

  it('D2. requires review when a DIRECT provision supplies the multi-subsidiary treatment', () => {
    // 8 <-> 8 = 0 on the table and on every axis, so a table-only test sees
    // no increase at all. The increase arrives through column 16b, which on a
    // 2+-subsidiary entry is the subsidiary-hazard treatment.
    const result = evaluate(
      makeEntry({
        primaryClass: '8',
        subsidiaryRisks: ['5.1', '3'],
        segregationCodes: ['SG_SEPARATED_FROM_8'],
      }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.decision.level).toBeNull();
    expect(result.reviewBlockers).toContain('SAME_CLASS_SUBSIDIARY_REVIEW');
  });

  it('D3. does not invent the exception for an ordinary DIRECT provision on same-class goods', () => {
    // Control for D4: same actual primary class on both sides, an ordinary
    // Column-16b DIRECT_CLASS rule, and no subsidiary-driven or substituted
    // provenance anywhere. 7.2.6.1 does not reach a DGL-specific provision of
    // this kind, so the requirement stays a definitive number — the
    // same-class exception must not fire for every Column-16b rule.
    const result = evaluate(
      makeEntry({ primaryClass: '8', segregationCodes: ['SG_SEPARATED_FROM_8'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
    expect(result.reviewBlockers).toEqual([]);
  });

  it('D4. requires review for an AS_FOR_CLASS raise on same-class goods with no subsidiary risk', () => {
    // Both sides have an actual DGL primary class of 3, and the left entry
    // carries no subsidiary hazard label at all. "Segregation as for class
    // 5.1" governs the table lookup (5.1 <-> 3 = 2), but 7.2.6.2 directs the
    // same-class permission of 7.2.6.1 back to the primary hazard class of
    // the Dangerous Goods List, where 3 <-> 3 = 0. The substitution is
    // therefore the whole reason the requirement exists, and whether these
    // two react dangerously is not in the dataset, so the level cannot be
    // finalized. Subsidiary-risk count is irrelevant to this path.
    const result = evaluate(
      makeEntry({ primaryClass: '3', segregationCodes: ['SG_AS_FOR_5_1'] }),
      makeEntry({ primaryClass: '3' }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.decision.level).toBeNull();
    expect(result.reviewBlockers).toContain('SAME_CLASS_SUBSIDIARY_REVIEW');
  });

  it('D4b. still finalizes an AS_FOR_CLASS substitution that raises nothing above the primary classes', () => {
    // Same shape as D4 — shared actual primary class 5.1, a substitution to
    // a different class — but the substituted basis 2.2 <-> 5.1 = 0 is no
    // more stringent than 5.1 <-> 5.1 = 0. Nothing is raised above what the
    // primary classes impose, so there is no exception to sit on and the
    // substitution does not escalate the pair on its own.
    const result = evaluate(
      makeEntry({ primaryClass: '5.1', segregationCodes: ['SG_AS_FOR_2_2'] }),
      makeEntry({ primaryClass: '5.1' }),
    );

    expect(result.decision.status).toBe('CLEAR');
    expect(result.reviewBlockers).toEqual([]);
  });

  it('D5. does not treat a single-subsidiary provision as subsidiary-driven', () => {
    // One subsidiary label, so the subsidiary axis is enumerated on its own
    // and column 16b is not standing in for it. 8 <-> 8 = 0 on both the basis
    // and the subsidiary axis, so nothing subsidiary-driven is introduced.
    const result = evaluate(
      makeEntry({ primaryClass: '8', subsidiaryRisks: ['8'], segregationCodes: ['SG_SEPARATED_FROM_8'] }),
      makeEntry({ primaryClass: '8' }),
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
    expect(result.reviewBlockers).toEqual([]);
  });

  it('D6. still requires review for a single-subsidiary table axis on same-class goods', () => {
    // The confirmed single-subsidiary behaviour is unchanged: 5.1 <-> 5.1 = 0
    // but the subsidiary axis 5.1 <-> 8 = 4.
    const result = evaluate(
      makeEntry({ primaryClass: '5.1' }),
      makeEntry({ primaryClass: '5.1', subsidiaryRisks: ['8'] }),
    );

    expect(result.decision.status).toBe('REVIEW_REQUIRED');
    expect(result.reviewBlockers).toContain('SAME_CLASS_SUBSIDIARY_REVIEW');
  });
});

describe('evaluateSegregationPair - class 1 subsidiary axis', () => {
  // A dedicated matrix: the shared fixture deliberately omits the 1.3 1.6 row
  // so the fail-closed case can be exercised, which makes it unusable for
  // proving the positive behaviour.
  const CLASS1_SUB_RULES: SegregationRuleSet = createSegregationRuleSet([
    ['3', '8', 1],
    ['1.3 1.6', '8', 2],
    ['1.1 1.2 1.5', '8', 4],
  ]);

  it('W2. uses the division 1.3 row for a subsidiary hazard of class 1', () => {
    // Subsidiary "1.1" must reach the 1.3 1.6 row (level 2), not the
    // 1.1 1.2 1.5 row its raw division would name (level 4), and not the
    // primary-only 3 <-> 8 = 1.
    const result = evaluateSegregationPair(
      makeEntry({ primaryClass: '3', subsidiaryRisks: ['1.1'] }),
      makeEntry({ primaryClass: '8' }),
      CLASS1_SUB_RULES,
      SG_RULES,
    );

    expect(result.decision).toEqual({ status: 'SEGREGATION_REQUIRED', level: 2, reason: expect.any(String) });
    expect(result.reviewBlockers).toEqual([]);
  });

  it('W2. reaches the same row from any class 1 division carried as a subsidiary', () => {
    for (const division of ['1.1', '1.2', '1.3', '1.5', '1.6']) {
      const result = evaluateSegregationPair(
        makeEntry({ primaryClass: '3', subsidiaryRisks: [division] }),
        makeEntry({ primaryClass: '8' }),
        CLASS1_SUB_RULES,
        SG_RULES,
      );

      expect(result.decision.level).toBe(2);
    }
  });

  it('W2. keeps a class 1 primary class on its own division row', () => {
    // Only a *subsidiary* class 1 hazard collapses to division 1.3; a class 1
    // primary class keeps the row its own division publishes.
    const result = evaluateSegregationPair(
      makeEntry({ primaryClass: '1.1' }),
      makeEntry({ primaryClass: '8' }),
      CLASS1_SUB_RULES,
      SG_RULES,
    );

    expect(result.decision.level).toBe(4);
  });
});
