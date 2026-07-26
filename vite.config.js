import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Mounts the api/ serverless handlers on the dev server.
//
// `vite dev` does not run Vercel functions, so without this the customer journey
// POSTs /api/generate and receives the SPA's index.html — meaning the whole
// server-enforced path is untestable locally, which is exactly the path most
// worth testing. `vercel dev` also works; this keeps plain `npm run dev` honest.
// Routes handled locally. Files starting with "_" are private modules, matching
// Vercel's own convention, so they are not routable.
const API_ROUTES = ['generate', 'submissions'];

function apiDevServer() {
  return {
    name: 'api-dev-server',
    apply: 'serve',
    configureServer(server) {
      // Mounted before Vite's static/transform middleware, otherwise a request to
      // /api/submissions is resolved as a module and the raw source is served.
      server.middlewares.use('/api', async (req, res, next) => {
        const name = (req.url || '').split('?')[0].replace(/^\/+|\/+$/g, '');
        if (!API_ROUTES.includes(name)) return next();

        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', async () => {
          try {
            // Imported through Vite's module runner so edits hot-reload.
            const mod = await server.ssrLoadModule(`/api/${name}.js`);
            let body = null;
            if (raw) {
              try { body = JSON.parse(raw); }
              catch {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
              }
            }
            // Minimal shim over the Vercel handler contract.
            const shim = {
              statusCode: 200,
              status(code) { this.statusCode = code; return this; },
              json(payload) {
                res.statusCode = this.statusCode;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(payload));
                return this;
              },
              setHeader(k, v) { res.setHeader(k, v); },
            };
            await mod.default({ method: req.method, headers: req.headers, body }, shim);
          } catch (err) {
            server.config.logger.error(`[api-dev] ${err.stack || err.message}`);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiDevServer()],
  server: { port: 5173 },
});
