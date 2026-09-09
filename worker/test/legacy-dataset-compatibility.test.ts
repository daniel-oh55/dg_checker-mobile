import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatasetStatus } from '../src/data/dataset-status';
import { findDgEntriesByUnNumber, findDgEntriesByUnNumbers } from '../src/data/dg-entries';

// Staged-rollout coverage. Migration 0005 adds proper_shipping_name before the
// schema-v3 dataset that populates it is ever imported, so this Worker must
// keep serving a schema v1/v2 dataset whose rows all have a NULL name. These
// tests seed exactly that state and assert nothing degrades.
//
// Synthetic data only: UN 9300+, TEST_ classes, invented shipping names.

let sequence = 9300;

function nextUnNumber(): string {
  sequence += 1;
  return String(sequence);
}

function nextClass(label: string): string {
  sequence += 1;
  return `TEST_${label}_${sequence}`;
}

async function resetDatasetState(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM app_metadata WHERE key IN ('dataset_schema_version', 'dataset_version')`),
    env.DB.prepare('DELETE FROM dg_entries'),
    env.DB.prepare('DELETE FROM segregation_class_rules'),
    env.DB.prepare('DELETE FROM sg_rules'),
  ]);
}

async function setSchemaVersion(schemaVersion: string, datasetVersion: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO app_metadata (key, value) VALUES ('dataset_schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).bind(schemaVersion),
    env.DB.prepare(
      `INSERT INTO app_metadata (key, value) VALUES ('dataset_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).bind(datasetVersion),
  ]);
}

/** Inserts a row the way a pre-0005 import did: no proper_shipping_name column at all. */
async function seedLegacyDgEntry(unNumber: string, primaryClass: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO dg_entries
       (un_number, variant_key, primary_class, subsidiary_risks_json, segregation_groups_json, segregation_codes_json, compatibility_group)
     VALUES (?, 'a', ?, '[]', '[]', '[]', NULL)`,
  )
    .bind(unNumber, primaryClass)
    .run();
}

async function seedSgRuleRow(code: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sg_rules (code, rule_type, targets_json, level, source_text)
     VALUES (?, 'REVIEW_ONLY', '[]', NULL, 'synthetic legacy-compatibility rule')`,
  )
    .bind(code)
    .run();
}

/** Seeds a complete, legacy-shaped dataset (all NULL names) and returns its two UN numbers. */
async function seedLegacyDataset(schemaVersion: string): Promise<[string, string]> {
  const left = nextUnNumber();
  const right = nextUnNumber();
  const cls = nextClass('LEGACY');
  await seedLegacyDgEntry(left, cls);
  await seedLegacyDgEntry(right, cls);
  await env.DB.prepare(
    'INSERT INTO segregation_class_rules (class_a, class_b, level, source_token) VALUES (?, ?, 0, ?)',
  )
    .bind(cls, cls, 'X')
    .run();
  if (schemaVersion !== '1') {
    await seedSgRuleRow(`SG${sequence}`);
  }
  await setSchemaVersion(schemaVersion, `synthetic-legacy-v${schemaVersion}`);
  return [left, right];
}

function post(path: string, body: unknown): Promise<Response> {
  return exports.default.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('staged rollout — a pre-schema-v3 dataset with NULL proper shipping names', () => {
  beforeEach(async () => {
    await resetDatasetState();
  });

  it.each(['1', '2'])('stays ready under schema v%s', async (schemaVersion) => {
    await seedLegacyDataset(schemaVersion);

    const status = await getDatasetStatus(env.DB);
    expect(status.ready).toBe(true);
    expect(status.schemaVersion).toBe(schemaVersion);
  });

  it.each(['1', '2'])('serves /segregation/check under schema v%s', async (schemaVersion) => {
    const [left, right] = await seedLegacyDataset(schemaVersion);

    const response = await post('/segregation/check', { leftUnNumber: left, rightUnNumber: right });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; decision: { status: string } };
    expect(body.ok).toBe(true);
    expect(body.decision.status).toBe('CLEAR');
  });

  it.each(['1', '2'])('serves /segregation/check-batch under schema v%s', async (schemaVersion) => {
    const [left, right] = await seedLegacyDataset(schemaVersion);

    const response = await post('/segregation/check-batch', { unNumbers: [left, right] });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      summary: { totalPairs: number };
      dgSummaries: Array<{ unNumber: string; variantCount: number; profiles: Array<{ properShippingName: string | null }> }>;
    };
    expect(body.ok).toBe(true);
    expect(body.summary.totalPairs).toBe(1);
    expect(body.dgSummaries.map((entry) => entry.unNumber)).toEqual([left, right]);
    for (const summary of body.dgSummaries) {
      expect(summary.variantCount).toBe(1);
      expect(summary.profiles).toHaveLength(1);
      expect(summary.profiles[0].properShippingName).toBeNull();
    }
  });

  it('maps a NULL column to null without raising a malformed-entry error', async () => {
    const [left, right] = await seedLegacyDataset('2');

    const single = await findDgEntriesByUnNumber(env.DB, left);
    expect(single).toHaveLength(1);
    expect(single[0].properShippingName).toBeNull();

    const batched = await findDgEntriesByUnNumbers(env.DB, [left, right]);
    for (const unNumber of [left, right]) {
      expect(batched.get(unNumber)?.[0].properShippingName).toBeNull();
    }
  });
});

