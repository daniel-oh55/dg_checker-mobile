// Synthetic-only tests for the authorized dataset converter. No real/authorized
// source rows are used anywhere in this file — only obviously-synthetic UN
// numbers (9001+) and structural class labels, per PR 9's testing contract.
// Run with Node's built-in test runner (`node --test`), not Vitest/Workers.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ORDINARY_CLASSES,
  buildOrdinaryClassRules,
  classifyMatrixValue,
  convertDglSheet,
  createVariantKeyAssigner,
  extractCellText,
  isContinuationRow,
  normalizeUnNumberCell,
  parsePrimaryClass,
  parseSegregationField,
  parseSubsidiaryRisks,
  validateMatrixSymmetry,
} from '../../scripts/authorized-dataset-convert.mjs';

// --- Fake ExcelJS-shaped worksheet for convertDglSheet tests -----------------

function cell(value) {
  return { value, isMerged: false, master: null };
}

function continuationCell(masterCellRef) {
  return { value: masterCellRef.value, isMerged: true, master: masterCellRef };
}

function makeDglWorksheet(headerNames, dataRows) {
  const rows = [headerNames.map((name) => cell(name)), ...dataRows];
  return {
    rowCount: rows.length,
    columnCount: headerNames.length,
    getRow(rowNumber) {
      const rowCells = rows[rowNumber - 1];
      return {
        getCell(columnNumber) {
          return rowCells[columnNumber - 1];
        },
      };
    },
  };
}

const HEADERS = ['UN No.', 'Proper shipping name (PSN)', 'Class or division', 'Subsidiary hazard(s)', 'Segregation'];

describe('extractCellText', () => {
  it('unwraps hyperlink objects and nested rich text', () => {
    assert.deepEqual(extractCellText('6.1'), { kind: 'string', text: '6.1' });
    assert.deepEqual(extractCellText({ text: '8', hyperlink: 'https://example.test' }), { kind: 'string', text: '8' });
    assert.deepEqual(extractCellText({ richText: [{ text: 'foo' }, { text: 'bar' }] }), { kind: 'string', text: 'foobar' });
    assert.deepEqual(
      extractCellText({ text: { richText: [{ text: '– ' }, { text: 'P' }] } }),
      { kind: 'string', text: '– P' },
    );
  });

  it('classifies empty, number, date, and unknown cells', () => {
    assert.equal(extractCellText(null).kind, 'empty');
    assert.equal(extractCellText(undefined).kind, 'empty');
    assert.equal(extractCellText(42).kind, 'number');
    assert.equal(extractCellText(new Date('2025-03-08')).kind, 'date');
    assert.equal(extractCellText({ formula: 'A1' }).kind, 'unknown');
  });
});

describe('normalizeUnNumberCell — UN number normalization', () => {
  it('zero-pads a plain numeric UN number', () => {
    assert.deepEqual(normalizeUnNumberCell(9001), { status: 'numeric', value: '9001', raw: 9001 });
    assert.deepEqual(normalizeUnNumberCell(7), { status: 'numeric', value: '0007', raw: 7 });
  });

  it('accepts already-canonical 4-digit text', () => {
    assert.deepEqual(normalizeUnNumberCell('9001'), { status: 'canonical', value: '9001', raw: '9001' });
  });

  it('mechanically strips embedded Unicode whitespace (including NBSP) before padding', () => {
    const result = normalizeUnNumberCell('9 001');
    assert.equal(result.status, 'whitespace-corrected');
    assert.equal(result.value, '9001');
  });

  it('rejects text that cannot unambiguously become exactly four digits', () => {
    assert.equal(normalizeUnNumberCell('UN9001').status, 'rejected');
    assert.equal(normalizeUnNumberCell('90A1').status, 'rejected');
    assert.equal(normalizeUnNumberCell('90015').status, 'rejected');
    assert.equal(normalizeUnNumberCell(null).status, 'rejected');
  });
});

describe('parsePrimaryClass — ordinary and Class 1 parsing', () => {
  it('recognizes ordinary SEG.TABLE classes', () => {
    assert.deepEqual(parsePrimaryClass('3'), { category: 'ordinary', primaryClass: '3', compatibilityGroup: null });
    assert.deepEqual(parsePrimaryClass({ text: '8' }), { category: 'ordinary', primaryClass: '8', compatibilityGroup: null });
  });

  it('splits Class 1 division from its compatibility group suffix', () => {
    assert.deepEqual(parsePrimaryClass('1.4S'), { category: 'class1', primaryClass: '1.4', compatibilityGroup: 'S' });
    assert.deepEqual(parsePrimaryClass('1.1 D'), { category: 'class1', primaryClass: '1.1', compatibilityGroup: 'D' });
    assert.deepEqual(parsePrimaryClass('1.2 F'), { category: 'class1', primaryClass: '1.2', compatibilityGroup: 'F' });
  });

  it('passes through an unmapped class value without fabricating a category', () => {
    const result = parsePrimaryClass('2');
    assert.equal(result.category, 'other');
    assert.equal(result.primaryClass, '2');
  });
});

