// Self-contained on purpose — no import from a sibling api/*.ts file. A prior cross-file import
// between two Vercel function entry points (api/extract.ts -> api/_lib/extract.ts) failed in
// production with ERR_MODULE_NOT_FOUND because Vercel's per-function bundler didn't trace it; see
// api/extract-medlist.ts for the same convention.

const DEFAULT_GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';
const DEFAULT_TTL_SECONDS = 30;

class ServerConfigError extends Error {}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new ServerConfigError(`${name} is not configured`);
  }
  return value;
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = optionalEnv(name);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ServerConfigError(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

interface DeepgramTokenConfig {
  apiKey: string;
  grantUrl: string;
  ttlSeconds: number;
}

function getDeepgramTokenConfig(): DeepgramTokenConfig {
  return {
    apiKey: requiredEnv('DEEPGRAM_API_KEY'),
    grantUrl: optionalEnv('DEEPGRAM_AUTH_GRANT_URL') ?? DEFAULT_GRANT_URL,
    ttlSeconds: integerEnv('DEEPGRAM_TOKEN_TTL_SECONDS', DEFAULT_TTL_SECONDS, 1, 3600),
  };
}

interface DeepgramGrantResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

interface DeepgramTokenResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

function parseBody(body: unknown): Record<string, unknown> {
  if (!body) {
    return {};
  }
  if (typeof body === 'string') {
    return JSON.parse(body) as Record<string, unknown>;
  }
  if (typeof body === 'object') {
    return body as Record<string, unknown>;
  }
  return {};
}

function requestedTtlSeconds(body: Record<string, unknown>, fallback: number): number {
  const value = body.ttlSeconds ?? body.ttl_seconds;
  if (value == null) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3600) {
    throw new ServerConfigError('ttlSeconds must be an integer from 1 to 3600');
  }
  return parsed;
}

// Mints a short-lived Deepgram JWT server-side so the permanent DEEPGRAM_API_KEY is never sent
// to the browser — the browser only ever holds this temporary token when opening a voice session.
export async function createDeepgramToken(ttlSeconds?: number): Promise<DeepgramTokenResponse> {
  const config = getDeepgramTokenConfig();
  const ttl = ttlSeconds ?? config.ttlSeconds;

  const response = await fetch(config.grantUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl_seconds: ttl }),
  });

  if (!response.ok) {
    throw new Error(`Deepgram token grant failed with status ${response.status}`);
  }

  const data = (await response.json()) as DeepgramGrantResponse;
  if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
    throw new Error('Deepgram token grant returned an unexpected response');
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    tokenType: 'Bearer',
  };
}

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
  setHeader?(name: string, value: string): void;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader?.('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const config = getDeepgramTokenConfig();
    const body = parseBody(req.body);
    const token = await createDeepgramToken(requestedTtlSeconds(body, config.ttlSeconds));
    res.status(200).json(token);
  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'Invalid JSON request body' });
      return;
    }
    if (err instanceof ServerConfigError) {
      res.status(500).json({ error: err.message });
      return;
    }
    console.error('Deepgram token grant failed');
    res.status(502).json({ error: 'Deepgram token service unavailable' });
  }
}
