import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// Isolated from segregation-check.test.ts on purpose: this file's D1
// instance must never have the dataset marked ready, so it can verify the
// gate rejects an otherwise-valid request before any DG lookup happens.

function post(body: unknown): Promise<Response> {
  return exports.default.fetch('https://example.com/segregation/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postBatch(body: unknown): Promise<Response> {
  return exports.default.fetch('https://example.com/segregation/check-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /segregation/check — dataset not ready', () => {
  it('returns 503 DATASET_NOT_READY for an otherwise-valid request', async () => {
    const response = await post({ leftUnNumber: '1234', rightUnNumber: '5678' });

    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('DATASET_NOT_READY');
    expect(body.error.message).toBe('Segregation dataset is not available.');
  });

  it('never falls through to DG_NOT_FOUND when the dataset is not ready', async () => {
    const response = await post({ leftUnNumber: '1234', rightUnNumber: '5678' });

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).not.toBe('DG_NOT_FOUND');
  });
});

describe('POST /segregation/check-batch — dataset not ready', () => {
  it('returns 503 DATASET_NOT_READY for an otherwise-valid request, checked once', async () => {
    const response = await postBatch({ unNumbers: ['1234', '5678', '9012'] });

    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('DATASET_NOT_READY');
    expect(body.error.message).toBe('Segregation dataset is not available.');
  });

  it('never falls through to DG_NOT_FOUND when the dataset is not ready', async () => {
    const response = await postBatch({ unNumbers: ['1234', '5678', '9012'] });

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).not.toBe('DG_NOT_FOUND');
  });
});
