import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import {handleGitProxy, GIT_PROXY_PREFIX} from './src/server/gitProxy';

// Serves /api/git-proxy in `vite dev` like the Cloudflare Worker does in production.
// NOTED_GIT_PROXY_DEV_HOSTS="127.0.0.1:9419" additionally allows plain-http test servers.
function gitProxyDev(): Plugin {
  const insecureHosts = (process.env.NOTED_GIT_PROXY_DEV_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  return {
    name: 'noted-git-proxy-dev',
    configureServer(server) {
      server.middlewares.use(GIT_PROXY_PREFIX.slice(0, -1), async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks);
        const request = new Request(`http://localhost${GIT_PROXY_PREFIX.slice(0, -1)}${req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: req.method === 'POST' ? body : undefined,
        });
        const response = await handleGitProxy(request, { insecureHosts });
        res.statusCode = response.status;
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), gitProxyDev()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      include: ['@emoji-mart/data'],
      exclude: ['pdfjs-dist'],
    },
    build: {
      target: 'esnext',
      rollupOptions: {
        output: {
          manualChunks: {
            pdfjs: ['pdfjs-dist'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api/opencode': {
          target: 'https://opencode.ai',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/opencode/, '/zen/go/v1'),
        },
      },
    },
  };
});