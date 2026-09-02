import type { SegregationDecision } from './segregation';

/**
 * Conservatively combines the SegregationDecision for every evaluated
 * DgEntry variant pair (the Cartesian product of left variants x right
 * variants) into a single decision. Pure — no I/O.
 *
 * - If every decision has the same status and level, that decision is
 *   returned as-is.
 * - If any decision is REVIEW_REQUIRED, the aggregate is REVIEW_REQUIRED
 *   (fail-closed).
 * - If decisions disagree (different status and/or level), the aggregate
 *   is REVIEW_REQUIRED — the caller only supplied a UN number, so the
 *   actual variant is unresolved and picking the maximum level would
 *   assert a regulatory outcome that isn't actually known.
 */
export function aggregateSegregationDecisions(
  decisions: readonly [SegregationDecision, ...SegregationDecision[]],
): SegregationDecision {
  if (decisions.some((decision) => decision.status === 'REVIEW_REQUIRED')) {
    return {
      status: 'REVIEW_REQUIRED',
      level: null,
      reason: 'At least one DG variant combination requires manual review.',
    };
  }

  const [first, ...rest] = decisions;
  const allAgree = rest.every((decision) => decision.status === first.status && decision.level === first.level);

  if (!allAgree) {
    return {
      status: 'REVIEW_REQUIRED',
      level: null,
      reason:
        'Different DG variants for the supplied UN number(s) produce different segregation outcomes; the specific variant is unresolved.',
    };
  }

  return first;
}
