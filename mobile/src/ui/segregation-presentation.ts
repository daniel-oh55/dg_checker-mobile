import type {
  DecisionStatus,
  SegregationBatchSummary,
  SegregationCheckError,
  SegregationCheckErrorCode,
} from '../api/segregation';

export interface Bilingual {
  ko: string;
  en: string;
}

import { segregationLevelLabel } from './segregation-levels';
import { palette } from './theme';

export { palette };

/** Surface/border/text/accent set for one status tone. Never hue-only: the
 * wording carries the meaning and `text` only has to stay readable on `surface`. */
export interface StatusTone {
  surface: string;
  border: string;
  text: string;
  accent: string;
}

export function sanitizeUnDigits(raw: string): string {
  return raw.replace(/[^0-9]/g, '').slice(0, 4);
}

export function isValidUnDigits(value: string): boolean {
  return /^[0-9]{1,4}$/.test(value);
}

export function canonicalUnNumber(value: string): string {
  return value.padStart(4, '0');
}

/** Canonical (padded) values that occur more than once, deduplicated, in first-occurrence order. */
export function findDuplicateCanonicalUnNumbers(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const canonical = canonicalUnNumber(value);
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
  }
  const duplicates: string[] = [];
  for (const value of values) {
    const canonical = canonicalUnNumber(value);
    if ((counts.get(canonical) ?? 0) > 1 && !duplicates.includes(canonical)) {
      duplicates.push(canonical);
    }
  }
  return duplicates;
}

/** Returns a validation message, or null when the active inputs are ready to submit. */
export function validateActiveInputs(values: string[]): Bilingual | null {
  const hasEmptyOrInvalid = values.some((value) => value.trim().length === 0 || !isValidUnDigits(value.trim()));
  if (hasEmptyOrInvalid) {
    return {
      ko: '모든 UN 번호를 입력해주세요.',
      en: 'Enter all UN numbers.',
    };
  }

  const duplicates = findDuplicateCanonicalUnNumbers(values.map((value) => value.trim()));
  if (duplicates.length > 0) {
    const list = duplicates.map((un) => `UN ${un}`).join(', ');
    return {
      ko: `중복된 UN 번호가 있습니다: ${list}`,
      en: 'Duplicate UN number.',
    };
  }

  return null;
}

/**
 * The one phrase for a REVIEW_REQUIRED pair.
 *
 * "Manual review" said nothing about why, and read as though the operator had
 * skipped a step. The result actually means the automated check ran and could
 * not finish this pair from the rules it models, so the wording says that and
 * {@link reviewRequiredDetail} says it in full. Neither exposes the internal
 * blocker code, which is diagnostic data derived from the private source.
 */
export const reviewRequiredText: Bilingual = { ko: '추가 확인 필요', en: 'Further review required' };

export const reviewRequiredDetail: Bilingual = {
  ko: '현재 자동 판정 범위를 넘어서는 조건이 있어 추가 확인이 필요합니다.',
  en: 'Additional review is required for conditions not fully resolved by the automated check.',
};

export function pairStatusText(status: DecisionStatus, level: number | null): Bilingual {
  switch (status) {
    case 'REVIEW_REQUIRED':
      return reviewRequiredText;
    case 'SEGREGATION_REQUIRED':
      return {
        ko: level === null ? '격리 필요' : `격리 필요 · ${segregationLevelLabel(level, 'ko')}`,
        en: level === null ? 'Segregation required' : `Segregation required · ${segregationLevelLabel(level, 'en')}`,
      };
    case 'CLEAR':
      return {
        ko: '확인된 규칙 기준 격리요건 없음 · Level 0',
        en: 'No segregation requirement identified from the evaluated rules · Level 0',
      };
  }
}

export const variantResolutionNote: Bilingual = {
  ko: '복수 Variant 중 가장 엄격한 결과',
  en: 'Strictest result across multiple variants',
};

export const additionalRequirementText = {
  header: {
    ko: '추가 격리조건 확인 필요',
    en: 'Additional segregation requirement requires review',
  } satisfies Bilingual,
  footer: { ko: '별도 조건을 확인해야 합니다.', en: 'Requires separate confirmation.' } satisfies Bilingual,
};

/**
 * Public API sentinels for a stored hazard value outside the authorized
 * publishable vocabulary (see worker `src/domain/dg-summary.ts`). Must never
 * be shown to end users verbatim, and must never be softened into "none" or
 * "safe" — the fact that the value is unresolved has to stay visible.
 */
