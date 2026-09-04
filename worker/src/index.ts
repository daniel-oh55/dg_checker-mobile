import { getDatasetStatus } from './data/dataset-status';
import { findDgEntriesByUnNumber, findDgEntriesByUnNumbers } from './data/dg-entries';
import { loadSegregationRuleSet } from './data/segregation-rules';
import { loadSgRuleSet } from './data/sg-rules';
import { evaluateResolvedUnPair } from './domain/evaluate-un-pair';
import type { ResolvedUnPairEvaluation } from './domain/evaluate-un-pair';
import type { DgEntry } from './domain/types';
import { normalizeUnNumber } from './domain/un-number';

const BATCH_MIN_INPUTS = 2;
const BATCH_MAX_INPUTS = 10;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

interface SegregationCheckInput {
  leftUnNumber: string;
  rightUnNumber: string;
}

function parseSegregationCheckBody(body: unknown): SegregationCheckInput | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const { leftUnNumber, rightUnNumber } = body as Record<string, unknown>;
  if (typeof leftUnNumber !== 'string' || typeof rightUnNumber !== 'string') {
    return null;
  }

  return { leftUnNumber, rightUnNumber };
}

async function handleSegregationCheck(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
  }

  const parsedBody = parseSegregationCheckBody(body);
  if (parsedBody === null) {
    return errorResponse(400, 'INVALID_REQUEST', '"leftUnNumber" and "rightUnNumber" are required strings.');
  }

  const leftUnNumber = normalizeUnNumber(parsedBody.leftUnNumber);
  const rightUnNumber = normalizeUnNumber(parsedBody.rightUnNumber);
  if (leftUnNumber === null || rightUnNumber === null) {
    return errorResponse(400, 'INVALID_REQUEST', '"leftUnNumber" and "rightUnNumber" must be valid UN numbers.');
  }

  try {
    const datasetStatus = await getDatasetStatus(env.DB);
    if (!datasetStatus.ready) {
      return errorResponse(503, 'DATASET_NOT_READY', 'Segregation dataset is not available.');
    }
  } catch (error) {
    console.error('Failed to check dataset readiness', error);
    return errorResponse(500, 'INTERNAL_ERROR', 'Unable to complete segregation check.');
  }

  let leftEntries: DgEntry[];
  let rightEntries: DgEntry[];
  try {
    [leftEntries, rightEntries] = await Promise.all([
      findDgEntriesByUnNumber(env.DB, leftUnNumber),
      findDgEntriesByUnNumber(env.DB, rightUnNumber),
    ]);
  } catch (error) {
    console.error('Failed to load DG entries', error);
    return errorResponse(500, 'INTERNAL_ERROR', 'Unable to complete segregation check.');
  }

  const missingUnNumbers: string[] = [];
  if (leftEntries.length === 0) missingUnNumbers.push(leftUnNumber);
  if (rightEntries.length === 0) missingUnNumbers.push(rightUnNumber);
  if (missingUnNumbers.length > 0) {
    return Response.json(
      { ok: false, error: { code: 'DG_NOT_FOUND', unNumbers: missingUnNumbers } },
      { status: 404 },
    );
  }

  let evaluation: ResolvedUnPairEvaluation;
  try {
    const [classRules, sgRules] = await Promise.all([loadSegregationRuleSet(env.DB), loadSgRuleSet(env.DB)]);
    evaluation = evaluateResolvedUnPair(leftEntries, rightEntries, classRules, sgRules);
  } catch (error) {
    console.error('Failed to evaluate segregation', error);
    return errorResponse(500, 'INTERNAL_ERROR', 'Unable to complete segregation check.');
  }

  // Response fields are additive over the PR 8 contract: `ok`, `input`,
  // `decision` and `variants` keep their existing shape and meaning, and
  // `additionalRequirements` / `variantResolution` are new. An older client
  // that ignores the new fields still parses this correctly — but note that
  // ignoring `additionalRequirements` means a non-empty obligation list on a
  // level-0 decision is not shown, which is why this engine must not be
  // activated in production before the client can surface it.
  return Response.json({
    ok: true,
    input: { leftUnNumber, rightUnNumber },
    decision: evaluation.decision,
    variants: evaluation.variants,
    additionalRequirements: evaluation.additionalRequirements,
    variantResolution: evaluation.variantResolution,
  });
}

