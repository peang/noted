export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
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
