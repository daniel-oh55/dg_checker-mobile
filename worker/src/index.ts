export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      try {
        await env.DB.prepare('SELECT 1').first();
        return Response.json({
          ok: true,
          service: 'dg-segregation-api',
          database: 'ok',
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

    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
