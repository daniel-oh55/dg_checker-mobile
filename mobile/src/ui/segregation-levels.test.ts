import { describe, expect, it } from 'vitest';
import {
  SEGREGATION_LEVEL_DISPLAY_LABEL,
  SEGREGATION_LEVEL_WORDING,
  segregationLevelDisplayLabel,
  segregationLevelLabel,
} from './segregation-levels';

describe('canonical level labels', () => {
  // Pinned verbatim: these are the only strings the app may use to name a
  // level, and a silent edit to one of them changes what an operator is told.
  it.each([
    [0, 'Level 0 · 격리 수준 없음'],
    [1, 'Level 1 · Away from / 이격 적재'],
    [2, 'Level 2 · Separated from / 분리 적재'],
    [3, 'Level 3 · 완전 구획 또는 화물창 분리'],
    [4, 'Level 4 · 종방향 완전 구획 분리'],
  ] as const)('level %i reads "%s"', (level, label) => {
    expect(SEGREGATION_LEVEL_DISPLAY_LABEL[level]).toBe(label);
    expect(segregationLevelDisplayLabel(level)).toBe(label);
  });

  it('has no label for an absent level', () => {
    expect(segregationLevelDisplayLabel(null)).toBeNull();
  });

  it('never softens level 0 into a clearance', () => {
    const label = SEGREGATION_LEVEL_DISPLAY_LABEL[0];
    for (const forbidden of ['혼적 가능', 'Safe', 'Compatible', 'OK to load']) {
      expect(label).not.toContain(forbidden);
    }
  });
});

describe('English IMDG terminology', () => {
  // The defined terms stay verbatim even where the canonical Korean label
  // uses the compact wording instead.
  it.each([
    [1, 'Away from'],
    [2, 'Separated from'],
    [3, 'Separated by a complete compartment or hold from'],
    [4, 'Separated longitudinally by an intervening complete compartment or hold from'],
  ] as const)('level %i keeps the defined term "%s"', (level, term) => {
    expect(SEGREGATION_LEVEL_WORDING[level].en).toBe(term);
    expect(segregationLevelLabel(level, 'en')).toBe(`Level ${level} · ${term}`);
  });
});
