/**
 * Test-only D1 seed helpers. Data inserted through these helpers must stay
 * unmistakably synthetic (e.g. UN 9001, TEST_A) — never production IMDG
 * data or rules.
 */

export interface SeedDgEntryInput {
  unNumber: string;
  variantKey: string;
  primaryClass: string;
  subsidiaryRisksJson?: string;
  segregationGroupsJson?: string;
  segregationCodesJson?: string;
  compatibilityGroup?: string | null;
}

export async function seedDgEntry(db: D1Database, input: SeedDgEntryInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dg_entries
         (un_number, variant_key, primary_class, subsidiary_risks_json, segregation_groups_json, segregation_codes_json, compatibility_group)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.unNumber,
      input.variantKey,
      input.primaryClass,
      input.subsidiaryRisksJson ?? '[]',
      input.segregationGroupsJson ?? '[]',
      input.segregationCodesJson ?? '[]',
      input.compatibilityGroup ?? null,
    )
    .run();
}

export async function seedClassRule(db: D1Database, classA: string, classB: string, level: number): Promise<void> {
  const [a, b] = classA <= classB ? [classA, classB] : [classB, classA];
  await db
    .prepare('INSERT INTO segregation_class_rules (class_a, class_b, level) VALUES (?, ?, ?)')
    .bind(a, b, level)
    .run();
}

/**
 * Marks the dataset as ready for tests that exercise normal ready-dataset
 * behavior: upserts the dataset_schema_version/dataset_version app_metadata
 * keys, and (idempotently) seeds one reserved synthetic dg_entries row and
 * one reserved synthetic segregation_class_rules row so readiness — which
 * requires non-empty runtime tables, not just metadata — holds regardless
 * of what other tests in the file have or haven't seeded yet. The reserved
 * UN number and class name are outside the ranges other test helpers in
 * this file allocate, so they never collide.
 */
export async function markSyntheticDatasetReady(db: D1Database): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO app_metadata (key, value) VALUES ('dataset_schema_version', '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ),
    db
      .prepare(
        `INSERT INTO app_metadata (key, value) VALUES ('dataset_version', 'synthetic-test-v1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO dg_entries
           (un_number, variant_key, primary_class, subsidiary_risks_json, segregation_groups_json, segregation_codes_json, compatibility_group)
         VALUES ('0000', 'READY_MARKER', 'TEST_READY_MARKER', '[]', '[]', '[]', NULL)`,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO segregation_class_rules (class_a, class_b, level)
         VALUES ('TEST_READY_MARKER', 'TEST_READY_MARKER', 0)`,
      ),
  ]);
}
