import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { markSyntheticDatasetReady, seedClassRule, seedDgEntry } from './helpers/seed';

// Synthetic UN numbers, classes and proper shipping names for testing only.
// No authorized PSN text appears anywhere in this file — every name here is
// obviously invented and has no regulatory meaning.

let sequence = 9200;

function nextUnNumber(): string {
  sequence += 1;
  return String(sequence);
}

function nextClass(label: string): string {
  sequence += 1;
  return `TEST_${label}_${sequence}`;
}

function post(body: unknown): Promise<Response> {
  return exports.default.fetch('https://example.com/segregation/check-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface DgSummaryProfile {
  primaryClass: string;
  subsidiaryRisks: string[];
  properShippingName: string | null;
}

interface DgSummary {
  unNumber: string;
  variantCount: number;
  profiles: DgSummaryProfile[];
}

interface BatchBody {
  ok: boolean;
  input: { unNumbers: string[] };
  dgSummaries: DgSummary[];
}

/** Seeds one UN number with a level-0 self rule so the pair evaluation is uneventful. */
async function seedFiller(): Promise<string> {
  const un = nextUnNumber();
  const cls = nextClass('FILLER');
  await seedClassRule(env.DB, cls, cls, 0);
  await seedDgEntry(env.DB, {
    unNumber: un,
    variantKey: 'a',
    primaryClass: cls,
    properShippingName: `SYNTHETIC FILLER SUBSTANCE ${un}`,
  });
  return un;
}

describe('POST /segregation/check-batch — dgSummaries', () => {
  beforeAll(async () => {
    await markSyntheticDatasetReady(env.DB);
  });

  it('reports class, subsidiary risks and proper shipping name for a single-variant UN number', async () => {
    const un = nextUnNumber();
    const cls = nextClass('SINGLE');
    await seedClassRule(env.DB, cls, cls, 0);
    await seedDgEntry(env.DB, {
      unNumber: un,
      variantKey: 'a',
      primaryClass: cls,
      subsidiaryRisksJson: JSON.stringify(['6.1', '8']),
      properShippingName: 'SYNTHETIC SINGLE-VARIANT SUBSTANCE',
    });
    const other = await seedFiller();

    const response = await post({ unNumbers: [un, other] });
    expect(response.status).toBe(200);
    const body = (await response.json()) as BatchBody;

    const summary = body.dgSummaries.find((entry) => entry.unNumber === un);
    expect(summary).toEqual({
      unNumber: un,
      variantCount: 1,
      profiles: [
        {
          primaryClass: cls,
          subsidiaryRisks: ['6.1', '8'],
          properShippingName: 'SYNTHETIC SINGLE-VARIANT SUBSTANCE',
        },
      ],
    });
  });

  it('returns one summary per input UN number, in input order', async () => {
    const unNumbers: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      unNumbers.push(await seedFiller());
    }
    // Request them in an order that is neither sorted nor seeding order.
    const requested = [unNumbers[3], unNumbers[0], unNumbers[4], unNumbers[1], unNumbers[2]];

    const response = await post({ unNumbers: requested });
    expect(response.status).toBe(200);
    const body = (await response.json()) as BatchBody;

    expect(body.dgSummaries).toHaveLength(requested.length);
    expect(body.dgSummaries.map((entry) => entry.unNumber)).toEqual(requested);
    expect(body.dgSummaries.map((entry) => entry.unNumber)).toEqual(body.input.unNumbers);
    for (const summary of body.dgSummaries) {
      expect(summary.profiles.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps both profiles when two variants differ visibly', async () => {
    const un = nextUnNumber();
    const clsA = nextClass('VARA');
    const clsB = nextClass('VARB');
    await seedClassRule(env.DB, clsA, clsA, 0);
    await seedClassRule(env.DB, clsB, clsB, 0);
    await seedClassRule(env.DB, clsA, clsB, 0);
    await seedDgEntry(env.DB, {
      unNumber: un,
      variantKey: 'a',
      primaryClass: clsA,
      subsidiaryRisksJson: JSON.stringify(['6.1']),
      properShippingName: 'SYNTHETIC TWO-PROFILE SUBSTANCE',
    });
    await seedDgEntry(env.DB, {
      unNumber: un,
      variantKey: 'b',
      primaryClass: clsB,
      properShippingName: 'SYNTHETIC TWO-PROFILE SUBSTANCE, STABILIZED',
    });
    const other = await seedFiller();

    const response = await post({ unNumbers: [un, other] });
    expect(response.status).toBe(200);
    const body = (await response.json()) as BatchBody;

    const summary = body.dgSummaries.find((entry) => entry.unNumber === un)!;
    expect(summary.variantCount).toBe(2);
    expect(summary.profiles).toHaveLength(2);
    expect(summary.profiles.map((profile) => profile.properShippingName).sort()).toEqual([
      'SYNTHETIC TWO-PROFILE SUBSTANCE',
      'SYNTHETIC TWO-PROFILE SUBSTANCE, STABILIZED',
    ]);
  });

  it('collapses variants that differ only in fields the API does not expose', async () => {
    const un = nextUnNumber();
    const cls = nextClass('DEDUP');
    await seedClassRule(env.DB, cls, cls, 0);
    // Same class, same subsidiary risks, same name — the variants differ only
    // by variantKey and segregation codes/groups, none of which are exposed.
    await seedDgEntry(env.DB, {
      unNumber: un,
      variantKey: 'a',
      primaryClass: cls,
      segregationCodesJson: JSON.stringify([]),
      properShippingName: 'SYNTHETIC DEDUPLICATED SUBSTANCE',
    });
    await seedDgEntry(env.DB, {
      unNumber: un,
      variantKey: 'b',
      primaryClass: cls,
      segregationGroupsJson: JSON.stringify(['SGG9201']),
      compatibilityGroup: 'A',
      properShippingName: 'SYNTHETIC DEDUPLICATED SUBSTANCE',
    });
    const other = await seedFiller();

    const response = await post({ unNumbers: [un, other] });
    expect(response.status).toBe(200);
    const body = (await response.json()) as BatchBody;

    const summary = body.dgSummaries.find((entry) => entry.unNumber === un)!;
    // variantCount still reports the real dataset ambiguity, even though only
    // one profile is visible.
    expect(summary.variantCount).toBe(2);
    expect(summary.profiles).toHaveLength(1);
    expect(summary.profiles[0]).toEqual({
      primaryClass: cls,
      subsidiaryRisks: [],
      properShippingName: 'SYNTHETIC DEDUPLICATED SUBSTANCE',
    });
  });

  it('orders profiles deterministically by their public fields, not by row order', async () => {
    const un = nextUnNumber();
    const cls = nextClass('ORDER');
    await seedClassRule(env.DB, cls, cls, 0);
    // Seeded in deliberately non-alphabetical name order.
    for (const [variantKey, name] of [
      ['c', 'SYNTHETIC ORDERING SUBSTANCE C'],
      ['a', 'SYNTHETIC ORDERING SUBSTANCE A'],
      ['b', 'SYNTHETIC ORDERING SUBSTANCE B'],
    ] as const) {
      await seedDgEntry(env.DB, {
        unNumber: un,
        variantKey,
        primaryClass: cls,
        properShippingName: name,
      });
    }
    const other = await seedFiller();

    const first = (await (await post({ unNumbers: [un, other] })).json()) as BatchBody;
    const second = (await (await post({ unNumbers: [other, un] })).json()) as BatchBody;

    const names = (body: BatchBody): (string | null)[] =>
      body.dgSummaries.find((entry) => entry.unNumber === un)!.profiles.map((p) => p.properShippingName);

    expect(names(first)).toEqual([
      'SYNTHETIC ORDERING SUBSTANCE A',
      'SYNTHETIC ORDERING SUBSTANCE B',
      'SYNTHETIC ORDERING SUBSTANCE C',
    ]);
    // Stable across requests and independent of the UN number's position.
    expect(names(second)).toEqual(names(first));
  });

  it('sorts by class first, then subsidiary risks, then name', async () => {
    const un = nextUnNumber();
    const clsA = nextClass('AAA');
    const clsZ = `${clsA}_Z`;
    await seedClassRule(env.DB, clsA, clsA, 0);
    await seedClassRule(env.DB, clsZ, clsZ, 0);
    await seedClassRule(env.DB, clsA, clsZ, 0);
    await seedDgEntry(env.DB, {
      unNumber: un,
      variantKey: 'a',
      primaryClass: clsZ,
      properShippingName: 'SYNTHETIC AAA NAME',
    });
    await seedDgEntry(env.DB, {
      unNumber: un,
      variantKey: 'b',
      primaryClass: clsA,
      subsidiaryRisksJson: JSON.stringify(['8']),
      properShippingName: 'SYNTHETIC ZZZ NAME',
    });
    await seedDgEntry(env.DB, {
      unNumber: un,
      variantKey: 'c',
      primaryClass: clsA,
      subsidiaryRisksJson: JSON.stringify(['6.1']),
      properShippingName: 'SYNTHETIC MMM NAME',
    });
    const other = await seedFiller();

    const body = (await (await post({ unNumbers: [un, other] })).json()) as BatchBody;
    const summary = body.dgSummaries.find((entry) => entry.unNumber === un)!;

    expect(summary.profiles.map((p) => [p.primaryClass, p.subsidiaryRisks, p.properShippingName])).toEqual([
      [clsA, ['6.1'], 'SYNTHETIC MMM NAME'],
      [clsA, ['8'], 'SYNTHETIC ZZZ NAME'],
      [clsZ, [], 'SYNTHETIC AAA NAME'],
    ]);
  });

  it('exposes only unNumber, variantCount and the three public profile fields', async () => {
    const un = nextUnNumber();
    const cls = nextClass('PRIVACY');
    await seedClassRule(env.DB, cls, cls, 0);
    await seedDgEntry(env.DB, {
      unNumber: un,
      variantKey: 'PRIVATE_VARIANT_KEY',
      primaryClass: cls,
      subsidiaryRisksJson: JSON.stringify(['6.1']),
      segregationGroupsJson: JSON.stringify(['SGG9202']),
      segregationCodesJson: JSON.stringify(['SG9202']),
      compatibilityGroup: 'B',
      properShippingName: 'SYNTHETIC PRIVACY SUBSTANCE',
    });
    const other = await seedFiller();

    const response = await post({ unNumbers: [un, other] });
    const rawBody = await response.text();
    const body = JSON.parse(rawBody) as BatchBody;
    const summary = body.dgSummaries.find((entry) => entry.unNumber === un)!;

    expect(Object.keys(summary).sort()).toEqual(['profiles', 'unNumber', 'variantCount']);
    for (const profile of summary.profiles) {
      expect(Object.keys(profile).sort()).toEqual([
        'primaryClass',
        'properShippingName',
        'subsidiaryRisks',
      ]);
    }

    // Nothing internal reaches the wire anywhere in the response — not in the
    // summaries and not in the pair results either.
    expect(rawBody).not.toContain('variantKey');
    expect(rawBody).not.toContain('PRIVATE_VARIANT_KEY');
    expect(rawBody).not.toContain('segregationGroups');
    expect(rawBody).not.toContain('segregationCodes');
    expect(rawBody).not.toContain('compatibilityGroup');
    expect(rawBody).not.toContain('sourceText');
    expect(rawBody).not.toContain('SGG9202');
  });

  it('produces identical decisions for fixtures that differ only in proper shipping name', async () => {
    // Two structurally identical DG pairs. The only difference between them is
    // the shipping-name text, which is informational: it must not reach the
    // class matrix, the SG lookup, or the strongest-rule aggregation.
    const clsLeft = nextClass('NAMEA');
    const clsRight = nextClass('NAMEB');
    await seedClassRule(env.DB, clsLeft, clsLeft, 0);
    await seedClassRule(env.DB, clsRight, clsRight, 0);
    await seedClassRule(env.DB, clsLeft, clsRight, 3);

    async function seedPair(nameSuffix: string): Promise<[string, string]> {
      const left = nextUnNumber();
      const right = nextUnNumber();
      await seedDgEntry(env.DB, {
        unNumber: left,
        variantKey: 'a',
        primaryClass: clsLeft,
        properShippingName: `SYNTHETIC LEFT SUBSTANCE ${nameSuffix}`,
      });
      await seedDgEntry(env.DB, {
        unNumber: right,
        variantKey: 'a',
        primaryClass: clsRight,
        properShippingName: `SYNTHETIC RIGHT SUBSTANCE ${nameSuffix}`,
      });
      return [left, right];
    }

    const [leftOne, rightOne] = await seedPair('ONE');
    const [leftTwo, rightTwo] = await seedPair('TWO, N.O.S. (COMPLETELY DIFFERENT WORDING)');

    interface DecisionBody {
      pairs: Array<{ decision: { status: string; level: number | null; reason: string }; variantResolution: string }>;
    }

    const first = (await (await post({ unNumbers: [leftOne, rightOne] })).json()) as DecisionBody;
    const second = (await (await post({ unNumbers: [leftTwo, rightTwo] })).json()) as DecisionBody;

    expect(first.pairs[0].decision.status).toBe('SEGREGATION_REQUIRED');
    expect(first.pairs[0].decision.level).toBe(3);
    expect(second.pairs[0].decision).toEqual(first.pairs[0].decision);
    expect(second.pairs[0].variantResolution).toBe(first.pairs[0].variantResolution);
  });

  it('produces the same decision whether or not the proper shipping name is populated', async () => {
    // The staged-rollout case: an otherwise identical pair, one side seeded
    // the pre-0005 way (NULL name) and one the schema-v3 way.
    const clsLeft = nextClass('NULLA');
    const clsRight = nextClass('NULLB');
    await seedClassRule(env.DB, clsLeft, clsLeft, 0);
    await seedClassRule(env.DB, clsRight, clsRight, 0);
    await seedClassRule(env.DB, clsLeft, clsRight, 2);

    const namedLeft = nextUnNumber();
    const namedRight = nextUnNumber();
    await seedDgEntry(env.DB, {
      unNumber: namedLeft,
      variantKey: 'a',
      primaryClass: clsLeft,
      properShippingName: 'SYNTHETIC NAMED SUBSTANCE',
    });
    await seedDgEntry(env.DB, {
      unNumber: namedRight,
      variantKey: 'a',
      primaryClass: clsRight,
      properShippingName: 'SYNTHETIC NAMED COUNTERPART',
    });

    const namelessLeft = nextUnNumber();
    const namelessRight = nextUnNumber();
    await seedDgEntry(env.DB, { unNumber: namelessLeft, variantKey: 'a', primaryClass: clsLeft });
    await seedDgEntry(env.DB, { unNumber: namelessRight, variantKey: 'a', primaryClass: clsRight });

    interface DecisionBody {
      pairs: Array<{ decision: { status: string; level: number | null; reason: string } }>;
    }

    const named = (await (await post({ unNumbers: [namedLeft, namedRight] })).json()) as DecisionBody;
    const nameless = (await (await post({ unNumbers: [namelessLeft, namelessRight] })).json()) as DecisionBody;

    expect(named.pairs[0].decision.level).toBe(2);
    expect(nameless.pairs[0].decision).toEqual(named.pairs[0].decision);
  });

  it('reports a null proper shipping name for a pre-schema-v3 row instead of inventing one', async () => {
    const un = nextUnNumber();
    const cls = nextClass('LEGACY');
    await seedClassRule(env.DB, cls, cls, 0);
    // No properShippingName: exactly the shape of a row imported before
    // migration 0005 added the column.
    await seedDgEntry(env.DB, { unNumber: un, variantKey: 'a', primaryClass: cls });
    const other = await seedFiller();

    const response = await post({ unNumbers: [un, other] });
    expect(response.status).toBe(200);
    const rawBody = await response.text();
    const body = JSON.parse(rawBody) as BatchBody;

    const summary = body.dgSummaries.find((entry) => entry.unNumber === un)!;
    expect(summary.profiles).toHaveLength(1);
    expect(summary.profiles[0].properShippingName).toBeNull();
    for (const placeholder of ['Unknown', 'N/A', 'Not available', 'UNKNOWN']) {
      expect(rawBody).not.toContain(placeholder);
    }
  });
});
