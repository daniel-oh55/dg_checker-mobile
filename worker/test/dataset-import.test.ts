import { describe, expect, it } from 'vitest';
import { DatasetValidationError, buildSql, summarizeDataset, validateDataset } from '../scripts/dataset-import.mjs';
import { syntheticDataset } from './fixtures/dataset.synthetic';

function cloneFixture(): typeof syntheticDataset {
  return JSON.parse(JSON.stringify(syntheticDataset));
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
    expect(sql).not.toMatch(/DELETE FROM app_metadata/);

    expect(buildSql(validateDataset(cloneFixture()))).toBe(sql);
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
});
