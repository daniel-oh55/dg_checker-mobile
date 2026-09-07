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

/**
 * Concept C — "Light Professional Maritime Utility" palette.
 * Off-white ground, white cards, navy headings, and status colors that never
 * use green (a CLEAR/level-0 pair may still carry an additional requirement).
 */
export const palette = {
  background: '#F4F6F8',
  card: '#FFFFFF',
  border: '#DCE3EA',
  navy: '#0B2545',
  navySubdued: '#3C5A78',
  primary: '#0F4C81',
  primaryDisabled: '#9FB6CC',
  textPrimary: '#1B2A3A',
  textSecondary: '#5A6B7C',
  clearBorder: '#8FA6BE',
  clearBg: '#EEF2F6',
  clearText: '#1F3A54',
  segregationBorder: '#B3261E',
  segregationBg: '#FCECEB',
  segregationText: '#7A1E1A',
  reviewBorder: '#C77700',
  reviewBg: '#FFF3E0',
  reviewText: '#7A4A00',
  additionalBorder: '#D69A00',
  additionalBg: '#FFF8E1',
  additionalText: '#6B4E00',
  errorBorder: '#B3261E',
  errorBg: '#FCECEB',
  errorText: '#7A1E1A',
} as const;

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

export function pairStatusText(status: DecisionStatus, level: number | null): Bilingual {
  switch (status) {
    case 'REVIEW_REQUIRED':
      return { ko: '수동 검토 필요', en: 'Manual review required' };
    case 'SEGREGATION_REQUIRED':
      return {
        ko: `격리 필요 · Level ${level ?? '-'}`,
        en: 'Segregation required',
      };
    case 'CLEAR':
      return { ko: '격리 수준 없음 · Level 0', en: 'No segregation level' };
  }
}

export const variantResolutionNote: Bilingual = {
  ko: '복수 Variant 중 가장 엄격한 결과',
  en: 'Strictest result across multiple variants',
};

export const additionalRequirementText = {
  header: { ko: '추가 조건 확인 필요', en: 'Additional requirement' } satisfies Bilingual,
  footer: { ko: '별도 조건을 확인해야 합니다.', en: 'Requires separate confirmation.' } satisfies Bilingual,
};

export function summaryHeadline(summary: SegregationBatchSummary): Bilingual {
  if (summary.reviewRequiredPairs > 0) {
    return { ko: '수동 검토가 필요한 조합이 있습니다.', en: 'Some pairs require manual review.' };
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
  reviewRequired: { ko: '수동 검토', en: 'Review' } satisfies Bilingual,
  levelZero: { ko: '격리 수준 없음', en: 'Level 0' } satisfies Bilingual,
  additionalRequirement: { ko: '추가 조건', en: 'Additional' } satisfies Bilingual,
  highestLevel: { ko: '조합 중 최고 Level', en: 'Highest pair level' } satisfies Bilingual,
};

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
  ko: 'PSN 데이터 업데이트 대기 중',
  en: 'PSN unavailable in the current dataset',
};

export const noneText: Bilingual = { ko: '없음', en: 'None' };

export const multipleProfilesText: Bilingual = {
  ko: '복수 DG Profile',
  en: 'Multiple DG profiles',
};

export const operationalNote: Bilingual = {
  ko: '수동 검토 또는 추가 조건이 표시된 조합은 적재 전 반드시 확인하세요.',
  en: 'Review flagged pairs and additional requirements before stowage.',
};

export const appHeaderText = {
  title: 'DG Segregation',
  primary: {
    ko: 'UN 번호 2~10개를 입력해 격리조건을 확인합니다.',
    en: 'Check segregation requirements for 2–10 UN numbers.',
  } satisfies Bilingual,
};
