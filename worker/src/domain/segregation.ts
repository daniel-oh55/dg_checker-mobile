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
 */
export interface SegregationRuleSet {
  readonly get: (classA: string, classB: string) => SegregationLevel | undefined;
}

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

function findUnsupportedReason(a: DgEntry, b: DgEntry): string | null {
  if (a.subsidiaryRisks.length > 0 || b.subsidiaryRisks.length > 0) {
    return 'One or more entries have subsidiary risk(s) not yet supported by the segregation engine.';
  }

  if (a.segregationCodes.length > 0 || b.segregationCodes.length > 0) {
    return 'One or more entries have specific segregation provision(s) not yet supported by the segregation engine.';
  }

  if (a.compatibilityGroup !== null || b.compatibilityGroup !== null) {
    return 'One or more entries have a Class 1 compatibility group not yet supported by the segregation engine.';
  }

  return null;
}

/**
 * Pure segregation evaluation for a pair of DG entries. Does not touch D1 or
 * any other I/O. Symmetric: evaluate(a, b, rules) === evaluate(b, a, rules).
 */
export function evaluateSegregation(left: DgEntry, right: DgEntry, rules: SegregationRuleSet): SegregationDecision {
  const unsupportedReason = findUnsupportedReason(left, right);
  if (unsupportedReason !== null) {
    return { status: 'REVIEW_REQUIRED', level: null, reason: unsupportedReason };
  }

  const classes = [left.primaryClass, right.primaryClass].sort();
  const level = rules.get(left.primaryClass, right.primaryClass);

  if (level === undefined) {
    return {
      status: 'REVIEW_REQUIRED',
      level: null,
      reason: `No segregation rule found for classes "${classes[0]}" and "${classes[1]}".`,
    };
  }

  if (level === 0) {
    return {
      status: 'CLEAR',
      level: 0,
      reason: `No segregation required between classes "${classes[0]}" and "${classes[1]}".`,
    };
  }

  return {
    status: 'SEGREGATION_REQUIRED',
    level,
    reason: `Segregation level ${level} required between classes "${classes[0]}" and "${classes[1]}".`,
  };
}