describe('production-v1 compatibility — this Worker deployed before schema v3 is activated', () => {
  // The rollout order is Worker first, dataset second, so this code must be
  // safe against the v1 dataset already in production: rows with NULL proper
  // shipping names, an empty sg_rules table, NULL class-rule source tokens,
  // and primary classes the current converter would not recognize. None of
  // that may leak, and none of it may soften a decision.
  //
  // Synthetic data only — the legacy class below is invented, not a stored
  // source value.
  const LEGACY_UNMAPPED_CLASS = 'synthetic-legacy-unmapped-class-9350';
  const UNSPECIFIED_PRIMARY_HAZARD = 'UNSPECIFIED_PRIMARY_HAZARD';

  interface V1Fixture {
    legacy: string;
    canonicalLeft: string;
    canonicalRight: string;
  }

  /** Seeds a v1-shaped dataset: NULL names, empty sg_rules, NULL source_token. */
  async function seedProductionV1Shape(): Promise<V1Fixture> {
    const legacy = nextUnNumber();
    const canonicalLeft = nextUnNumber();
    const canonicalRight = nextUnNumber();

    await seedLegacyDgEntry(legacy, LEGACY_UNMAPPED_CLASS);
    await seedLegacyDgEntry(canonicalLeft, '3');
    await seedLegacyDgEntry(canonicalRight, '8');

    // source_token stays NULL, exactly as a pre-0004 import left it.
    await env.DB.prepare(
      'INSERT INTO segregation_class_rules (class_a, class_b, level, source_token) VALUES (?, ?, ?, NULL)',
    )
      .bind('3', '8', 2)
      .run();

    // sg_rules is deliberately left empty: v1 has no SG content.
    await setSchemaVersion('1', 'synthetic-legacy-v1');
    return { legacy, canonicalLeft, canonicalRight };
  }

  beforeEach(async () => {
    await resetDatasetState();
  });

  it('stays ready with NULL names, no SG rules and NULL source tokens', async () => {
    await seedProductionV1Shape();

    const sgRuleCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM sg_rules').first<{ n: number }>();
    expect(sgRuleCount?.n).toBe(0);
    const namedCount = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM dg_entries WHERE proper_shipping_name IS NOT NULL',
    ).first<{ n: number }>();
    expect(namedCount?.n).toBe(0);

    const status = await getDatasetStatus(env.DB);
    expect(status).toEqual({ ready: true, schemaVersion: '1', datasetVersion: 'synthetic-legacy-v1' });
  });

  it('withholds a legacy unmapped primary class from the batch DG summary', async () => {
    const { legacy, canonicalLeft } = await seedProductionV1Shape();

    const response = await post('/segregation/check-batch', { unNumbers: [legacy, canonicalLeft] });
    expect(response.status).toBe(200);
    const rawBody = await response.text();

    // The whole serialized body, not just the field this test models.
    expect(rawBody).not.toContain(LEGACY_UNMAPPED_CLASS);
    expect(rawBody).not.toContain('synthetic-legacy-unmapped');

    const body = JSON.parse(rawBody) as {
      pairs: Array<{ decision: { status: string; level: number | null } }>;
      dgSummaries: Array<{
        unNumber: string;
        variantCount: number;
        profiles: Array<{ primaryClass: string; properShippingName: string | null }>;
      }>;
    };

    const summary = body.dgSummaries.find((entry) => entry.unNumber === legacy);
    expect(summary?.variantCount).toBe(1);
    expect(summary?.profiles[0].primaryClass).toBe(UNSPECIFIED_PRIMARY_HAZARD);
    // A v1 row genuinely has no authorized name; null is still reported as null.
    expect(summary?.profiles[0].properShippingName).toBeNull();
    // An unmapped class matches no rule, so the pair still fails closed.
    expect(body.pairs[0].decision.status).toBe('REVIEW_REQUIRED');
    expect(body.pairs[0].decision.level).toBeNull();
  });

  it('keeps the single endpoint compatible and fail-closed for a legacy unmapped class', async () => {
    const { legacy, canonicalLeft } = await seedProductionV1Shape();

    const response = await post('/segregation/check', { leftUnNumber: legacy, rightUnNumber: canonicalLeft });
    expect(response.status).toBe(200);
    const rawBody = await response.text();

    expect(rawBody).not.toContain(LEGACY_UNMAPPED_CLASS);
    const body = JSON.parse(rawBody) as { ok: boolean; decision: { status: string; level: number | null } };
    expect(body.ok).toBe(true);
    expect(body.decision.status).toBe('REVIEW_REQUIRED');
    expect(body.decision.level).toBeNull();
  });

  it('still resolves a v1 pair whose classes are recognized, and publishes them', async () => {
    // The other half of the contract: withholding unmapped classes must not
    // degrade a v1 dataset whose classes and rules are perfectly usable, even
    // though every source_token is NULL.
    const { canonicalLeft, canonicalRight } = await seedProductionV1Shape();

    const response = await post('/segregation/check-batch', { unNumbers: [canonicalLeft, canonicalRight] });
    expect(response.status).toBe(200);
    const rawBody = await response.text();
    const body = JSON.parse(rawBody) as {
      pairs: Array<{ decision: { status: string; level: number | null } }>;
      dgSummaries: Array<{ unNumber: string; profiles: Array<{ primaryClass: string }> }>;
    };

    expect(body.pairs[0].decision.status).toBe('SEGREGATION_REQUIRED');
    expect(body.pairs[0].decision.level).toBe(2);
    expect(body.dgSummaries.map((entry) => entry.profiles[0].primaryClass)).toEqual(['3', '8']);
    expect(rawBody).not.toContain(UNSPECIFIED_PRIMARY_HAZARD);
  });
});