interface SegregationCheckBatchInput {
  unNumbers: string[];
}

function parseSegregationCheckBatchBody(body: unknown): SegregationCheckBatchInput | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const { unNumbers } = body as Record<string, unknown>;
  if (!Array.isArray(unNumbers)) {
    return null;
  }
  if (unNumbers.length < BATCH_MIN_INPUTS || unNumbers.length > BATCH_MAX_INPUTS) {
    return null;
  }
  if (!unNumbers.every((item) => typeof item === 'string')) {
    return null;
  }

  return { unNumbers: unNumbers as string[] };
}

interface SegregationCheckBatchPairResult extends ResolvedUnPairEvaluation {
  readonly leftUnNumber: string;
  readonly rightUnNumber: string;
}

interface SegregationCheckBatchSummary {
  readonly inputCount: number;
  readonly totalPairs: number;
  readonly segregationRequiredPairs: number;
  readonly reviewRequiredPairs: number;
  readonly noSegregationLevelPairs: number;
  readonly additionalRequirementPairs: number;
  readonly maxRequiredLevel: 1 | 2 | 3 | 4 | null;
}

/**
 * Summarizes batch pair results into counts only. `noSegregationLevelPairs`
 * counts CLEAR (level 0) decisions and must never be read as "safe" or
 * "mixable" — a level-0 pair can still carry additionalRequirements, which
 * `additionalRequirementPairs` tracks independently of decision.status.
 * `maxRequiredLevel` stays null unless at least one pair is
 * SEGREGATION_REQUIRED; 0 is never fabricated as "no requirement".
 */
function buildBatchSummary(
  inputCount: number,
  pairs: readonly SegregationCheckBatchPairResult[],
): SegregationCheckBatchSummary {
  let segregationRequiredPairs = 0;
  let reviewRequiredPairs = 0;
  let noSegregationLevelPairs = 0;
  let additionalRequirementPairs = 0;
  let maxRequiredLevel: 1 | 2 | 3 | 4 | null = null;

  for (const pair of pairs) {
    switch (pair.decision.status) {
      case 'SEGREGATION_REQUIRED':
        segregationRequiredPairs += 1;
        if (maxRequiredLevel === null || pair.decision.level > maxRequiredLevel) {
          maxRequiredLevel = pair.decision.level;
        }
        break;
      case 'REVIEW_REQUIRED':
        reviewRequiredPairs += 1;
        break;
      case 'CLEAR':
        noSegregationLevelPairs += 1;
        break;
    }

    if (pair.additionalRequirements.length > 0) {
      additionalRequirementPairs += 1;
    }
  }

  return {
    inputCount,
    totalPairs: pairs.length,
    segregationRequiredPairs,
    reviewRequiredPairs,
    noSegregationLevelPairs,
    additionalRequirementPairs,
    maxRequiredLevel,
  };
}

