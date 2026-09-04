import { dedupeAdditionalRequirements, reviewReason } from './segregation';
import type { PairEvaluation, SegregationDecision } from './segregation';
import type { AdditionalRequirement } from './sg-rules';

/**
 * How the aggregate numeric result relates to the individual variant pairs.
 *
 * - UNIFORM: every evaluated variant pair produced the same outcome.
 * - STRICTEST_OF_MULTIPLE_VARIANTS: the variant pairs disagreed, and the
 *   reported result is the strictest of them. Callers must not present this
 *   as "all variants require this" — the specific variant is unresolved
 *   because the request only carried UN numbers.
 */
export type VariantResolution = 'UNIFORM' | 'STRICTEST_OF_MULTIPLE_VARIANTS';

export interface AggregatedEvaluation {
  readonly decision: SegregationDecision;
  readonly additionalRequirements: readonly AdditionalRequirement[];
  readonly variantResolution: VariantResolution;
}

/**
 * Combines the PairEvaluation for every evaluated DgEntry variant pair (the
 * Cartesian product of left variants x right variants) into a single result.
 * Pure — no I/O.
 *
 * - If any variant pair is REVIEW_REQUIRED, the aggregate is REVIEW_REQUIRED
 *   (fail-closed), and the union of that pair's blockers is reported.
 * - Otherwise the aggregate takes the maximum numeric level across variant
 *   pairs. A weaker variant never dilutes a stronger one, and the reason
 *   states plainly when the shown result is the strictest of several
 *   differing variants rather than a shared outcome.
 * - additionalRequirements are unioned and deduplicated across every variant
 *   pair, including pairs that individually resolved to REVIEW_REQUIRED —
 *   an obligation found on any variant still has to reach the operator.
 */
export function aggregatePairEvaluations(
  evaluations: readonly [PairEvaluation, ...PairEvaluation[]],
): AggregatedEvaluation {
  const additionalRequirements = dedupeAdditionalRequirements(
    evaluations.flatMap((evaluation) => [...evaluation.additionalRequirements]),
  );

  const [first, ...rest] = evaluations;
  const allAgree = rest.every(
    (evaluation) =>
      evaluation.decision.status === first.decision.status && evaluation.decision.level === first.decision.level,
  );
  const variantResolution: VariantResolution = allAgree ? 'UNIFORM' : 'STRICTEST_OF_MULTIPLE_VARIANTS';

  const reviewing = evaluations.filter((evaluation) => evaluation.decision.status === 'REVIEW_REQUIRED');
  if (reviewing.length > 0) {
    const blockers = [...new Set(reviewing.flatMap((evaluation) => [...evaluation.reviewBlockers]))].sort();
    return {
      decision: { status: 'REVIEW_REQUIRED', level: null, reason: reviewReason(blockers) },
      additionalRequirements,
      variantResolution,
    };
  }

  let level: 0 | 1 | 2 | 3 | 4 = 0;
  for (const evaluation of evaluations) {
    // Every remaining decision is CLEAR (level 0) or SEGREGATION_REQUIRED
    // (level 1-4), so `level` is always a number here.
    const pairLevel = evaluation.decision.level as 0 | 1 | 2 | 3 | 4;
    if (pairLevel > level) {
      level = pairLevel;
    }
  }

  if (level === 0) {
    return {
      decision: {
        status: 'CLEAR',
        level: 0,
        reason: 'All DG variant combinations produce the same clear segregation outcome.',
      },
      additionalRequirements,
      variantResolution,
    };
  }

  const reason =
    variantResolution === 'UNIFORM'
      ? `All DG variant combinations require segregation level ${level}.`
      : `Segregation level ${level} is the strictest applicable result across the evaluated DG variant ` +
        'combinations; the specific variant is unresolved, so other variants may require less.';

  return {
    decision: { status: 'SEGREGATION_REQUIRED', level, reason },
    additionalRequirements,
    variantResolution,
  };
}
