import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { markSyntheticDatasetReady, seedClassRule, seedDgEntry, seedSgRule } from './helpers/seed';

// The converter preserves a source value it cannot resolve mechanically as an
// UNRESOLVED_* token that carries the raw cell text inline, so the engine
// fails closed instead of dropping it. Those tokens are private: they are
// authorized workbook content, and the mobile client renders both
// `decision.reason` and `dgSummaries[].profiles[].subsidiaryRisks` verbatim.
//
// These tests inject source-shaped unresolved values through every stored
// field that can carry one and assert the *complete serialized response* of
// both public endpoints contains neither the marker nor the injected text.
// Asserting on the whole body — not on individual fields — is deliberate: a
// future field that starts echoing a stored value fails here rather than
// shipping a leak.
//
// Every injected value below is unmistakably synthetic. No authorized source
// wording appears in this file.

let sequence = 9700;

function nextUnNumber(): string {
  sequence += 1;
  return String(sequence);
}

/**
 * Every hazard class this file stores, recorded as it is issued so
 * `assertNoLeak` can assert that no response echoes any of them. These stand
 * in for an unmapped source class: `parsePrimaryClass` keeps such a cell as
 * the stored primary class, which is the vector Astra found published through
 * `dgSummaries[].profiles[].primaryClass`.
 */
const storedHazardClasses: string[] = [];

function nextClass(label: string): string {
  sequence += 1;
  const hazardClass = `TEST_${label}_${sequence}`;
  storedHazardClasses.push(hazardClass);
  return hazardClass;
}

function nextSgCode(): string {
  sequence += 1;
  return `SG${sequence}`;
}

/** Synthetic stand-in for a private source cell the converter could not resolve. */
const SYNTHETIC_SOURCE_TEXT = 'synthetic-private-source-wording-9700';
const UNRESOLVED_MARKER = 'UNRESOLVED_SOURCE';
const UNRESOLVED_VALUE = `${UNRESOLVED_MARKER}:${SYNTHETIC_SOURCE_TEXT}`;

/**
 * Public stand-in for a primary hazard class outside the authorized
 * vocabulary. Asserted as a literal rather than imported, so a rename of the
 * exported constant shows up here as the API contract change it would be.
 */
const UNSPECIFIED_PRIMARY_HAZARD = 'UNSPECIFIED_PRIMARY_HAZARD';

/**
 * Synthetic stand-ins for an unmapped "Class or division" cell.
 *
 * `parsePrimaryClass` keeps such a cell as the stored primary class so the
 * pair fails closed on a missing class rule, which makes the stored value
 * private source content — the same category as the unresolved tokens above.
 */
const UNMAPPED_PRIMARY_CLASS = 'synthetic-unmapped-class-payload-9700';
const OTHER_UNMAPPED_PRIMARY_CLASS = 'synthetic-unmapped-class-payload-9701';

function checkSingle(leftUnNumber: string, rightUnNumber: string): Promise<Response> {
  return exports.default.fetch('https://example.com/segregation/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ leftUnNumber, rightUnNumber }),
  });
}

function checkBatch(unNumbers: string[]): Promise<Response> {
  return exports.default.fetch('https://example.com/segregation/check-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unNumbers }),
  });
}

interface DecisionBody {
  decision: { status: string; level: number | null; reason: string };
}

interface BatchBody {
  pairs: Array<{ decision: { status: string; level: number | null; reason: string } }>;
}

/**
 * Asserts the raw response text carries no private source content, then
 * returns the parsed body. Reads the body as text first so the assertion
 * covers every field, including ones this test does not model.
 */
async function assertNoLeak(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  const serialized = await response.text();

  expect(serialized).not.toContain(UNRESOLVED_MARKER);
  expect(serialized).not.toContain(SYNTHETIC_SOURCE_TEXT);
  // The whole `UNRESOLVED_` family, not just this one token.
  expect(serialized).not.toContain('UNRESOLVED_');

  // Internal blocker markers embed a source-derived SG code or class label,
  // and the list itself is internal to PairEvaluation.
  expect(serialized).not.toContain('UNKNOWN_SG_CODE');
  expect(serialized).not.toContain('MISSING_CLASS_RULE');
  expect(serialized).not.toContain('reviewBlockers');

  // No stored hazard class may be echoed anywhere in any response.
  for (const hazardClass of storedHazardClasses) {
    expect(serialized).not.toContain(hazardClass);
  }

  expect(serialized).not.toContain(UNMAPPED_PRIMARY_CLASS);
  expect(serialized).not.toContain(OTHER_UNMAPPED_PRIMARY_CLASS);
  // The shared prefix of both, so a partial echo cannot slip through.
  expect(serialized).not.toContain('synthetic-unmapped-class');

  return serialized;
}

