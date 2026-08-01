export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerConfigError';
  }
}

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

export interface DeepgramTokenConfig {
  apiKey: string;
  grantUrl: string;
  ttlSeconds: number;
}

export function getDeepgramTokenConfig(): DeepgramTokenConfig {
  return {
    apiKey: requiredEnv('DEEPGRAM_API_KEY'),
    grantUrl: optionalEnv('DEEPGRAM_AUTH_GRANT_URL') ?? 'https://api.deepgram.com/v1/auth/grant',
    ttlSeconds: integerEnv('DEEPGRAM_TOKEN_TTL_SECONDS', 30, 1, 3600),
  };
}

export interface MedicationVisionConfig {
  apiKey?: string;
  serviceUrl?: string;
  timeoutMs: number;
}

export function getMedicationVisionConfig(): MedicationVisionConfig {
  return {
    apiKey: optionalEnv('MEDICATION_VISION_API_KEY'),
    serviceUrl: optionalEnv('MEDICATION_VISION_API_URL'),
    timeoutMs: integerEnv('MEDICATION_VISION_TIMEOUT_MS', 10_000, 500, 60_000),
  };
}
