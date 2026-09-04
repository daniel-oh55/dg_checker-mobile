// Synthetic-only tests for the authorized SG sheet converter. Every wording
// below is synthetic phrasing built from the *structural* vocabulary the
// converter recognizes ("away from", "separated from", "[Reserved]", ...);
// no authorized SG row text is reproduced here, and every UN number / group
// code is in the reserved synthetic 9000+ range.
// Run with Node's built-in test runner (`node --test`), not Vitest/Workers.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CLASS1_MATRIX_LABELS,
  convertSgSheet,
  parseSgRow,
  resolveClassTargets,
  resolveClassToken,
} from '../../scripts/authorized-dataset-convert.mjs';

function makeSgWorksheet(dataRows) {
  const rows = [['Segregation code', 'Description'], ...dataRows];
  return {
    rowCount: rows.length,
    columnCount: 2,
    getRow(rowNumber) {
      const rowCells = rows[rowNumber - 1];
      return {
        getCell(columnNumber) {
          return { value: rowCells[columnNumber - 1] ?? null };
        },
      };
    },
  };
}

function convertRows(dataRows) {
  return convertSgSheet(makeSgWorksheet(dataRows), { expectedRowCount: dataRows.length });
}

describe('resolveClassToken / resolveClassTargets — class target normalization', () => {
  it('resolves an ordinary class to itself', () => {
    assert.deepEqual(resolveClassToken('3'), ['3']);
    assert.deepEqual(resolveClassToken('5.1'), ['5.1']);
  });

  it('collapses a Class 1 division into its published matrix group', () => {
    assert.deepEqual(resolveClassToken('1.1'), ['1.1 1.2 1.5']);
    assert.deepEqual(resolveClassToken('1.5'), ['1.1 1.2 1.5']);
    assert.deepEqual(resolveClassToken('1.6'), ['1.3 1.6']);
    assert.deepEqual(resolveClassToken('1.4'), ['1.4']);
  });

  it('expands a bare "1" target to every published Class 1 group row', () => {
    assert.deepEqual(resolveClassToken('1'), CLASS1_MATRIX_LABELS);
  });

  it('refuses a compatibility-letter target that has no published matrix row', () => {
    assert.equal(resolveClassToken('1.2G'), null);
    assert.equal(resolveClassToken('1.4S'), null);
  });

  it('never resolves a broad Class 1 target by naive string equality', () => {
    // Comparing "1" directly against the collapsed label silently matches
    // nothing, which is what broke broad-target rules in the reference
    // implementation.
    assert.notDeepEqual(resolveClassToken('1'), ['1']);
    assert.ok(resolveClassToken('1').includes('1.1 1.2 1.5'));
  });

  it('resolves multi-class and multi-division target phrases', () => {
    assert.deepEqual(resolveClassTargets('class 3'), ['3']);
    assert.deepEqual(resolveClassTargets('goods of classes 2.1 and 3'), ['2.1', '3']);
    assert.deepEqual(resolveClassTargets('division 1.1, 1.2, and 1.5'), ['1.1 1.2 1.5']);
    assert.deepEqual(resolveClassTargets('class 1'), CLASS1_MATRIX_LABELS);
  });

  it('returns null for a prose target that is not a class list', () => {
    assert.equal(resolveClassTargets('synthetic prose target'), null);
    assert.equal(resolveClassTargets('combustible material'), null);
  });
});

describe('parseSgRow — level wording', () => {
  it('maps each authorized level phrase to its numeric level', () => {
    assert.equal(parseSgRow('SG9001', 'Stow “away from” class 3.').level, 1);
    assert.equal(parseSgRow('SG9002', 'Stow “separated from” class 3.').level, 2);
    assert.equal(
      parseSgRow('SG9003', 'Stow “separated by a complete compartment or hold from” class 3.').level,
      3,
    );
    assert.equal(
      parseSgRow(
        'SG9004',
        'Stow “separated longitudinally by an intervening complete compartment or hold from” class 3.',
      ).level,
      4,
    );
  });

  it('matches the longest level phrase first rather than a shorter substring', () => {
    const rule = parseSgRow(
      'SG9005',
      'Stow “separated longitudinally by an intervening complete compartment or hold from” class 8.',
    );

    assert.equal(rule.level, 4);
    assert.notEqual(rule.level, 2);
    assert.deepEqual(rule.targets, ['8']);
  });

  it('reads level wording written with straight quotes too', () => {
    assert.equal(parseSgRow('SG9006', 'Stow "away from" class 3.').level, 1);
  });
});

