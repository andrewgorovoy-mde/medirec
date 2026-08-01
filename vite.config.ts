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

// Dev-only stand-in for the Vercel serverless function at api/extract.ts, so
// `npm run dev` can hit /api/extract without needing `vercel dev`.
function apiExtractDevPlugin(): Plugin {
  return {
    name: 'api-extract-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/extract', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          void (async () => {
            try {
              const { extractMed } = await import('./api/extract');
              const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
              const image = body?.image;
              if (!image || typeof image !== 'string') {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Missing "image" (base64 JPEG) in request body' }));
                return;
              }

              const result = await extractMed(image);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(result));
            } catch (err) {
              console.error('extract dev middleware failed', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Extraction failed' }));
            }
          })();
        });
      });
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
  for (const key of ['GEMINI_API_KEY', 'MOSS_PROJECT_ID', 'MOSS_PROJECT_KEY']) {
    if (env[key]) {
      process.env[key] = env[key];
    }
  }

  return {
    envPrefix: ['MEDPLUM_'],
    plugins: [react(), apiExtractDevPlugin()],
    server: {
      host: 'localhost',
      port: 3000,
    },
  };
});
