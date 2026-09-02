// Offline import harness for the private, authorized DG dataset. Validates
// a canonical JSON snapshot and generates deterministic SQL compatible with
// migrations 0001-0003. Node built-ins only — no dependencies. `fs` is
// imported dynamically inside main() so this module stays importable (for
// its pure validate/build-sql exports) from environments without real
// filesystem access, such as the Vitest/Workers test pool.
//
// Usage:
//   node worker/scripts/dataset-import.mjs validate <input.json>
//   node worker/scripts/dataset-import.mjs build-sql <input.json> <output.sql>

export const SCHEMA_VERSION = 1;

export class DatasetValidationError extends Error {
  constructor(errors) {
    super(`Dataset validation failed with ${errors.length} error(s):\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    this.name = 'DatasetValidationError';
    this.errors = errors;
  }
}

const UN_NUMBER_PATTERN = /^[0-9]{4}$/;
const ROOT_KEYS = new Set(['schemaVersion', 'datasetVersion', 'dgEntries', 'classRules']);
const DG_ENTRY_KEYS = new Set([
  'unNumber',
  'variantKey',
  'primaryClass',
  'subsidiaryRisks',
  'segregationGroups',
  'segregationCodes',
  'compatibilityGroup',
]);
const CLASS_RULE_KEYS = new Set(['classA', 'classB', 'level']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((key) => !allowed.has(key));
}

function validateDgEntry(entry, index, errors, seen) {
  const path = `dgEntries[${index}]`;
  if (!isPlainObject(entry)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  const extra = unknownKeys(entry, DG_ENTRY_KEYS);
  if (extra.length > 0) {
    errors.push(`${path} has unknown field(s): ${extra.join(', ')}.`);
  }

  const {
    unNumber,
    variantKey,
    primaryClass,
    subsidiaryRisks,
    segregationGroups,
    segregationCodes,
    compatibilityGroup,
  } = entry;

  if (typeof unNumber !== 'string' || !UN_NUMBER_PATTERN.test(unNumber)) {
    errors.push(`${path}.unNumber must be a canonical 4-digit string (got ${JSON.stringify(unNumber)}).`);
  }
  if (typeof variantKey !== 'string' || variantKey.length === 0) {
    errors.push(`${path}.variantKey must be a non-empty string.`);
  }
  if (typeof primaryClass !== 'string' || primaryClass.length === 0) {
    errors.push(`${path}.primaryClass must be a non-empty string.`);
  }
  if (!isStringArray(subsidiaryRisks)) {
    errors.push(`${path}.subsidiaryRisks must be a string array.`);
  }
  if (!isStringArray(segregationGroups)) {
    errors.push(`${path}.segregationGroups must be a string array.`);
  }
  if (!isStringArray(segregationCodes)) {
    errors.push(`${path}.segregationCodes must be a string array.`);
  }
  if (compatibilityGroup !== null && typeof compatibilityGroup !== 'string') {
    errors.push(`${path}.compatibilityGroup must be a string or null.`);
  }

  if (typeof unNumber === 'string' && typeof variantKey === 'string') {
    const key = `${unNumber}|${variantKey}`;
    if (seen.has(key)) {
      errors.push(`${path} duplicates (unNumber, variantKey) = (${unNumber}, ${variantKey}).`);
    }
    seen.add(key);
  }
}

function validateClassRule(rule, index, errors, seen) {
  const path = `classRules[${index}]`;
  if (!isPlainObject(rule)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  const extra = unknownKeys(rule, CLASS_RULE_KEYS);
  if (extra.length > 0) {
    errors.push(`${path} has unknown field(s): ${extra.join(', ')}.`);
  }

  const { classA, classB, level } = rule;
  const classAValid = typeof classA === 'string' && classA.length > 0;
  const classBValid = typeof classB === 'string' && classB.length > 0;

  if (!classAValid) errors.push(`${path}.classA must be a non-empty string.`);
  if (!classBValid) errors.push(`${path}.classB must be a non-empty string.`);
  if (!(Number.isInteger(level) && level >= 0 && level <= 4)) {
    errors.push(`${path}.level must be an integer between 0 and 4 (got ${JSON.stringify(level)}).`);
  }

  if (classAValid && classBValid) {
    if (!(classA <= classB)) {
      errors.push(`${path} must use canonical ordering: classA (${classA}) <= classB (${classB}).`);
    }
    const key = `${classA}|${classB}`;
    if (seen.has(key)) {
      errors.push(`${path} duplicates class pair (${classA}, ${classB}).`);
    }
    seen.add(key);
  }
}

/**
 * Validates a raw parsed-JSON dataset snapshot against the canonical import
 * format. Throws DatasetValidationError (with every violation collected)
 * on failure. The private source must already be canonical — this never
 * normalizes or coerces values.
 */
export function validateDataset(raw) {
  const errors = [];

  if (!isPlainObject(raw)) {
    throw new DatasetValidationError(['Dataset root must be a JSON object.']);
  }

  const extraRootKeys = unknownKeys(raw, ROOT_KEYS);
  if (extraRootKeys.length > 0) {
    errors.push(`Dataset root has unknown field(s): ${extraRootKeys.join(', ')}.`);
  }

  if (raw.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION} (got ${JSON.stringify(raw.schemaVersion)}).`);
  }

  if (typeof raw.datasetVersion !== 'string' || raw.datasetVersion.length === 0) {
    errors.push('datasetVersion must be a non-empty string.');
  }