describe('parseSubsidiaryRisks — fail-closed subsidiary hazard parsing', () => {
  it('resolves dash/blank to an empty array', () => {
    assert.deepEqual(parseSubsidiaryRisks('–'), []);
    assert.deepEqual(parseSubsidiaryRisks(null), []);
  });

  it('resolves a single class token', () => {
    assert.deepEqual(parseSubsidiaryRisks('6.1'), ['6.1']);
    assert.deepEqual(parseSubsidiaryRisks({ text: '8' }), ['8']);
  });

  it('splits a clean slash-delimited list', () => {
    assert.deepEqual(parseSubsidiaryRisks('6.1/8'), ['6.1', '8']);
    assert.deepEqual(parseSubsidiaryRisks('3/6.1'), ['3', '6.1']);
  });

  it('keeps "See SP###" as a distinct, non-empty unresolved token', () => {
    const result = parseSubsidiaryRisks('See SP172');
    assert.deepEqual(result, ['UNRESOLVED_SP:SP172']);
    assert.ok(result.length > 0);
  });

  it('keeps malformed subsidiary content (space-delimited, "P"-suffixed, corrupted dates) non-empty and unresolved', () => {
    assert.deepEqual(parseSubsidiaryRisks('6.1 P'), ['UNRESOLVED_SOURCE:6.1 P']);
    assert.deepEqual(parseSubsidiaryRisks('3 8'), ['UNRESOLVED_SOURCE:3 8']);
    assert.deepEqual(parseSubsidiaryRisks('5.1/8 P'), ['UNRESOLVED_SOURCE:5.1/8 P']);

    const dateResult = parseSubsidiaryRisks(new Date('2025-03-08T00:00:00.000Z'));
    assert.equal(dateResult.length, 1);
    assert.ok(dateResult[0].startsWith('UNRESOLVED_SOURCE:DATE:'));
  });
});

describe('parseSegregationField — SG vs SGG extraction', () => {
  it('resolves dash/blank to empty arrays', () => {
    assert.deepEqual(parseSegregationField('–'), { segregationGroups: [], segregationCodes: [] });
  });

  it('separates SGG group tokens from SG code tokens', () => {
    assert.deepEqual(parseSegregationField('SGG2 SG27 SG31'), {
      segregationGroups: ['SGG2'],
      segregationCodes: ['SG27', 'SG31'],
    });
  });

  it('keeps unrecognized segregation content non-empty and unresolved', () => {
    const result = parseSegregationField('See entry above.');
    assert.deepEqual(result.segregationGroups, []);
    assert.equal(result.segregationCodes.length, 1);
    assert.ok(result.segregationCodes[0].startsWith('UNRESOLVED_SOURCE:'));
  });
});

describe('createVariantKeyAssigner — deterministic V1/V2/V3 keys', () => {
  it('assigns distinct, deterministic keys per UN number in call order', () => {
    const next = createVariantKeyAssigner();
    assert.equal(next('9001'), 'V1');
    assert.equal(next('9002'), 'V1');
    assert.equal(next('9001'), 'V2');
    assert.equal(next('9001'), 'V3');
    assert.equal(next('9002'), 'V2');
  });
});

describe('isContinuationRow — merged-row detection', () => {
  it('flags a non-master merged cell as a continuation row', () => {
    const master = cell(9001);
    assert.equal(isContinuationRow(master), false);
    assert.equal(isContinuationRow(continuationCell(master)), true);
  });

  it('does not flag an unmerged cell', () => {
    assert.equal(isContinuationRow(cell(9001)), false);
  });
});

describe('classifyMatrixValue / buildOrdinaryClassRules — SEG.TABLE matrix policy', () => {
  function allClearMatrix(overrides) {
    const values = new Map();
    for (const a of ORDINARY_CLASSES) {
      for (const b of ORDINARY_CLASSES) {
        values.set(`${a}|${b}`, 2);
      }
    }
    for (const [key, value] of Object.entries(overrides ?? {})) {
      values.set(key, value);
    }
    return (a, b) => values.get(`${a}|${b}`);
  }

  it('generates a ClassRule for numeric 1-4 matrix cells', () => {
    const getCell = allClearMatrix();
    const { rules, xPairCount } = buildOrdinaryClassRules(getCell);
    assert.equal(xPairCount, 0);
    const expectedPairCount = (ORDINARY_CLASSES.length * (ORDINARY_CLASSES.length + 1)) / 2;
    assert.equal(rules.length, expectedPairCount);
    for (const rule of rules) {
      assert.ok(rule.classA <= rule.classB, 'rule must use canonical classA <= classB ordering');
      assert.equal(rule.level, 2);
    }
  });

  it('omits "X" pairs from classRules and counts them', () => {
    const getCell = allClearMatrix({ '3|8': 'X', '8|3': 'X' });
    const { rules, xPairCount } = buildOrdinaryClassRules(getCell);
    assert.equal(xPairCount, 1);
    assert.equal(rules.some((r) => r.classA === '3' && r.classB === '8'), false);
  });

  it('never coerces "*" into a numeric level — it hard-fails the ordinary submatrix', () => {
    const getCell = allClearMatrix({ '3|8': '*', '8|3': '*' });
    assert.throws(() => buildOrdinaryClassRules(getCell), /Unexpected '\*'/);
  });

  it('fails on an unknown/unexpected matrix symbol rather than fabricating a rule', () => {
    const getCell = allClearMatrix({ '3|8': 'Y', '8|3': 'Y' });
    assert.throws(() => buildOrdinaryClassRules(getCell), /Unexpected segregation matrix value/);
  });

  it('classifies raw matrix values correctly', () => {
    assert.deepEqual(classifyMatrixValue(4), { type: 'numeric', level: 4 });
    assert.deepEqual(classifyMatrixValue('X'), { type: 'X' });
    assert.deepEqual(classifyMatrixValue('*'), { type: 'star' });
  });
});

