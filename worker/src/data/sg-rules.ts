import { createSgRuleSet } from '../domain/sg-rules';
import type { SgRule, SgRuleSet, SgRuleType } from '../domain/sg-rules';

/**
 * Thrown when a persisted sg_rules row cannot be safely mapped to the domain
 * shape. Never coerced to a permissive default: an SG rule that cannot be
 * read is an internal data error, not an absent obligation.
 */
export class MalformedSgRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedSgRuleError';
  }
}

interface SgRuleRow {
  code: string;
  rule_type: string;
  targets_json: string;
  level: number | null;
  source_text: string;
}

const SG_RULE_TYPES: ReadonlySet<string> = new Set<SgRuleType>([
  'DIRECT_CLASS',
  'DIRECT_SGG',
  'DIRECT_UN',
  'AS_FOR_CLASS',
  'ADDITIONAL_REQUIREMENT',
  'REVIEW_ONLY',
  'RESERVED',
]);

function parseTargets(json: string, code: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MalformedSgRuleError(`sg_rules row "${code}" has targets_json that is not valid JSON.`);
  }

  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new MalformedSgRuleError(`sg_rules row "${code}" has targets_json that is not a JSON array of strings.`);
  }

  return parsed;
}

function mapRow(row: SgRuleRow): SgRule {
  if (!SG_RULE_TYPES.has(row.rule_type)) {
    throw new MalformedSgRuleError(`sg_rules row "${row.code}" has unknown rule_type "${row.rule_type}".`);
  }

  if (row.level !== null && !(Number.isInteger(row.level) && row.level >= 1 && row.level <= 4)) {
    throw new MalformedSgRuleError(`sg_rules row "${row.code}" has an out-of-range level ${String(row.level)}.`);
  }

  return {
    code: row.code,
    ruleType: row.rule_type as SgRuleType,
    targets: parseTargets(row.targets_json, row.code),
    level: row.level as 1 | 2 | 3 | 4 | null,
    sourceText: row.source_text,
  };
}

/**
 * Loads the complete sg_rules table and builds an SgRuleSet from it.
 *
 * Loading everything is deliberate: the authorized SG table is on the order
 * of ~80 rows, an evaluated pair can reach an arbitrary subset of them
 * (directly, or indirectly through AS_FOR_CLASS substitution), and a rule
 * that fails to load must fail closed rather than look absent. A per-code
 * query plan would buy nothing but a way to silently miss a rule.
 */
export async function loadSgRuleSet(db: D1Database): Promise<SgRuleSet> {
  const result = await db
    .prepare('SELECT code, rule_type, targets_json, level, source_text FROM sg_rules')
    .all<SgRuleRow>();

  return createSgRuleSet(result.results.map(mapRow));
}
