/**
 * Synthetic dataset fixture for the import harness tests. Unmistakably
 * fake: UN 9001+, TEST_ classes and SG9001+ codes have no regulatory
 * meaning. Never real IMDG data.
 */
export const syntheticDataset = {
  schemaVersion: 2,
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
    { classA: 'TEST_A', classB: 'TEST_A', level: 0, sourceToken: 'X' },
    { classA: 'TEST_A', classB: 'TEST_B', level: 2, sourceToken: '2' },
  ],
  sgRules: [
    {
      code: 'SG9001',
      ruleType: 'DIRECT_CLASS',
      targets: ['TEST_B'],
      level: 3,
      sourceText: 'synthetic: stow separated by a complete compartment from TEST_B',
    },
    {
      code: 'SG9002',
      ruleType: 'DIRECT_SGG',
      targets: ['SGG9001'],
      level: 2,
      sourceText: 'synthetic: stow separated from SGG9001',
    },
    {
      code: 'SG9003',
      ruleType: 'AS_FOR_CLASS',
      targets: ['TEST_B'],
      level: null,
      sourceText: 'synthetic: segregation as for TEST_B',
    },
    {
      code: 'SG9004',
      ruleType: 'ADDITIONAL_REQUIREMENT',
      targets: [],
      level: null,
      sourceText: 'synthetic: an additional non-level obligation',
    },
    {
      code: 'SG9005',
      ruleType: 'REVIEW_ONLY',
      targets: [],
      level: null,
      sourceText: 'synthetic: a conditional rule this engine cannot evaluate',
    },
    {
      code: 'SG9006',
      ruleType: 'RESERVED',
      targets: [],
      level: null,
      sourceText: '[Reserved]',
    },
  ],
};
