// Reproducible converter: authorized private DATA_TABLE_DGL.xlsx + Segregation.xlsx
// -> canonical dataset JSON matching the schema v2 import contract (dataset-import.mjs).
//
// Fail-closed by construction. The critical invariant is that no authorized
// source row may silently disappear because this converter does not
// understand it:
//
//   - every SEG.TABLE cell becomes a numeric rule, an "X" -> level-0 rule, an
//     omitted "*" Class 1 <-> Class 1 pair, or a hard conversion failure;
//   - every SG row becomes an automatically evaluable rule, an
//     ADDITIONAL_REQUIREMENT, a REVIEW_ONLY, a RESERVED, or a hard failure;
//   - every non-empty subsidiary-hazard cell becomes resolved hazard classes
//     or an explicit UNRESOLVED_* token.
//
// Unknown data never becomes CLEAR by omission. This module never invents
// regulatory meaning for ambiguous source content.
//
// Usage:
//   node scripts/authorized-dataset-convert.mjs \
//     --dgl private-data/DATA_TABLE_DGL.xlsx \
//     --segregation private-data/Segregation.xlsx \
//     --dataset-version authorized-source-v2 \
//     --output private-data/authorized-dataset.json

import { SCHEMA_VERSION, validateDataset } from './dataset-import.mjs';

export const ORDINARY_CLASSES = [
  '2.1', '2.2', '2.3', '3', '4.1', '4.2', '4.3', '5.1', '5.2', '6.1', '6.2', '7', '8', '9',
];

/**
 * The authorized matrix does not publish a row per Class 1 division — it
 * collapses them into these three labels. They are the labels used for every
 * Class 1 lookup, so a division is normalized into its group rather than
 * compared as a bare "1.1" against "1.1 1.2 1.5".
 */
export const CLASS1_MATRIX_LABELS = ['1.1 1.2 1.5', '1.3 1.6', '1.4'];

/** Every label the authorized SEG.TABLE publishes, in source order. */
export const ALL_MATRIX_LABELS = [...CLASS1_MATRIX_LABELS, ...ORDINARY_CLASSES];

const CLASS1_DIVISION_TO_LABEL = new Map([
  ['1.1', '1.1 1.2 1.5'],
  ['1.2', '1.1 1.2 1.5'],
  ['1.5', '1.1 1.2 1.5'],
  ['1.3', '1.3 1.6'],
  ['1.6', '1.3 1.6'],
  ['1.4', '1.4'],
]);

const CLASS1_PATTERN = /^1\.([1-6])([A-Za-z])?$/;
const CLASS_TOKEN_PATTERN = /^\d+(\.\d+)?$/;
const SP_REFERENCE_PATTERN = /^See\s+SP\s*(\d+)$/i;
const SGG_TOKEN_PATTERN = /^SGG\d+$/;
const SG_TOKEN_PATTERN = /^SG\d+$/;
const DASH_VALUES = new Set(['–', '-', '—']);

const REQUIRED_DGL_HEADERS = ['UN No.', 'Class or division', 'Subsidiary hazard(s)', 'Segregation'];
const DGL_SHEET_NAME = 'TRIM';
const SEG_SHEET_NAME = 'SEG.TABLE';
const SG_SHEET_NAME = 'SG';
const SEG_INFORMATIONAL_SHEETS = ['SW', 'SGG', 'HANDLING'];

/**
 * Structural expectation for the authorized SG sheet. A source revision that
 * changes the row count must be re-verified by a human rather than silently
 * absorbed, so a mismatch fails the conversion.
 */
export const EXPECTED_SG_ROW_COUNT = 77;

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
 *
 * The compatibility letter is preserved but never used to decide a level:
 * the authorized source does not publish the compatibility-group tables
 * needed to resolve Class 1 <-> Class 1.
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
 * Parses "Subsidiary hazard(s)" into a string array of hazard class tokens.
 *
 * Handles the separable authorized forms: a single class token, and
 * slash-, whitespace- or comma-delimited lists of them. A standalone "P"
 * is an orthogonal marine-pollutant marker rather than a hazard class, so it
 * is stripped before class parsing — dropping the whole cell because of it
 * (which is what previously lost "3 P"-style subsidiary risks) would silently
 * discard a real hazard. Tokens are deduplicated in source order.
 *
 * Everything that is not mechanically separable ("See SP###", "See 2.0.6.6",
 * Excel-date-corrupted cells, unrecognized rich content) becomes an explicit
 * UNRESOLVED_* token, so the array stays non-empty and the engine fails
 * closed to REVIEW_REQUIRED instead of dropping the value.
 */
