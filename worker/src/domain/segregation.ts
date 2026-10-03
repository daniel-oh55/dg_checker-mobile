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

/**
 * The segregation provisions corresponding to a **subsidiary** hazard of
 * class 1 are those for class 1 division 1.3, which the authorized matrix
 * publishes in the collapsed "1.3 1.6" row. Only ever used for a subsidiary
 * axis: a class 1 *primary* class keeps its own division's row.
 */
const CLASS1_SUBSIDIARY_AXIS = '1.3 1.6';

export const REVIEW_BLOCKER = {
  unresolvedSubsidiary: 'UNRESOLVED_SUBSIDIARY_SOURCE',
  /**
   * A segregation-field value the converter could not resolve to an SG code.
   * Distinct from UNKNOWN_SG_CODE: that one means a well-formed code with no
   * row in `sg_rules` (a dataset-integrity fault), whereas this means the
   * authorized source cell itself did not yield a code. Carries no payload,
   * so the unresolvable source text never reaches a diagnostic value.
   */
  unresolvedSegregation: 'UNRESOLVED_SEGREGATION_SOURCE',
  /**
   * Two or more subsidiary hazard labels, where the entry carries no column
   * 16b provision this engine can mechanically evaluate. The provisions for
   * such goods are the ones given in column 16b, so an entry whose column 16b
   * yields nothing evaluable leaves the requirement unspecified.
   */
  multipleSubsidiaryNoProvision: 'MULTIPLE_SUBSIDIARY_RISKS_NO_PROVISION',
  /**
   * A provision that relaxes segregation under a condition this engine cannot
   * verify. The relaxation is not granted, and the un-relaxed requirement is
   * not presented as a final answer either: the pair goes to review.
   */
  exemptionRequiresReview: 'EXEMPTION_REQUIRES_REVIEW',
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
  /** Segregation-field values the converter could not resolve to an SG code. */
  readonly unresolvedSegregationTokens: readonly string[];
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
    unresolvedSegregationTokens: entry.segregationCodes.filter((code) =>
      code.startsWith(UNRESOLVED_TOKEN_PREFIX),
    ),
  };
}

/**
 * The hazard class(es) an entry presents to the segregation table, and
 * whether an "as for class" provision put them there in place of its own
 * primary hazard class.
 */
interface TableBasis {
  readonly labels: readonly string[];
  readonly substituted: boolean;
}

/**
 * One segregation-table axis an entry contributes, carrying just enough
 * provenance to answer "did subsidiary-hazard treatment introduce this?".
 */
interface HazardAxis {
  readonly label: string;
  readonly subsidiaryDriven: boolean;
}

/**
 * The hazard classes this entry is "deemed to include" when another cargo's
 * SG provision names a class.
 *
 * A segregation term such as "away from class N" covers goods *of* class N
 * and goods carrying a class N **subsidiary** hazard label, so every resolved
 * subsidiary label is matchable here — including on an entry that carries two
 * or more of them, since that rule has no single-subsidiary restriction.
 *
 * Deliberately distinct from {@link tableBasisLabels}: this is target
 * matching, not a segregation-table lookup, so an "as for class" substitution
 * never changes what another cargo's provision matches against.
 */
function matchableHazardLabels(normalized: NormalizedEntry): string[] {
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
  /**
   * The highest contribution that exists only because of subsidiary-hazard
   * treatment — a subsidiary table axis, or the column 16b provisions that
   * stand in for those axes on a two-or-more-subsidiary entry. Kept beside
   * `level` so the same-primary-class exception (step 8) can tell "this
   * requirement comes from a subsidiary hazard" from "this requirement is a
   * DGL-specific provision unrelated to subsidiary handling", which is
   * exactly the distinction 7.2.6.1 turns on.
   */
  subsidiaryDrivenLevel: SegregationLevel;
  readonly blockers: string[];
  readonly additionalRequirements: AdditionalRequirement[];
}

