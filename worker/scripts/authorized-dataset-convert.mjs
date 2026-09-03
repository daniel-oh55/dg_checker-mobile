// Reproducible converter: authorized private DATA_TABLE_DGL.xlsx + Segregation.xlsx
// -> canonical dataset JSON matching the PR 5 import contract (dataset-import.mjs).
//
// Fail-closed by construction: any source condition this converter does not
// have an explicit, mechanical rule for (Class 1 compatibility groups,
// subsidiary risks, SG/SGG segregation provisions, matrix "X"/"*" cells,
// malformed cell content) is either omitted from classRules or encoded as a
// non-empty, clearly-unresolved token so the existing engine's fail-closed
// checks (worker/src/domain/segregation.ts) route it to REVIEW_REQUIRED. This
// module never invents regulatory meaning for ambiguous source content.
//
// Usage:
//   node scripts/authorized-dataset-convert.mjs \
//     --dgl private-data/DATA_TABLE_DGL.xlsx \
//     --segregation private-data/Segregation.xlsx \
//     --dataset-version authorized-source-v1 \
//     --output private-data/authorized-dataset.json

import { SCHEMA_VERSION, validateDataset } from './dataset-import.mjs';

export const ORDINARY_CLASSES = [
  '2.1', '2.2', '2.3', '3', '4.1', '4.2', '4.3', '5.1', '5.2', '6.1', '6.2', '7', '8', '9',
];

const CLASS1_PATTERN = /^1\.([1-6])([A-Za-z])?$/;
const CLASS_TOKEN_PATTERN = /^\d+(\.\d+)?$/;
const SP_REFERENCE_PATTERN = /^See\s+SP\s*(\d+)$/i;
const SGG_TOKEN_PATTERN = /^SGG\d+$/;
const SG_TOKEN_PATTERN = /^SG\d+$/;
const DASH_VALUES = new Set(['–', '-', '—']);

const REQUIRED_DGL_HEADERS = ['UN No.', 'Class or division', 'Subsidiary hazard(s)', 'Segregation'];
const DGL_SHEET_NAME = 'TRIM';
const SEG_SHEET_NAME = 'SEG.TABLE';
const SEG_INFORMATIONAL_SHEETS = ['SW', 'SGG', 'SG', 'HANDLING'];

/**
 * Recursively unwraps ExcelJS cell values (hyperlink objects, rich text runs)
 * down to a primitive. Real cells in this workbook nest both ways: a
 * hyperlink whose `.text` is itself a rich-text run array.
 */
export function extractCellText(value) {
  if (value === null || value === undefined) {
    return { kind: 'empty', text: null };
  }
  if (value instanceof Date) {
    return { kind: 'date', text: value };
  }
  if (typeof value === 'number') {
    return { kind: 'number', text: value };
  }
  if (typeof value === 'string') {
    return { kind: 'string', text: value };
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return extractCellText(value.richText.map((run) => run.text).join(''));
    }
    if ('text' in value) {
      return extractCellText(value.text);
    }
    return { kind: 'unknown', text: JSON.stringify(value) };
  }
  return { kind: 'unknown', text: String(value) };
}

/** True for a merged cell that is a continuation of another (master) cell — i.e. it carries no independent value. */
export function isContinuationRow(unCell) {
  return Boolean(unCell && unCell.isMerged && unCell.master && unCell.master !== unCell);
}

/**
 * Normalizes a raw UN No. cell value to a canonical 4-digit string.
 * Handles the known real-data cases: plain numbers, already-canonical
 * 4-digit text (Class 1 rows), and text containing stray Unicode whitespace
 * (including NBSP) that mechanically collapses to 1-4 digits.
 */
export function normalizeUnNumberCell(rawValue) {
  const { kind, text } = extractCellText(rawValue);

  if (kind === 'number') {
    if (!Number.isInteger(text) || text < 0 || text > 9999) {
      return { status: 'rejected', value: null, raw: text };
    }
    return { status: 'numeric', value: String(text).padStart(4, '0'), raw: text };
  }

  if (kind === 'string') {
    const stripped = text.replace(/\s/gu, '');
    if (!/^[0-9]{1,4}$/.test(stripped)) {
      return { status: 'rejected', value: null, raw: text };
    }
    const value = stripped.padStart(4, '0');
    if (stripped !== text) {
      return { status: 'whitespace-corrected', value, raw: text };
    }
    return { status: stripped.length === 4 ? 'canonical' : 'numeric-text', value, raw: text };
  }

  return { status: 'rejected', value: null, raw: text };
}

