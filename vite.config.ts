// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import react from '@vitejs/plugin-react';
import dns from 'dns';
import { copyFileSync, existsSync } from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';

dns.setDefaultResultOrder('verbatim');

if (!existsSync(path.join(__dirname, '.env'))) {
  copyFileSync(path.join(__dirname, '.env.defaults'), path.join(__dirname, '.env'));
}

dns.setDefaultResultOrder('verbatim');

interface DevApiResponse {
  status(code: number): DevApiResponse;
  json(payload: unknown): void;
}
type ApiHandler = (req: { method?: string; body?: unknown }, res: DevApiResponse) => Promise<void>;

// Dev-only stand-in for Vercel serverless functions under api/, so `npm run dev` can hit them
// without needing `vercel dev`. Each function's default-exported handler(req, res) is reused
// as-is; this just adapts Vite's Connect middleware request/response into that shape.
// `loadHandler` must be a literal `() => import('./literal/path')` at the call site — Vite only
// statically resolves dynamic imports it can see as a literal string; a variable path breaks
// once vite.config.ts is transpiled into a temp copy elsewhere on disk.
function apiDevPlugin(route: string, loadHandler: () => Promise<{ default: ApiHandler }>): Plugin {
  return {
    name: `api-dev-middleware${route.replace(/\W+/g, '-')}`,
    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          void (async () => {
            try {
              const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : undefined;
              const { default: handler } = await loadHandler();
              const devReq = { method: req.method, body };
              const devRes = {
                status(code: number) {
                  res.statusCode = code;
                  return devRes;
                },
                json(payload: unknown) {
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(payload));
                },
              };
              await handler(devReq, devRes);
            } catch (err) {
              console.error(`${route} dev middleware failed`, err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Request failed' }));
            }
          })();
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // GEMINI_API_KEY / MOSS_PROJECT_ID / MOSS_PROJECT_KEY / STEDI_API_KEY / STEDI_PROVIDER_NPI are
  // server-only secrets — deliberately NOT under the MEDPLUM_ envPrefix below, so Vite never
  // exposes them to client bundle code. loadEnv with an empty prefix filter is only used here,
  // in Node config scope, to feed them into process.env for the dev middleware above.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['GEMINI_API_KEY', 'MOSS_PROJECT_ID', 'MOSS_PROJECT_KEY', 'STEDI_API_KEY', 'STEDI_PROVIDER_NPI']) {
    if (env[key]) {
      process.env[key] = env[key];
    }
  }

  return {
    envPrefix: ['MEDPLUM_'],
    plugins: [
      react(),
      apiDevPlugin('/api/extract', () => import('./api/extract')),
      apiDevPlugin('/api/eligibility', () => import('./api/eligibility')),
      apiDevPlugin('/api/extract-medlist', () => import('./api/extract-medlist')),
    ],
    server: {
      host: 'localhost',
      port: 3000,
    },
  };
});
