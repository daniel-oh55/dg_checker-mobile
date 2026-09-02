const UN_PREFIX_PATTERN = /^UN\s*/i;
const FOUR_DIGIT_PATTERN = /^\d{1,4}$/;

/**
 * Normalizes a UN number to its canonical 4-digit string form.
 * Returns null for any input that is not a valid UN number.
 */
export function normalizeUnNumber(input: string): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const digits = trimmed.replace(UN_PREFIX_PATTERN, '');
  if (!FOUR_DIGIT_PATTERN.test(digits)) {
    return null;
  }

  return digits.padStart(4, '0');
}
