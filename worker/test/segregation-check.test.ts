import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { markSyntheticDatasetReady, seedClassRule, seedDgEntry } from './helpers/seed';

// Synthetic UN numbers, classes and rules for testing only. These have no
// regulatory meaning and must never be seeded into a production migration.
//
// Each test allocates its own UN numbers and class names via `nextUnNumber`
// / `nextClass` so that rows inserted by one test can never collide (via a
// UNIQUE constraint) with rows inserted by another test in this file,
// regardless of whether the underlying D1 storage is reset between tests.

let sequence = 9000;

function nextUnNumber(): string {
  sequence += 1;
  return String(sequence);
}

function nextClass(label: string): string {
  sequence += 1;
  return `TEST_${label}_${sequence}`;
}

function post(body: unknown): Promise<Response> {
  return exports.default.fetch('https://example.com/segregation/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postRawBody(rawBody: string): Promise<Response> {
  return exports.default.fetch('https://example.com/segregation/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  });
}

describe('POST /segregation/check', () => {
  // All tests in this file exercise normal, ready-dataset behavior — the
  // dedicated DATASET_NOT_READY gate tests live in
  // segregation-check-dataset-not-ready.test.ts, which needs an isolated,
  // never-marked-ready D1 instance.
  beforeAll(async () => {
    await markSyntheticDatasetReady(env.DB);
  });

  describe('request handling', () => {
    it('normalizes prefixed and unprefixed UN input and returns 200', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });
      await seedClassRule(env.DB, classA, classA, 0);

      const response = await post({ leftUnNumber: `UN ${left}`, rightUnNumber: right });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean; input: { leftUnNumber: string; rightUnNumber: string } };
      expect(body.ok).toBe(true);
      expect(body.input).toEqual({ leftUnNumber: left, rightUnNumber: right });
    });

    it('returns 400 for malformed JSON', async () => {
      const response = await postRawBody('{not valid json');

      expect(response.status).toBe(400);
      const body = (await response.json()) as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when a required field is missing', async () => {
      const response = await post({ leftUnNumber: nextUnNumber() });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { ok: boolean; error: { code: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when a field is not a string', async () => {
      const response = await post({ leftUnNumber: 9001, rightUnNumber: nextUnNumber() });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { ok: boolean; error: { code: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 for an invalid UN number format', async () => {
      const response = await post({ leftUnNumber: 'not-a-un-number', rightUnNumber: nextUnNumber() });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { ok: boolean; error: { code: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 405 for GET', async () => {
      const response = await exports.default.fetch('https://example.com/segregation/check');

      expect(response.status).toBe(405);
      const body = (await response.json()) as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
    });
  });

  describe('DG lookup', () => {
    it('returns 404 when the left DG is missing', async () => {
      const missingLeft = nextUnNumber();
      const right = nextUnNumber();
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: nextClass('A') });

      const response = await post({ leftUnNumber: missingLeft, rightUnNumber: right });

      expect(response.status).toBe(404);
      const body = (await response.json()) as { ok: boolean; error: { code: string; unNumbers: string[] } };
      expect(body.error.code).toBe('DG_NOT_FOUND');
      expect(body.error.unNumbers).toEqual([missingLeft]);
    });

    it('returns 404 when the right DG is missing', async () => {
      const left = nextUnNumber();
      const missingRight = nextUnNumber();
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: nextClass('A') });

      const response = await post({ leftUnNumber: left, rightUnNumber: missingRight });

      expect(response.status).toBe(404);
      const body = (await response.json()) as { ok: boolean; error: { code: string; unNumbers: string[] } };
      expect(body.error.code).toBe('DG_NOT_FOUND');
      expect(body.error.unNumbers).toEqual([missingRight]);
    });

    it('returns 404 with both UN numbers when both DGs are missing', async () => {
      const missingLeft = nextUnNumber();
      const missingRight = nextUnNumber();

      const response = await post({ leftUnNumber: missingLeft, rightUnNumber: missingRight });

      expect(response.status).toBe(404);
      const body = (await response.json()) as { ok: boolean; error: { code: string; unNumbers: string[] } };
      expect(body.error.code).toBe('DG_NOT_FOUND');
      expect(body.error.unNumbers).toEqual([missingLeft, missingRight]);
    });

    it('loads every variant for a UN number', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'b', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'c', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });
      await seedClassRule(env.DB, classA, classA, 0);

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { variants: { left: number; right: number; evaluatedPairs: number } };
      expect(body.variants).toEqual({ left: 3, right: 1, evaluatedPairs: 3 });
    });
  });

  describe('decisions', () => {
    it('returns CLEAR for a synthetic level-0 rule', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });
      await seedClassRule(env.DB, classA, classA, 0);

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: { status: string; level: number | null } };
      expect(body.decision.status).toBe('CLEAR');
      expect(body.decision.level).toBe(0);
    });

    it('returns SEGREGATION_REQUIRED for a synthetic level 1-4 rule', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      const classB = nextClass('B');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classB });
      await seedClassRule(env.DB, classA, classB, 3);

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: { status: string; level: number | null } };
      expect(body.decision.status).toBe('SEGREGATION_REQUIRED');
      expect(body.decision.level).toBe(3);
    });

    it('returns REVIEW_REQUIRED when no class rule exists for the pair', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: nextClass('A') });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: nextClass('B') });

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: { status: string; level: number | null } };
      expect(body.decision.status).toBe('REVIEW_REQUIRED');
      expect(body.decision.level).toBeNull();
    });

    it('returns REVIEW_REQUIRED when an entry has a subsidiary risk', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      await seedDgEntry(env.DB, {
        unNumber: left,
        variantKey: 'a',
        primaryClass: classA,
        subsidiaryRisksJson: '["TEST_SUB"]',
      });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });
      await seedClassRule(env.DB, classA, classA, 0);

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: { status: string; level: number | null } };
      expect(body.decision.status).toBe('REVIEW_REQUIRED');
      expect(body.decision.level).toBeNull();
    });

    it('returns REVIEW_REQUIRED when an entry has a segregation code', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, {
        unNumber: right,
        variantKey: 'a',
        primaryClass: classA,
        segregationCodesJson: '["SGxx"]',
      });
      await seedClassRule(env.DB, classA, classA, 0);

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: { status: string; level: number | null } };
      expect(body.decision.status).toBe('REVIEW_REQUIRED');
      expect(body.decision.level).toBeNull();
    });

    it('does not force review for a compatibility group on a non-Class-1 entry', async () => {
      // A compatibility letter is recorded but never used to decide a level,
      // and its mere presence no longer blocks an otherwise-resolvable pair.
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA, compatibilityGroup: 'C' });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });
      await seedClassRule(env.DB, classA, classA, 0);

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: { status: string; level: number | null } };
      expect(body.decision.status).toBe('CLEAR');
      expect(body.decision.level).toBe(0);
    });

    it('returns REVIEW_REQUIRED for a Class 1 <-> Class 1 pair', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: '1.1', compatibilityGroup: 'D' });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: '1.4', compatibilityGroup: 'S' });

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: { status: string; level: number | null; reason: string } };
      expect(body.decision.status).toBe('REVIEW_REQUIRED');
      expect(body.decision.level).toBeNull();
      expect(body.decision.reason).toContain('CLASS1_TO_CLASS1_UNRESOLVED');
    });
  });

  describe('variant aggregation', () => {
    it('aggregates to CLEAR when all variant combinations are CLEAR', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'b', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });
      await seedClassRule(env.DB, classA, classA, 0);

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      const body = (await response.json()) as { decision: { status: string; level: number | null; reason: string } };
      expect(body.decision.status).toBe('CLEAR');
      expect(body.decision.level).toBe(0);
      expect(body.decision.reason).toBe('All DG variant combinations produce the same clear segregation outcome.');
    });

    it('aggregates to SEGREGATION_REQUIRED when all variant combinations agree on the same level', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      const classB = nextClass('B');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'b', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classB });
      await seedClassRule(env.DB, classA, classB, 2);

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      const body = (await response.json()) as { decision: { status: string; level: number | null; reason: string } };
      expect(body.decision.status).toBe('SEGREGATION_REQUIRED');
      expect(body.decision.level).toBe(2);
      expect(body.decision.reason).toBe('All DG variant combinations require segregation level 2.');
    });

    it('aggregates to a variant-safe reason when different variant classes agree on the same level', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      const classB = nextClass('B');
      const classC = nextClass('C');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'b', primaryClass: classC });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classB });
      await seedClassRule(env.DB, classA, classB, 2);
      await seedClassRule(env.DB, classC, classB, 2);

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      const body = (await response.json()) as { decision: { status: string; level: number | null; reason: string } };
      expect(body.decision.status).toBe('SEGREGATION_REQUIRED');
      expect(body.decision.level).toBe(2);
      expect(body.decision.reason).toBe('All DG variant combinations require segregation level 2.');
      expect(body.decision.reason).not.toContain(classA);
      expect(body.decision.reason).not.toContain(classC);
    });

    it('keeps the strictest result when variants disagree between CLEAR and SEGREGATION_REQUIRED', async () => {
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

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      const body = (await response.json()) as {
        decision: { status: string; level: number | null; reason: string };
        variantResolution: string;
      };
      expect(body.decision.status).toBe('SEGREGATION_REQUIRED');
      expect(body.decision.level).toBe(2);
      expect(body.variantResolution).toBe('STRICTEST_OF_MULTIPLE_VARIANTS');
      expect(body.decision.reason).toContain('strictest');
      expect(body.decision.reason).not.toContain('All DG variant combinations');
    });

    it('keeps the strictest result when variants disagree on segregation level', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      const classB = nextClass('B');
      const classC = nextClass('C');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'b', primaryClass: classC });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classB });
      await seedClassRule(env.DB, classA, classB, 1);
      await seedClassRule(env.DB, classB, classC, 3);

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      const body = (await response.json()) as {
        decision: { status: string; level: number | null };
        variantResolution: string;
      };
      expect(body.decision.status).toBe('SEGREGATION_REQUIRED');
      expect(body.decision.level).toBe(3);
      expect(body.variantResolution).toBe('STRICTEST_OF_MULTIPLE_VARIANTS');
    });

    it('reports UNIFORM when every variant combination agrees', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      const classB = nextClass('B');
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'b', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classB });
      await seedClassRule(env.DB, classA, classB, 2);

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      const body = (await response.json()) as { variantResolution: string };
      expect(body.variantResolution).toBe('UNIFORM');
    });

    it('aggregates to REVIEW_REQUIRED when any variant combination requires review', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      const classA = nextClass('A');
      const classB = nextClass('B');
      await seedDgEntry(env.DB, {
        unNumber: left,
        variantKey: 'a',
        primaryClass: classA,
        subsidiaryRisksJson: '["TEST_SUB"]',
      });
      await seedDgEntry(env.DB, { unNumber: left, variantKey: 'b', primaryClass: classA });
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classB });
      await seedClassRule(env.DB, classA, classB, 0);

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      const body = (await response.json()) as { decision: { status: string; level: number | null } };
      expect(body.decision.status).toBe('REVIEW_REQUIRED');
      expect(body.decision.level).toBeNull();
    });
  });

  describe('internal failures', () => {
    it('returns 500 and does not silently treat malformed persisted JSON as an empty array', async () => {
      const left = nextUnNumber();
      const right = nextUnNumber();
      await env.DB.prepare(
        `INSERT INTO dg_entries (un_number, variant_key, primary_class, subsidiary_risks_json, segregation_groups_json, segregation_codes_json, compatibility_group)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(left, 'a', nextClass('A'), 'not-json', '[]', '[]', null)
        .run();
      await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: nextClass('B') });

      const response = await post({ leftUnNumber: left, rightUnNumber: right });

      expect(response.status).toBe(500);
      const body = (await response.json()) as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
