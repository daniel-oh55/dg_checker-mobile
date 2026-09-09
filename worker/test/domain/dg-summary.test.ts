import { describe, expect, it } from 'vitest';
import { CLASS1_MATRIX_LABELS, PRIMARY_HAZARD_CLASSES } from '../../src/domain/class-normalization';
import {
  UNSPECIFIED_PRIMARY_HAZARD,
  UNSPECIFIED_SUBSIDIARY_HAZARD,
  buildDgSummary,
} from '../../src/domain/dg-summary';
import type { DgEntry } from '../../src/domain/types';

// Pure unit coverage for the public DG-summary boundary. The API-level
// equivalents live in segregation-source-leakage.test.ts; these tests pin the
// contract itself, so a regression is reported here rather than only as a
// response-body diff.
//
// Every unrecognized value used below is unmistakably synthetic. No authorized
// source wording appears in this file.

function entry(overrides: Partial<DgEntry> = {}): DgEntry {
  return {
    unNumber: '9001',
    variantKey: 'a',
    properShippingName: 'SYNTHETIC UNIT-TEST SUBSTANCE',
    primaryClass: '3',
    subsidiaryRisks: [],
    segregationGroups: [],
    segregationCodes: [],
    compatibilityGroup: null,
    ...overrides,
  };
}

/**
 * The complete set of hazard classes a DgEntry primary class can hold, written
 * out as literals rather than derived from the source module: this is the
 * published contract, so it has to fail if the vocabulary silently changes.
 *
 * These are Class 1 *divisions*, not the collapsed matrix labels — the
 * converter stores "1.1", and "1.1 1.2 1.5" exists only as a lookup row.
 */
const CANONICAL_PRIMARY_CLASSES = [
  '1.1',
  '1.2',
  '1.3',
  '1.4',
  '1.5',
  '1.6',
  '2.1',
  '2.2',
  '2.3',
  '3',
  '4.1',
  '4.2',
  '4.3',
  '5.1',
  '5.2',
  '6.1',
  '6.2',
  '7',
  '8',
  '9',
];

describe('public primary-class vocabulary', () => {
  it('is exactly the six Class 1 divisions plus the 14 ordinary classes', () => {
    expect([...PRIMARY_HAZARD_CLASSES].sort()).toEqual([...CANONICAL_PRIMARY_CLASSES].sort());
    expect(PRIMARY_HAZARD_CLASSES).toHaveLength(20);
  });

  it('does not treat a collapsed Class 1 matrix label as a primary class', () => {
    // A label covering several divisions names a segregation-matrix row, not a
    // DG entry: publishing "1.1 1.2 1.5" as a primary class would report a
    // class the source never assigned to the entry. ("1.4" is excluded here
    // because it is genuinely both a division and its own matrix row.)
    const collapsedLabels = CLASS1_MATRIX_LABELS.filter((label) => label.includes(' '));
    expect(collapsedLabels).toHaveLength(2);
    for (const label of collapsedLabels) {
      expect(PRIMARY_HAZARD_CLASSES).not.toContain(label);
    }
  });
});

describe('buildDgSummary — recognized primary classes pass through', () => {
  it.each(CANONICAL_PRIMARY_CLASSES)('publishes %s unchanged', (primaryClass) => {
    const summary = buildDgSummary('9001', [entry({ primaryClass })]);

    expect(summary.profiles).toHaveLength(1);
    expect(summary.profiles[0].primaryClass).toBe(primaryClass);
  });

  it('publishes an ordinary class, a decimal class and a Class 1 division verbatim', () => {
    // The three shapes the mobile Class field renders, called out separately
    // from the table above so a narrowing of the set is unmistakable.
    for (const primaryClass of ['3', '6.1', '1.1', '1.4']) {
      const summary = buildDgSummary('9001', [entry({ primaryClass })]);
      expect(summary.profiles[0].primaryClass).toBe(primaryClass);
    }
  });
});

describe('buildDgSummary — unrecognized primary classes are withheld', () => {
  // Each case is a shape an unmapped "Class or division" cell can reach the
  // database as. The check is an allowlist, so none of them has to be
  // enumerated in the implementation.
  const WITHHELD: Array<[string, string]> = [
    ['unmapped source prose', 'synthetic-unmapped-class-prose-9001'],
    ['a class-shaped value outside the vocabulary', '10.4'],
    ['a Class 1 division outside 1.1-1.6', '1.7'],
    ['a collapsed matrix label', '1.1 1.2 1.5'],
    ['a division with its compatibility letter still attached', '1.4S'],
    ['an unresolved converter token', 'UNRESOLVED_SOURCE:synthetic-class-payload-9001'],
    ['an empty value', ''],
    ['a whitespace-only value', '   '],
    ['a recognized class with surrounding whitespace', ' 3 '],
    ['a recognized class with a trailing marker', '3+'],
    ['a legacy value stored by an older dataset', 'TEST_LEGACY_CLASS_9001'],
  ];

  it.each(WITHHELD)('replaces %s with the public placeholder', (_label, primaryClass) => {
    const summary = buildDgSummary('9001', [entry({ primaryClass })]);

    expect(summary.profiles).toHaveLength(1);
    expect(summary.profiles[0].primaryClass).toBe(UNSPECIFIED_PRIMARY_HAZARD);
    expect(summary.profiles[0].primaryClass).not.toBe(primaryClass);
  });

  it('withholds the value from the serialized summary entirely', () => {
    const raw = 'synthetic-unmapped-class-prose-9002';
    const serialized = JSON.stringify(buildDgSummary('9001', [entry({ primaryClass: raw })]));

    expect(serialized).not.toContain(raw);
    expect(serialized).toContain(UNSPECIFIED_PRIMARY_HAZARD);
  });

  it('reports the placeholder without disturbing the other public fields', () => {
    const summary = buildDgSummary('9001', [
      entry({
        primaryClass: 'synthetic-unmapped-class-prose-9003',
        subsidiaryRisks: ['6.1'],
        properShippingName: 'SYNTHETIC PLACEHOLDER SUBSTANCE',
      }),
    ]);

    expect(summary.profiles[0]).toEqual({
      primaryClass: UNSPECIFIED_PRIMARY_HAZARD,
      subsidiaryRisks: ['6.1'],
      properShippingName: 'SYNTHETIC PLACEHOLDER SUBSTANCE',
    });
  });
});

