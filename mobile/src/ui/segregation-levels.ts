import type { Bilingual } from './segregation-presentation';

/** Every level the app is able to put on screen, including the level-0 state. */
export type SegregationDisplayLevel = 0 | 1 | 2 | 3 | 4;

export function isSegregationDisplayLevel(level: number | null): level is SegregationDisplayLevel {
  return level === 0 || level === 1 || level === 2 || level === 3 || level === 4;
}

/**
 * The single place the segregation levels are put into words.
 *
 * Levels 1-4 are not an app-invented severity scale: each one names a defined
 * segregation term, and the authorized source uses those terms verbatim in
 * its special-provision wording ("stow away from ...", "stow separated from
 * ...", and the two compartment/hold forms). The engine's converter maps that
 * same wording back to 1-4, so these labels and the numbers the engine
 * computes come from one shared vocabulary rather than two.
 *
 * `en` is the defined term as written, kept verbatim for the places the app
 * shows English secondary text. `ko` is a compact plain-language description
 * of what the term requires, not an official translation, which is why the
 * English term is never replaced by it.
 *
 * Presentation only. Nothing here feeds a decision, and no numeric engine
 * semantics depend on it.
 */
export const SEGREGATION_LEVEL_WORDING = {
  1: {
    ko: '이격 적재',
    en: 'Away from',
  },
  2: {
    ko: '분리 적재',
    en: 'Separated from',
  },
  3: {
    ko: '완전 구획 또는 화물창 분리',
    en: 'Separated by a complete compartment or hold from',
  },
  4: {
    ko: '종방향 완전 구획 분리',
    en: 'Separated longitudinally by an intervening complete compartment or hold from',
  },
} as const satisfies Readonly<Record<1 | 2 | 3 | 4, Bilingual>>;

/**
 * The canonical Korean-primary label for each level — the only wording the app
 * uses when it names a level to the operator.
 *
 * Levels 1 and 2 carry their English defined term inline because both are
 * short enough to read as one line; levels 3 and 4 would run to two or three
 * lines, so their label stays Korean and the full English term is reached
 * through {@link segregationLevelLabel} where an English line is rendered.
 *
 * Level 0 is an application presentation state: it means no numeric
 * segregation level was identified from the evaluated rules. It is deliberately
 * not phrased as "혼적 가능", "compatible" or "safe" — a level-0 pair may still
 * carry an additional requirement that has to be confirmed separately.
 */
export const SEGREGATION_LEVEL_DISPLAY_LABEL = {
  0: 'Level 0 · 격리 수준 없음',
  1: 'Level 1 · Away from / 이격 적재',
  2: 'Level 2 · Separated from / 분리 적재',
  3: 'Level 3 · 완전 구획 또는 화물창 분리',
  4: 'Level 4 · 종방향 완전 구획 분리',
} as const satisfies Readonly<Record<SegregationDisplayLevel, string>>;

/** The canonical label, or null when there is no level to name at all. */
export function segregationLevelDisplayLabel(level: number | null): string | null {
  return isSegregationDisplayLevel(level) ? SEGREGATION_LEVEL_DISPLAY_LABEL[level] : null;
}

/** Level 0 is the absence of a numeric requirement, so it has no segregation term. */
export function segregationLevelWording(level: number | null): Bilingual | null {
  if (level === 1 || level === 2 || level === 3 || level === 4) {
    return SEGREGATION_LEVEL_WORDING[level];
  }
  return null;
}

/**
 * "Level 2 · Separated from" — the number with the term it stands for, in the
 * requested language. Falls back to the bare level when there is no term,
 * which is only ever level 0 or an absent level.
 */
export function segregationLevelLabel(level: number | null, language: keyof Bilingual): string {
  if (level === null) {
    return '';
  }
  const wording = segregationLevelWording(level);
  return wording === null ? `Level ${level}` : `Level ${level} · ${wording[language]}`;
}
