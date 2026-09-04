/**
 * Runtime model for the authorized SG (special segregation provision) rows.
 *
 * Deliberately not a generic rule-expression engine: the converter reduces
 * each source SG row to one of a small, fixed set of mechanically evaluable
 * shapes, and anything it cannot prove mechanically is preserved as
 * ADDITIONAL_REQUIREMENT, REVIEW_ONLY or RESERVED. That keeps the runtime
 * total and auditable — every code an entry carries lands in exactly one
 * branch, and none of those branches can silently produce CLEAR.
 */

export type SgRuleType =
  /** Numeric level against the other cargo's hazard class(es). */
  | 'DIRECT_CLASS'
  /** Numeric level against the other cargo's segregation-group membership. */
  | 'DIRECT_SGG'
  /** Numeric level against a specific UN number. */
  | 'DIRECT_UN'
  /** Substitute a target class, then use the authorized class matrix. */
  | 'AS_FOR_CLASS'
  /** A non-level obligation that must be surfaced, never folded into 0-4. */
  | 'ADDITIONAL_REQUIREMENT'
  /** Source conditions this engine cannot evaluate; forces manual review. */
  | 'REVIEW_ONLY'
  /** "[Reserved]" in the authorized source; must never be applied. */
  | 'RESERVED';

export interface SgRule {
  readonly code: string;
  readonly ruleType: SgRuleType;
  /**
   * Meaning depends on ruleType: matrix class labels for DIRECT_CLASS and
   * AS_FOR_CLASS, "SGG<n>" tokens for DIRECT_SGG, canonical 4-digit UN
   * numbers for DIRECT_UN, and empty for every non-evaluable type.
   */
  readonly targets: readonly string[];
  /** Numeric level for the DIRECT_* types; null for every other type. */
  readonly level: 1 | 2 | 3 | 4 | null;
  readonly sourceText: string;
}

export interface SgRuleSet {
  readonly get: (code: string) => SgRule | undefined;
}

export function createSgRuleSet(rules: readonly SgRule[]): SgRuleSet {
  const byCode = new Map(rules.map((rule) => [rule.code, rule]));
  return {
    get(code: string) {
      return byCode.get(code);
    },
  };
}

/**
 * A non-level obligation attached to an evaluated pair. Carries the stable
 * code and classification only — not the proprietary regulatory prose — and
 * is reported alongside, never instead of, the numeric decision.
 */
export interface AdditionalRequirement {
  readonly code: string;
  readonly source: 'SG';
  readonly requiresConfirmation: boolean;
}
