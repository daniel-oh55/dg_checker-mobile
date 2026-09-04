/**
 * Hazard-class normalization for authorized SEG.TABLE lookups.
 *
 * The authorized segregation matrix does not have one row per Class 1
 * division — it collapses them into three labels ("1.1 1.2 1.5", "1.3 1.6",
 * "1.4"). Every matrix lookup therefore goes through `toMatrixLabel` so a
 * Class 1 division resolves to the row the authorized source actually
 * publishes, and a naive `"1.1" === "1.1 1.2 1.5"` comparison can never
 * silently miss a rule.
 *
 * Non-Class-1 tokens pass through unchanged: the matrix labels for the 14
 * ordinary classes are already the class names themselves, and any token
 * that is neither is left as-is so it fails closed on a missing class rule
 * rather than being coerced into an unrelated row.
 */

/** The three collapsed Class 1 rows published by the authorized matrix. */
export const CLASS1_MATRIX_LABELS = ['1.1 1.2 1.5', '1.3 1.6', '1.4'] as const;

/** The 14 ordinary matrix labels, which double as their own class names. */
export const ORDINARY_MATRIX_LABELS = [
  '2.1',
  '2.2',
  '2.3',
  '3',
  '4.1',
  '4.2',
  '4.3',
  '5.1',
  '5.2',
  '6.1',
  '6.2',
  '7',
  '8',
  '9',
] as const;

const CLASS1_DIVISION_TO_LABEL = new Map<string, string>([
  ['1.1', '1.1 1.2 1.5'],
  ['1.2', '1.1 1.2 1.5'],
  ['1.5', '1.1 1.2 1.5'],
  ['1.3', '1.3 1.6'],
  ['1.6', '1.3 1.6'],
  ['1.4', '1.4'],
]);

const CLASS1_LABEL_SET: ReadonlySet<string> = new Set<string>(CLASS1_MATRIX_LABELS);

/**
 * Maps a hazard class token to the authorized matrix label used for
 * segregation-table lookups. Class 1 divisions collapse to their published
 * group row; every other token (including an already-collapsed group label)
 * is returned unchanged.
 */
export function toMatrixLabel(hazardClass: string): string {
  return CLASS1_DIVISION_TO_LABEL.get(hazardClass) ?? hazardClass;
}

/**
 * True for any token that denotes Class 1 — a raw division ("1.1", "1.4") or
 * an already-collapsed matrix label ("1.1 1.2 1.5"). Class 1 <-> Class 1 is
 * the one region of the authorized matrix that holds "*" rather than a
 * level, so callers use this to route those pairs to REVIEW_REQUIRED instead
 * of guessing a level.
 */
export function isClass1(hazardClass: string): boolean {
  return CLASS1_LABEL_SET.has(hazardClass) || CLASS1_DIVISION_TO_LABEL.has(hazardClass);
}