describe('validateMatrixSymmetry', () => {
  const labels = ['A', 'B', 'C'];

  it('accepts a fully symmetric square matrix', () => {
    const values = { 'A|A': 1, 'A|B': 2, 'A|C': 3, 'B|A': 2, 'B|B': 1, 'B|C': 4, 'C|A': 3, 'C|B': 4, 'C|C': 1 };
    const getCell = (a, b) => values[`${a}|${b}`];
    assert.doesNotThrow(() => validateMatrixSymmetry(labels, labels, getCell));
  });

  it('fails on an asymmetric matrix', () => {
    const values = { 'A|A': 1, 'A|B': 2, 'A|C': 3, 'B|A': 9, 'B|B': 1, 'B|C': 4, 'C|A': 3, 'C|B': 4, 'C|C': 1 };
    const getCell = (a, b) => values[`${a}|${b}`];
    assert.throws(() => validateMatrixSymmetry(labels, labels, getCell), /asymmetric/);
  });

  it('fails when row and column labels do not match', () => {
    assert.throws(() => validateMatrixSymmetry(['A', 'B'], ['A', 'X'], () => 1), /do not match/);
  });
});

describe('convertDglSheet — full-row pipeline', () => {
  it('skips merged continuation rows and reports the skipped count', () => {
    const masterUn = cell(9010);
    const worksheet = makeDglWorksheet(HEADERS, [
      [masterUn, cell('SYNTHETIC ENTRY (a)'), cell('3'), cell('–'), cell('–')],
      [continuationCell(masterUn), cell('SYNTHETIC ENTRY (b)'), cell('3'), cell('–'), cell('–')],
      [continuationCell(masterUn), cell('SYNTHETIC ENTRY (c)'), cell('3'), cell('–'), cell('–')],
      [cell(9011), cell('SYNTHETIC ENTRY 2'), cell('8'), cell('–'), cell('–')],
    ]);

    const { dgEntries, counts } = convertDglSheet(worksheet);
    assert.equal(counts.continuationRowsSkipped, 2);
    assert.equal(counts.sourceRows, 2);
    assert.equal(dgEntries.length, 2);
    assert.deepEqual(dgEntries.map((e) => e.unNumber), ['9010', '9011']);
  });

  it('assigns deterministic distinct variant keys to duplicate UN rows', () => {
    const worksheet = makeDglWorksheet(HEADERS, [
      [cell(9020), cell('SYNTHETIC VARIANT A'), cell('3'), cell('–'), cell('–')],
      [cell(9020), cell('SYNTHETIC VARIANT B'), cell('4.1'), cell('–'), cell('–')],
      [cell(9020), cell('SYNTHETIC VARIANT C'), cell('8'), cell('–'), cell('–')],
    ]);

    const { dgEntries } = convertDglSheet(worksheet);
    assert.deepEqual(
      dgEntries.map((e) => [e.unNumber, e.variantKey]),
      [
        ['9020', 'V1'],
        ['9020', 'V2'],
        ['9020', 'V3'],
      ],
    );
  });

  it('never leaks descriptive DGL fields (PSN, etc.) into the canonical entry', () => {
    const worksheet = makeDglWorksheet(HEADERS, [
      [cell(9030), cell('SOME SYNTHETIC PROPER SHIPPING NAME'), cell('3'), cell('–'), cell('–')],
    ]);

    const { dgEntries } = convertDglSheet(worksheet);
    assert.deepEqual(Object.keys(dgEntries[0]).sort(), [
      'compatibilityGroup',
      'primaryClass',
      'segregationCodes',
      'segregationGroups',
      'subsidiaryRisks',
      'unNumber',
      'variantKey',
    ]);
  });

  it('throws when a required header is missing (no silent column-shift guessing)', () => {
    const worksheet = makeDglWorksheet(
      ['UN No.', 'Proper shipping name (PSN)', 'Subsidiary hazard(s)', 'Segregation'],
      [[cell(9040), cell('X'), cell('–'), cell('–')]],
    );
    assert.throws(() => convertDglSheet(worksheet), /missing required header/);
  });
});
