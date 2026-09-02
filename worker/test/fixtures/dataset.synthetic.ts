/**
 * Synthetic dataset fixture for the import harness tests. Unmistakably
 * fake — UN 9001+/TEST_* have no regulatory meaning. Never real IMDG data.
 */
export const syntheticDataset = {
  schemaVersion: 1,
  datasetVersion: 'synthetic-test-v1',
  dgEntries: [
    {
      unNumber: '9001',
      variantKey: 'A',
      primaryClass: 'TEST_A',
      subsidiaryRisks: [],
      segregationGroups: [],
      segregationCodes: [],
      compatibilityGroup: null,
    },
    {
      unNumber: '9001',
      variantKey: 'B',
      primaryClass: 'TEST_A',
      subsidiaryRisks: [],
      segregationGroups: [],
      segregationCodes: [],
      compatibilityGroup: null,
    },
    {
      unNumber: '9002',
      variantKey: 'A',
      primaryClass: 'TEST_A',
      subsidiaryRisks: [],
      segregationGroups: [],
      segregationCodes: [],
      compatibilityGroup: null,
    },
    {
      unNumber: '9003',
      variantKey: 'A',
      primaryClass: 'TEST_B',
      subsidiaryRisks: [],
      segregationGroups: [],
      segregationCodes: [],
      compatibilityGroup: null,
    },
  ],
  classRules: [
    { classA: 'TEST_A', classB: 'TEST_A', level: 0 },
    { classA: 'TEST_A', classB: 'TEST_B', level: 2 },
  ],
};
