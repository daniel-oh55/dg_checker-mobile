import { describe, expect, it } from 'vitest';
import {
  DatasetValidationError,
  INSERT_BATCH_SIZE,
  buildSql,
  summarizeDataset,
  validateDataset,
} from '../scripts/dataset-import.mjs';
import { syntheticDataset } from './fixtures/dataset.synthetic';

function cloneFixture(): typeof syntheticDataset {
  return JSON.parse(JSON.stringify(syntheticDataset));
}

function buildSyntheticDgEntries(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const unNumber = String(1000 + i).padStart(4, '0');
    return {
      unNumber,
      variantKey: 'A',
      primaryClass: 'TEST_A',
      subsidiaryRisks: [],
      segregationGroups: [],
      segregationCodes: [],
      compatibilityGroup: null,
    };
  });
}

function buildSyntheticClassRules(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const suffix = String(i).padStart(4, '0');
    const level = i % 5;
    return {
      classA: `TEST_A${suffix}`,
      classB: `TEST_B${suffix}`,
      level,
      sourceToken: level === 0 ? 'X' : String(level),
    };
  });
}

describe('validateDataset — valid data', () => {
  it('accepts the synthetic fixture and returns it unchanged', () => {
    const dataset = validateDataset(cloneFixture());
    expect(dataset.schemaVersion).toBe(2);
    expect(dataset.datasetVersion).toBe('synthetic-test-v1');
    expect(dataset.dgEntries).toHaveLength(4);
    expect(dataset.classRules).toHaveLength(2);
    expect(dataset.sgRules).toHaveLength(6);
  });

  it('summarizes the fixture correctly without dumping rows', () => {
    const dataset = validateDataset(cloneFixture());
    const summary = summarizeDataset(dataset);
    expect(summary).toEqual({
      datasetVersion: 'synthetic-test-v1',
      dgEntryCount: 4,
      uniqueUnNumberCount: 3,
      classRuleCount: 2,
      classRuleXCount: 1,
      primaryClassCount: 2,
      multiVariantUnNumberCount: 1,
      sgRuleCount: 6,
      sgRuleCountsByType: {
        DIRECT_CLASS: 1,
        DIRECT_SGG: 1,
        DIRECT_UN: 0,
        AS_FOR_CLASS: 1,
        ADDITIONAL_REQUIREMENT: 1,
        REVIEW_ONLY: 1,
        RESERVED: 1,
      },
    });
  });
});

describe('validateDataset — invalid data', () => {
  it('rejects a malformed root', () => {
    expect(() => validateDataset(null)).toThrow(DatasetValidationError);
    expect(() => validateDataset('not an object')).toThrow(DatasetValidationError);
    expect(() => validateDataset([])).toThrow(DatasetValidationError);
  });

  it('rejects schema version 1 now that the canonical contract is version 2', () => {
    const bad = cloneFixture() as Record<string, unknown>;
    bad.schemaVersion = 1;
    expect(() => validateDataset(bad)).toThrow(/schemaVersion must be 2/);
  });

  it('rejects a dataset with no sgRules array at all', () => {
    const bad = cloneFixture() as Record<string, unknown>;
    delete bad.sgRules;
    expect(() => validateDataset(bad)).toThrow(/sgRules must be an array/);
  });

  it('rejects a non-4-digit UN number', () => {
    const bad = cloneFixture();
    bad.dgEntries[0].unNumber = 'UN9001';
    expect(() => validateDataset(bad)).toThrow(/unNumber must be a canonical 4-digit string/);
  });

  it('rejects duplicate (unNumber, variantKey)', () => {
    const bad = cloneFixture();
    bad.dgEntries.push({ ...bad.dgEntries[0] });
    expect(() => validateDataset(bad)).toThrow(/duplicates \(unNumber, variantKey\)/);
  });

  it('rejects an invalid string-array field', () => {
    const bad = cloneFixture();
    // @ts-expect-error -- deliberately invalid shape for the test
    bad.dgEntries[0].subsidiaryRisks = ['ok', 42];
    expect(() => validateDataset(bad)).toThrow(/subsidiaryRisks must be a string array/);
  });

  it('rejects an invalid class-rule level', () => {
    const bad = cloneFixture();
    bad.classRules[0].level = 5;
    expect(() => validateDataset(bad)).toThrow(/level must be an integer between 0 and 4/);
  });

  it('rejects a duplicate class pair', () => {
    const bad = cloneFixture();
    bad.classRules.push({ ...bad.classRules[0] });
    expect(() => validateDataset(bad)).toThrow(/duplicates class pair/);
  });

  it('rejects non-canonical class ordering', () => {
    const bad = cloneFixture();
    bad.classRules[0] = { classA: 'TEST_B', classB: 'TEST_A', level: 2, sourceToken: '2' };
    expect(() => validateDataset(bad)).toThrow(/canonical ordering/);
  });

  it('rejects unknown root fields', () => {
    const bad = cloneFixture() as Record<string, unknown>;
    bad.properShippingName = 'not allowed';
    expect(() => validateDataset(bad)).toThrow(/unknown field/);
  });

  it('rejects unknown class-rule fields', () => {
    const bad = cloneFixture() as { classRules: Record<string, unknown>[] };
    bad.classRules[0].note = 'not allowed';
    expect(() => validateDataset(bad)).toThrow(/unknown field/);
  });

  it('rejects unknown SG-rule fields', () => {
    const bad = cloneFixture() as { sgRules: Record<string, unknown>[] };
    bad.sgRules[0].note = 'not allowed';
    expect(() => validateDataset(bad)).toThrow(/unknown field/);
  });
});

