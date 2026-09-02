import type { DgEntry } from '../domain/types';

/**
 * Thrown when a persisted DG entry row cannot be safely mapped to the
 * domain shape (e.g. a JSON-array column holds invalid JSON or a
 * non-string-array value). Callers must treat this as an internal data
 * error, not silently coerce the column to an empty array.
 */
export class MalformedDgEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedDgEntryError';
  }
}

interface DgEntryRow {
  un_number: string;
  variant_key: string;
  primary_class: string;
  subsidiary_risks_json: string;
  segregation_groups_json: string;
  segregation_codes_json: string;
  compatibility_group: string | null;
}

function parseStringArrayColumn(json: string, column: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MalformedDgEntryError(`Column "${column}" is not valid JSON.`);
  }

  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new MalformedDgEntryError(`Column "${column}" is not a JSON array of strings.`);
  }

  return parsed;
}

function mapRow(row: DgEntryRow): DgEntry {
  return {
    unNumber: row.un_number,
    variantKey: row.variant_key,
    primaryClass: row.primary_class,
    subsidiaryRisks: parseStringArrayColumn(row.subsidiary_risks_json, 'subsidiary_risks_json'),
    segregationGroups: parseStringArrayColumn(row.segregation_groups_json, 'segregation_groups_json'),
    segregationCodes: parseStringArrayColumn(row.segregation_codes_json, 'segregation_codes_json'),
    compatibilityGroup: row.compatibility_group,
  };
}

/**
 * Loads every DgEntry variant persisted for a canonical (already
 * normalized) UN number. Returns an empty array if none exist.
 */
export async function findDgEntriesByUnNumber(db: D1Database, unNumber: string): Promise<DgEntry[]> {
  const result = await db
    .prepare(
      `SELECT un_number, variant_key, primary_class, subsidiary_risks_json, segregation_groups_json, segregation_codes_json, compatibility_group
       FROM dg_entries
       WHERE un_number = ?`,
    )
    .bind(unNumber)
    .all<DgEntryRow>();

  return result.results.map(mapRow);
}
