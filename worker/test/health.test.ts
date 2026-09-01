import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('worker', () => {
  it('GET /health returns ok with a working D1 binding', async () => {
    const response = await exports.default.fetch('https://example.com/health');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      service: 'dg-segregation-api',
      database: 'ok',
    });
  });

  it('unknown routes return 404', async () => {
    const response = await exports.default.fetch('https://example.com/does-not-exist');

    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});