async function handleSegregationCheckBatch(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
  }

  const parsedBody = parseSegregationCheckBatchBody(body);
  if (parsedBody === null) {
    return errorResponse(
      400,
      'INVALID_REQUEST',
      `"unNumbers" must be an array of ${BATCH_MIN_INPUTS} to ${BATCH_MAX_INPUTS} distinct UN number strings.`,
    );
  }

  const canonicalUnNumbers: string[] = [];
  for (const raw of parsedBody.unNumbers) {
    const normalized = normalizeUnNumber(raw);
    if (normalized === null) {
      return errorResponse(400, 'INVALID_REQUEST', `"${raw}" is not a valid UN number.`);
    }
    canonicalUnNumbers.push(normalized);
  }

  // Duplicates are rejected, not deduplicated: the model has UN numbers, not
  // distinct cargo-instance identities, so silently deduplicating would
  // create repeated indistinguishable pair rows and misleading pair counts.
  const seen = new Set<string>();
  const duplicateUnNumbers = new Set<string>();
  for (const unNumber of canonicalUnNumbers) {
    if (seen.has(unNumber)) {
      duplicateUnNumbers.add(unNumber);
    }
    seen.add(unNumber);
  }
  if (duplicateUnNumbers.size > 0) {
    return Response.json(
      { ok: false, error: { code: 'DUPLICATE_UN_NUMBER', unNumbers: [...duplicateUnNumbers] } },
      { status: 400 },
    );
  }

  try {
    const datasetStatus = await getDatasetStatus(env.DB);
    if (!datasetStatus.ready) {
      return errorResponse(503, 'DATASET_NOT_READY', 'Segregation dataset is not available.');
    }
  } catch (error) {
    console.error('Failed to check dataset readiness', error);
    return errorResponse(500, 'INTERNAL_ERROR', 'Unable to complete segregation check.');
  }

  let entriesByUnNumber: Map<string, DgEntry[]>;
  try {
    entriesByUnNumber = await findDgEntriesByUnNumbers(env.DB, canonicalUnNumbers);
  } catch (error) {
    console.error('Failed to load DG entries', error);
    return errorResponse(500, 'INTERNAL_ERROR', 'Unable to complete segregation check.');
  }

  const missingUnNumbers = canonicalUnNumbers.filter(
    (unNumber) => (entriesByUnNumber.get(unNumber) ?? []).length === 0,
  );
  if (missingUnNumbers.length > 0) {
    return Response.json(
      { ok: false, error: { code: 'DG_NOT_FOUND', unNumbers: missingUnNumbers } },
      { status: 404 },
    );
  }

  let pairs: SegregationCheckBatchPairResult[];
  try {
    // Class rules and SG rules are loaded once for the whole batch, not once
    // per pair — the authorized tables are small, and reloading per pair
    // would issue up to 45 redundant DB round trips for a 10-UN request.
    const [classRules, sgRules] = await Promise.all([loadSegregationRuleSet(env.DB), loadSgRuleSet(env.DB)]);

    pairs = [];
    for (let i = 0; i < canonicalUnNumbers.length; i += 1) {
      for (let j = i + 1; j < canonicalUnNumbers.length; j += 1) {
        const leftUnNumber = canonicalUnNumbers[i];
        const rightUnNumber = canonicalUnNumbers[j];
        const evaluation = evaluateResolvedUnPair(
          entriesByUnNumber.get(leftUnNumber) ?? [],
          entriesByUnNumber.get(rightUnNumber) ?? [],
          classRules,
          sgRules,
        );
        pairs.push({ leftUnNumber, rightUnNumber, ...evaluation });
      }
    }
  } catch (error) {
    console.error('Failed to evaluate batch segregation', error);
    return errorResponse(500, 'INTERNAL_ERROR', 'Unable to complete segregation check.');
  }

  return Response.json({
    ok: true,
    input: { unNumbers: canonicalUnNumbers },
    summary: buildBatchSummary(canonicalUnNumbers.length, pairs),
    pairs,
  });
}

export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      try {
        const datasetStatus = await getDatasetStatus(env.DB);
        return Response.json({
          ok: true,
          service: 'dg-segregation-api',
          database: 'ok',
          dataset: {
            ready: datasetStatus.ready,
            schemaVersion: datasetStatus.schemaVersion,
            version: datasetStatus.datasetVersion,
          },
        });
      } catch {
        return Response.json(
          {
            ok: false,
            service: 'dg-segregation-api',
            database: 'error',
          },
          { status: 500 },
        );
      }
    }

    if (url.pathname === '/segregation/check') {
      if (request.method !== 'POST') {
        return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }

      return handleSegregationCheck(request, env);
    }

    if (url.pathname === '/segregation/check-batch') {
      if (request.method !== 'POST') {
        return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }

      return handleSegregationCheckBatch(request, env);
    }

    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
