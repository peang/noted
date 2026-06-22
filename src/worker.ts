/// <reference types="@cloudflare/workers-types" />

export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/opencode/')) {
      const path = url.pathname.replace('/api/opencode/', '');
      const targetUrl = `https://opencode.ai/zen/go/v1/${path}${url.search}`;

      const proxyHeaders = new Headers(request.headers);
      proxyHeaders.delete('host');

      return fetch(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
        duplex: 'half',
      } as RequestInit);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<{ ASSETS: Fetcher }>;