describe('public API never surfaces unresolved private source text', () => {
  beforeAll(async () => {
    await markSyntheticDatasetReady(env.DB);
  });

  it('withholds an unresolved segregation-code source value from both endpoints', async () => {
    // The vector Astra reproduced: an unresolvable "Segregation" cell is
    // stored as a segregation code, so the engine reports it as an unknown SG
    // code — and the blocker embedded the raw source value.
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');

    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      properShippingName: 'SYNTHETIC LEAKAGE PROBE LEFT',
      segregationCodesJson: JSON.stringify([UNRESOLVED_VALUE]),
    });
    await seedDgEntry(env.DB, {
      unNumber: right,
      variantKey: 'a',
      primaryClass: classA,
      properShippingName: 'SYNTHETIC LEAKAGE PROBE RIGHT',
    });

    const single = await checkSingle(left, right);
    const singleBody = JSON.parse(await assertNoLeak(single)) as DecisionBody;
    // Still fail-closed: withholding the detail must not soften the decision.
    expect(singleBody.decision.status).toBe('REVIEW_REQUIRED');
    expect(singleBody.decision.level).toBeNull();

    const batch = await checkBatch([left, right]);
    const batchBody = JSON.parse(await assertNoLeak(batch)) as BatchBody;
    expect(batchBody.pairs).toHaveLength(1);
    expect(batchBody.pairs[0].decision.status).toBe('REVIEW_REQUIRED');
    expect(batchBody.pairs[0].decision.level).toBeNull();
  });

  it('withholds an unresolved subsidiary-hazard source value from both endpoints', async () => {
    // `dgSummaries` publishes `subsidiaryRisks`, so this vector leaks through
    // the batch response body rather than through `decision.reason`.
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');

    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      properShippingName: 'SYNTHETIC SUBSIDIARY PROBE LEFT',
      subsidiaryRisksJson: JSON.stringify([UNRESOLVED_VALUE]),
    });
    await seedDgEntry(env.DB, {
      unNumber: right,
      variantKey: 'a',
      primaryClass: classA,
      properShippingName: 'SYNTHETIC SUBSIDIARY PROBE RIGHT',
    });

    const singleBody = JSON.parse(await assertNoLeak(await checkSingle(left, right))) as DecisionBody;
    expect(singleBody.decision.status).toBe('REVIEW_REQUIRED');

    const serialized = await assertNoLeak(await checkBatch([left, right]));
    const batchBody = JSON.parse(serialized) as BatchBody & {
      dgSummaries: Array<{ unNumber: string; profiles: Array<{ subsidiaryRisks: string[] }> }>;
    };
    expect(batchBody.pairs[0].decision.status).toBe('REVIEW_REQUIRED');

    // The hazard is still reported — only its private payload is withheld.
    const summary = batchBody.dgSummaries.find((entry) => entry.unNumber === left);
    expect(summary?.profiles[0].subsidiaryRisks).toEqual(['UNSPECIFIED_SUBSIDIARY_HAZARD']);
  });

  it('withholds an unmapped primary-class source value from both endpoints', async () => {
    // `dgSummaries` publishes `primaryClass`, and `parsePrimaryClass` stores an
    // unmapped "Class or division" cell as-is so the pair fails closed on a
    // missing class rule. No class rule is seeded for this pair, which is
    // exactly that production condition rather than a contrived one.
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classB = nextClass('B');

    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: UNMAPPED_PRIMARY_CLASS,
      properShippingName: 'SYNTHETIC PRIMARY CLASS PROBE LEFT',
    });
    await seedDgEntry(env.DB, {
      unNumber: right,
      variantKey: 'a',
      primaryClass: classB,
      properShippingName: 'SYNTHETIC PRIMARY CLASS PROBE RIGHT',
    });

    // The single endpoint exposes no dgSummaries today, but its whole body is
    // scanned anyway so a future field that starts echoing the stored class
    // fails here rather than shipping.
    const singleBody = JSON.parse(await assertNoLeak(await checkSingle(left, right))) as DecisionBody;
    expect(singleBody.decision.status).toBe('REVIEW_REQUIRED');
    expect(singleBody.decision.level).toBeNull();

    const serialized = await assertNoLeak(await checkBatch([left, right]));
    const batchBody = JSON.parse(serialized) as BatchBody & {
      dgSummaries: Array<{ unNumber: string; variantCount: number; profiles: Array<{ primaryClass: string }> }>;
    };
    expect(batchBody.pairs[0].decision.status).toBe('REVIEW_REQUIRED');
    expect(batchBody.pairs[0].decision.level).toBeNull();

    // The class being unusable is still reported — only the payload is withheld.
    const summary = batchBody.dgSummaries.find((entry) => entry.unNumber === left);
    expect(summary?.profiles).toHaveLength(1);
    expect(summary?.profiles[0].primaryClass).toBe(UNSPECIFIED_PRIMARY_HAZARD);
  });

  it('collapses variants whose only visible difference is a withheld primary class', async () => {
    // Two withheld payloads must not present as two profiles: a client would
    // see ambiguity it has no way to resolve, and the profile count would
    // itself disclose that the payloads differ.
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classB = nextClass('B');

    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: UNMAPPED_PRIMARY_CLASS,
      subsidiaryRisksJson: JSON.stringify(['6.1']),
      properShippingName: 'SYNTHETIC COLLAPSE PROBE SUBSTANCE',
    });
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'b',
      primaryClass: OTHER_UNMAPPED_PRIMARY_CLASS,
      subsidiaryRisksJson: JSON.stringify(['6.1']),
      properShippingName: 'SYNTHETIC COLLAPSE PROBE SUBSTANCE',
    });
    await seedDgEntry(env.DB, {
      unNumber: right,
      variantKey: 'a',
      primaryClass: classB,
      properShippingName: 'SYNTHETIC COLLAPSE PROBE COUNTERPART',
    });

    const serialized = await assertNoLeak(await checkBatch([left, right]));
    const batchBody = JSON.parse(serialized) as BatchBody & {
      dgSummaries: Array<{
        unNumber: string;
        variantCount: number;
        profiles: Array<{ primaryClass: string; subsidiaryRisks: string[]; properShippingName: string | null }>;
      }>;
    };

    const summary = batchBody.dgSummaries.find((entry) => entry.unNumber === left);
    // The real dataset ambiguity is still reported truthfully...
    expect(summary?.variantCount).toBe(2);
    // ...while the client sees the one profile it can actually distinguish.
    expect(summary?.profiles).toEqual([
      {
        primaryClass: UNSPECIFIED_PRIMARY_HAZARD,
        subsidiaryRisks: ['6.1'],
        properShippingName: 'SYNTHETIC COLLAPSE PROBE SUBSTANCE',
      },
    ]);
    expect(batchBody.pairs[0].decision.status).toBe('REVIEW_REQUIRED');
  });

  it('still publishes a recognized primary class and division verbatim', async () => {
    // The redaction is an allowlist, so this is the regression that proves it
    // withholds only what it must: an authorized class stays visible, and a
    // resolvable pair still returns a numeric level rather than a review.
    const left = nextUnNumber();
    const right = nextUnNumber();

    // Both axes the engine consults for this pair: primary-to-primary, and the
    // left subsidiary against the right primary.
    await seedClassRule(env.DB, '3', '1.4', 2);
    await seedClassRule(env.DB, '6.1', '1.4', 1);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: '3',
      subsidiaryRisksJson: JSON.stringify(['6.1']),
      properShippingName: 'SYNTHETIC RECOGNIZED CLASS SUBSTANCE',
    });
    await seedDgEntry(env.DB, {
      unNumber: right,
      variantKey: 'a',
      primaryClass: '1.4',
      properShippingName: 'SYNTHETIC RECOGNIZED DIVISION SUBSTANCE',
    });

    const serialized = await assertNoLeak(await checkBatch([left, right]));
    const batchBody = JSON.parse(serialized) as BatchBody & {
      dgSummaries: Array<{ unNumber: string; profiles: Array<{ primaryClass: string; subsidiaryRisks: string[] }> }>;
    };

    // Authorized data still resolves to a level; nothing here fails closed.
    expect(batchBody.pairs[0].decision.status).toBe('SEGREGATION_REQUIRED');
    expect(batchBody.pairs[0].decision.level).toBe(2);

    const byUnNumber = new Map(batchBody.dgSummaries.map((entry) => [entry.unNumber, entry]));
    expect(byUnNumber.get(left)?.profiles[0].primaryClass).toBe('3');
    expect(byUnNumber.get(left)?.profiles[0].subsidiaryRisks).toEqual(['6.1']);
    // A Class 1 division, not the collapsed matrix label it is looked up under.
    expect(byUnNumber.get(right)?.profiles[0].primaryClass).toBe('1.4');
    expect(serialized).not.toContain(UNSPECIFIED_PRIMARY_HAZARD);
  });

  it('withholds an unresolved source value carried by a REVIEW_ONLY SG code', async () => {
    // A stored SG rule resolves, so the blocker names the code rather than the
    // source — but the code itself is source-derived, and `sourceText` holds
    // the regulatory prose. Neither may reach the response.
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');
    const code = nextSgCode();

    await seedSgRule(env.DB, {
      code,
      ruleType: 'REVIEW_ONLY',
      sourceText: `synthetic prose ${SYNTHETIC_SOURCE_TEXT}`,
    });
    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      properShippingName: 'SYNTHETIC REVIEW ONLY PROBE LEFT',
      segregationCodesJson: JSON.stringify([code]),
    });
    await seedDgEntry(env.DB, {
      unNumber: right,
      variantKey: 'a',
      primaryClass: classA,
      properShippingName: 'SYNTHETIC REVIEW ONLY PROBE RIGHT',
    });

    const singleBody = JSON.parse(await assertNoLeak(await checkSingle(left, right))) as DecisionBody;
    expect(singleBody.decision.status).toBe('REVIEW_REQUIRED');

    const batchBody = JSON.parse(await assertNoLeak(await checkBatch([left, right]))) as BatchBody;
    expect(batchBody.pairs[0].decision.status).toBe('REVIEW_REQUIRED');
  });

  it('does not leak a raw blocker suffix through multi-variant aggregation', async () => {
    // Aggregation unions the blockers of every reviewing variant pair, so a
    // payload could re-enter the public reason on this path even if the
    // single-pair path is clean.
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');
    const classB = nextClass('B');

    await seedClassRule(env.DB, classA, classA, 0);
    await seedClassRule(env.DB, classA, classB, 2);
    await seedClassRule(env.DB, classB, classB, 0);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      properShippingName: 'SYNTHETIC AGGREGATION PROBE V1',
      segregationCodesJson: JSON.stringify([UNRESOLVED_VALUE]),
    });
    // A second variant that resolves cleanly, so the pairs disagree and the
    // aggregate is built from a union rather than a single evaluation.
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'b',
      primaryClass: classB,
      properShippingName: 'SYNTHETIC AGGREGATION PROBE V2',
    });
    await seedDgEntry(env.DB, {
      unNumber: right,
      variantKey: 'a',
      primaryClass: classA,
      properShippingName: 'SYNTHETIC AGGREGATION PROBE RIGHT',
    });

    const singleBody = JSON.parse(await assertNoLeak(await checkSingle(left, right))) as DecisionBody & {
      variants: { evaluatedPairs: number };
    };
    expect(singleBody.variants.evaluatedPairs).toBe(2);
    expect(singleBody.decision.status).toBe('REVIEW_REQUIRED');

    const batchBody = JSON.parse(await assertNoLeak(await checkBatch([left, right]))) as BatchBody;
    expect(batchBody.pairs[0].decision.status).toBe('REVIEW_REQUIRED');
  });

  it('returns the same stable generic reason for every REVIEW_REQUIRED cause', async () => {
    // A per-cause reason would itself be a side channel: it would tell a
    // caller which private source condition fired.
    const classA = nextClass('A');
    await seedClassRule(env.DB, classA, classA, 0);

    const reasons = new Set<string>();
    for (const codesJson of [
      JSON.stringify([UNRESOLVED_VALUE]),
      JSON.stringify([nextSgCode()]),
    ]) {
      const left = nextUnNumber();
      const right = nextUnNumber();
      await seedDgEntry(env.DB, {
        unNumber: left,
        variantKey: 'a',
        primaryClass: classA,
        properShippingName: 'SYNTHETIC REASON PROBE LEFT',
        segregationCodesJson: codesJson,
      });
      await seedDgEntry(env.DB, {
        unNumber: right,
        variantKey: 'a',
        primaryClass: classA,
        properShippingName: 'SYNTHETIC REASON PROBE RIGHT',
      });

      const body = JSON.parse(await assertNoLeak(await checkSingle(left, right))) as DecisionBody;
      expect(body.decision.status).toBe('REVIEW_REQUIRED');
      reasons.add(body.decision.reason);
    }

    expect([...reasons]).toEqual([
      'Manual review required due to unresolved or unsupported segregation conditions.',
    ]);
  });
});