export function parseSubsidiaryRisks(rawValue) {
  const { kind, text } = extractCellText(rawValue);

  if (kind === 'empty') return [];
  if (kind === 'number') return [String(text)];
  if (kind === 'date') return [`UNRESOLVED_SOURCE:DATE:${text.toISOString().slice(0, 10)}`];
  if (kind === 'unknown') return [`UNRESOLVED_SOURCE:${text}`];

  const trimmed = text.trim();
  if (trimmed === '' || DASH_VALUES.has(trimmed)) return [];

  const spMatch = SP_REFERENCE_PATTERN.exec(trimmed);
  if (spMatch) return [`UNRESOLVED_SP:SP${spMatch[1]}`];

  // Strip "P" only where it stands alone as its own token.
  const withoutMarker = trimmed.replace(/(^|[\s/,])P(?=$|[\s/,])/g, '$1').trim();

  // A cell that was only a dash plus the marker (e.g. "- P") records the
  // marker against no subsidiary hazard at all, so it resolves to an empty
  // list exactly like a bare dash.
  if (withoutMarker === '' || DASH_VALUES.has(withoutMarker)) return [];

  const tokens = withoutMarker
    .split(/[\s/,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length > 0 && tokens.every((token) => CLASS_TOKEN_PATTERN.test(token))) {
    const seen = new Set();
    const resolved = [];
    for (const token of tokens) {
      if (!seen.has(token)) {
        seen.add(token);
        resolved.push(token);
      }
    }
    return resolved;
  }

  return [`UNRESOLVED_SOURCE:${trimmed}`];
}

/**
 * Parses "Segregation" into segregationGroups (SGG#) and segregationCodes
 * (SG#). Any content that is not cleanly dash/blank or a whitespace-
 * separated list of SG#/SGG# tokens becomes a single UNRESOLVED_SOURCE
 * segregationCodes entry, which the engine treats as an unknown SG code and
 * therefore fails closed.
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

/** True for a raw Class 1 division token or an already-collapsed group label. */
export function isClass1Label(label) {
  return CLASS1_MATRIX_LABELS.includes(label) || CLASS1_DIVISION_TO_LABEL.has(label);
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
 * Builds ClassRule rows for every unordered pair (including self-pairs) among
 * the supplied matrix labels, in canonical classA <= classB order.
 *
 * Cell semantics:
 *   - "1".."4" -> that numeric level, sourceToken = the digit.
 *   - "X"      -> level 0, sourceToken "X". "X" means the base matrix
 *                 contributes no numeric level; it does NOT mean "stop
 *                 evaluating", so the row is emitted rather than omitted and
 *                 the engine still evaluates subsidiary risks and SG rules
 *                 on top of it.
 *   - "*"      -> omitted entirely. Resolving it needs the Class 1
 *                 compatibility-group tables, which the authorized source
 *                 does not contain, so the pair stays absent and the engine
 *                 fails closed to REVIEW_REQUIRED. A "*" anywhere outside
 *                 Class 1 <-> Class 1 is an unrecognized source shape and
 *                 hard-fails the conversion.
 *   - anything else -> hard failure. This converter never guesses matrix
 *                 semantics.
 */
export function buildClassRules(getCell, labels = ALL_MATRIX_LABELS) {
  const sorted = [...labels].sort();
  const rules = [];
  const counts = { numericPairs: 0, xLevelZeroPairs: 0, starOmittedPairs: 0 };

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i; j < sorted.length; j++) {
      const classA = sorted[i];
      const classB = sorted[j];
      const classified = classifyMatrixValue(getCell(classA, classB));

      if (classified.type === 'numeric') {
        rules.push({ classA, classB, level: classified.level, sourceToken: String(classified.level) });
        counts.numericPairs++;
      } else if (classified.type === 'X') {
        rules.push({ classA, classB, level: 0, sourceToken: 'X' });
        counts.xLevelZeroPairs++;
      } else if (classified.type === 'star') {
        if (!(isClass1Label(classA) && isClass1Label(classB))) {
          throw new Error(
            `Unexpected '*' outside the Class 1 <-> Class 1 region for pair (${classA}, ${classB}).`,
          );
        }
        counts.starOmittedPairs++;
      } else {
        throw new Error(
          `Unexpected segregation matrix value for pair (${classA}, ${classB}): ${JSON.stringify(classified.raw)}.`,
        );
      }
    }
  }

  return { rules, counts };
}

