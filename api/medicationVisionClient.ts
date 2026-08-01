import { extractMed } from './extract';
import { getMedicationVisionConfig } from './serverConfig';
import {
  MAX_MEDICATION_IMAGE_BYTES,
  MEDICATION_IMAGE_CONTENT_TYPES,
  type MedicationIdentifyRequest,
  type MedicationIdentifyResponse,
  type MedicationIdentificationSource,
  type MedicationIdentificationStatus,
  type MedicationImageContentType,
  type NormalizedMedication,
} from '../src/vision/types';

export class MedicationVisionError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly publicMessage: string,
    message = publicMessage
  ) {
    super(message);
    this.name = 'MedicationVisionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanBase64Payload(value: string): string {
  return value.trim().replace(/\s/g, '');
}

function decodedBase64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function isMedicationImageContentType(value: unknown): value is MedicationImageContentType {
  return typeof value === 'string' && MEDICATION_IMAGE_CONTENT_TYPES.includes(value as MedicationImageContentType);
}

export function parseMedicationIdentifyRequest(body: unknown): MedicationIdentifyRequest {
  const parsed = typeof body === 'string' ? (JSON.parse(body) as unknown) : body;
  if (!isRecord(parsed)) {
    throw new MedicationVisionError(400, 'Request body must be a JSON object');
  }

  const image = typeof parsed.image === 'string' ? cleanBase64Payload(parsed.image) : undefined;
  const imageId = typeof parsed.imageId === 'string' && parsed.imageId.trim() ? parsed.imageId.trim() : null;
  if (!image && !imageId) {
    throw new MedicationVisionError(400, 'Request body must include image or imageId');
  }

  if (image?.startsWith('data:')) {
    throw new MedicationVisionError(400, 'image must be a base64 payload without a data URL prefix');
  }

  if (image && decodedBase64Bytes(image) > MAX_MEDICATION_IMAGE_BYTES) {
    throw new MedicationVisionError(413, 'Image payload is too large');
  }

  const contentType = parsed.contentType ?? 'image/jpeg';
  if (!isMedicationImageContentType(contentType)) {
    throw new MedicationVisionError(415, 'Unsupported image content type');
  }

  return {
    ...(image ? { image } : {}),
    imageId,
    contentType,
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeMedication(value: unknown): NormalizedMedication | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = stringOrNull(value.name);
  if (!name) {
    return null;
  }

  return {
    name,
    strength: stringOrNull(value.strength),
    strengthMg: numberOrNull(value.strengthMg),
    dosageForm: stringOrNull(value.dosageForm),
    imprint: stringOrNull(value.imprint),
    manufacturer: stringOrNull(value.manufacturer),
    rxnormCode: stringOrNull(value.rxnormCode),
    rawText: stringOrNull(value.rawText),
  };
}

function normalizeStatus(value: unknown, medication: NormalizedMedication | null): MedicationIdentificationStatus {
  if (value === 'possible_match' || value === 'no_match' || value === 'unresolved' || value === 'error') {
    return value;
  }
  return medication ? 'possible_match' : 'unresolved';
}

function normalizeWarnings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function normalizeExternalResponse(value: unknown, source: MedicationIdentificationSource): MedicationIdentifyResponse {
  if (!isRecord(value)) {
    throw new MedicationVisionError(502, 'Medication vision service returned an invalid response');
  }

  const medication = normalizeMedication(value.medication);
  const alternatives = Array.isArray(value.alternatives)
    ? value.alternatives.map(normalizeMedication).filter((entry): entry is NormalizedMedication => entry !== null)
    : [];
  const confidence = numberOrNull(value.confidence) ?? 0;

  return {
    status: normalizeStatus(value.status, medication),
    medication,
    confidence: Math.max(0, Math.min(1, confidence)),
    alternatives,
    warnings: normalizeWarnings(value.warnings),
    requiresConfirmation: typeof value.requiresConfirmation === 'boolean' ? value.requiresConfirmation : true,
    source,
  };
}

function strengthText(strengthMg?: number): string | null {
  return strengthMg == null ? null : `${strengthMg} mg`;
}

async function identifyWithLocalExtraction(request: MedicationIdentifyRequest): Promise<MedicationIdentifyResponse> {
  if (!request.image) {
    throw new MedicationVisionError(503, 'Image ID lookup is not configured');
  }

  try {
    const result = await extractMed(request.image);
    return {
      status: result.med.matchKey ? 'possible_match' : 'unresolved',
      medication: {
        name: result.med.display,
        strength: strengthText(result.med.strengthMg),
        strengthMg: result.med.strengthMg ?? null,
        dosageForm: null,
        imprint: null,
        manufacturer: null,
        rxnormCode: result.med.matchKey,
        rawText: result.med.rawText,
      },
      confidence: result.confidence,
      alternatives: [],
      warnings: result.med.matchKey ? [] : ['Medication could not be resolved to a catalog RxNorm ingredient code.'],
      requiresConfirmation: true,
      source: 'local_extract',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('GEMINI_API_KEY')) {
      throw new MedicationVisionError(503, 'Medication vision service is not configured', message);
    }
    throw new MedicationVisionError(502, 'Medication vision service unavailable', message);
  }
}

async function callExternalVisionService(request: MedicationIdentifyRequest, url: string): Promise<MedicationIdentifyResponse> {
  const config = getMedicationVisionConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new MedicationVisionError(502, 'Medication vision service unavailable', `CV service status ${response.status}`);
    }

    return normalizeExternalResponse(await response.json(), 'external_cv_service');
  } finally {
    clearTimeout(timer);
  }
}

export async function identifyMedicationImage(request: MedicationIdentifyRequest): Promise<MedicationIdentifyResponse> {
  const config = getMedicationVisionConfig();
  if (config.serviceUrl) {
    return callExternalVisionService(request, config.serviceUrl);
  }
  return identifyWithLocalExtraction(request);
}
