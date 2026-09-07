export interface DatasetStatus {
  ready: boolean;
  schemaVersion: string | null;
  datasetVersion: string | null;
}

interface AppMetadataRow {
  key: string;
  value: string;
}

const SCHEMA_VERSION_V1 = '1';
const SCHEMA_VERSION_V2 = '2';
const SCHEMA_VERSION_V3 = '3';

/**
 * Reports whether the service currently has a usable segregation dataset.
 * Distinguishes "dataset not imported yet" (ready: false) from a genuinely
 * missing UN number in an otherwise-ready dataset, which callers must
 * handle separately. Metadata being absent is a normal, expected state and
 * never throws — only real D1 failures propagate, so callers can return 500.
 *
 * Three schema versions are recognized, so migrating, importing and deploying
 * can be staged without a window where the service is unavailable. Older
 * versions stay serviceable indefinitely; production may also jump straight
 * from v1 to v3 without ever activating v2:
 *
 * - v1 has no sg_rules content. It stays serviceable under this Worker, and
 *   stays fail-closed: with no SG rules loaded, every entry that carries an
 *   SG code resolves to an UNKNOWN_SG_CODE blocker and therefore
 *   REVIEW_REQUIRED. It can never silently answer CLEAR for a pair whose
 *   provisions have not been imported.
 * - v2 additionally requires sg_rules to be populated. An empty sg_rules
 *   table is never accepted as a valid v2 dataset, so a half-finished
 *   v2 import reports not-ready instead of quietly serving an engine with no
 *   special provisions.
 * - v3 is v2 plus a proper shipping name on every DG entry. A row with a NULL
 *   or blank name is only possible in a v3 dataset if the import was
 *   incomplete or the metadata was mislabelled, so it fails readiness rather
 *   than serving summaries with silently missing names. The same NULL is
 *   perfectly valid — and stays serviceable — under v1/v2, where the column
 *   simply predates the dataset.
 */
export async function getDatasetStatus(db: D1Database): Promise<DatasetStatus> {
  const [metadataResult, dgEntryResult, classRuleResult, sgRuleResult, missingPsnResult] = await db.batch<
    Record<string, unknown>
  >([
    db.prepare(
      `SELECT key, value FROM app_metadata WHERE key IN ('dataset_schema_version', 'dataset_version')`,
    ),
    db.prepare('SELECT 1 FROM dg_entries LIMIT 1'),
    db.prepare('SELECT 1 FROM segregation_class_rules LIMIT 1'),
    db.prepare('SELECT 1 FROM sg_rules LIMIT 1'),
    // Bounded by LIMIT 1: this stops at the first offending row rather than
    // scanning the whole table, and on a complete v3 dataset it is a single
    // full scan of a few thousand rows on an already-hot table.
    db.prepare(
      `SELECT 1 FROM dg_entries WHERE proper_shipping_name IS NULL OR TRIM(proper_shipping_name) = '' LIMIT 1`,
    ),
  ]);

  const metadata = new Map(
    (metadataResult.results as unknown as AppMetadataRow[]).map((row) => [row.key, row.value]),
  );
  const schemaVersion = metadata.get('dataset_schema_version') ?? null;
  const datasetVersion = metadata.get('dataset_version') ?? null;

  const hasDgEntries = dgEntryResult.results.length > 0;
  const hasClassRules = classRuleResult.results.length > 0;
  const hasSgRules = sgRuleResult.results.length > 0;
  const hasEveryProperShippingName = missingPsnResult.results.length === 0;

  const coreReady =
    typeof datasetVersion === 'string' && datasetVersion.length > 0 && hasDgEntries && hasClassRules;

  const ready =
    coreReady &&
    (schemaVersion === SCHEMA_VERSION_V1 ||
      (schemaVersion === SCHEMA_VERSION_V2 && hasSgRules) ||
      (schemaVersion === SCHEMA_VERSION_V3 && hasSgRules && hasEveryProperShippingName));

  return { ready, schemaVersion, datasetVersion };
}