function contribute(acc: Accumulator, level: SegregationLevel, subsidiaryDriven = false): void {
  acc.level = maxLevel(acc.level, level);
  if (subsidiaryDriven) {
    acc.subsidiaryDrivenLevel = maxLevel(acc.subsidiaryDrivenLevel, level);
  }
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
 * Resolves the SG codes an entry carries to rules, recording a blocker for
 * every code that cannot be resolved. Runs once per entry so a code is
 * diagnosed exactly once even though it is consulted twice — first to
 * establish the entry's segregation-table basis, then to apply the provision
 * against the other cargo.
 */
function resolveSgRules(acc: Accumulator, normalized: NormalizedEntry, sgRules: SgRuleSet): SgRule[] {
  const resolved: SgRule[] = [];

  for (const code of normalized.entry.segregationCodes) {
    if (code.startsWith(UNRESOLVED_TOKEN_PREFIX)) {
      // Already recorded as REVIEW_BLOCKER.unresolvedSegregation; skipped
      // here so the raw source payload never reaches a blocker value.
      continue;
    }

    const rule = sgRules.get(code);
    if (rule === undefined) {
      addBlocker(acc, `UNKNOWN_SG_CODE:${code}`);
      continue;
    }
    resolved.push(rule);
  }

  return resolved;
}

/**
 * The hazard class(es) this entry presents to the segregation table.
 *
 * Where the Dangerous Goods List specifies "segregation as for class ...",
 * the provisions applicable to *that* class are the ones applied — the
 * substituted class **replaces** the entry's own primary hazard class as the
 * table basis rather than adding a second candidate on top of it. That is the
 * one place a column 16b provision overrides the general table instead of
 * adding to it, and getting it wrong over-segregates: a class 4.3 substance
 * told to segregate as for class 3 would otherwise keep its class 4.3 row and
 * so keep requirements the substitution is meant to displace.
 *
 * Several substitutions on one entry are unioned; the strictest result across
 * them governs.
 */
function tableBasisLabels(normalized: NormalizedEntry, rules: readonly SgRule[]): TableBasis {
  const substituted: string[] = [];
  for (const rule of rules) {
    if (rule.ruleType !== 'AS_FOR_CLASS') continue;
    for (const target of rule.targets) {
      if (!substituted.includes(target)) {
        substituted.push(target);
      }
    }
  }

  return substituted.length > 0
    ? { labels: substituted, substituted: true }
    : { labels: [normalized.primaryLabel], substituted: false };
}

/**
 * Whether a resolved provision can actually establish or evaluate a
 * segregation requirement, as opposed to merely accompanying one.
 *
 * DIRECT_* produce a level against a matchable target, and AS_FOR_CLASS
 * establishes a table basis — those four can yield a determinable result.
 * ADDITIONAL_REQUIREMENT, EXEMPTION, REVIEW_ONLY and RESERVED cannot: the
 * first is a non-level obligation carried alongside a requirement, and the
 * other three are precisely the cases this engine refuses to resolve. A
 * DIRECT_* row missing its level or targets is malformed and counts as
 * nothing here, so a broken row can never stand in for a real provision.
 */
function isMechanicallyEvaluable(rule: SgRule): boolean {
  switch (rule.ruleType) {
    case 'DIRECT_CLASS':
    case 'DIRECT_SGG':
    case 'DIRECT_UN':
      return rule.level !== null && rule.targets.length > 0;
    case 'AS_FOR_CLASS':
      return rule.targets.length > 0;
    default:
      return false;
  }
}

/**
 * The full set of axes this entry contributes to segregation-table lookups:
 * its table basis, plus a subsidiary-hazard axis where one applies.
 *
 * - Exactly one subsidiary hazard label — its provisions apply and take
 *   precedence wherever they are more stringent than the basis, which is
 *   exactly what maximizing over both axes produces. A subsidiary hazard of
 *   class 1 contributes the provisions for division 1.3.
 * - Two or more subsidiary hazard labels — the applicable provisions are the
 *   ones given in column 16b, so the individual subsidiary axes are *not*
 *   enumerated against the table. Completeness is judged on the *resolved*
 *   rules rather than on how many source tokens column 16b happened to hold:
 *   the entry needs at least one provision that can actually establish or
 *   evaluate a requirement (see {@link isMechanicallyEvaluable}). An entry
 *   whose column 16b carries only an ADDITIONAL_REQUIREMENT, only provisions
 *   this engine refuses to resolve, or nothing at all leaves the requirement
 *   unspecified and fails closed instead of silently resolving to its primary
 *   class alone. Codes that are themselves unresolvable — EXEMPTION,
 *   REVIEW_ONLY, RESERVED, an unknown code, an unresolved source token — also
 *   raise their own blockers elsewhere; this check is about whether anything
 *   is left that could have produced an answer.
 *
 * Returns null when the entry fails closed.
 */
function tableHazardAxes(
  acc: Accumulator,
  normalized: NormalizedEntry,
  basis: TableBasis,
  rules: readonly SgRule[],
): HazardAxis[] | null {
  const subsidiaries = normalized.subsidiaryLabels;
  const multipleSubsidiaries = subsidiaries.length > 1;

  // A substituted basis counts as subsidiary-driven only where column 16b is
  // itself the subsidiary-hazard treatment, i.e. on a 2+-subsidiary entry.
  // On an entry with one subsidiary label or none, "segregation as for class"
  // is an ordinary DGL-specific provision and nothing to do with subsidiary
  // handling, while the single subsidiary axis below is tracked on its own.
  const basisSubsidiaryDriven = multipleSubsidiaries && basis.substituted;
  const axes: HazardAxis[] = basis.labels.map((label) => ({
    label,
    subsidiaryDriven: basisSubsidiaryDriven,
  }));

  if (multipleSubsidiaries) {
    if (!rules.some(isMechanicallyEvaluable)) {
      addBlocker(acc, REVIEW_BLOCKER.multipleSubsidiaryNoProvision);
      return null;
    }
    return axes;
  }

  for (const subsidiary of subsidiaries) {
    const label = isClass1(subsidiary) ? CLASS1_SUBSIDIARY_AXIS : subsidiary;
    // A subsidiary label the basis already carries introduces nothing: the
    // entry's own basis row imposes that requirement anyway, so the axis is
    // not recorded a second time as a subsidiary-driven one.
    if (!axes.some((axis) => axis.label === label)) {
      axes.push({ label, subsidiaryDriven: true });
    }
  }

  return axes;
}

/**
 * Applies one resolved SG provision carried by the holder against `other`.
 *
 * AS_FOR_CLASS is absent here on purpose: it is not an additional provision
 * applied against the other cargo but a substitution of the holder's own
 * table basis, handled by {@link tableBasisLabels} before any lookup happens.
 *
 * `subsidiaryDriven` says whether this holder's column 16b provisions *are*
 * its subsidiary-hazard treatment — true exactly when the holder carries two
 * or more subsidiary hazard labels, where column 16b supplies the requirement
 * the individual subsidiary axes would otherwise have been enumerated for.
 * On every other entry a provision is an ordinary DGL-specific one and is not
 * attributed to subsidiary handling.
 */
function applySgRule(
  acc: Accumulator,
  rule: SgRule,
  other: NormalizedEntry,
  subsidiaryDriven: boolean,
): void {
  switch (rule.ruleType) {
    case 'AS_FOR_CLASS':
      return;

    case 'RESERVED':
      // A reserved source code should never be referenced by a real entry.
      addBlocker(acc, `RESERVED_SG_CODE:${rule.code}`);
      return;

    case 'REVIEW_ONLY':
      addBlocker(acc, `REVIEW_ONLY_SG_CODE:${rule.code}`);
      return;

    case 'EXEMPTION':
      // A relaxation whose condition this engine cannot verify. Failing
      // closed means declining the relaxation *and* declining to publish the
      // un-relaxed figure as a final answer: the condition may well hold, in
      // which case the strict number would be wrong in the other direction.
      // So the provision is not applied, the level is not lowered, it is not
      // reported to the operator as an obligation to satisfy, and the pair
      // goes to review. The un-relaxed level keeps accumulating internally;
      // the blocker simply dominates the public decision. The row stays in
      // the dataset so the source provision remains auditable, and the
      // blocker carries no payload so no source wording escapes.
      addBlocker(acc, REVIEW_BLOCKER.exemptionRequiresReview);
      return;

    case 'ADDITIONAL_REQUIREMENT':
      acc.additionalRequirements.push({ code: rule.code, source: 'SG', requiresConfirmation: true });
      return;

    case 'DIRECT_CLASS': {
      if (rule.level === null) {
        addBlocker(acc, `MALFORMED_SG_RULE:${rule.code}`);
        return;
      }
      for (const label of matchableHazardLabels(other)) {
        if (rule.targets.includes(label)) {
          contribute(acc, rule.level, subsidiaryDriven);
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
        contribute(acc, rule.level, subsidiaryDriven);
      }
      return;
    }

    case 'DIRECT_UN': {
      if (rule.level === null) {
        addBlocker(acc, `MALFORMED_SG_RULE:${rule.code}`);
        return;
      }
      if (rule.targets.includes(other.entry.unNumber)) {
        contribute(acc, rule.level, subsidiaryDriven);
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

/**
 * The public reason for every REVIEW_REQUIRED decision.
 *
 * Deliberately stable and generic. Review blockers are diagnostic values
 * derived from the private authorized source — `UNKNOWN_SG_CODE:<code>` and
 * `MISSING_CLASS_RULE:<a>|<b>` embed a code or class label read straight out
 * of the workbook, and a source cell the converter could not resolve reaches
 * them verbatim as an `UNRESOLVED_SOURCE:` payload. Concatenating blockers
 * into `decision.reason` published that source text through the API, so the
 * public reason now carries none of it.
 *
 * Blockers stay available internally on `PairEvaluation.reviewBlockers` for
 * evaluation, logging and debugging; they are not part of the single or batch
 * API contract and must not be added to it.
 */
export const REVIEW_REQUIRED_REASON =
  'This pair has conditions the automated check cannot resolve, so further review is required.';

/**
 * Pure segregation evaluation for one concrete DG entry variant pair. Does
 * not touch D1 or any other I/O, and is symmetric: evaluate(a, b) and
 * evaluate(b, a) produce the same decision.
 *
 * Evaluation order (review blockers dominate any numeric result):
 *   1. normalize source hazard data
 *   2. detect unresolved subsidiary / segregation source content
 *   3. resolve each side's column 16b provisions
 *   4. establish each side's segregation-table basis, substituting an
 *      "as for class" target for the primary class where one applies
 *   5. add each side's permitted subsidiary-hazard axis
 *   6. evaluate the table across both sides' axes, strictest governing
 *   7. apply column 16b provisions in both directions, strictest governing
 *   8. same-primary-class dangerous-reaction exception
 *
 * Steps 6 and 7 accumulate by `max`, so a weaker provision never erases a
 * stronger one. The one provision type that genuinely overrides rather than
 * adds — "segregation as for class ..." — does so at step 4 by replacing the
 * basis, not by contributing a competing level.
 */
export function evaluateSegregationPair(
  left: DgEntry,
  right: DgEntry,
  classRules: SegregationRuleSet,
  sgRules: SgRuleSet,
): PairEvaluation {
  const a = normalizeEntry(left);
  const b = normalizeEntry(right);

  const acc: Accumulator = { level: 0, subsidiaryDrivenLevel: 0, blockers: [], additionalRequirements: [] };

  // Step 2 — unresolved source content must never be dropped.
  if (a.unresolvedSubsidiaryTokens.length > 0 || b.unresolvedSubsidiaryTokens.length > 0) {
    addBlocker(acc, REVIEW_BLOCKER.unresolvedSubsidiary);
  }
  if (a.unresolvedSegregationTokens.length > 0 || b.unresolvedSegregationTokens.length > 0) {
    addBlocker(acc, REVIEW_BLOCKER.unresolvedSegregation);
  }

  // Step 3 — resolve column 16b provisions once per side.
  const rulesA = resolveSgRules(acc, a, sgRules);
  const rulesB = resolveSgRules(acc, b, sgRules);

  // Steps 4-5 — each side's segregation-table axes.
  const basisA = tableBasisLabels(a, rulesA);
  const basisB = tableBasisLabels(b, rulesB);
  const hazardsA = tableHazardAxes(acc, a, basisA, rulesA);
  const hazardsB = tableHazardAxes(acc, b, basisB, rulesB);

  // Step 6 — the table across every applicable axis pair. `primaryOnlyLevel`
  // is kept separately for step 8: it is the requirement the two primary
  // hazard classes impose on their own, with no subsidiary axis and no
  // substitution, which is the basis the same-class exception is judged on.
  const primaryOnlyLevel = lookupAxis(acc, classRules, a.primaryLabel, b.primaryLabel);
  if (hazardsA !== null && hazardsB !== null) {
    for (const axisA of hazardsA) {
      for (const axisB of hazardsB) {
        const level = lookupAxis(acc, classRules, axisA.label, axisB.label);
        if (level !== null) {
          contribute(acc, level, axisA.subsidiaryDriven || axisB.subsidiaryDriven);
        }
      }
    }
  }

  // Step 7 — column 16b provisions in both directions. A provision on either
  // entry applies, and the strictest applicable requirement governs. Where
  // the holder carries two or more subsidiary hazard labels its provisions
  // *are* the subsidiary-hazard treatment, so what they contribute is
  // recorded as subsidiary-driven for step 8.
  const multiSubsidiaryA = a.subsidiaryLabels.length > 1;
  const multiSubsidiaryB = b.subsidiaryLabels.length > 1;
  for (const rule of rulesA) {
    applySgRule(acc, rule, b, multiSubsidiaryA);
  }
  for (const rule of rulesB) {
    applySgRule(acc, rule, a, multiSubsidiaryB);
  }

  // Step 8 — substances of the same class may be stowed together without
  // regard to segregation required by their subsidiary hazard label(s),
  // provided they do not react dangerously with each other. "Same class" is
  // judged on the Dangerous Goods List primary hazard class, so a pair that
  // shares one and whose requirement exceeds what those primary classes
  // impose on their own *because of subsidiary-hazard treatment* is sitting
  // exactly on that exception. The dataset carries no dangerous-reaction
  // detail, so fail to review rather than asserting either the raised level
  // or CLEAR.
  //
  // The test is the subsidiary-driven contribution, not the overall level: a
  // DGL-specific provision on same-class goods that has nothing to do with
  // subsidiary handling raises a requirement the exception never reaches, and
  // must still produce its number rather than a review.
  const samePrimaryClass = left.primaryClass === right.primaryClass;
  if (samePrimaryClass && acc.subsidiaryDrivenLevel > (primaryOnlyLevel ?? 0)) {
    addBlocker(acc, REVIEW_BLOCKER.sameClassSubsidiary);
  }

  const additionalRequirements = dedupeAdditionalRequirements(acc.additionalRequirements);

  if (acc.blockers.length > 0) {
    const blockers = [...acc.blockers].sort();
    return {
      decision: { status: 'REVIEW_REQUIRED', level: null, reason: REVIEW_REQUIRED_REASON },
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