describe('validateDataset — class rule source tokens', () => {
  it('rejects a missing sourceToken', () => {
    const bad = cloneFixture() as { classRules: Record<string, unknown>[] };
    delete bad.classRules[0].sourceToken;
    expect(() => validateDataset(bad)).toThrow(/sourceToken must be one of/);
  });

  it('rejects an unrecognized sourceToken', () => {
    const bad = cloneFixture();
    bad.classRules[0].sourceToken = '*';
    expect(() => validateDataset(bad)).toThrow(/sourceToken must be one of/);
  });

  it('rejects a sourceToken that disagrees with the level it was converted to', () => {
    const bad = cloneFixture();
    bad.classRules[0].sourceToken = '3';
    expect(() => validateDataset(bad)).toThrow(/implies level 3 but level is 0/);
  });

  it('accepts an "X" token only against level 0', () => {
    const bad = cloneFixture();
    bad.classRules[1].sourceToken = 'X';
    expect(() => validateDataset(bad)).toThrow(/implies level 0 but level is 2/);
  });
});

describe('validateDataset — SG rules', () => {
  it('rejects a malformed SG code', () => {
    const bad = cloneFixture();
    bad.sgRules[0].code = 'NOT_AN_SG_CODE';
    expect(() => validateDataset(bad)).toThrow(/code must match/);
  });

  it('rejects a duplicate SG code', () => {
    const bad = cloneFixture();
    bad.sgRules.push({ ...bad.sgRules[0] });
    expect(() => validateDataset(bad)).toThrow(/duplicates SG code/);
  });

  it('rejects an unknown ruleType', () => {
    const bad = cloneFixture();
    bad.sgRules[0].ruleType = 'DIRECT_MAGIC';
    expect(() => validateDataset(bad)).toThrow(/ruleType must be one of/);
  });

  it('rejects an empty sourceText', () => {
    const bad = cloneFixture();
    bad.sgRules[0].sourceText = '';
    expect(() => validateDataset(bad)).toThrow(/sourceText must be a non-empty string/);
  });

  it('rejects an out-of-range level', () => {
    const bad = cloneFixture();
    bad.sgRules[0].level = 5;
    expect(() => validateDataset(bad)).toThrow(/level must be null or an integer between 1 and 4/);
  });

  it('rejects level 0 for an SG rule — an SG rule never contributes 0', () => {
    const bad = cloneFixture();
    bad.sgRules[0].level = 0;
    expect(() => validateDataset(bad)).toThrow(/level must be null or an integer between 1 and 4/);
  });

  it('rejects a DIRECT_CLASS rule with no level', () => {
    const bad = cloneFixture();
    bad.sgRules[0].level = null;
    expect(() => validateDataset(bad)).toThrow(/level must be 1-4 for ruleType DIRECT_CLASS/);
  });

  it('rejects a DIRECT_CLASS rule with no targets', () => {
    const bad = cloneFixture();
    bad.sgRules[0].targets = [];
    expect(() => validateDataset(bad)).toThrow(/targets must be non-empty for ruleType DIRECT_CLASS/);
  });

  it('rejects a DIRECT_SGG rule whose targets are not SGG tokens', () => {
    const bad = cloneFixture();
    bad.sgRules[1].targets = ['acids'];
    expect(() => validateDataset(bad)).toThrow(/targets must all match/);
  });

  it('rejects a DIRECT_UN rule whose targets are not canonical UN numbers', () => {
    const bad = cloneFixture();
    bad.sgRules[1].ruleType = 'DIRECT_UN';
    bad.sgRules[1].targets = ['UN9846'];
    expect(() => validateDataset(bad)).toThrow(/targets must all be canonical 4-digit UN numbers/);
  });

  it('rejects an AS_FOR_CLASS rule that carries its own level', () => {
    const bad = cloneFixture();
    bad.sgRules[2].level = 2;
    expect(() => validateDataset(bad)).toThrow(/level must be null for ruleType AS_FOR_CLASS/);
  });

  it('rejects an AS_FOR_CLASS rule with no substituted class', () => {
    const bad = cloneFixture();
    bad.sgRules[2].targets = [];
    expect(() => validateDataset(bad)).toThrow(/targets must be non-empty for ruleType AS_FOR_CLASS/);
  });

  it('rejects an ADDITIONAL_REQUIREMENT rule that carries a level', () => {
    const bad = cloneFixture();
    bad.sgRules[3].level = 2;
    expect(() => validateDataset(bad)).toThrow(/level must be null for ruleType ADDITIONAL_REQUIREMENT/);
  });

  it('rejects a REVIEW_ONLY rule that carries targets', () => {
    const bad = cloneFixture();
    bad.sgRules[4].targets = ['3'];
    expect(() => validateDataset(bad)).toThrow(/targets must be empty for ruleType REVIEW_ONLY/);
  });

  it('rejects a RESERVED rule that carries a level', () => {
    const bad = cloneFixture();
    bad.sgRules[5].level = 4;
    expect(() => validateDataset(bad)).toThrow(/level must be null for ruleType RESERVED/);
  });
});