/**
 * Splits a "Class or division" cell into primaryClass + compatibilityGroup.
 * Only the 14 ordinary SEG.TABLE labels and well-formed Class 1 divisions
 * ("1.1D", "1.4 S", ...) are recognized; anything else passes through as an
 * unmapped primaryClass, which naturally has no classRule and therefore
 * fails closed to REVIEW_REQUIRED without any special-case logic.
 */
export function parsePrimaryClass(rawValue) {
  const { kind, text } = extractCellText(rawValue);
  const normalized = (kind === 'number' ? String(text) : String(text ?? '')).trim().replace(/\s+/g, '');

  const class1Match = CLASS1_PATTERN.exec(normalized);
  if (class1Match) {
    return {
      category: 'class1',
      primaryClass: `1.${class1Match[1]}`,
      compatibilityGroup: class1Match[2] ? class1Match[2].toUpperCase() : null,
    };
  }

  if (ORDINARY_CLASSES.includes(normalized)) {
    return { category: 'ordinary', primaryClass: normalized, compatibilityGroup: null };
  }

  return { category: 'other', primaryClass: normalized, compatibilityGroup: null };
}

/**
 * Parses "Subsidiary hazard(s)" into a string array. Only a single class
 * token, a "/"-delimited list of class tokens, or dash/blank are resolved.
 * Everything else (space-delimited tokens, "P"-suffixed annotations,
 * "See SP###"/"See <section>" references, Excel-date-corrupted cells,
 * unrecognized rich content) becomes an explicit UNRESOLVED_* token so the
 * array stays non-empty and the engine fails closed.
 */
export function parseSubsidiaryRisks(rawValue) {
  const { kind, text } = extractCellText(rawValue);

  if (kind === 'empty') return [];
  if (kind === 'number') return [String(text)];
  if (kind === 'date') return [`UNRESOLVED_SOURCE:DATE:${text.toISOString().slice(0, 10)}`];
  if (kind === 'unknown') return [`UNRESOLVED_SOURCE:${text}`];

  const trimmed = text.trim();
  if (trimmed === '' || DASH_VALUES.has(trimmed)) return [];
  if (CLASS_TOKEN_PATTERN.test(trimmed)) return [trimmed];

  if (trimmed.includes('/')) {
    const parts = trimmed.split('/').map((part) => part.trim());
    if (parts.every((part) => CLASS_TOKEN_PATTERN.test(part))) {
      return parts;
    }
  }

  const spMatch = SP_REFERENCE_PATTERN.exec(trimmed);
  if (spMatch) return [`UNRESOLVED_SP:SP${spMatch[1]}`];

  return [`UNRESOLVED_SOURCE:${trimmed}`];
}

/**
 * Parses "Segregation" into segregationGroups (SGG#) and segregationCodes
 * (SG#). Any content that is not cleanly dash/blank or a whitespace-
 * separated list of SG#/SGG# tokens becomes a single UNRESOLVED_SOURCE
 * segregationCodes entry, which is non-empty and therefore fails closed.
 */
export function parseSegregationField(rawValue) {
  const { kind, text } = extractCellText(rawValue);

  if (kind === 'empty') return { segregationGroups: [], segregationCodes: [] };
  if (kind !== 'string') {
    const label = kind === 'date' ? text.toISOString() : String(text);
    return { segregationGroups: [], segregationCodes: [`UNRESOLVED_SOURCE:${label}`] };
  }

  const trimmed = text.trim();
  if (trimmed === '' || DASH_VALUES.has(trimmed)) {
    return { segregationGroups: [], segregationCodes: [] };
  }

  const tokens = trimmed.split(/\s+/);
  const groups = [];
  const codes = [];
  for (const token of tokens) {
    if (SGG_TOKEN_PATTERN.test(token)) {
      groups.push(token);
    } else if (SG_TOKEN_PATTERN.test(token)) {
      codes.push(token);
    } else {
      return { segregationGroups: [], segregationCodes: [`UNRESOLVED_SOURCE:${trimmed}`] };
    }
  }
  return { segregationGroups: groups, segregationCodes: codes };
}

