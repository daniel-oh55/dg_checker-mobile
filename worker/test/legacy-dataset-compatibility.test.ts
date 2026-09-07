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

  it('still requires sg_rules for v3, exactly as v2 does', async () => {
    await seedV3Dataset('SYNTHETIC V3 SUBSTANCE');
    await env.DB.prepare('DELETE FROM sg_rules').run();

    const status = await getDatasetStatus(env.DB);
    expect(status.ready).toBe(false);
  });
});