describe('parseSgRow — rule classification', () => {
  it('classifies a class target as DIRECT_CLASS', () => {
    const rule = parseSgRow('SG9010', 'Stow “separated from” class 5.1.');
    assert.equal(rule.ruleType, 'DIRECT_CLASS');
    assert.deepEqual(rule.targets, ['5.1']);
    assert.equal(rule.level, 2);
  });

  it('classifies a broad Class 1 target through explicit group normalization', () => {
    const rule = parseSgRow('SG9011', 'Stow “away from” class 1.');
    assert.equal(rule.ruleType, 'DIRECT_CLASS');
    assert.deepEqual(rule.targets, CLASS1_MATRIX_LABELS);
  });

  it('classifies a multi-class target as DIRECT_CLASS with every class listed', () => {
    const rule = parseSgRow('SG9012', 'Stow “separated from” goods of classes 2.1 and 3.');
    assert.equal(rule.ruleType, 'DIRECT_CLASS');
    assert.deepEqual(rule.targets, ['2.1', '3']);
  });

  it('classifies an SGG target as DIRECT_SGG', () => {
    const rule = parseSgRow('SG9013', 'Stow “separated from” SGG9001 – synthetic group.');
    assert.equal(rule.ruleType, 'DIRECT_SGG');
    assert.deepEqual(rule.targets, ['SGG9001']);
    assert.equal(rule.level, 2);
  });

  it('classifies a specific-UN target as DIRECT_UN using canonical 4-digit matching', () => {
    const rule = parseSgRow('SG9014', 'Stow “separated from” SYNTHETIC SUBSTANCE (UN 9001).');
    assert.equal(rule.ruleType, 'DIRECT_UN');
    assert.deepEqual(rule.targets, ['9001']);
    assert.equal(rule.level, 2);
  });

  it('classifies a substituted class as AS_FOR_CLASS with no level of its own', () => {
    const rule = parseSgRow('SG9015', 'Segregation as for class 2.1.');
    assert.equal(rule.ruleType, 'AS_FOR_CLASS');
    assert.deepEqual(rule.targets, ['2.1']);
    assert.equal(rule.level, null);
  });

  it('classifies a non-level obligation as ADDITIONAL_REQUIREMENT, not as a level', () => {
    const rule = parseSgRow('SG9016', 'In addition: a synthetic stowage distance obligation applies.');
    assert.equal(rule.ruleType, 'ADDITIONAL_REQUIREMENT');
    assert.deepEqual(rule.targets, []);
    assert.equal(rule.level, null);
  });

  it('classifies a cargo-context obligation as ADDITIONAL_REQUIREMENT rather than a class rule', () => {
    const rule = parseSgRow('SG9017', 'Stow “separated from” odour-absorbing cargoes.');
    assert.equal(rule.ruleType, 'ADDITIONAL_REQUIREMENT');
    assert.equal(rule.level, null);
  });

  it('classifies a "[Reserved]" row as RESERVED', () => {
    const rule = parseSgRow('SG9018', '[Reserved]');
    assert.equal(rule.ruleType, 'RESERVED');
    assert.deepEqual(rule.targets, []);
    assert.equal(rule.level, null);
  });

  it('classifies a prose target as REVIEW_ONLY rather than guessing a match', () => {
    const rule = parseSgRow('SG9019', 'Stow “separated from” synthetic prose substance.');
    assert.equal(rule.ruleType, 'REVIEW_ONLY');
    assert.deepEqual(rule.targets, []);
    assert.equal(rule.level, null);
  });

  it('classifies an AS_FOR_CLASS target with no published matrix row as REVIEW_ONLY', () => {
    assert.equal(parseSgRow('SG9020', 'Segregation as for class 1.2G.').ruleType, 'REVIEW_ONLY');
    assert.equal(parseSgRow('SG9021', 'Segregation as for 1.4G.').ruleType, 'REVIEW_ONLY');
  });

  it('classifies conditional and excepting wording as REVIEW_ONLY', () => {
    const conditional = [
      'Stow “separated from” class 1 except for division 1.4S.',
      'Stow “separated from” SGG9001 – synthetic group other than SYNTHETIC ITEM (UN 9002).',
      'When containing synthetic compounds, “separated from” SGG9001 – synthetic group.',
      'Stow “separated from” class 1 except from explosives of compatibility group J.',
      'If flashpoint 60°C c.c. or below, segregation as for class 3.',
      'Segregation as for class 8. However, in relation to class 7, no segregation needs to be applied.',
      'See tables in 7.2.6.3.',
      'For packages carrying a synthetic subsidiary label, segregation as for class 3.',
      'For AEROSOLS with a synthetic capacity limit: segregation as for class 9.',
      'Stow “separated from” explosives containing synthetic compounds.',
    ];

    for (const description of conditional) {
      assert.equal(
        parseSgRow('SG9022', description).ruleType,
        'REVIEW_ONLY',
        `expected REVIEW_ONLY for: ${description}`,
      );
    }
  });

  it('does not reduce a conditional rule to its unconditional-looking core', () => {
    // The level phrase and the class target are both present and mechanically
    // readable, but the "except" clause is not — so nothing is applied.
    const rule = parseSgRow('SG9023', 'Stow “separated from” class 1 except for division 1.4S.');
    assert.equal(rule.ruleType, 'REVIEW_ONLY');
    assert.equal(rule.level, null);
    assert.deepEqual(rule.targets, []);
  });

  it('preserves the source text on every classification', () => {
    const descriptions = ['[Reserved]', 'Stow “away from” class 3.', 'Segregation as for class 3.'];
    for (const description of descriptions) {
      assert.ok(parseSgRow('SG9024', description).sourceText.length > 0);
    }
  });

  it('fails closed on wording it does not recognize instead of dropping the row', () => {
    assert.throws(
      () => parseSgRow('SG9025', 'Synthetic wording with no recognizable structure at all.'),
      /does not recognize/,
    );
  });

  it('fails on an empty description', () => {
    assert.throws(() => parseSgRow('SG9026', ''), /empty description/);
  });
});

