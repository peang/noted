// git smart-HTTP relay: browsers can't call github.com & co directly (no CORS headers), so
// isomorphic-git is pointed at /api/git-proxy/<host>/<path> and this forwards it.
// It only relays the three git protocol endpoints to known hosts, and never logs or stores headers
// (the Authorization header carries the user's access token).

export const GIT_PROXY_PREFIX = '/api/git-proxy/';

const ALLOWED_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);
const GIT_ENDPOINT = /\/(info\/refs|git-upload-pack|git-receive-pack)$/;
const FORWARDED_REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'git-protocol'];

interface GitProxyOptions {
  // Extra "host:port" targets reached over plain http; for local development and tests only
  insecureHosts?: string[];
}

function refuse(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain' } });
}

export async function handleGitProxy(request: Request, options: GitProxyOptions = {}): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return refuse(405, 'Method not allowed');

  const url = new URL(request.url);
  const rest = url.pathname.slice(GIT_PROXY_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return refuse(400, 'Bad git proxy path');
  const host = rest.slice(0, slash).toLowerCase();
  const path = rest.slice(slash);

  const insecure = options.insecureHosts?.includes(host) ?? false;
  if (!insecure && !ALLOWED_HOSTS.has(host)) return refuse(403, `Host "${host}" is not allowed`);
  if (!GIT_ENDPOINT.test(path)) return refuse(400, 'Only git protocol endpoints are proxied');
  if (path.endsWith('/info/refs') && !/^(git-upload-pack|git-receive-pack)$/.test(url.searchParams.get('service') ?? '')) {
    return refuse(400, 'Missing git service');
  }

  const headers = new Headers({ 'user-agent': 'git/isomorphic-git' });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${insecure ? 'http' : 'https'}://${host}${path}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
      redirect: 'follow',
    });
  } catch {
    return refuse(502, 'Git host unreachable');
  }

  const responseHeaders = new Headers({ 'cache-control': 'no-store' });
  const contentType = upstream.headers.get('content-type');
  if (contentType) responseHeaders.set('content-type', contentType);
  // www-authenticate is dropped on purpose: a Basic challenge could make the browser open its own login prompt
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
