import { API_BASE_URL } from '../../config';

export type DecisionStatus = 'CLEAR' | 'SEGREGATION_REQUIRED' | 'REVIEW_REQUIRED';

export interface SegregationCheckResult {
  input: {
    leftUnNumber: string;
    rightUnNumber: string;
  };
  decision: {
    status: DecisionStatus;
    level: 0 | 1 | 2 | 3 | 4 | null;
    reason: string;
  };
  variants: {
    left: number;
    right: number;
    evaluatedPairs: number;
  };
}

export type SegregationCheckErrorCode =
  | 'INVALID_REQUEST'
  | 'DG_NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR';

export class SegregationCheckError extends Error {
  code: SegregationCheckErrorCode;
  unNumbers?: string[];

  constructor(code: SegregationCheckErrorCode, message: string, unNumbers?: string[]) {
    super(message);
    this.code = code;
    this.unNumbers = unNumbers;
  }
}

export async function checkSegregation(
  leftUnNumber: string,
  rightUnNumber: string,
  signal?: AbortSignal,
): Promise<SegregationCheckResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/segregation/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leftUnNumber, rightUnNumber }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new SegregationCheckError('NETWORK_ERROR', 'Unable to reach the service.');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SegregationCheckError('INTERNAL_ERROR', 'Unable to complete the check.');
  }

  if (!response.ok) {
    const errorBody = body as { error?: { code?: string; unNumbers?: string[] } };
    const code = errorBody.error?.code;

    if (response.status === 404 && code === 'DG_NOT_FOUND') {
      throw new SegregationCheckError(
        'DG_NOT_FOUND',
        'One or more UN numbers were not found in the current dataset.',
        errorBody.error?.unNumbers,
      );
    }

    if (response.status === 400) {
      throw new SegregationCheckError('INVALID_REQUEST', 'Check the UN numbers and try again.');
    }

    throw new SegregationCheckError('INTERNAL_ERROR', 'Unable to complete the check. Please try again.');
  }

  return body as SegregationCheckResult;
}