  if (!Array.isArray(raw.dgEntries)) {
    errors.push('dgEntries must be an array.');
  } else {
    const seenEntries = new Set();
    raw.dgEntries.forEach((entry, index) => validateDgEntry(entry, index, errors, seenEntries));
  }

  if (!Array.isArray(raw.classRules)) {
    errors.push('classRules must be an array.');
  } else {
    const seenRules = new Set();
    raw.classRules.forEach((rule, index) => validateClassRule(rule, index, errors, seenRules));
  }

  if (errors.length > 0) {
    throw new DatasetValidationError(errors);
  }

  return {
    schemaVersion: raw.schemaVersion,
    datasetVersion: raw.datasetVersion,
    dgEntries: raw.dgEntries,
    classRules: raw.classRules,
  };
}

/**
 * Compact, non-sensitive summary for operator-facing logs. Never dumps row
 * contents — only counts.
 */
export function summarizeDataset(dataset) {
  const unNumbers = new Set(dataset.dgEntries.map((e) => e.unNumber));
  const variantCounts = new Map();
  for (const entry of dataset.dgEntries) {
    variantCounts.set(entry.unNumber, (variantCounts.get(entry.unNumber) ?? 0) + 1);
  }
  const multiVariantUnNumberCount = [...variantCounts.values()].filter((count) => count > 1).length;
  const primaryClasses = new Set(dataset.dgEntries.map((e) => e.primaryClass));

  return {
    datasetVersion: dataset.datasetVersion,
    dgEntryCount: dataset.dgEntries.length,
    uniqueUnNumberCount: unNumbers.size,
    classRuleCount: dataset.classRules.length,
    primaryClassCount: primaryClasses.size,
    multiVariantUnNumberCount,
  };
}

function sqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlStringOrNull(value) {
  return value === null ? 'NULL' : sqlString(value);
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Generates deterministic SQL that replaces the full dg_entries and
 * segregation_class_rules snapshot with the validated dataset, and upserts
 * only the two dataset-related app_metadata keys. Never touches migration
 * bookkeeping, unrelated tables, or app_metadata wholesale.
 */
export function buildSql(dataset) {
  const entries = [...dataset.dgEntries].sort(
    (a, b) => compareStrings(a.unNumber, b.unNumber) || compareStrings(a.variantKey, b.variantKey),
  );
  const rules = [...dataset.classRules].sort(
    (a, b) => compareStrings(a.classA, b.classA) || compareStrings(a.classB, b.classB),
  );

  const lines = [];
  lines.push('-- Generated by worker/scripts/dataset-import.mjs. Do not edit by hand.');
  lines.push('BEGIN TRANSACTION;');
  lines.push('DELETE FROM segregation_class_rules;');
  lines.push('DELETE FROM dg_entries;');

  if (entries.length > 0) {
    const values = entries
      .map(
        (e) =>
          `(${sqlString(e.unNumber)}, ${sqlString(e.variantKey)}, ${sqlString(e.primaryClass)}, ` +
          `${sqlString(JSON.stringify(e.subsidiaryRisks))}, ${sqlString(JSON.stringify(e.segregationGroups))}, ` +
          `${sqlString(JSON.stringify(e.segregationCodes))}, ${sqlStringOrNull(e.compatibilityGroup)})`,
      )
      .join(',\n  ');
    lines.push(
      'INSERT INTO dg_entries ' +
        '(un_number, variant_key, primary_class, subsidiary_risks_json, segregation_groups_json, segregation_codes_json, compatibility_group) ' +
        `VALUES\n  ${values};`,
    );
  }

  if (rules.length > 0) {
    const values = rules.map((r) => `(${sqlString(r.classA)}, ${sqlString(r.classB)}, ${r.level})`).join(',\n  ');
    lines.push(`INSERT INTO segregation_class_rules (class_a, class_b, level) VALUES\n  ${values};`);
  }

  lines.push(
    `INSERT INTO app_metadata (key, value) VALUES ('dataset_schema_version', ${sqlString(String(SCHEMA_VERSION))}) ` +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value;',
  );
  lines.push(
    `INSERT INTO app_metadata (key, value) VALUES ('dataset_version', ${sqlString(dataset.datasetVersion)}) ` +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value;',
  );
  lines.push('COMMIT;');

  return lines.join('\n') + '\n';
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  process.argv[1].replace(/\\/g, '/').endsWith('/scripts/dataset-import.mjs');

function printUsage() {
  console.error('Usage: node dataset-import.mjs <validate|build-sql> <input.json> [output.sql]');
}

async function main() {
  const [, , command, inputPath, outputPath] = process.argv;

  if ((command !== 'validate' && command !== 'build-sql') || !inputPath || (command === 'build-sql' && !outputPath)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { readFileSync, writeFileSync } = await import('node:fs');

  let raw;
  try {
    raw = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (error) {
    console.error(`Failed to read/parse ${inputPath}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let dataset;
  try {
    dataset = validateDataset(raw);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const summary = summarizeDataset(dataset);
  console.log(`Dataset version: ${summary.datasetVersion}`);
  console.log(`DG entries: ${summary.dgEntryCount}`);
  console.log(`Unique UN numbers: ${summary.uniqueUnNumberCount}`);
  console.log(`Class rules: ${summary.classRuleCount}`);
  console.log(`Primary classes: ${summary.primaryClassCount}`);
  console.log(`UN numbers with multiple variants: ${summary.multiVariantUnNumberCount}`);

  if (command === 'validate') {
    return;
  }

  writeFileSync(outputPath, buildSql(dataset), 'utf8');
  console.log(`Wrote ${outputPath}`);
}

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  });
}