/** Assigns deterministic V1/V2/V3... keys per UN number, in source-row order. */
export function createVariantKeyAssigner() {
  const counters = new Map();
  return function nextVariantKey(unNumber) {
    const count = (counters.get(unNumber) ?? 0) + 1;
    counters.set(unNumber, count);
    return `V${count}`;
  };
}

export function classifyMatrixValue(rawValue) {
  if (typeof rawValue === 'number' && Number.isInteger(rawValue) && rawValue >= 1 && rawValue <= 4) {
    return { type: 'numeric', level: rawValue };
  }
  if (rawValue === 'X') return { type: 'X' };
  if (rawValue === '*') return { type: 'star' };
  return { type: 'other', raw: rawValue };
}

/** Validates a labeled square matrix is square, has matching row/col label order, and is fully symmetric. */
export function validateMatrixSymmetry(rowLabels, colLabels, getCell) {
  if (rowLabels.length !== colLabels.length) {
    throw new Error(
      `Segregation matrix is not square: ${rowLabels.length} row labels vs ${colLabels.length} column labels.`,
    );
  }
  for (let i = 0; i < rowLabels.length; i++) {
    if (rowLabels[i] !== colLabels[i]) {
      throw new Error(
        `Segregation matrix row/column labels do not match at index ${i}: "${rowLabels[i]}" vs "${colLabels[i]}".`,
      );
    }
  }
  for (const a of rowLabels) {
    for (const b of colLabels) {
      const ab = String(getCell(a, b));
      const ba = String(getCell(b, a));
      if (ab !== ba) {
        throw new Error(`Segregation matrix is asymmetric for pair (${a}, ${b}): ${ab} vs ${ba}.`);
      }
    }
  }
}

/**
 * Builds ClassRule rows for every unordered pair (including self-pairs)
 * among the 14 ordinary SEG.TABLE classes, in canonical classA <= classB
 * order. "X" pairs are counted and omitted (no rule -> REVIEW_REQUIRED via
 * the existing engine). "*" or any other unexpected cell value hard-fails
 * the whole conversion — this converter never guesses matrix semantics.
 */
export function buildOrdinaryClassRules(getCell) {
  const sorted = [...ORDINARY_CLASSES].sort();
  const rules = [];
  let xPairCount = 0;

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i; j < sorted.length; j++) {
      const classA = sorted[i];
      const classB = sorted[j];
      const classified = classifyMatrixValue(getCell(classA, classB));

      if (classified.type === 'numeric') {
        rules.push({ classA, classB, level: classified.level });
      } else if (classified.type === 'X') {
        xPairCount++;
      } else if (classified.type === 'star') {
        throw new Error(`Unexpected '*' in the ordinary 14-class submatrix for pair (${classA}, ${classB}).`);
      } else {
        throw new Error(
          `Unexpected segregation matrix value for pair (${classA}, ${classB}): ${JSON.stringify(classified.raw)}.`,
        );
      }
    }
  }

  return { rules, xPairCount };
}

function buildHeaderIndex(headerRow, columnCount) {
  const index = new Map();
  for (let column = 1; column <= columnCount; column++) {
    const { text } = extractCellText(headerRow.getCell(column).value);
    const name = typeof text === 'string' ? text.trim() : null;
    if (name && !index.has(name)) {
      index.set(name, column);
    }
  }
  return index;
}

/**
 * Reads the DGL "TRIM" sheet and produces canonical DgEntry rows plus a
 * counts summary. Skips merged continuation rows (wrapped PSN text with no
 * independent UN/class/etc. identity) and rejects UN numbers that cannot
 * unambiguously normalize to 4 digits.
 */
