import { describe, expect, it } from 'vitest';
import type { DecisionStatus } from '../api/segregation';
import { pairStatusText } from './segregation-presentation';

describe('pairStatusText', () => {
  it('names the level once, after the outcome', () => {
    expect(pairStatusText('SEGREGATION_REQUIRED', 2)).toEqual({
      ko: '격리 필요',
      en: 'Level 2 · Separated from / 분리 적재',
    });
  });

  it.each([1, 2, 3, 4] as const)('does not restate the level in the outcome line (level %i)', (level) => {
    const { ko } = pairStatusText('SEGREGATION_REQUIRED', level);
    expect(ko).toBe('격리 필요');
    expect(ko).not.toContain('Level');
  });

  it('falls back to the bare outcome when no level was resolved', () => {
    expect(pairStatusText('SEGREGATION_REQUIRED', null)).toEqual({
      ko: '격리 필요',
      en: 'Segregation required',
    });
  });

  it('leads a clear pair with the canonical level-0 label', () => {
    expect(pairStatusText('CLEAR', 0)).toEqual({
      ko: 'Level 0 · 격리 수준 없음',
      en: 'No segregation requirement identified from the evaluated rules',
    });
  });

  it('leaves the review wording alone', () => {
    const status: DecisionStatus = 'REVIEW_REQUIRED';
    expect(pairStatusText(status, null)).toEqual({
      ko: '추가 확인 필요',
      en: 'Further review required',
    });
  });
});
