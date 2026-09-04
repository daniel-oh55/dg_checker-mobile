import { createSegregationRuleSet } from '../domain/segregation';
import type { SegregationLevel, SegregationRuleEntry, SegregationRuleSet } from '../domain/segregation';

interface ClassRuleRow {
  class_a: string;
  class_b: string;
  level: SegregationLevel;
}

/**
 * Loads the complete class-pair segregation rule table and builds a
 * SegregationRuleSet from it.
 *
 * The engine no longer touches only the primary <-> primary pair: it also
 * evaluates subsidiary-risk axes, Class 1 normalized group rows, and
 * AS_FOR_CLASS substituted targets, so the set of pairs a single check needs
 * is not knowable before evaluation starts. The authorized table is on the
 * order of ~150 rows, so loading it whole is both simpler and safer than
 * predicting which pairs will be reached — a mispredicted pair would look
 * absent, and absence is what routes a pair to REVIEW_REQUIRED.
 *
 * Pairs genuinely absent from `segregation_class_rules` (the "*" Class 1 <->
 * Class 1 cells) stay absent from the returned set, which the pure engine
 * already treats as fail-closed.
 */
export async function loadSegregationRuleSet(db: D1Database): Promise<SegregationRuleSet> {
  const result = await db.prepare('SELECT class_a, class_b, level FROM segregation_class_rules').all<ClassRuleRow>();

  const entries: SegregationRuleEntry[] = result.results.map((row) => [row.class_a, row.class_b, row.level]);

  return createSegregationRuleSet(entries);
}
