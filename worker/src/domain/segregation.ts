import { isClass1, toMatrixLabel } from './class-normalization';
import type { AdditionalRequirement, SgRule, SgRuleSet } from './sg-rules';
import type { DgEntry } from './types';

export type SegregationLevel = 0 | 1 | 2 | 3 | 4;

export type SegregationDecision =
  | {
      status: 'CLEAR';
      level: 0;
      reason: string;
    }
  | {
      status: 'SEGREGATION_REQUIRED';
      level: 1 | 2 | 3 | 4;
      reason: string;
    }
  | {
      status: 'REVIEW_REQUIRED';
      level: null;
      reason: string;
    };

export type SegregationRuleEntry = readonly [classA: string, classB: string, level: SegregationLevel];

/**
 * Class-pair -> segregation-level lookup, injected by the caller. This engine
 * has no knowledge of the real IMDG segregation table — it only evaluates
 * whatever rules it is given.
 *
 * A returned 0 means the authorized matrix cell contributes no numeric base
 * level (source token "X", or a numeric 0). `undefined` means the pair is
 * genuinely absent from the table — a "*" Class 1 <-> Class 1 cell, or a
 * class token the authorized source does not publish — and callers must fail
 * closed rather than assume it is harmless.
 */
export interface SegregationRuleSet {
  readonly get: (classA: string, classB: string) => SegregationLevel | undefined;
}

/**
 * Result of evaluating one concrete DgEntry variant pair.
 *
 * `additionalRequirements` is independent of `decision`: a pair can be CLEAR
 * at level 0 and still carry obligations that must be shown to the operator.
 * A level-0 decision with a non-empty requirement list therefore does NOT
 * mean "unrestricted" or "safe to mix".
 */
export interface PairEvaluation {
  readonly decision: SegregationDecision;
  readonly additionalRequirements: readonly AdditionalRequirement[];
  /**
   * Stable, non-proprietary blocker codes explaining a REVIEW_REQUIRED
   * decision. Empty for CLEAR and SEGREGATION_REQUIRED.
   */
  readonly reviewBlockers: readonly string[];
}

/** Prefix the converter uses for source content it could not resolve mechanically. */
const UNRESOLVED_TOKEN_PREFIX = 'UNRESOLVED_';

export const REVIEW_BLOCKER = {
  unresolvedSubsidiary: 'UNRESOLVED_SUBSIDIARY_SOURCE',
  multipleSubsidiary: 'MULTIPLE_SUBSIDIARY_RISKS',
  sameClassSubsidiary: 'SAME_CLASS_SUBSIDIARY_REVIEW',
  class1ToClass1: 'CLASS1_TO_CLASS1_UNRESOLVED',
} as const;

function pairKey(classA: string, classB: string): string {
  return [classA, classB].sort().join('|');
}

export function createSegregationRuleSet(entries: readonly SegregationRuleEntry[]): SegregationRuleSet {
  const table = new Map<string, SegregationLevel>();
  for (const [classA, classB, level] of entries) {
    table.set(pairKey(classA, classB), level);
  }

  return {
    get(classA: string, classB: string) {
      return table.get(pairKey(classA, classB));
    },
  };
}

interface NormalizedEntry {
  readonly entry: DgEntry;
  /** Primary hazard class as an authorized-matrix label. */
  readonly primaryLabel: string;
  /** Resolved subsidiary hazards as matrix labels, deduplicated, in source order. */
  readonly subsidiaryLabels: readonly string[];
  /** Subsidiary source values the converter could not resolve mechanically. */
  readonly unresolvedSubsidiaryTokens: readonly string[];
}

function normalizeEntry(entry: DgEntry): NormalizedEntry {
  const subsidiaryLabels: string[] = [];
  const unresolvedSubsidiaryTokens: string[] = [];
  const seen = new Set<string>();

  for (const risk of entry.subsidiaryRisks) {
    if (risk.startsWith(UNRESOLVED_TOKEN_PREFIX)) {
      unresolvedSubsidiaryTokens.push(risk);
      continue;
    }
    const label = toMatrixLabel(risk);
    if (!seen.has(label)) {
      seen.add(label);
      subsidiaryLabels.push(label);
    }
  }

  return {
    entry,
    primaryLabel: toMatrixLabel(entry.primaryClass),
    subsidiaryLabels,
    unresolvedSubsidiaryTokens,
  };
}

/** Primary plus safely resolved subsidiary hazard labels, deduplicated. */
function hazardLabels(normalized: NormalizedEntry): string[] {
  const labels = [normalized.primaryLabel];
  for (const label of normalized.subsidiaryLabels) {
    if (!labels.includes(label)) {
      labels.push(label);
    }
  }
  return labels;
}

function maxLevel(a: SegregationLevel, b: SegregationLevel): SegregationLevel {
  return a >= b ? a : b;
}