// ---------------------------------------------------------------------------
// SG sheet conversion
// ---------------------------------------------------------------------------

/**
 * Level wording published by the authorized source. Ordered longest-phrase
 * first so "separated longitudinally by an intervening complete compartment
 * or hold from" can never be matched as the shorter "separated from".
 */
export const SG_LEVEL_PHRASES = [
  ['separated longitudinally by an intervening complete compartment or hold from', 4],
  ['separated by a complete compartment or hold from', 3],
  ['separated from', 2],
  ['away from', 1],
];

/**
 * Wording that marks a non-level obligation. These rules must be surfaced
 * separately rather than folded into a 0-4 level, and must never be treated
 * as harmless notes.
 */
const ADDITIONAL_REQUIREMENT_PATTERNS = [
  /^in addition:/i,
  /^segregation from foodstuffs as in/i,
  /^shall not be stowed together with/i,
  /odour-absorbing cargoes/i,
  /there is no need to apply the provisions on segregation/i,
];

/**
 * Wording that carries a condition or exception this converter cannot prove
 * mechanically from two DG records — holder-content conditions, named
 * exclusions, compatibility-group semantics, cargo-context dependencies.
 * Any hit routes the rule to REVIEW_ONLY.
 */
const REVIEW_CONDITION_PATTERNS = [
  /\bexcept\b/i,
  /\bother than\b/i,
  /\bwhen containing\b/i,
  /compatibility group/i,
  /\bhowever\b/i,
  /\bif flashpoint\b/i,
  /^see tables\b/i,
  /^for packages carrying\b/i,
  /^for arsenic\b/i,
  /^for aerosols\b/i,
  /explosives containing/i,
];

