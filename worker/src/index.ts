import { getDatasetStatus } from './data/dataset-status';
import { findDgEntriesByUnNumber } from './data/dg-entries';
import { loadSegregationRuleSet } from './data/segregation-rules';
import { aggregateSegregationDecisions } from './domain/aggregate-decision';
import { evaluateSegregation } from './domain/segregation';
import type { SegregationDecision } from './domain/segregation';
import type { DgEntry } from './domain/types';
import { normalizeUnNumber } from './domain/un-number';

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

  const pairs: Array<readonly [DgEntry, DgEntry]> = [];
  for (const left of leftEntries) {
    for (const right of rightEntries) {
      pairs.push([left, right]);
    }
  }

  let decision: SegregationDecision;
  try {
    const ruleSet = await loadSegregationRuleSet(
      env.DB,
      pairs.map(([left, right]) => [left.primaryClass, right.primaryClass] as const),
    );

    const decisions = pairs.map(([left, right]) => evaluateSegregation(left, right, ruleSet)) as [
      SegregationDecision,
      ...SegregationDecision[],
    ];
    decision = aggregateSegregationDecisions(decisions);
  } catch (error) {
    console.error('Failed to evaluate segregation', error);
    return errorResponse(500, 'INTERNAL_ERROR', 'Unable to complete segregation check.');
  }

  return Response.json({
    ok: true,
    input: { leftUnNumber, rightUnNumber },
    decision,
    variants: {
      left: leftEntries.length,
      right: rightEntries.length,
      evaluatedPairs: pairs.length,
    },
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

    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