/**
 * Mutable accumulator threaded through the evaluation steps. Numeric
 * contributions only ever move upwards (`max`), so a weaker rule can never
 * reduce a stronger one, and an "X"/level-0 cell can never lower a level
 * contributed by a subsidiary hazard or an SG provision.
 */
interface Accumulator {
  level: SegregationLevel;
  readonly blockers: string[];
  readonly additionalRequirements: AdditionalRequirement[];
}

function contribute(acc: Accumulator, level: SegregationLevel): void {
  acc.level = maxLevel(acc.level, level);
}

function addBlocker(acc: Accumulator, blocker: string): void {
  if (!acc.blockers.includes(blocker)) {
    acc.blockers.push(blocker);
  }
}

/**
 * Looks up one hazard axis in the authorized class matrix. Class 1 <-> Class 1
 * is refused outright ("*" in the source), and an absent pair becomes a
 * blocker rather than an implicit 0.
 */
function lookupAxis(
  acc: Accumulator,
  rules: SegregationRuleSet,
  labelA: string,
  labelB: string,
): SegregationLevel | null {
  if (isClass1(labelA) && isClass1(labelB)) {
    addBlocker(acc, REVIEW_BLOCKER.class1ToClass1);
    return null;
  }

  const level = rules.get(labelA, labelB);
  if (level === undefined) {
    const [first, second] = [labelA, labelB].sort();
    addBlocker(acc, `MISSING_CLASS_RULE:${first}|${second}`);
    return null;
  }

  return level;
}

/**
 * Evaluates every SG code carried by `holder` against `other`. Runs in one
 * direction only; the caller runs it both ways so an SG code on either side
 * is applied. Segregation-group membership on `other` stays inert unless a
 * holder SG rule actually targets that group.
 */
function evaluateSgDirection(
  acc: Accumulator,
  holder: NormalizedEntry,
  other: NormalizedEntry,
  classRules: SegregationRuleSet,
  sgRules: SgRuleSet,
): void {
  for (const code of holder.entry.segregationCodes) {
    const rule = sgRules.get(code);
    if (rule === undefined) {
      addBlocker(acc, `UNKNOWN_SG_CODE:${code}`);
      continue;
    }
    applySgRule(acc, rule, other, classRules);
  }
}

function applySgRule(
  acc: Accumulator,
  rule: SgRule,
  other: NormalizedEntry,
  classRules: SegregationRuleSet,
): void {
  switch (rule.ruleType) {
    case 'RESERVED':
      // A reserved source code should never be referenced by a real entry.
      addBlocker(acc, `RESERVED_SG_CODE:${rule.code}`);
      return;

    case 'REVIEW_ONLY':
      addBlocker(acc, `REVIEW_ONLY_SG_CODE:${rule.code}`);
      return;

    case 'ADDITIONAL_REQUIREMENT':
      acc.additionalRequirements.push({ code: rule.code, source: 'SG', requiresConfirmation: true });
      return;

    case 'DIRECT_CLASS': {
      if (rule.level === null) {
        addBlocker(acc, `MALFORMED_SG_RULE:${rule.code}`);
        return;
      }
      for (const label of hazardLabels(other)) {
        if (rule.targets.includes(label)) {
          contribute(acc, rule.level);
        }
      }
      return;
    }

    case 'DIRECT_SGG': {
      if (rule.level === null) {
        addBlocker(acc, `MALFORMED_SG_RULE:${rule.code}`);
        return;
      }
      if (other.entry.segregationGroups.some((group) => rule.targets.includes(group))) {
        contribute(acc, rule.level);
      }
      return;
    }

    case 'DIRECT_UN': {
      if (rule.level === null) {
        addBlocker(acc, `MALFORMED_SG_RULE:${rule.code}`);
        return;
      }
      if (rule.targets.includes(other.entry.unNumber)) {
        contribute(acc, rule.level);
      }
      return;
    }

    case 'AS_FOR_CLASS': {
      // Substitute the rule's target class for the holder's own class, then
      // fall back to the authorized matrix against the other cargo.
      for (const substituted of rule.targets) {
        for (const label of hazardLabels(other)) {
          const level = lookupAxis(acc, classRules, substituted, label);
          if (level !== null) {
            contribute(acc, level);
          }
        }
      }
      return;
    }
  }
}

