import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatasetStatus } from '../../src/data/dataset-status';

// D1 storage persists across tests within this file (it is not reset
// automatically), so each test explicitly wipes the relevant tables first
// and builds up exactly the state it needs — never relying on what a
// previous test left behind.
async function resetDatasetState(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM app_metadata WHERE key IN ('dataset_schema_version', 'dataset_version')`),
    env.DB.prepare('DELETE FROM dg_entries'),
    env.DB.prepare('DELETE FROM segregation_class_rules'),
  ]);
}

async function setMetadata(schemaVersion: string | null, datasetVersion: string | null): Promise<void> {
  if (schemaVersion !== null) {
    await env.DB.prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)')
      .bind('dataset_schema_version', schemaVersion)
      .run();
  }
  if (datasetVersion !== null) {
    await env.DB.prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)')
      .bind('dataset_version', datasetVersion)
      .run();
  }
}

async function insertDgEntryRow(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO dg_entries
       (un_number, variant_key, primary_class, subsidiary_risks_json, segregation_groups_json, segregation_codes_json, compatibility_group)
     VALUES ('9500', 'A', 'TEST_STATUS', '[]', '[]', '[]', NULL)`,
  ).run();
}

async function insertClassRuleRow(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO segregation_class_rules (class_a, class_b, level) VALUES ('TEST_STATUS', 'TEST_STATUS', 0)`,
  ).run();
}

describe('getDatasetStatus', () => {
  beforeEach(async () => {
    await resetDatasetState();
  });

  it('is not ready when there is no metadata and no rows', async () => {
    const status = await getDatasetStatus(env.DB);
    expect(status).toEqual({ ready: false, schemaVersion: null, datasetVersion: null });
  });

  it('is not ready with metadata only and no rows', async () => {
    await setMetadata('1', 'synthetic-status-v1');

    const status = await getDatasetStatus(env.DB);
    expect(status.ready).toBe(false);
    expect(status.schemaVersion).toBe('1');
    expect(status.datasetVersion).toBe('synthetic-status-v1');
  });

  it('is not ready with DG rows and rules but no metadata', async () => {
    await insertDgEntryRow();
    await insertClassRuleRow();

    const status = await getDatasetStatus(env.DB);
    expect(status.ready).toBe(false);
    expect(status.schemaVersion).toBeNull();
    expect(status.datasetVersion).toBeNull();
  });

  it('is not ready with metadata and DG rows but no rules', async () => {
    await setMetadata('1', 'synthetic-status-v1');
    await insertDgEntryRow();

    const status = await getDatasetStatus(env.DB);
    expect(status.ready).toBe(false);
  });

  it('is not ready with metadata and rules but no DG rows', async () => {
    await setMetadata('1', 'synthetic-status-v1');
    await insertClassRuleRow();

    const status = await getDatasetStatus(env.DB);
    expect(status.ready).toBe(false);
  });

  it('is not ready when schemaVersion is not "1"', async () => {
    await setMetadata('2', 'synthetic-status-v1');
    await insertDgEntryRow();
    await insertClassRuleRow();

    const status = await getDatasetStatus(env.DB);
    expect(status.ready).toBe(false);
    expect(status.schemaVersion).toBe('2');
  });

  it('is ready with valid metadata, DG rows, and rules', async () => {
    await setMetadata('1', 'synthetic-status-v1');
    await insertDgEntryRow();
    await insertClassRuleRow();

    const status = await getDatasetStatus(env.DB);
    expect(status).toEqual({ ready: true, schemaVersion: '1', datasetVersion: 'synthetic-status-v1' });
  });
});

// Regression for the PR 6 partial-import bug: a snapshot refresh that
// deletes/replaces dg_entries and segregation_class_rules while the
// *previous* dataset's readiness metadata is still present could make
// getDatasetStatus() report ready:true against a half-replaced dataset. The
// generated import SQL now deletes the two readiness metadata keys before
// any table replacement, so a refresh in progress is correctly unready even
// though both runtime tables already contain rows again.
describe('getDatasetStatus — partial dataset refresh regression (PR 6 correction)', () => {
  beforeEach(async () => {
    await resetDatasetState();
  });

  it('is not ready mid-refresh once readiness metadata is invalidated first, even with rows present', async () => {
    // A. old dataset is ready.
    await setMetadata('1', 'synthetic-old-v1');
    await insertDgEntryRow();
    await insertClassRuleRow();
    expect((await getDatasetStatus(env.DB)).ready).toBe(true);

    // B. simulate the start of a generated replacement import: the importer's
    // readiness invalidation runs first, then the table replacement begins
    // (here, completes) before the closing metadata upserts would run.
    await env.DB.prepare(
      `DELETE FROM app_metadata WHERE key IN ('dataset_schema_version', 'dataset_version')`,
    ).run();
    await env.DB.prepare('DELETE FROM segregation_class_rules').run();
    await env.DB.prepare('DELETE FROM dg_entries').run();
    await insertDgEntryRow();
    await insertClassRuleRow();

    const midRefreshStatus = await getDatasetStatus(env.DB);
    expect(midRefreshStatus).toEqual({ ready: false, schemaVersion: null, datasetVersion: null });

    const response = await exports.default.fetch('https://example.com/segregation/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leftUnNumber: '1234', rightUnNumber: '5678' }),
    });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('DATASET_NOT_READY');

    // C. import completes: the final metadata upserts restore readiness.
    await setMetadata('1', 'synthetic-new-v1');
    const finalStatus = await getDatasetStatus(env.DB);
    expect(finalStatus).toEqual({ ready: true, schemaVersion: '1', datasetVersion: 'synthetic-new-v1' });
  });
});
