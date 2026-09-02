import { exports } from 'cloudflare:workers';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { markSyntheticDatasetReady } from './helpers/seed';

describe('worker', () => {
  it('GET /health returns ok with database ok and dataset not ready on a freshly migrated DB', async () => {
    const response = await exports.default.fetch('https://example.com/health');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      service: 'dg-segregation-api',
      database: 'ok',
      dataset: {
        ready: false,
        schemaVersion: null,
        version: null,
      },
    });
  });

  it('unknown routes return 404', async () => {
    const response = await exports.default.fetch('https://example.com/does-not-exist');

    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('GET /health reports dataset ready once metadata and rows exist', async () => {
    await markSyntheticDatasetReady(env.DB);

    const response = await exports.default.fetch('https://example.com/health');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      service: 'dg-segregation-api',
      database: 'ok',
      dataset: {
        ready: true,
        schemaVersion: '1',
        version: 'synthetic-test-v1',
      },
    });
  });
});