export function dedupeAdditionalRequirements(
  requirements: readonly AdditionalRequirement[],
): AdditionalRequirement[] {
  const byCode = new Map<string, AdditionalRequirement>();
  for (const requirement of requirements) {
    const existing = byCode.get(requirement.code);
    if (existing === undefined || (requirement.requiresConfirmation && !existing.requiresConfirmation)) {
      byCode.set(requirement.code, requirement);
    }
  }
  return [...byCode.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export function reviewReason(blockers: readonly string[]): string {
  return `Manual review required: ${[...blockers].sort().join(', ')}.`;
}

/**
 * Pure segregation evaluation for one concrete DG entry variant pair. Does
 * not touch D1 or any other I/O, and is symmetric: evaluate(a, b) and
 * evaluate(b, a) produce the same decision.
 *
 * Evaluation order (numeric contributions aggregate by `max`; review
 * blockers dominate any numeric result):
 *   1. normalize source hazard data
 *   2. detect unresolved / unsupported subsidiary data
 *   3. detect the Class 1 <-> Class 1 limitation
 *   4. base primary <-> primary matrix lookup
 *   5. permitted subsidiary matrix axes
 *   6. SG rules, holder = left
 *   7. SG rules, holder = right
 *   8. same-primary-class subsidiary exception
 */
export function evaluateSegregationPair(
  left: DgEntry,
  right: DgEntry,
  classRules: SegregationRuleSet,
  sgRules: SgRuleSet,
): PairEvaluation {
  const a = normalizeEntry(left);
  const b = normalizeEntry(right);

  const acc: Accumulator = { level: 0, blockers: [], additionalRequirements: [] };

  // Step 2 — unresolved subsidiary source content must never be dropped.
  if (a.unresolvedSubsidiaryTokens.length > 0 || b.unresolvedSubsidiaryTokens.length > 0) {
    addBlocker(acc, REVIEW_BLOCKER.unresolvedSubsidiary);
  }

  // Step 2 — two or more subsidiary risks on one entry are governed by
  // special provisions this engine does not model. Fail closed rather than
  // asserting a result from a naive full hazard Cartesian product.
  const hasMultipleSubsidiaries = a.subsidiaryLabels.length > 1 || b.subsidiaryLabels.length > 1;
  if (hasMultipleSubsidiaries) {
    addBlocker(acc, REVIEW_BLOCKER.multipleSubsidiary);
  }

  // Steps 3-4 — base primary <-> primary axis.
  const baseLevel = lookupAxis(acc, classRules, a.primaryLabel, b.primaryLabel);

  // Step 5 — subsidiary axes, only while each side has at most one resolved
  // subsidiary hazard. Sub <-> Sub is included: it is a real requirement the
  // engine must not miss when both entries carry one subsidiary risk.
  let subsidiaryLevel: SegregationLevel = 0;
  if (!hasMultipleSubsidiaries) {
    const axes: Array<readonly [string, string]> = [];
    for (const subA of a.subsidiaryLabels) {
      axes.push([subA, b.primaryLabel]);
    }
    for (const subB of b.subsidiaryLabels) {
      axes.push([a.primaryLabel, subB]);
    }
    for (const subA of a.subsidiaryLabels) {
      for (const subB of b.subsidiaryLabels) {
        axes.push([subA, subB]);
      }
    }

    for (const [labelA, labelB] of axes) {
      const level = lookupAxis(acc, classRules, labelA, labelB);
      if (level !== null) {
        subsidiaryLevel = maxLevel(subsidiaryLevel, level);
      }
    }
  }

  if (baseLevel !== null) {
    contribute(acc, baseLevel);
  }
  contribute(acc, subsidiaryLevel);

  // Steps 6-7 — SG provisions in both directions.
  evaluateSgDirection(acc, a, b, classRules, sgRules);
  evaluateSgDirection(acc, b, a, classRules, sgRules);

  // Step 8 — same-primary-class subsidiary exception. When both entries share
  // a primary class and the only thing raising the requirement is a
  // subsidiary-risk axis, the authorized dataset does not carry enough
  // dangerous-reaction detail to finalize that level. Fail to review rather
  // than asserting either the level or CLEAR.
  const samePrimaryClass = left.primaryClass === right.primaryClass;
  if (samePrimaryClass && subsidiaryLevel > 0 && subsidiaryLevel > (baseLevel ?? 0)) {
    addBlocker(acc, REVIEW_BLOCKER.sameClassSubsidiary);
  }

  const additionalRequirements = dedupeAdditionalRequirements(acc.additionalRequirements);

  if (acc.blockers.length > 0) {
    const blockers = [...acc.blockers].sort();
    return {
      decision: { status: 'REVIEW_REQUIRED', level: null, reason: reviewReason(blockers) },
      additionalRequirements,
      reviewBlockers: blockers,
    };
  }

  if (acc.level === 0) {
    return {
      decision: { status: 'CLEAR', level: 0, reason: 'No segregation level is required for this DG pair.' },
      additionalRequirements,
      reviewBlockers: [],
    };
  }

  return {
    decision: {
      status: 'SEGREGATION_REQUIRED',
      level: acc.level,
      reason: `Segregation level ${acc.level} is required for this DG pair.`,
    },
    additionalRequirements,
    reviewBlockers: [],
  };
}
