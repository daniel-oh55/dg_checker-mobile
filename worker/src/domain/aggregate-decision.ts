import type { SegregationDecision } from './segregation';

/**
 * Conservatively combines the SegregationDecision for every evaluated
 * DgEntry variant pair (the Cartesian product of left variants x right
 * variants) into a single decision. Pure — no I/O.
 *
 * - If every decision has the same status and level, that status and level
 *   are preserved, but the reason is a generic variant-safe statement — the
 *   caller only supplied a UN number, so the actual variant is unresolved
 *   and a reason naming one specific class pair would misleadingly imply
 *   that variant is the one in effect.
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

  if (rest.length === 0) {
    return first;
  }

  if (first.status === 'SEGREGATION_REQUIRED') {
    return {
      status: 'SEGREGATION_REQUIRED',
      level: first.level,
      reason: `All DG variant combinations require segregation level ${first.level}.`,
    };
  }

  return {
    status: 'CLEAR',
    level: 0,
    reason: 'All DG variant combinations produce the same clear segregation outcome.',
  };
}