describe('buildSql', () => {
  it('generates deterministic SQL containing the expected canonical rows', () => {
    const dataset = validateDataset(cloneFixture());
    const sql = buildSql(dataset);

    expect(sql).toContain(`DELETE FROM app_metadata WHERE key IN ('dataset_schema_version', 'dataset_version');`);
    expect(sql).toContain('DELETE FROM sg_rules;');
    expect(sql).toContain('DELETE FROM segregation_class_rules;');
    expect(sql).toContain('DELETE FROM dg_entries;');
    expect(sql).toContain("('9001', 'A', 'TEST_A'");
    expect(sql).toContain("('9003', 'A', 'TEST_B'");
    expect(sql).toContain("('TEST_A', 'TEST_A', 0, 'X')");
    expect(sql).toContain("('TEST_A', 'TEST_B', 2, '2')");
    expect(sql).toContain("('SG9001', 'DIRECT_CLASS', '[\"TEST_B\"]', 3,");
    expect(sql).toContain("('SG9006', 'RESERVED', '[]', NULL,");
    expect(sql).toContain("INSERT INTO app_metadata (key, value) VALUES ('dataset_schema_version', '2')");
    expect(sql).toContain(
      "INSERT INTO app_metadata (key, value) VALUES ('dataset_version', 'synthetic-test-v1')",
    );
    expect(sql).not.toMatch(/DELETE FROM app_metadata;/);

    expect(buildSql(validateDataset(cloneFixture()))).toBe(sql);
  });

  it('invalidates readiness metadata before replacing table data, and restores it only after all inserts', () => {
    const dataset = validateDataset(cloneFixture());
    const sql = buildSql(dataset);

    const metadataDeleteIndex = sql.indexOf(
      `DELETE FROM app_metadata WHERE key IN ('dataset_schema_version', 'dataset_version');`,
    );
    const sgDeleteIndex = sql.indexOf('DELETE FROM sg_rules;');
    const rulesDeleteIndex = sql.indexOf('DELETE FROM segregation_class_rules;');
    const entriesDeleteIndex = sql.indexOf('DELETE FROM dg_entries;');
    const firstDgInsertIndex = sql.indexOf('INSERT INTO dg_entries');
    const firstRuleInsertIndex = sql.indexOf('INSERT INTO segregation_class_rules');
    const firstSgInsertIndex = sql.indexOf('INSERT INTO sg_rules');
    const lastDgInsertIndex = sql.lastIndexOf('INSERT INTO dg_entries');
    const lastRuleInsertIndex = sql.lastIndexOf('INSERT INTO segregation_class_rules');
    const lastSgInsertIndex = sql.lastIndexOf('INSERT INTO sg_rules');
    const schemaUpsertIndex = sql.indexOf("INSERT INTO app_metadata (key, value) VALUES ('dataset_schema_version'");
    const versionUpsertIndex = sql.indexOf("INSERT INTO app_metadata (key, value) VALUES ('dataset_version'");

    expect(metadataDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(metadataDeleteIndex).toBeLessThan(sgDeleteIndex);
    expect(metadataDeleteIndex).toBeLessThan(rulesDeleteIndex);
    expect(metadataDeleteIndex).toBeLessThan(entriesDeleteIndex);
    expect(metadataDeleteIndex).toBeLessThan(firstDgInsertIndex);
    expect(metadataDeleteIndex).toBeLessThan(firstRuleInsertIndex);
    expect(metadataDeleteIndex).toBeLessThan(firstSgInsertIndex);

    for (const upsertIndex of [schemaUpsertIndex, versionUpsertIndex]) {
      expect(upsertIndex).toBeGreaterThan(lastDgInsertIndex);
      expect(upsertIndex).toBeGreaterThan(lastRuleInsertIndex);
      expect(upsertIndex).toBeGreaterThan(lastSgInsertIndex);
    }

    // dataset_version is written last of all: getDatasetStatus() requires it
    // alongside the schema version, so it is the key that flips readiness on.
    expect(versionUpsertIndex).toBeGreaterThan(schemaUpsertIndex);
  });

  it('sorts entries, class rules and SG rules deterministically regardless of input order', () => {
    const dataset = validateDataset(cloneFixture());
    const reversed = {
      ...dataset,
      dgEntries: [...dataset.dgEntries].reverse(),
      classRules: [...dataset.classRules].reverse(),
      sgRules: [...dataset.sgRules].reverse(),
    };

    expect(buildSql(reversed)).toBe(buildSql(dataset));
  });

  it('escapes apostrophes in string values, including SG source text', () => {
    const dataset = validateDataset({
      schemaVersion: 2,
      datasetVersion: "synthetic-o'brien-v1",
      dgEntries: [
        {
          unNumber: '9004',
          variantKey: "A'B",
          primaryClass: 'TEST_A',
          subsidiaryRisks: [],
          segregationGroups: [],
          segregationCodes: [],
          compatibilityGroup: "GROUP'X",
        },
      ],
      classRules: [],
      sgRules: [
        {
          code: 'SG9100',
          ruleType: 'REVIEW_ONLY',
          targets: [],
          level: null,
          sourceText: "synthetic o'brien wording",
        },
      ],
    });

    const sql = buildSql(dataset);
    expect(sql).toContain("'9004', 'A''B', 'TEST_A'");
    expect(sql).toContain("'GROUP''X'");
    expect(sql).toContain("'dataset_version', 'synthetic-o''brien-v1'");
    expect(sql).toContain("'synthetic o''brien wording'");
  });

  it('does not emit explicit transaction statements', () => {
    const dataset = validateDataset(cloneFixture());
    const sql = buildSql(dataset);

    expect(sql).not.toMatch(/BEGIN TRANSACTION/);
    expect(sql).not.toMatch(/\bCOMMIT;/);
  });

  it('splits a production-sized dg_entries snapshot into multiple batches', () => {
    const entryCount = INSERT_BATCH_SIZE * 2 + 5;
    const dataset = validateDataset({
      schemaVersion: 2,
      datasetVersion: 'synthetic-large-v1',
      dgEntries: buildSyntheticDgEntries(entryCount),
      classRules: [],
      sgRules: [],
    });

    const sql = buildSql(dataset);
    const insertMatches = sql.match(/INSERT INTO dg_entries/g) ?? [];
    expect(insertMatches).toHaveLength(3);

    for (let i = 1000; i < 1000 + entryCount; i++) {
      expect(sql).toContain(`'${String(i).padStart(4, '0')}'`);
    }

    expect(buildSql(dataset)).toBe(sql);
  });

  it('splits a production-sized class rule snapshot into multiple batches', () => {
    const ruleCount = INSERT_BATCH_SIZE * 2 + 5;
    const dataset = validateDataset({
      schemaVersion: 2,
      datasetVersion: 'synthetic-large-rules-v1',
      dgEntries: [],
      classRules: buildSyntheticClassRules(ruleCount),
      sgRules: [],
    });

    const sql = buildSql(dataset);
    const insertMatches = sql.match(/INSERT INTO segregation_class_rules/g) ?? [];
    expect(insertMatches).toHaveLength(3);

    for (let i = 0; i < ruleCount; i++) {
      const suffix = String(i).padStart(4, '0');
      expect(sql).toContain(`'TEST_A${suffix}'`);
      expect(sql).toContain(`'TEST_B${suffix}'`);
    }

    expect(buildSql(dataset)).toBe(sql);
  });
});