describe('buildDgSummary — the withheld value never reaches the dedupe key', () => {
  it('collapses two variants that differ only by their unmapped primary class', () => {
    const summary = buildDgSummary('9001', [
      entry({
        variantKey: 'a',
        primaryClass: 'synthetic-unmapped-class-alpha-9001',
        properShippingName: 'SYNTHETIC COLLAPSE SUBSTANCE',
      }),
      entry({
        variantKey: 'b',
        primaryClass: 'synthetic-unmapped-class-beta-9001',
        properShippingName: 'SYNTHETIC COLLAPSE SUBSTANCE',
      }),
    ]);

    // The dataset ambiguity is still reported truthfully...
    expect(summary.variantCount).toBe(2);
    // ...but a client is not handed two profiles it cannot tell apart.
    expect(summary.profiles).toHaveLength(1);
    expect(summary.profiles[0].primaryClass).toBe(UNSPECIFIED_PRIMARY_HAZARD);
  });

  it('still separates two variants whose recognized classes genuinely differ', () => {
    const summary = buildDgSummary('9001', [
      entry({ variantKey: 'a', primaryClass: '3' }),
      entry({ variantKey: 'b', primaryClass: '8' }),
    ]);

    expect(summary.variantCount).toBe(2);
    expect(summary.profiles.map((profile) => profile.primaryClass)).toEqual(['3', '8']);
  });

  it('keeps a recognized class distinct from a withheld one', () => {
    const summary = buildDgSummary('9001', [
      entry({ variantKey: 'a', primaryClass: '3' }),
      entry({ variantKey: 'b', primaryClass: 'synthetic-unmapped-class-gamma-9001' }),
    ]);

    expect(summary.variantCount).toBe(2);
    expect(summary.profiles).toHaveLength(2);
    expect(summary.profiles.map((profile) => profile.primaryClass).sort()).toEqual([
      '3',
      UNSPECIFIED_PRIMARY_HAZARD,
    ]);
  });

  it('does not collapse variants that still differ in another public field', () => {
    const summary = buildDgSummary('9001', [
      entry({
        variantKey: 'a',
        primaryClass: 'synthetic-unmapped-class-alpha-9002',
        properShippingName: 'SYNTHETIC COLLAPSE SUBSTANCE',
      }),
      entry({
        variantKey: 'b',
        primaryClass: 'synthetic-unmapped-class-beta-9002',
        properShippingName: 'SYNTHETIC COLLAPSE SUBSTANCE, STABILIZED',
      }),
    ]);

    expect(summary.profiles).toHaveLength(2);
    for (const profile of summary.profiles) {
      expect(profile.primaryClass).toBe(UNSPECIFIED_PRIMARY_HAZARD);
    }
  });

  it('sorts on the public value, so ordering cannot depend on the withheld one', () => {
    // The synthetic value sorts after "8" as a raw string but the placeholder
    // sorts before it, so a summary ordered by the raw value would come back
    // in the other order.
    const forward = buildDgSummary('9001', [
      entry({ variantKey: 'a', primaryClass: 'synthetic-unmapped-class-delta-9001' }),
      entry({ variantKey: 'b', primaryClass: '8' }),
    ]);
    const reversed = buildDgSummary('9001', [
      entry({ variantKey: 'b', primaryClass: '8' }),
      entry({ variantKey: 'a', primaryClass: 'synthetic-unmapped-class-delta-9001' }),
    ]);

    expect(forward.profiles.map((profile) => profile.primaryClass)).toEqual([
      '8',
      UNSPECIFIED_PRIMARY_HAZARD,
    ]);
    expect(reversed.profiles.map((profile) => profile.primaryClass)).toEqual(
      forward.profiles.map((profile) => profile.primaryClass),
    );
  });
});

describe('buildDgSummary — the subsidiary boundary is unchanged', () => {
  it('still withholds an unresolved subsidiary payload alongside a withheld class', () => {
    const summary = buildDgSummary('9001', [
      entry({
        primaryClass: 'synthetic-unmapped-class-prose-9004',
        subsidiaryRisks: ['6.1', 'UNRESOLVED_SOURCE:synthetic-subsidiary-payload-9001'],
      }),
    ]);

    expect(summary.profiles[0].primaryClass).toBe(UNSPECIFIED_PRIMARY_HAZARD);
    expect(summary.profiles[0].subsidiaryRisks).toEqual(['6.1', UNSPECIFIED_SUBSIDIARY_HAZARD]);
  });
});
