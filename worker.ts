import { handleGitProxy, GIT_PROXY_PREFIX } from './src/server/gitProxy';

export default {
  async fetch(request: Request, env: { ASSETS: { fetch: (req: Request) => Promise<Response> } }): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith(GIT_PROXY_PREFIX)) {
      return handleGitProxy(request);
    }

    if (url.pathname.startsWith('/api/opencode/')) {
      const path = url.pathname.replace(/^\/api\/opencode\/?/, '');
      const target = `https://opencode.ai/zen/go/v1/${path}${url.search}`;

      // Only this app's own pages may use the proxy
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) {
        return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Forward only what the API needs — never this site's cookies
      const headers = new Headers();
      for (const name of ['Authorization', 'Content-Type', 'Accept', 'x-opencode-session']) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      headers.set('User-Agent', 'noted/1.0');

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