/** Normalizes curly quotes/dashes-adjacent whitespace so matching is stable. */
export function normalizeSgSourceText(raw) {
  return String(raw ?? '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resolves a bare class/division token to matrix label(s), or null if unresolvable. */
export function resolveClassToken(token) {
  const normalized = token.trim();
  // Bare "1" targets the whole of Class 1, i.e. all three published rows.
  if (normalized === '1') return [...CLASS1_MATRIX_LABELS];
  if (CLASS1_DIVISION_TO_LABEL.has(normalized)) return [CLASS1_DIVISION_TO_LABEL.get(normalized)];
  if (ORDINARY_CLASSES.includes(normalized)) return [normalized];
  // Compatibility-letter targets such as "1.2G" have no published matrix row.
  return null;
}

/**
 * Resolves a prose target phrase ("class 3", "goods of classes 2.1 and 3",
 * "division 1.1, 1.2, and 1.5") to matrix labels. Returns null for any
 * target that is not an explicit class/division list — prose targets such as
 * "ammonium salts" or "combustible material" are not mechanically matchable
 * against a DG record and must fall through to REVIEW_ONLY.
 */
export function resolveClassTargets(rawText) {
  const text = String(rawText ?? '')
    .trim()
    .replace(/\.$/, '')
    .trim()
    .replace(/^goods of\s+/i, '');

  const match = /^(?:classes|class|divisions|division)\s+(.+)$/i.exec(text);
  if (!match) return null;

  const tokens = match[1]
    .split(/\s*(?:,|\band\b|\bor\b)\s*/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return null;

  const labels = [];
  for (const token of tokens) {
    const resolved = resolveClassToken(token);
    if (resolved === null) return null;
    for (const label of resolved) {
      if (!labels.includes(label)) labels.push(label);
    }
  }
  return labels;
}

function matchLevelPhrase(plainText) {
  const lower = plainText.toLowerCase();
  for (const [phrase, level] of SG_LEVEL_PHRASES) {
    const index = lower.indexOf(phrase);
    if (index !== -1) {
      return { level, remainder: plainText.slice(index + phrase.length).trim() };
    }
  }
  return null;
}

/**
 * Converts one authorized SG row into exactly one canonical sgRules entry.
 *
 * Classification order matters and is deliberate:
 *   1. "[Reserved]"                -> RESERVED
 *   2. non-level obligation wording -> ADDITIONAL_REQUIREMENT
 *   3. condition/exception wording  -> REVIEW_ONLY
 *   4. "Segregation as for ..."     -> AS_FOR_CLASS (or REVIEW_ONLY if the
 *                                      substituted class has no matrix row)
 *   5. level wording + target       -> DIRECT_SGG / DIRECT_UN / DIRECT_CLASS
 *                                      (or REVIEW_ONLY for a prose target)
 *   6. anything else                -> hard failure
 *
 * Step 3 runs before steps 4-5 so a conditional rule can never be reduced to
 * its unconditional-looking core, and step 6 means unrecognized wording stops
 * the conversion instead of quietly vanishing.
 */
export function parseSgRow(code, rawDescription) {
  const sourceText = normalizeSgSourceText(rawDescription);
  if (sourceText.length === 0) {
    throw new Error(`SG row "${code}" has an empty description.`);
  }

  const reviewOnly = { code, ruleType: 'REVIEW_ONLY', targets: [], level: null, sourceText };

  if (/^\[reserved\]$/i.test(sourceText)) {
    return { code, ruleType: 'RESERVED', targets: [], level: null, sourceText };
  }

  // Quote characters carry no meaning for matching, and the level phrases are
  // quoted in the source ("away from"), so compare against a quote-free copy.
  const plain = sourceText.replace(/["']/g, '').trim();

  if (ADDITIONAL_REQUIREMENT_PATTERNS.some((pattern) => pattern.test(plain))) {
    return { code, ruleType: 'ADDITIONAL_REQUIREMENT', targets: [], level: null, sourceText };
  }

  if (REVIEW_CONDITION_PATTERNS.some((pattern) => pattern.test(plain))) {
    return reviewOnly;
  }

  const asForClass = /^segregation as for(?: class)? (.+?)\.?$/i.exec(plain);
  if (asForClass) {
    const targets = resolveClassToken(asForClass[1]);
    if (targets === null) return reviewOnly;
    return { code, ruleType: 'AS_FOR_CLASS', targets, level: null, sourceText };
  }

  const matched = matchLevelPhrase(plain);
  if (matched === null) {
    throw new Error(
      `SG row "${code}" uses wording this converter does not recognize. ` +
        'Classify it explicitly rather than letting it fall through.',
    );
  }

  const { level, remainder } = matched;
  const target = remainder.replace(/\.$/, '').trim();

  const sggMatch = /^SGG(\d+)\b/i.exec(target);
  if (sggMatch) {
    return { code, ruleType: 'DIRECT_SGG', targets: [`SGG${sggMatch[1]}`], level, sourceText };
  }

  const unMatch = /\(UN\s*(\d{4})\)/i.exec(target);
  if (unMatch) {
    return { code, ruleType: 'DIRECT_UN', targets: [unMatch[1]], level, sourceText };
  }

  const classTargets = resolveClassTargets(target);
  if (classTargets !== null) {
    return { code, ruleType: 'DIRECT_CLASS', targets: classTargets, level, sourceText };
  }

  return reviewOnly;
}

/**
 * Reads the authorized "SG" sheet and produces exactly one sgRules row per
 * source row. Duplicate codes, malformed codes, empty descriptions and an
 * unexpected row count all fail the conversion.
 */
export function convertSgSheet(worksheet, { expectedRowCount = EXPECTED_SG_ROW_COUNT } = {}) {
  if (!worksheet) {
    throw new Error(`Segregation workbook is missing the required "${SG_SHEET_NAME}" sheet.`);
  }

  const sgRules = [];
  const seen = new Set();

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const codeText = extractCellText(row.getCell(1).value).text;
    const code = typeof codeText === 'string' ? codeText.trim() : '';

    if (code === '') {
      // A fully blank trailing row is skipped; a row with a description but no
      // code is a source shape this converter must not guess about.
      const descriptionText = extractCellText(row.getCell(2).value).text;
      if (descriptionText === null || String(descriptionText).trim() === '') continue;
      throw new Error(`SG sheet row ${rowNumber} has a description but no segregation code.`);
    }

    if (!SG_TOKEN_PATTERN.test(code)) {
      throw new Error(`SG sheet row ${rowNumber} has a malformed segregation code "${code}".`);
    }
    if (seen.has(code)) {
      throw new Error(`SG sheet contains duplicate segregation code "${code}".`);
    }
    seen.add(code);

    sgRules.push(parseSgRow(code, extractCellText(row.getCell(2).value).text));
  }

  if (expectedRowCount !== null && sgRules.length !== expectedRowCount) {
    throw new Error(
      `SG sheet produced ${sgRules.length} rule(s) but ${expectedRowCount} were expected. ` +
        'Re-verify the authorized source before changing this expectation.',
    );
  }

  const countsByType = {};
  for (const rule of sgRules) {
    countsByType[rule.ruleType] = (countsByType[rule.ruleType] ?? 0) + 1;
  }

  return { sgRules, counts: { sgRuleCount: sgRules.length, countsByType } };
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
    multipleSubsidiaryRiskEntries: 0,
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
    const unresolvedSubsidiary = subsidiaryRisks.filter((token) => token.startsWith('UNRESOLVED_'));
    if (subsidiaryRisks.length > 0) counts.subsidiaryRiskEntries++;
    if (unresolvedSubsidiary.length > 0) counts.unresolvedSubsidiaryEntries++;
    if (subsidiaryRisks.length - unresolvedSubsidiary.length > 1) counts.multipleSubsidiaryRiskEntries++;

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

/**
 * Reads the Segregation.xlsx "SEG.TABLE" sheet into ClassRule rows for the
 * complete authorized matrix — all 17 published labels, not just the ordinary
 * 14-class submatrix. Matrix labels are preserved exactly as the source
 * writes them, which is what makes the collapsed Class 1 rows usable for
 * Class 1 <-> non-Class-1 lookups.
 */
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

  const missingLabels = ALL_MATRIX_LABELS.filter((label) => !rowLabels.includes(label));
  if (missingLabels.length > 0) {
    throw new Error(`Segregation matrix is missing expected label(s): ${missingLabels.join(', ')}.`);
  }

  const unexpectedLabels = rowLabels.filter((label) => !ALL_MATRIX_LABELS.includes(label));
  if (unexpectedLabels.length > 0) {
    throw new Error(`Segregation matrix has unexpected label(s): ${unexpectedLabels.join(', ')}.`);
  }

  const { rules, counts } = buildClassRules(getCell, ALL_MATRIX_LABELS);

  return {
    classRules: rules,
    counts: { matrixLabelCount: rowLabels.length, matrixCellCount: rowLabels.length * colLabels.length, ...counts },
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
  const { sgRules, counts: sgCounts } = convertSgSheet(segWorkbook.getWorksheet(SG_SHEET_NAME));

  const dataset = {
    schemaVersion: SCHEMA_VERSION,
    datasetVersion: args['dataset-version'],
    dgEntries,
    classRules,
    sgRules,
  };

  const validated = validateDataset(dataset);

  const uniqueUnNumbers = new Set(validated.dgEntries.map((e) => e.unNumber));
  const variantCounts = new Map();
  for (const entry of validated.dgEntries) {
    variantCounts.set(entry.unNumber, (variantCounts.get(entry.unNumber) ?? 0) + 1);
  }
  const multiVariantUnNumberCount = [...variantCounts.values()].filter((count) => count > 1).length;

  console.log(`Dataset version: ${validated.datasetVersion}`);
  console.log(`Schema version: ${validated.schemaVersion}`);
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
  console.log(`Entries with 2+ resolved subsidiary risks: ${dglCounts.multipleSubsidiaryRiskEntries}`);
  console.log(`Entries with unresolved SP/source subsidiary values: ${dglCounts.unresolvedSubsidiaryEntries}`);
  console.log(`Entries with SG codes: ${dglCounts.sgCodeEntries}`);
  console.log(`Entries with SGG groups: ${dglCounts.sggGroupEntries}`);
  console.log(`Matrix labels: ${segCounts.matrixLabelCount} (cells: ${segCounts.matrixCellCount})`);
  console.log(`Class rules generated: ${classRules.length}`);
  console.log(`  numeric pairs: ${segCounts.numericPairs}`);
  console.log(`  X -> level 0 pairs: ${segCounts.xLevelZeroPairs}`);
  console.log(`  '*' pairs omitted (Class 1 <-> Class 1): ${segCounts.starOmittedPairs}`);
  console.log(`SG rules generated: ${sgCounts.sgRuleCount}`);
  for (const [ruleType, count] of Object.entries(sgCounts.countsByType).sort()) {
    console.log(`  ${ruleType}: ${count}`);
  }
  console.log(
    `UN normalization — whitespace-corrected: ${dglCounts.whitespaceCorrectedUn}, ` +
      `numeric: ${dglCounts.numericUn}, already canonical: ${dglCounts.canonicalUn}`,
  );

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
