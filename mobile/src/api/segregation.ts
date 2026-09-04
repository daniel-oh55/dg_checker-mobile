import { API_BASE_URL } from '../../config';

export type DecisionStatus = 'CLEAR' | 'SEGREGATION_REQUIRED' | 'REVIEW_REQUIRED';

export interface SegregationDecision {
  status: DecisionStatus;
  level: 0 | 1 | 2 | 3 | 4 | null;
  reason: string;
}

export type VariantResolution = 'UNIFORM' | 'STRICTEST_OF_MULTIPLE_VARIANTS';

export interface AdditionalRequirement {
  code: string;
  source: 'SG';
  requiresConfirmation: boolean;
}

export interface VariantSummary {
  left: number;
  right: number;
  evaluatedPairs: number;
}

export interface SegregationCheckResult {
  input: {
    leftUnNumber: string;
    rightUnNumber: string;
  };
  decision: SegregationDecision;
  variants: VariantSummary;
  additionalRequirements: AdditionalRequirement[];
  variantResolution: VariantResolution;
}

export type SegregationCheckErrorCode =
  | 'INVALID_REQUEST'
  | 'DUPLICATE_UN_NUMBER'
  | 'DG_NOT_FOUND'
  | 'DATASET_NOT_READY'
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

async function parseErrorResponse(response: Response): Promise<SegregationCheckError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new SegregationCheckError('INTERNAL_ERROR', 'Unable to complete the check.');
  }

  const errorBody = body as { error?: { code?: string; unNumbers?: string[] } };
  const code = errorBody.error?.code;

  if (response.status === 404 && code === 'DG_NOT_FOUND') {
    return new SegregationCheckError(
      'DG_NOT_FOUND',
      'One or more UN numbers were not found in the current dataset.',
      errorBody.error?.unNumbers,
    );
  }

  if (response.status === 400 && code === 'DUPLICATE_UN_NUMBER') {
    return new SegregationCheckError(
      'DUPLICATE_UN_NUMBER',
      'Enter distinct UN numbers.',
      errorBody.error?.unNumbers,
    );
  }

  if (response.status === 400) {
    return new SegregationCheckError('INVALID_REQUEST', 'Check the UN numbers and try again.');
  }

  if (response.status === 503 && code === 'DATASET_NOT_READY') {
    return new SegregationCheckError(
      'DATASET_NOT_READY',
      'The segregation dataset is not available yet. Please try again later.',
    );
  }

  return new SegregationCheckError('INTERNAL_ERROR', 'Unable to complete the check. Please try again.');
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

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as SegregationCheckResult;
}

export interface SegregationBatchPairResult {
  leftUnNumber: string;
  rightUnNumber: string;
  decision: SegregationDecision;
  variants: VariantSummary;
  additionalRequirements: AdditionalRequirement[];
  variantResolution: VariantResolution;
}

export interface SegregationBatchSummary {
  inputCount: number;
  totalPairs: number;
  segregationRequiredPairs: number;
  reviewRequiredPairs: number;
  noSegregationLevelPairs: number;
  additionalRequirementPairs: number;
  maxRequiredLevel: 1 | 2 | 3 | 4 | null;
}

export interface SegregationBatchResult {
  input: {
    unNumbers: string[];
  };
  summary: SegregationBatchSummary;
  pairs: SegregationBatchPairResult[];
}

export async function checkSegregationBatch(
  unNumbers: string[],
  signal?: AbortSignal,
): Promise<SegregationBatchResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/segregation/check-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unNumbers }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new SegregationCheckError('NETWORK_ERROR', 'Unable to reach the service.');
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as SegregationBatchResult;
}
