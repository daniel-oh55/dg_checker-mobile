import { aggregatePairEvaluations } from './aggregate-decision';
import type { VariantResolution } from './aggregate-decision';
import { evaluateSegregationPair } from './segregation';
import type { PairEvaluation, SegregationDecision, SegregationRuleSet } from './segregation';
import type { AdditionalRequirement, SgRuleSet } from './sg-rules';
import type { DgEntry } from './types';

export interface ResolvedUnPairEvaluation {
  readonly decision: SegregationDecision;
  readonly variants: {
    readonly left: number;
    readonly right: number;
    readonly evaluatedPairs: number;
  };
  readonly additionalRequirements: readonly AdditionalRequirement[];
  readonly variantResolution: VariantResolution;
}

/**
 * Evaluates every left-variant x right-variant DgEntry pair for one already
 * resolved UN-number pair and aggregates them with aggregatePairEvaluations.
 * Shared by the single-pair and batch endpoints so both apply exactly the
 * same engine and aggregation semantics. Callers must pass non-empty entry
 * lists — "no entries for this UN number" is a lookup concern handled before
 * this is called, not an evaluation concern.
 */
export function evaluateResolvedUnPair(
  leftEntries: readonly DgEntry[],
  rightEntries: readonly DgEntry[],
  classRules: SegregationRuleSet,
  sgRules: SgRuleSet,
): ResolvedUnPairEvaluation {
  const evaluations: PairEvaluation[] = [];
  for (const left of leftEntries) {
    for (const right of rightEntries) {
      evaluations.push(evaluateSegregationPair(left, right, classRules, sgRules));
    }
  }

  const aggregated = aggregatePairEvaluations(evaluations as [PairEvaluation, ...PairEvaluation[]]);

  return {
    decision: aggregated.decision,
    variants: { left: leftEntries.length, right: rightEntries.length, evaluatedPairs: evaluations.length },
    additionalRequirements: aggregated.additionalRequirements,
    variantResolution: aggregated.variantResolution,
  };
}