describe('getDatasetStatus — schema v3', () => {
  beforeEach(async () => {
    await resetDatasetState();
  });

  async function seedV3Dataset(properShippingName: string | null): Promise<void> {
    const cls = nextClass('V3');
    await env.DB.prepare(
      `INSERT INTO dg_entries
         (un_number, variant_key, proper_shipping_name, primary_class, subsidiary_risks_json, segregation_groups_json, segregation_codes_json, compatibility_group)
       VALUES (?, 'a', ?, ?, '[]', '[]', '[]', NULL)`,
    )
      .bind(nextUnNumber(), properShippingName, cls)
      .run();
    await env.DB.prepare(
      'INSERT INTO segregation_class_rules (class_a, class_b, level, source_token) VALUES (?, ?, 0, ?)',
    )
      .bind(cls, cls, 'X')
      .run();
    await seedSgRuleRow(`SG${sequence}`);
    await setSchemaVersion('3', 'synthetic-v3');
  }

  it('is ready when every entry carries a proper shipping name', async () => {
    await seedV3Dataset('SYNTHETIC V3 SUBSTANCE');

    const status = await getDatasetStatus(env.DB);
    expect(status).toEqual({ ready: true, schemaVersion: '3', datasetVersion: 'synthetic-v3' });
  });

  it('is not ready when a v3 entry has a NULL proper shipping name', async () => {
    await seedV3Dataset(null);

    const status = await getDatasetStatus(env.DB);
    expect(status.ready).toBe(false);
    expect(status.schemaVersion).toBe('3');
  });

  it('is not ready when a v3 entry has a blank proper shipping name', async () => {
    await seedV3Dataset('   ');

    const status = await getDatasetStatus(env.DB);
    expect(status.ready).toBe(false);
  });

  // SQLite's one-argument TRIM() strips ordinary spaces only, so a name made
  // of tabs, newlines or NBSP passed v3 readiness and would have been served
  // as a real proper shipping name. Every whitespace form the source and the
  // runtime can produce must fail closed instead.
  //
  // Built from explicit code points rather than backslash escapes so each
  // character is named and cannot be misread at a glance.
  const SPACE = String.fromCharCode(32);
  const TAB = String.fromCharCode(9);
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const VERTICAL_TAB = String.fromCharCode(11);
  const FORM_FEED = String.fromCharCode(12);
  const NBSP = String.fromCharCode(160);

  const BLANK_NAMES: Array<[string, string]> = [
    ['a tab and a line feed', TAB + LF],
    ['a single tab', TAB],
    ['a line feed', LF],
    ['a carriage return', CR],
    ['a CRLF pair', CR + LF],
    ['mixed CR/LF and spaces', SPACE + CR + LF + SPACE + CR + LF + SPACE],
    ['a vertical tab', VERTICAL_TAB],
    ['a form feed', FORM_FEED],
    ['a non-breaking space', NBSP],
    ['non-breaking spaces and a tab', NBSP + NBSP + TAB],
    ['every recognized blank character', SPACE + TAB + LF + CR + VERTICAL_TAB + FORM_FEED + NBSP],
  ];

  it.each(BLANK_NAMES)('is not ready when a v3 proper shipping name is only %s', async (_label, name) => {
    await seedV3Dataset(name);

    const status = await getDatasetStatus(env.DB);
    expect(status.ready).toBe(false);
    expect(status.schemaVersion).toBe('3');
  });

  it('stays ready for a real name that merely contains internal whitespace', async () => {
    // The blank check must not reject a legitimate multi-word name, or one
    // whose stored form kept whitespace around real text.
    await seedV3Dataset(`${SPACE}${SPACE}SYNTHETIC V3${TAB}SUBSTANCE,${NBSP}WITH QUALIFIER${SPACE}`);

    const status = await getDatasetStatus(env.DB);
    expect(status).toEqual({ ready: true, schemaVersion: '3', datasetVersion: 'synthetic-v3' });
  });

  it('still requires sg_rules for v3, exactly as v2 does', async () => {
    await seedV3Dataset('SYNTHETIC V3 SUBSTANCE');
    await env.DB.prepare('DELETE FROM sg_rules').run();

    const status = await getDatasetStatus(env.DB);
    expect(status.ready).toBe(false);
  });
});
