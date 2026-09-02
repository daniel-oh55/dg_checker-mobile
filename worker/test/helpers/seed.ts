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
