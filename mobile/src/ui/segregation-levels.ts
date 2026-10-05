import type { Bilingual } from './segregation-presentation';

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
 * `en` is the defined term as written. `ko` is a plain-language description
 * of what the term requires, not an official translation, which is why the
 * English term is always shown alongside it rather than replaced by it.
 *
 * Presentation only. Nothing here feeds a decision, and no numeric engine
 * semantics depend on it.
 */
export const SEGREGATION_LEVEL_WORDING: Readonly<Record<1 | 2 | 3 | 4, Bilingual>> = {
  1: {
    ko: '떨어져서 적재',
    en: 'Away from',
  },
  2: {
    ko: '격리 적재',
    en: 'Separated from',
  },
  3: {
    ko: '격벽 또는 선창으로 격리',
    en: 'Separated by a complete compartment or hold from',
  },
  4: {
    ko: '종방향으로 격벽 또는 선창을 사이에 두고 격리',
    en: 'Separated longitudinally by an intervening complete compartment or hold from',
  },
};

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
