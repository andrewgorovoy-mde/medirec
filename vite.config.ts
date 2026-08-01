// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import react from '@vitejs/plugin-react';
import dns from 'dns';
import { copyFileSync, existsSync } from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import type { ViteDevServer } from 'vite';
import { defineConfig, loadEnv } from 'vite';

dns.setDefaultResultOrder('verbatim');

if (!existsSync(path.join(__dirname, '.env'))) {
  copyFileSync(path.join(__dirname, '.env.defaults'), path.join(__dirname, '.env'));
}

dns.setDefaultResultOrder('verbatim');

type DevApiHandler = (
  req: { method?: string; body?: unknown },
  res: DevApiResponse
) => Promise<void> | void;

interface DevApiResponse {
  status(code: number): DevApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

function createJsonResponse(res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }) {
  return {
    status(code: number) {
      res.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      res.setHeader(name, value);
    },
    json(body: unknown) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    },
  };
}

function registerDevApiRoute(
  server: ViteDevServer,
  pathName: string,
  loadHandler: () => Promise<DevApiHandler>
): void {
  server.middlewares.use(pathName, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        try {
          const rawBody = Buffer.concat(chunks).toString('utf-8');
          const handler = await loadHandler();
          await handler({ method: req.method, body: rawBody || undefined }, createJsonResponse(res));
        } catch (err) {
          console.error(`${pathName} dev middleware failed`, err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'API route failed' }));
        }
      })();
    });
  });
}

// Dev-only stand-ins for Vercel serverless functions, so `npm run dev` can hit
// local API routes without needing `vercel dev`.
function apiDevPlugin(): Plugin {
  return {
    name: 'api-dev-middleware',
    configureServer(server) {
      registerDevApiRoute(server, '/api/extract', async () => (await import('./api/extract')).default);
      registerDevApiRoute(server, '/api/deepgram/token', async () => (await import('./api/deepgram/token')).default);
      registerDevApiRoute(
        server,
        '/api/medications/identify',
        async () => (await import('./api/medications/identify')).default
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // GEMINI_API_KEY / MOSS_PROJECT_ID / MOSS_PROJECT_KEY are server-only secrets — deliberately
  // NOT under the MEDPLUM_ envPrefix below, so Vite never exposes them to client bundle code.
  // loadEnv with an empty prefix filter is only used here, in Node config scope, to feed them
  // into process.env for the dev middleware above.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of [
    'GEMINI_API_KEY',
    'MOSS_PROJECT_ID',
    'MOSS_PROJECT_KEY',
    'DEEPGRAM_API_KEY',
    'DEEPGRAM_AUTH_GRANT_URL',
    'DEEPGRAM_TOKEN_TTL_SECONDS',
    'MEDICATION_VISION_API_URL',
    'MEDICATION_VISION_API_KEY',
    'MEDICATION_VISION_TIMEOUT_MS',
  ]) {
    if (env[key]) {
      process.env[key] = env[key];
    }
  }

  return {
    envPrefix: ['MEDPLUM_'],
    plugins: [react(), apiDevPlugin()],
    server: {
      host: 'localhost',
      port: 3000,
    },
  };
});
