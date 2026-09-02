import { createSegregationRuleSet } from '../domain/segregation';
import type { SegregationLevel, SegregationRuleEntry, SegregationRuleSet } from '../domain/segregation';

function canonicalPair(classA: string, classB: string): readonly [string, string] {
  return classA <= classB ? [classA, classB] : [classB, classA];
}

/**
 * Loads the general class-pair segregation rules required to evaluate the
 * given class pairs, and builds a SegregationRuleSet from them. Pairs not
 * present in `segregation_class_rules` are simply absent from the returned
 * set — the pure engine already treats an absent pair as REVIEW_REQUIRED.
 */
export async function loadSegregationRuleSet(
  db: D1Database,
  classPairs: ReadonlyArray<readonly [string, string]>,
): Promise<SegregationRuleSet> {
  const uniquePairs = new Map<string, readonly [string, string]>();
  for (const [classA, classB] of classPairs) {
    const pair = canonicalPair(classA, classB);
    uniquePairs.set(pair.join('|'), pair);
  }

  const entries: SegregationRuleEntry[] = [];
  for (const [classA, classB] of uniquePairs.values()) {
    const row = await db
      .prepare('SELECT level FROM segregation_class_rules WHERE class_a = ? AND class_b = ?')
      .bind(classA, classB)
      .first<{ level: SegregationLevel }>();

    if (row !== null) {
      entries.push([classA, classB, row.level]);
    }
  }

  return createSegregationRuleSet(entries);
}