describe('convertSgSheet — structural integrity', () => {
  it('produces exactly one rule per source row, with no code lost', () => {
    const { sgRules, counts } = convertRows([
      ['SG9001', 'Stow “away from” class 3.'],
      ['SG9002', 'Stow “separated from” SGG9001 – synthetic group.'],
      ['SG9003', '[Reserved]'],
      ['SG9004', 'In addition: a synthetic obligation applies.'],
      ['SG9005', 'Stow “separated from” synthetic prose substance.'],
    ]);

    assert.equal(sgRules.length, 5);
    assert.equal(counts.sgRuleCount, 5);
    assert.deepEqual(
      sgRules.map((rule) => rule.code),
      ['SG9001', 'SG9002', 'SG9003', 'SG9004', 'SG9005'],
    );
  });

  it('assigns every row to exactly one of the canonical rule types', () => {
    const { sgRules } = convertRows([
      ['SG9001', 'Stow “away from” class 3.'],
      ['SG9002', 'Stow “separated from” SGG9001 – synthetic group.'],
      ['SG9003', 'Stow “separated from” SYNTHETIC SUBSTANCE (UN 9001).'],
      ['SG9004', 'Segregation as for class 3.'],
      ['SG9005', 'In addition: a synthetic obligation applies.'],
      ['SG9006', 'Stow “separated from” synthetic prose substance.'],
      ['SG9007', '[Reserved]'],
    ]);

    assert.deepEqual(
      sgRules.map((rule) => rule.ruleType),
      [
        'DIRECT_CLASS',
        'DIRECT_SGG',
        'DIRECT_UN',
        'AS_FOR_CLASS',
        'ADDITIONAL_REQUIREMENT',
        'REVIEW_ONLY',
        'RESERVED',
      ],
    );
  });

  it('reports counts by rule type', () => {
    const { counts } = convertRows([
      ['SG9001', 'Stow “away from” class 3.'],
      ['SG9002', 'Stow “separated from” class 8.'],
      ['SG9003', '[Reserved]'],
    ]);

    assert.deepEqual(counts.countsByType, { DIRECT_CLASS: 2, RESERVED: 1 });
  });

  it('fails on a duplicate SG code', () => {
    assert.throws(
      () =>
        convertRows([
          ['SG9001', 'Stow “away from” class 3.'],
          ['SG9001', 'Stow “away from” class 8.'],
        ]),
      /duplicate segregation code/,
    );
  });

  it('fails on a malformed SG code', () => {
    assert.throws(
      () => convertRows([['NOT_A_CODE', 'Stow “away from” class 3.']]),
      /malformed segregation code/,
    );
  });

  it('fails on a description with no code rather than dropping the provision', () => {
    assert.throws(
      () => convertRows([[null, 'Stow “away from” class 3.']]),
      /description but no segregation code/,
    );
  });

  it('skips a fully blank trailing row', () => {
    const worksheet = makeSgWorksheet([['SG9001', 'Stow “away from” class 3.'], [null, null]]);
    const { sgRules } = convertSgSheet(worksheet, { expectedRowCount: 1 });

    assert.equal(sgRules.length, 1);
  });

  it('fails when the row count does not match the verified structural expectation', () => {
    assert.throws(
      () =>
        convertSgSheet(makeSgWorksheet([['SG9001', 'Stow “away from” class 3.']]), {
          expectedRowCount: 2,
        }),
      /but 2 were expected/,
    );
  });

  it('fails when the SG sheet is missing entirely', () => {
    assert.throws(() => convertSgSheet(undefined), /missing the required "SG" sheet/);
  });
});
