export default {
  async fetch(request: Request, env: { ASSETS: { fetch: (req: Request) => Promise<Response> } }): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/opencode/')) {
      const path = url.pathname.replace(/^\/api\/opencode\/?/, '');
      const target = `https://opencode.ai/zen/go/v1/${path}${url.search}`;

      const headers = new Headers(request.headers);
      headers.set('Host', 'opencode.ai');

      try {
        return await fetch(target, {
          method: request.method,
          headers,
          body: request.body,
          redirect: 'follow',
        });
      } catch {
        return new Response(JSON.stringify({ error: 'API unreachable' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    let res = await env.ASSETS.fetch(request);
    if (res.status === 404) {
      res = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
    }
    return res;
  },
};