export function convertDglSheet(worksheet) {
  if (!worksheet) {
    throw new Error(`DGL workbook is missing the required "${DGL_SHEET_NAME}" sheet.`);
  }

  const headerIndex = buildHeaderIndex(worksheet.getRow(1), worksheet.columnCount);
  const missingHeaders = REQUIRED_DGL_HEADERS.filter((name) => !headerIndex.has(name));
  if (missingHeaders.length > 0) {
    throw new Error(`DGL sheet is missing required header(s): ${missingHeaders.join(', ')}.`);
  }

  const unColumn = headerIndex.get('UN No.');
  const classColumn = headerIndex.get('Class or division');
  const subsidiaryColumn = headerIndex.get('Subsidiary hazard(s)');
  const segregationColumn = headerIndex.get('Segregation');

  const nextVariantKey = createVariantKeyAssigner();
  const dgEntries = [];
  const counts = {
    sourceRows: 0,
    continuationRowsSkipped: 0,
    rejectedRows: 0,
    canonicalUn: 0,
    whitespaceCorrectedUn: 0,
    numericUn: 0,
    class1Entries: 0,
    ordinaryEntries: 0,
    unmappedClassEntries: 0,
    subsidiaryRiskEntries: 0,
    unresolvedSubsidiaryEntries: 0,
    sgCodeEntries: 0,
    sggGroupEntries: 0,
  };

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const unCell = row.getCell(unColumn);

    if (isContinuationRow(unCell)) {
      counts.continuationRowsSkipped++;
      continue;
    }

    counts.sourceRows++;

    const un = normalizeUnNumberCell(unCell.value);
    if (un.status === 'rejected') {
      counts.rejectedRows++;
      continue;
    }
    if (un.status === 'whitespace-corrected') counts.whitespaceCorrectedUn++;
    else if (un.status === 'numeric') counts.numericUn++;
    else counts.canonicalUn++;

    const { category, primaryClass, compatibilityGroup } = parsePrimaryClass(row.getCell(classColumn).value);
    if (category === 'class1') counts.class1Entries++;
    else if (category === 'ordinary') counts.ordinaryEntries++;
    else counts.unmappedClassEntries++;

    const subsidiaryRisks = parseSubsidiaryRisks(row.getCell(subsidiaryColumn).value);
    if (subsidiaryRisks.length > 0) counts.subsidiaryRiskEntries++;
    if (subsidiaryRisks.some((token) => token.startsWith('UNRESOLVED_'))) counts.unresolvedSubsidiaryEntries++;

    const { segregationGroups, segregationCodes } = parseSegregationField(row.getCell(segregationColumn).value);
    if (segregationCodes.length > 0) counts.sgCodeEntries++;
    if (segregationGroups.length > 0) counts.sggGroupEntries++;

    dgEntries.push({
      unNumber: un.value,
      variantKey: nextVariantKey(un.value),
      primaryClass,
      subsidiaryRisks,
      segregationGroups,
      segregationCodes,
      compatibilityGroup,
    });
  }

  return { dgEntries, counts };
}

/** Reads the Segregation.xlsx "SEG.TABLE" sheet into numeric ClassRule rows for the 14 ordinary classes. */
export function convertSegTableSheet(worksheet) {
  if (!worksheet) {
    throw new Error(`Segregation workbook is missing the required "${SEG_SHEET_NAME}" sheet.`);
  }

  const columnCount = worksheet.columnCount;
  const colLabels = [];
  for (let c = 2; c <= columnCount; c++) {
    colLabels.push(String(extractCellText(worksheet.getRow(1).getCell(c).value).text).trim());
  }

  const rowLabels = [];
  const rows = new Map();
  for (let r = 2; r <= worksheet.rowCount; r++) {
    const label = String(extractCellText(worksheet.getRow(r).getCell(1).value).text).trim();
    rowLabels.push(label);
    const values = new Map();
    for (let c = 2; c <= columnCount; c++) {
      values.set(colLabels[c - 2], worksheet.getRow(r).getCell(c).value);
    }
    rows.set(label, values);
  }

  const getCell = (a, b) => rows.get(a)?.get(b);
  validateMatrixSymmetry(rowLabels, colLabels, getCell);

  const missingOrdinary = ORDINARY_CLASSES.filter((label) => !rowLabels.includes(label));
  if (missingOrdinary.length > 0) {
    throw new Error(`Segregation matrix is missing ordinary class label(s): ${missingOrdinary.join(', ')}.`);
  }

  const { rules, xPairCount } = buildOrdinaryClassRules(getCell);

  return {
    classRules: rules,
    counts: { matrixLabelCount: rowLabels.length, xPairCount },
  };
}

