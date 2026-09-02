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
    return {
      classA: `TEST_A${suffix}`,
      classB: `TEST_B${suffix}`,
      level: i % 5,
    };
  });
}

describe('validateDataset — valid data', () => {
  it('accepts the synthetic fixture and returns it unchanged', () => {
    const dataset = validateDataset(cloneFixture());
    expect(dataset.datasetVersion).toBe('synthetic-test-v1');
    expect(dataset.dgEntries).toHaveLength(4);
    expect(dataset.classRules).toHaveLength(2);
  });

  it('summarizes the fixture correctly without dumping rows', () => {
    const dataset = validateDataset(cloneFixture());
    const summary = summarizeDataset(dataset);
    expect(summary).toEqual({
      datasetVersion: 'synthetic-test-v1',
      dgEntryCount: 4,
      uniqueUnNumberCount: 3,
      classRuleCount: 2,
      primaryClassCount: 2,
      multiVariantUnNumberCount: 1,
    });
  });
});

describe('validateDataset — invalid data', () => {
  it('rejects a malformed root', () => {
    expect(() => validateDataset(null)).toThrow(DatasetValidationError);
    expect(() => validateDataset('not an object')).toThrow(DatasetValidationError);
    expect(() => validateDataset([])).toThrow(DatasetValidationError);
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

  it('rejects an invalid level', () => {
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
    bad.classRules[0] = { classA: 'TEST_B', classB: 'TEST_A', level: 2 };
    expect(() => validateDataset(bad)).toThrow(/canonical ordering/);
  });

  it('rejects unknown fields', () => {
    const bad = cloneFixture() as Record<string, unknown>;
    bad.properShippingName = 'not allowed';
    expect(() => validateDataset(bad)).toThrow(/unknown field/);
  });
});

describe('buildSql', () => {
  it('generates deterministic SQL containing the expected canonical rows', () => {
    const dataset = validateDataset(cloneFixture());
    const sql = buildSql(dataset);

    expect(sql).toContain(`DELETE FROM app_metadata WHERE key IN ('dataset_schema_version', 'dataset_version');`);
    expect(sql).toContain('DELETE FROM segregation_class_rules;');
    expect(sql).toContain('DELETE FROM dg_entries;');
    expect(sql).toContain("('9001', 'A', 'TEST_A'");
    expect(sql).toContain("('9003', 'A', 'TEST_B'");
    expect(sql).toContain("('TEST_A', 'TEST_A', 0)");
    expect(sql).toContain("('TEST_A', 'TEST_B', 2)");
    expect(sql).toContain("INSERT INTO app_metadata (key, value) VALUES ('dataset_schema_version', '1')");
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
    const rulesDeleteIndex = sql.indexOf('DELETE FROM segregation_class_rules;');
    const entriesDeleteIndex = sql.indexOf('DELETE FROM dg_entries;');
    const firstDgInsertIndex = sql.indexOf('INSERT INTO dg_entries');
    const firstRuleInsertIndex = sql.indexOf('INSERT INTO segregation_class_rules');
    const lastDgInsertIndex = sql.lastIndexOf('INSERT INTO dg_entries');
    const lastRuleInsertIndex = sql.lastIndexOf('INSERT INTO segregation_class_rules');
    const schemaUpsertIndex = sql.indexOf("INSERT INTO app_metadata (key, value) VALUES ('dataset_schema_version'");
    const versionUpsertIndex = sql.indexOf("INSERT INTO app_metadata (key, value) VALUES ('dataset_version'");

    expect(metadataDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(metadataDeleteIndex).toBeLessThan(rulesDeleteIndex);
    expect(metadataDeleteIndex).toBeLessThan(entriesDeleteIndex);
    expect(metadataDeleteIndex).toBeLessThan(firstDgInsertIndex);
    expect(metadataDeleteIndex).toBeLessThan(firstRuleInsertIndex);

    expect(schemaUpsertIndex).toBeGreaterThan(lastDgInsertIndex);
    expect(schemaUpsertIndex).toBeGreaterThan(lastRuleInsertIndex);
    expect(versionUpsertIndex).toBeGreaterThan(lastDgInsertIndex);
    expect(versionUpsertIndex).toBeGreaterThan(lastRuleInsertIndex);
  });

  it('sorts entries and rules deterministically regardless of input order', () => {
    const dataset = validateDataset(cloneFixture());
    const reversed = {
      ...dataset,
      dgEntries: [...dataset.dgEntries].reverse(),
      classRules: [...dataset.classRules].reverse(),
    };

    expect(buildSql(reversed)).toBe(buildSql(dataset));
  });

  it('escapes apostrophes in string values', () => {
    const dataset = validateDataset({
      schemaVersion: 1,
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
    });

    const sql = buildSql(dataset);
    expect(sql).toContain("'9004', 'A''B', 'TEST_A'");
    expect(sql).toContain("'GROUP''X'");
    expect(sql).toContain("'dataset_version', 'synthetic-o''brien-v1'");
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
      schemaVersion: 1,
      datasetVersion: 'synthetic-large-v1',
      dgEntries: buildSyntheticDgEntries(entryCount),
      classRules: [],
    });

    const sql = buildSql(dataset);
    const insertMatches = sql.match(/INSERT INTO dg_entries/g) ?? [];
    expect(insertMatches).toHaveLength(3);

    for (let i = 1000; i < 1000 + entryCount; i++) {
      expect(sql).toContain(`'${String(i).padStart(4, '0')}'`);
    }

    expect(buildSql(validateDataset(cloneFixture()))).toBe(buildSql(validateDataset(cloneFixture())));
    expect(buildSql(dataset)).toBe(sql);
  });

  it('splits a production-sized class rule snapshot into multiple batches', () => {
    const ruleCount = INSERT_BATCH_SIZE * 2 + 5;
    const dataset = validateDataset({
      schemaVersion: 1,
      datasetVersion: 'synthetic-large-rules-v1',
      dgEntries: [],
      classRules: buildSyntheticClassRules(ruleCount),
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