const UNSPECIFIED_PRIMARY_HAZARD = 'UNSPECIFIED_PRIMARY_HAZARD';
const UNSPECIFIED_SUBSIDIARY_HAZARD = 'UNSPECIFIED_SUBSIDIARY_HAZARD';

export const hazardReviewRequiredText: Bilingual = { ko: '확인 필요', en: 'Review required' };

/** Ordinary classes (e.g. "3", "6.1", "1.4") pass through unchanged. */
export function presentPrimaryClass(primaryClass: string): string {
  return primaryClass === UNSPECIFIED_PRIMARY_HAZARD
    ? `${hazardReviewRequiredText.ko} / ${hazardReviewRequiredText.en}`
    : primaryClass;
}

/** Resolved subsidiary risk tokens pass through unchanged; only the sentinel is remapped. */
export function presentSubsidiaryRisks(subsidiaryRisks: readonly string[]): string {
  if (subsidiaryRisks.length === 0) {
    return `${noneText.ko} / ${noneText.en}`;
  }
  return subsidiaryRisks
    .map((risk) =>
      risk === UNSPECIFIED_SUBSIDIARY_HAZARD ? `${hazardReviewRequiredText.ko} / ${hazardReviewRequiredText.en}` : risk,
    )
    .join(', ');
}

/**
 * Tone for the Result Summary headline panel, in the same priority order as
 * {@link summaryHeadline}: REVIEW_REQUIRED outranks SEGREGATION_REQUIRED
 * outranks an additional requirement outranks a clear/no-level result.
 *
 * The no-level branch may use the muted mint accent, but mint here means
 * "no numeric level was identified", never "safe" — a CLEAR/level-0 pair may
 * still carry an additional requirement elsewhere in the batch, and the
 * headline wording is what actually carries the meaning.
 */
export function summaryTone(summary: SegregationBatchSummary): StatusTone {
  if (summary.reviewRequiredPairs > 0) {
    return reviewTone;
  }
  if (summary.segregationRequiredPairs > 0) {
    return segregationTone;
  }
  if (summary.additionalRequirementPairs > 0) {
    return additionalTone;
  }
  return clearTone;
}

const segregationTone: StatusTone = {
  surface: palette.segregationSurface,
  border: palette.segregationBorder,
  text: palette.segregationText,
  accent: palette.segregationAccent,
};

const reviewTone: StatusTone = {
  surface: palette.reviewSurface,
  border: palette.reviewBorder,
  text: palette.reviewText,
  accent: palette.reviewAccent,
};

const additionalTone: StatusTone = {
  surface: palette.additionalSurface,
  border: palette.additionalBorder,
  text: palette.additionalText,
  accent: palette.additionalAccent,
};

const clearTone: StatusTone = {
  surface: palette.clearSurface,
  border: palette.clearBorder,
  text: palette.clearText,
  accent: palette.clearAccent,
};

export { additionalTone };

/** Tone for one pair's status panel. Mirrors {@link summaryTone}'s vocabulary. */
export function pairStatusTone(status: DecisionStatus): StatusTone {
  switch (status) {
    case 'SEGREGATION_REQUIRED':
      return segregationTone;
    case 'REVIEW_REQUIRED':
      return reviewTone;
    case 'CLEAR':
      return clearTone;
  }
}

export function summaryHeadline(summary: SegregationBatchSummary): Bilingual {
  if (summary.reviewRequiredPairs > 0) {
    return { ko: '추가 확인이 필요한 조합이 있습니다.', en: 'Some pairs require further review.' };
  }
  if (summary.segregationRequiredPairs > 0) {
    return { ko: '격리가 필요한 조합이 있습니다.', en: 'Some pairs require segregation.' };
  }
  if (summary.additionalRequirementPairs > 0) {
    return { ko: '추가 조건 확인이 필요합니다.', en: 'Additional requirements need confirmation.' };
  }
  return {
    ko: '숫자 격리 수준이 요구된 조합은 없습니다.',
    en: 'No numeric segregation level was identified.',
  };
}

export const summaryMetricLabels = {
  totalPairs: { ko: '전체 조합', en: 'Total pairs' } satisfies Bilingual,
  segregationRequired: { ko: '격리 필요', en: 'Segregation' } satisfies Bilingual,
  reviewRequired: { ko: '추가 확인', en: 'Review' } satisfies Bilingual,
  levelZero: { ko: '격리 수준 없음', en: 'Level 0' } satisfies Bilingual,
  additionalRequirement: { ko: '추가 조건', en: 'Additional' } satisfies Bilingual,
  highestLevel: { ko: '조합 중 최고 Level', en: 'Highest pair level' } satisfies Bilingual,
};