async function loadWorkbook(path) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      args[token.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function printUsage() {
  console.error(
    'Usage: node authorized-dataset-convert.mjs --dgl <DATA_TABLE_DGL.xlsx> --segregation <Segregation.xlsx> ' +
      '--dataset-version <version> --output <output.json>',
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dgl || !args.segregation || !args['dataset-version'] || !args.output) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const dglWorkbook = await loadWorkbook(args.dgl);
  const { dgEntries, counts: dglCounts } = convertDglSheet(dglWorkbook.getWorksheet(DGL_SHEET_NAME));

  const segWorkbook = await loadWorkbook(args.segregation);
  for (const sheetName of SEG_INFORMATIONAL_SHEETS) {
    if (!segWorkbook.getWorksheet(sheetName)) {
      throw new Error(`Segregation workbook is missing expected informational sheet "${sheetName}".`);
    }
  }
  const { classRules, counts: segCounts } = convertSegTableSheet(segWorkbook.getWorksheet(SEG_SHEET_NAME));

  const dataset = {
    schemaVersion: SCHEMA_VERSION,
    datasetVersion: args['dataset-version'],
    dgEntries,
    classRules,
  };

  const validated = validateDataset(dataset);

  const uniqueUnNumbers = new Set(validated.dgEntries.map((e) => e.unNumber));
  const variantCounts = new Map();
  for (const entry of validated.dgEntries) {
    variantCounts.set(entry.unNumber, (variantCounts.get(entry.unNumber) ?? 0) + 1);
  }
  const multiVariantUnNumberCount = [...variantCounts.values()].filter((count) => count > 1).length;

  console.log(`Dataset version: ${validated.datasetVersion}`);
  console.log(`Source DG rows: ${dglCounts.sourceRows}`);
  console.log(`Continuation rows skipped: ${dglCounts.continuationRowsSkipped}`);
  console.log(`Rejected/unresolved UN rows: ${dglCounts.rejectedRows}`);
  console.log(`Canonical DG entries: ${validated.dgEntries.length}`);
  console.log(`Unique UN numbers: ${uniqueUnNumbers.size}`);
  console.log(`Multi-variant UN numbers: ${multiVariantUnNumberCount}`);
  console.log(`Class 1 entries: ${dglCounts.class1Entries}`);
  console.log(`Ordinary-class entries: ${dglCounts.ordinaryEntries}`);
  console.log(`Unmapped/unusual primary class entries: ${dglCounts.unmappedClassEntries}`);
  console.log(`Entries with subsidiary risk(s): ${dglCounts.subsidiaryRiskEntries}`);
  console.log(`Entries with unresolved SP/source subsidiary values: ${dglCounts.unresolvedSubsidiaryEntries}`);
  console.log(`Entries with SG codes: ${dglCounts.sgCodeEntries}`);
  console.log(`Entries with SGG groups: ${dglCounts.sggGroupEntries}`);
  console.log(`Matrix labels (total, incl. Class 1 rows): ${segCounts.matrixLabelCount}`);
  console.log(`Matrix ordinary labels: ${ORDINARY_CLASSES.length}`);
  console.log(`Numeric classRules generated: ${classRules.length}`);
  console.log(`X ordinary pairs omitted: ${segCounts.xPairCount}`);
  console.log(`UN normalization — whitespace-corrected: ${dglCounts.whitespaceCorrectedUn}, numeric: ${dglCounts.numericUn}, already canonical: ${dglCounts.canonicalUn}`);

  const { writeFileSync } = await import('node:fs');
  writeFileSync(args.output, JSON.stringify(validated, null, 2), 'utf8');
  console.log(`Wrote ${args.output}`);
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  process.argv[1].replace(/\\/g, '/').endsWith('/scripts/authorized-dataset-convert.mjs');

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  });
}
