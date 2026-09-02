export interface DatasetStatus {
  ready: boolean;
  schemaVersion: string | null;
  datasetVersion: string | null;
}

interface AppMetadataRow {
  key: string;
  value: string;
}

const READY_SCHEMA_VERSION = '1';

/**
 * Reports whether the service currently has a usable segregation dataset.
 * Distinguishes "dataset not imported yet" (ready: false) from a genuinely
 * missing UN number in an otherwise-ready dataset, which callers must
 * handle separately. Metadata being absent is a normal, expected state and
 * never throws — only real D1 failures propagate, so callers can return 500.
 */
export async function getDatasetStatus(db: D1Database): Promise<DatasetStatus> {
  const [metadataResult, dgEntryResult, classRuleResult] = await db.batch<Record<string, unknown>>([
    db.prepare(
      `SELECT key, value FROM app_metadata WHERE key IN ('dataset_schema_version', 'dataset_version')`,
    ),
    db.prepare('SELECT 1 FROM dg_entries LIMIT 1'),
    db.prepare('SELECT 1 FROM segregation_class_rules LIMIT 1'),
  ]);

  const metadata = new Map(
    (metadataResult.results as unknown as AppMetadataRow[]).map((row) => [row.key, row.value]),
  );
  const schemaVersion = metadata.get('dataset_schema_version') ?? null;
  const datasetVersion = metadata.get('dataset_version') ?? null;

  const hasDgEntries = dgEntryResult.results.length > 0;
  const hasClassRules = classRuleResult.results.length > 0;

  const ready =
    schemaVersion === READY_SCHEMA_VERSION &&
    typeof datasetVersion === 'string' &&
    datasetVersion.length > 0 &&
    hasDgEntries &&
    hasClassRules;

  return { ready, schemaVersion, datasetVersion };
}