/**
 * Accent colour for each summary metric tile. Used only for the small badge
 * strip behind the value, never as a filled card background, so the grid
 * stays readable and no tile shouts louder than the headline panel.
 */
export const summaryMetricAccents = {
  totalPairs: { tint: palette.brandBlueSoft, ink: palette.navy },
  segregationRequired: { tint: palette.segregationSurface, ink: palette.segregationText },
  reviewRequired: { tint: palette.reviewSurface, ink: palette.reviewText },
  levelZero: { tint: palette.mintSurface, ink: palette.mintText },
  additionalRequirement: { tint: palette.additionalSurface, ink: palette.additionalText },
  highestLevel: { tint: palette.brandBlueSoft, ink: palette.brandBlue },
} as const;

/**
 * Presentation-only: which active input slots should carry an error outline.
 *
 * Deliberately narrower than {@link validateActiveInputs}, which decides
 * whether the form may be submitted and is unchanged. Only a field that is
 * actually wrong on its own terms is outlined — a duplicate of another entered
 * value. A slot the operator simply has not filled in yet is left neutral, so
 * entering ten UN numbers does not paint the whole grid red; the validation
 * panel already states that every number is required.
 */
export function duplicateInputIndexes(values: string[]): number[] {
  const trimmed = values.map((value) => value.trim());
  const duplicates = findDuplicateCanonicalUnNumbers(trimmed.filter((value) => value.length > 0));
  if (duplicates.length === 0) {
    return [];
  }
  const flagged: number[] = [];
  trimmed.forEach((value, index) => {
    if (value.length > 0 && duplicates.includes(canonicalUnNumber(value))) {
      flagged.push(index);
    }
  });
  return flagged;
}

export function errorPresentation(error: SegregationCheckError): { message: Bilingual; unNumbers?: string[] } {
  const code: SegregationCheckErrorCode = error.code;

  switch (code) {
    case 'DG_NOT_FOUND':
      return {
        message: {
          ko: `현재 데이터셋에서 찾을 수 없습니다${
            error.unNumbers && error.unNumbers.length > 0
              ? `: ${error.unNumbers.map((un) => `UN ${un}`).join(', ')}`
              : ''
          }`,
          en: 'Not found in the current dataset.',
        },
        unNumbers: error.unNumbers,
      };
    case 'DUPLICATE_UN_NUMBER':
      return {
        message: {
          ko: `중복된 UN 번호가 있습니다${
            error.unNumbers && error.unNumbers.length > 0
              ? `: ${error.unNumbers.map((un) => `UN ${un}`).join(', ')}`
              : ''
          }`,
          en: 'Duplicate UN number.',
        },
        unNumbers: error.unNumbers,
      };
    case 'DATASET_NOT_READY':
      return {
        message: {
          ko: '데이터 업데이트 중입니다. 잠시 후 다시 시도해주세요.',
          en: 'Dataset is temporarily unavailable.',
        },
      };
    case 'NETWORK_ERROR':
      return {
        message: { ko: '서비스에 연결할 수 없습니다.', en: 'Unable to reach the service.' },
      };
    case 'INVALID_REQUEST':
    case 'INTERNAL_ERROR':
    default:
      return {
        message: {
          ko: '검사를 완료할 수 없습니다. 다시 시도해주세요.',
          en: 'Unable to complete the check.',
        },
      };
  }
}

export const psnUnavailableText: Bilingual = {
  ko: 'PSN 확인 필요',
  en: 'Proper Shipping Name requires review',
};

export const noneText: Bilingual = { ko: '없음', en: 'None' };

export const multipleProfilesText: Bilingual = {
  ko: '복수 DG Profile',
  en: 'Multiple DG profiles',
};

export const operationalNote: Bilingual = {
  ko: '추가 확인 또는 추가 조건이 표시된 조합은 적재 전 반드시 확인하세요. 본 도구는 참고용이며 최종 위험물 승인을 대체하지 않습니다.',
  en: 'Review flagged pairs and additional requirements before stowage. This is a reference tool, not final dangerous-goods approval.',
};

export const appHeaderText = {
  title: 'DG Segregation',
  primary: {
    ko: 'UN 번호 2~10개를 입력해 격리조건을 확인합니다.',
    en: 'Check segregation requirements for 2–10 UN numbers.',
  } satisfies Bilingual,
};
