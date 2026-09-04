import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { markSyntheticDatasetReady, seedClassRule, seedDgEntry, seedSgRule } from './helpers/seed';

// End-to-end coverage for the SG-rule and additive-response parts of the
// engine. Synthetic UN numbers, class names and SG codes only — these have no
// regulatory meaning and must never be seeded into a production migration.

let sequence = 9500;

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
  return exports.default.fetch('https://example.com/segregation/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface CheckBody {
  ok: boolean;
  input: { leftUnNumber: string; rightUnNumber: string };
  decision: { status: string; level: number | null; reason: string };
  variants: { left: number; right: number; evaluatedPairs: number };
  additionalRequirements: Array<{ code: string; source: string; requiresConfirmation: boolean }>;
  variantResolution: string;
}

async function check(left: string, right: string): Promise<CheckBody> {
  const response = await post({ leftUnNumber: left, rightUnNumber: right });
  expect(response.status).toBe(200);
  return (await response.json()) as CheckBody;
}

describe('POST /segregation/check — SG rules and additive response fields', () => {
  beforeAll(async () => {
    await markSyntheticDatasetReady(env.DB);
  });

  it('preserves the existing top-level response fields and adds the new ones', async () => {
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');
    await seedDgEntry(env.DB, { unNumber: left, variantKey: 'a', primaryClass: classA });
    await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });
    await seedClassRule(env.DB, classA, classA, 0);

    const response = await post({ leftUnNumber: left, rightUnNumber: right });
    const body = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual([
      'additionalRequirements',
      'decision',
      'input',
      'ok',
      'variantResolution',
      'variants',
    ]);
    expect(body.ok).toBe(true);
    expect(body.input).toEqual({ leftUnNumber: left, rightUnNumber: right });
    expect(body.variants).toEqual({ left: 1, right: 1, evaluatedPairs: 1 });
  });

  it('applies a DIRECT_CLASS SG rule loaded from D1', async () => {
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');
    const classB = nextClass('B');
    const code = nextSgCode();
    await seedSgRule(env.DB, { code, ruleType: 'DIRECT_CLASS', targets: [classB], level: 3 });
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      segregationCodesJson: JSON.stringify([code]),
    });
    await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classB });
    await seedClassRule(env.DB, classA, classB, 1);

    const body = await check(left, right);

    expect(body.decision.status).toBe('SEGREGATION_REQUIRED');
    expect(body.decision.level).toBe(3);
  });

  it('applies a DIRECT_SGG SG rule, while group membership alone imposes nothing', async () => {
    const holderUn = nextUnNumber();
    const memberUn = nextUnNumber();
    const plainUn = nextUnNumber();
    const classA = nextClass('A');
    const code = nextSgCode();
    const group = `SGG${sequence}`;

    await seedSgRule(env.DB, { code, ruleType: 'DIRECT_SGG', targets: [group], level: 2 });
    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: holderUn,
      variantKey: 'a',
      primaryClass: classA,
      segregationCodesJson: JSON.stringify([code]),
    });
    await seedDgEntry(env.DB, {
      unNumber: memberUn,
      variantKey: 'a',
      primaryClass: classA,
      segregationGroupsJson: JSON.stringify([group]),
    });
    await seedDgEntry(env.DB, { unNumber: plainUn, variantKey: 'a', primaryClass: classA });

    const applied = await check(holderUn, memberUn);
    expect(applied.decision.status).toBe('SEGREGATION_REQUIRED');
    expect(applied.decision.level).toBe(2);

    // The group member on its own carries no obligation.
    const membershipOnly = await check(memberUn, plainUn);
    expect(membershipOnly.decision.status).toBe('CLEAR');

    // And the holder against a non-member is unaffected.
    const holderOnly = await check(holderUn, plainUn);
    expect(holderOnly.decision.status).toBe('CLEAR');
  });

  it('applies a DIRECT_UN SG rule by canonical UN number', async () => {
    const holderUn = nextUnNumber();
    const targetUn = nextUnNumber();
    const otherUn = nextUnNumber();
    const classA = nextClass('A');
    const code = nextSgCode();

    await seedSgRule(env.DB, { code, ruleType: 'DIRECT_UN', targets: [targetUn], level: 2 });
    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: holderUn,
      variantKey: 'a',
      primaryClass: classA,
      segregationCodesJson: JSON.stringify([code]),
    });
    await seedDgEntry(env.DB, { unNumber: targetUn, variantKey: 'a', primaryClass: classA });
    await seedDgEntry(env.DB, { unNumber: otherUn, variantKey: 'a', primaryClass: classA });

    const matched = await check(holderUn, targetUn);
    expect(matched.decision.level).toBe(2);

    const unmatched = await check(holderUn, otherUn);
    expect(unmatched.decision.status).toBe('CLEAR');
  });

  it('resolves an AS_FOR_CLASS SG rule through the substituted class matrix lookup', async () => {
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');
    const classB = nextClass('B');
    const substituted = nextClass('SUB');
    const code = nextSgCode();

    await seedSgRule(env.DB, { code, ruleType: 'AS_FOR_CLASS', targets: [substituted], level: null });
    await seedClassRule(env.DB, classA, classB, 1);
    await seedClassRule(env.DB, substituted, classB, 4);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      segregationCodesJson: JSON.stringify([code]),
    });
    await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classB });

    const body = await check(left, right);

    expect(body.decision.level).toBe(4);
  });

  it('reports an ADDITIONAL_REQUIREMENT alongside a level-0 decision', async () => {
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');
    const code = nextSgCode();

    await seedSgRule(env.DB, { code, ruleType: 'ADDITIONAL_REQUIREMENT' });
    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      segregationCodesJson: JSON.stringify([code]),
    });
    await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });

    const body = await check(left, right);

    // Level 0 with an outstanding obligation: this is NOT "safe to mix".
    expect(body.decision.status).toBe('CLEAR');
    expect(body.decision.level).toBe(0);
    expect(body.additionalRequirements).toEqual([{ code, source: 'SG', requiresConfirmation: true }]);
  });

  it('does not expose SG regulatory prose through the response', async () => {
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');
    const code = nextSgCode();
    const prose = 'SYNTHETIC PROSE THAT MUST NOT BE RETURNED';

    await seedSgRule(env.DB, { code, ruleType: 'ADDITIONAL_REQUIREMENT', sourceText: prose });
    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      segregationCodesJson: JSON.stringify([code]),
    });
    await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });

    const response = await post({ leftUnNumber: left, rightUnNumber: right });
    const raw = await response.text();

    expect(raw).toContain(code);
    expect(raw).not.toContain(prose);
  });

  it('unions additional requirements across variant pairs', async () => {
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');
    const codeA = nextSgCode();
    const codeB = nextSgCode();

    await seedSgRule(env.DB, { code: codeA, ruleType: 'ADDITIONAL_REQUIREMENT' });
    await seedSgRule(env.DB, { code: codeB, ruleType: 'ADDITIONAL_REQUIREMENT' });
    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      segregationCodesJson: JSON.stringify([codeA]),
    });
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'b',
      primaryClass: classA,
      segregationCodesJson: JSON.stringify([codeB]),
    });
    await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });

    const body = await check(left, right);

    expect(body.additionalRequirements.map((entry) => entry.code).sort()).toEqual([codeA, codeB].sort());
  });

  it('requires review for a REVIEW_ONLY SG code', async () => {
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');
    const code = nextSgCode();

    await seedSgRule(env.DB, { code, ruleType: 'REVIEW_ONLY' });
    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      segregationCodesJson: JSON.stringify([code]),
    });
    await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });

    const body = await check(left, right);

    expect(body.decision.status).toBe('REVIEW_REQUIRED');
    expect(body.decision.reason).toContain(`REVIEW_ONLY_SG_CODE:${code}`);
  });

  it('requires review when an entry references a RESERVED SG code', async () => {
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');
    const code = nextSgCode();

    await seedSgRule(env.DB, { code, ruleType: 'RESERVED' });
    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      segregationCodesJson: JSON.stringify([code]),
    });
    await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });

    const body = await check(left, right);

    expect(body.decision.status).toBe('REVIEW_REQUIRED');
    expect(body.decision.reason).toContain(`RESERVED_SG_CODE:${code}`);
  });

  it('requires review for an SG code with no row in sg_rules', async () => {
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');
    const code = nextSgCode();

    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      segregationCodesJson: JSON.stringify([code]),
    });
    await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });

    const body = await check(left, right);

    expect(body.decision.status).toBe('REVIEW_REQUIRED');
    expect(body.decision.reason).toContain(`UNKNOWN_SG_CODE:${code}`);
  });

  it('requires review for an unresolved subsidiary source token', async () => {
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');

    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      subsidiaryRisksJson: JSON.stringify(['UNRESOLVED_SP:SP9001']),
    });
    await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });

    const body = await check(left, right);

    expect(body.decision.status).toBe('REVIEW_REQUIRED');
    expect(body.decision.reason).toContain('UNRESOLVED_SUBSIDIARY_SOURCE');
  });

  it('returns 500 rather than a permissive result when an sg_rules row is malformed', async () => {
    const left = nextUnNumber();
    const right = nextUnNumber();
    const classA = nextClass('A');
    const code = nextSgCode();

    await env.DB.prepare(
      'INSERT INTO sg_rules (code, rule_type, targets_json, level, source_text) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(code, 'DIRECT_CLASS', 'not valid json', 2, 'synthetic malformed row')
      .run();
    await seedClassRule(env.DB, classA, classA, 0);
    await seedDgEntry(env.DB, {
      unNumber: left,
      variantKey: 'a',
      primaryClass: classA,
      segregationCodesJson: JSON.stringify([code]),
    });
    await seedDgEntry(env.DB, { unNumber: right, variantKey: 'a', primaryClass: classA });

    const response = await post({ leftUnNumber: left, rightUnNumber: right });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
