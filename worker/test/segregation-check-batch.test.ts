import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { markSyntheticDatasetReady, seedClassRule, seedDgEntry, seedSgRule } from './helpers/seed';

// Synthetic UN numbers, classes and rules for testing only. These have no
// regulatory meaning and must never be seeded into a production migration.

let sequence = 9800;

function nextUnNumber(): string {
  sequence += 1;
  return String(sequence);
}

function nextClass(label: string): string {
  sequence += 1;
  return `TEST_${label}_${sequence}`;
}

function nextSgCode(): string {
  sequence += 1;
  return `SG${sequence}`;
}

function post(body: unknown): Promise<Response> {
  return exports.default.fetch('https://example.com/segregation/check-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postCheck(body: unknown): Promise<Response> {
  return exports.default.fetch('https://example.com/segregation/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postRawBody(rawBody: string): Promise<Response> {
  return exports.default.fetch('https://example.com/segregation/check-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  });
}

interface BatchPair {
  leftUnNumber: string;
  rightUnNumber: string;
  decision: { status: string; level: number | null; reason: string };
  variants: { left: number; right: number; evaluatedPairs: number };
  additionalRequirements: Array<{ code: string; source: string; requiresConfirmation: boolean }>;
  variantResolution: string;
}

interface BatchBody {
  ok: boolean;
  input: { unNumbers: string[] };
  summary: {
    inputCount: number;
    totalPairs: number;
    segregationRequiredPairs: number;
    reviewRequiredPairs: number;
    noSegregationLevelPairs: number;
    additionalRequirementPairs: number;
    maxRequiredLevel: number | null;
  };
  pairs: BatchPair[];
}

/** Seeds `count` distinct UN numbers sharing one class with a level-0 self rule. */
async function seedUniformUnNumbers(count: number): Promise<string[]> {
  const cls = nextClass('UNIFORM');
  await seedClassRule(env.DB, cls, cls, 0);

  const unNumbers: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const un = nextUnNumber();
    await seedDgEntry(env.DB, { unNumber: un, variantKey: 'a', primaryClass: cls });
    unNumbers.push(un);
  }
  return unNumbers;
}

function expectedPairOrder(unNumbers: readonly string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < unNumbers.length; i += 1) {
    for (let j = i + 1; j < unNumbers.length; j += 1) {
      pairs.push([unNumbers[i], unNumbers[j]]);
    }
  }
  return pairs;
}

describe('POST /segregation/check-batch', () => {
  beforeAll(async () => {
    await markSyntheticDatasetReady(env.DB);
  });

  describe('request validation', () => {
    it('accepts 2 UN numbers', async () => {
      const unNumbers = await seedUniformUnNumbers(2);
      const response = await post({ unNumbers });
      expect(response.status).toBe(200);
    });

    it('accepts 10 UN numbers', async () => {
      const unNumbers = await seedUniformUnNumbers(10);
      const response = await post({ unNumbers });
      expect(response.status).toBe(200);
      const body = (await response.json()) as BatchBody;
      expect(body.summary.totalPairs).toBe(45);
    });

    it('rejects a single UN number', async () => {
      const response = await post({ unNumbers: [nextUnNumber()] });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects 11 UN numbers', async () => {
      const unNumbers = Array.from({ length: 11 }, () => nextUnNumber());
      const response = await post({ unNumbers });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects malformed JSON', async () => {
      const response = await postRawBody('{not valid json');
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects a missing unNumbers field', async () => {
      const response = await post({});
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects a non-array unNumbers field', async () => {
      const response = await post({ unNumbers: 'not-an-array' });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects a non-string item', async () => {
      const response = await post({ unNumbers: [1002, nextUnNumber()] });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects an invalid UN number format', async () => {
      const response = await post({ unNumbers: ['not-a-un-number', nextUnNumber()] });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects exact duplicate UN numbers', async () => {
      const un = nextUnNumber();
      const response = await post({ unNumbers: [un, un] });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string; unNumbers: string[] } };
      expect(body.error.code).toBe('DUPLICATE_UN_NUMBER');
      expect(body.error.unNumbers).toEqual([un]);
    });

    it('rejects duplicates that only match after normalization', async () => {
      const response = await post({ unNumbers: ['4', '0004', nextUnNumber()] });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string; unNumbers: string[] } };
      expect(body.error.code).toBe('DUPLICATE_UN_NUMBER');
      expect(body.error.unNumbers).toEqual(['0004']);
    });

    it('normalizes a UN-prefixed input', async () => {
      const unNumbers = await seedUniformUnNumbers(2);
      const response = await post({ unNumbers: [`UN${unNumbers[0]}`, unNumbers[1]] });
      expect(response.status).toBe(200);
      const body = (await response.json()) as BatchBody;
      expect(body.input.unNumbers).toEqual(unNumbers);
    });

    it('returns 405 for GET', async () => {
      const response = await exports.default.fetch('https://example.com/segregation/check-batch');

      expect(response.status).toBe(405);
      const body = (await response.json()) as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
    });
  });

  describe('pair generation', () => {
    it.each([
      [2, 1],
      [3, 3],
      [4, 6],
      [5, 10],
      [10, 45],
    ])('produces the %i-choose-2 pair count for %i inputs', async (count, expectedPairCount) => {
      const unNumbers = await seedUniformUnNumbers(count);
      const response = await post({ unNumbers });

      expect(response.status).toBe(200);
      const body = (await response.json()) as BatchBody;

      expect(body.summary.totalPairs).toBe(expectedPairCount);
      expect(body.pairs).toHaveLength(expectedPairCount);
      expect(body.pairs.map((pair) => [pair.leftUnNumber, pair.rightUnNumber])).toEqual(
        expectedPairOrder(unNumbers),
      );

      const seenKeys = new Set<string>();
      for (const pair of body.pairs) {
        expect(pair.leftUnNumber).not.toBe(pair.rightUnNumber);
        const key = [pair.leftUnNumber, pair.rightUnNumber].sort().join('|');
        expect(seenKeys.has(key)).toBe(false);
        seenKeys.add(key);
      }
    });
  });

  describe('result parity with /segregation/check', () => {
    async function assertParity(left: string, right: string): Promise<void> {
      const checkResponse = await postCheck({ leftUnNumber: left, rightUnNumber: right });
      expect(checkResponse.status).toBe(200);
      const checkBody = (await checkResponse.json()) as {
        decision: unknown;
        variants: unknown;
        additionalRequirements: unknown;
        variantResolution: unknown;
      };

      const batchResponse = await post({ unNumbers: [left, right] });
      expect(batchResponse.status).toBe(200);
      const batchBody = (await batchResponse.json()) as BatchBody;
      const [pair] = batchBody.pairs;

      expect(pair.decision).toEqual(checkBody.decision);
      expect(pair.variants).toEqual(checkBody.variants);
      expect(pair.additionalRequirements).toEqual(checkBody.additionalRequirements);
      expect(pair.variantResolution).toEqual(checkBody.variantResolution);
    }

    it('matches for CLEAR', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const cls = nextClass('A');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: cls });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: cls });
      await seedClassRule(env.DB, cls, cls, 0);

      await assertParity(left, right);
    });

    it('matches for SEGREGATION_REQUIRED', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      const classB = nextClass('B');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classB });
      await seedClassRule(env.DB, classA, classB, 3);

      await assertParity(left, right);
    });

    it('matches for REVIEW_REQUIRED', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: nextClass('A') });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: nextClass('B') });

      await assertParity(left, right);
    });

    it('matches when an additional requirement is present', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const cls = nextClass('A');
      const sgCode = nextSgCode();
      await seedSgRule(env.DB, { code: sgCode, ruleType: 'ADDITIONAL_REQUIREMENT' });
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: cls });
      await seedDgEntry(env.DB, {
        unNumber: right,
        variantKey: 'a',
        primaryClass: cls,
        segregationCodesJson: JSON.stringify([sgCode]),
      });
      await seedClassRule(env.DB, cls, cls, 0);

      await assertParity(left, right);
    });

    it('matches for the strictest of multiple variants', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      const classB = nextClass('B');
      const classC = nextClass('C');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'b', primaryClass: classC });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classB });
      await seedClassRule(env.DB, classA, classB, 0);
      await seedClassRule(env.DB, classB, classC, 2);

      await assertParity(left, right);
    });
  });

  describe('summary', () => {
    it('computes exact counts across a mixed batch', async () => {
      const a = nextUnNumber();
      const b = nextUnNumber();
      const c = nextUnNumber();
      const d = nextUnNumber();
      const classA = nextClass('A');
      const classB = nextClass('B');
      const classC = nextClass('C');
      const classD = nextClass('D');
      const sgCode = nextSgCode();

      await seedSgRule(env.DB, { code: sgCode, ruleType: 'ADDITIONAL_REQUIREMENT' });
      await seedDgEntry(env.DB, { unNumber: a, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: b, variantKey: 'a', primaryClass: classB });
      await seedDgEntry(env.DB, { unNumber: c, variantKey: 'a', primaryClass: classC });
      await seedDgEntry(env.DB, {
        unNumber: d,
        variantKey: 'a',
        primaryClass: classD,
        segregationCodesJson: JSON.stringify([sgCode]),
      });

      // A<->B and A<->C both require segregation (levels 2 and 4); A<->D is
      // left unseeded on purpose to force REVIEW_REQUIRED; B<->C, B<->D and
      // C<->D are all CLEAR. D additionally carries an SG additional
      // requirement that applies to every pair D appears in, regardless of
      // that pair's decision — demonstrating a CLEAR pair (B<->D, C<->D) and
      // a REVIEW_REQUIRED pair (A<->D) both carrying additionalRequirements.
      await seedClassRule(env.DB, classA, classB, 2);
      await seedClassRule(env.DB, classA, classC, 4);
      await seedClassRule(env.DB, classB, classC, 0);
      await seedClassRule(env.DB, classB, classD, 0);
      await seedClassRule(env.DB, classC, classD, 0);

      const response = await post({ unNumbers: [a, b, c, d] });
      expect(response.status).toBe(200);
      const body = (await response.json()) as BatchBody;

      expect(body.summary).toEqual({
        inputCount: 4,
        totalPairs: 6,
        segregationRequiredPairs: 2,
        reviewRequiredPairs: 1,
        noSegregationLevelPairs: 3,
        additionalRequirementPairs: 3,
        maxRequiredLevel: 4,
      });

      const byPairKey = new Map(body.pairs.map((pair) => [`${pair.leftUnNumber}|${pair.rightUnNumber}`, pair]));
      expect(byPairKey.get(`${a}|${d}`)?.decision.status).toBe('REVIEW_REQUIRED');
      expect(byPairKey.get(`${a}|${d}`)?.additionalRequirements).toEqual([
        { code: sgCode, source: 'SG', requiresConfirmation: true },
      ]);
      expect(byPairKey.get(`${b}|${d}`)?.decision.status).toBe('CLEAR');
      expect(byPairKey.get(`${b}|${d}`)?.additionalRequirements).toEqual([
        { code: sgCode, source: 'SG', requiresConfirmation: true },
      ]);
    });

    it('reports maxRequiredLevel as null when no pair requires segregation', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const third = nextUnNumber();
      const cls = nextClass('A');
      const otherCls = nextClass('B');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: cls });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: cls });
      await seedDgEntry(env.DB, { unNumber: third, variantKey: 'a', primaryClass: otherCls });
      await seedClassRule(env.DB, cls, cls, 0);
      // cls <-> otherCls is left unseeded: forces REVIEW_REQUIRED, never
      // SEGREGATION_REQUIRED, so maxRequiredLevel must stay null rather than
      // fall back to 0.

      const response = await post({ unNumbers: [left, right, third] });
      expect(response.status).toBe(200);
      const body = (await response.json()) as BatchBody;

      expect(body.summary.segregationRequiredPairs).toBe(0);
      expect(body.summary.maxRequiredLevel).toBeNull();
    });
  });

  describe('missing DG entries', () => {
    it('returns all missing canonical UN numbers in request order and no pairs', async () => {
      const a = nextUnNumber();
      const missing1 = nextUnNumber();
      const b = nextUnNumber();
      const missing2 = nextUnNumber();
      const cls = nextClass('A');
      await seedDgEntry(env.DB, { unNumber: a, variantKey: 'a', primaryClass: cls });
      await seedDgEntry(env.DB, { unNumber: b, variantKey: 'a', primaryClass: cls });
      await seedClassRule(env.DB, cls, cls, 0);

      const response = await post({ unNumbers: [a, missing1, b, missing2] });

      expect(response.status).toBe(404);
      const body = (await response.json()) as {
        ok: boolean;
        error: { code: string; unNumbers: string[] };
        pairs?: unknown;
      };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('DG_NOT_FOUND');
      expect(body.error.unNumbers).toEqual([missing1, missing2]);
      expect(body.pairs).toBeUndefined();
    });
  });
});
