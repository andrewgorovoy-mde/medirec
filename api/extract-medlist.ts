import drugCatalogDocs from './drug_index.json' with { type: 'json' };

// This file deliberately duplicates the Gemini-call / moss.dev-resolution logic in api/extract.ts
// rather than importing it — a prior cross-file import between two Vercel function entry points
// (api/extract.ts -> api/_lib/extract.ts) failed in production with ERR_MODULE_NOT_FOUND because
// Vercel's per-function bundler didn't trace it. Each api/*.ts file here stays fully self-contained.

export interface FlatMed {
  matchKey: string | null;
  display: string;
  strengthMg?: number;
  dosesPerDay?: number;
  rawText: string;
}

export interface MedListItem extends FlatMed {
  confidence: number;
}

export interface ExtractMedListResult {
  medications: MedListItem[];
}

interface GeminiListExtraction {
  drugName: string;
  strengthMg?: number;
  dosesPerDay?: number;
  rawText: string;
  readConfidence: number;
}

const GEMINI_MODEL = 'gemini-flash-latest';

const MEDLIST_PROMPT =
  'You are reading a medication list from a hospital discharge summary, pharmacy printout, or ' +
  'similar document. Extract every medication mentioned as a JSON array — do not include allergies, ' +
  'diagnoses, or non-medication items. For each medication, extract the drug name exactly as it ' +
  'identifies the product, including the salt/ester form (e.g. "succinate", "tartrate") and any ' +
  'release modifier (ER, XL, IR, SR, CR) if present. Also extract the strength in mg if legible, the ' +
  'doses per day computed from the sig/instructions if it parses cleanly, and the raw text line for ' +
  'that medication verbatim. Omit strengthMg or dosesPerDay if not legible or not parseable — never ' +
  'guess. Set readConfidence to your confidence (0-1) that the drugName and rawText are correct.';

async function callGeminiForPdf(base64Pdf: string): Promise<GeminiListExtraction[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: MEDLIST_PROMPT },
              { inline_data: { mime_type: 'application/pdf', data: base64Pdf } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                drugName: { type: 'STRING' },
                strengthMg: { type: 'NUMBER' },
                dosesPerDay: { type: 'NUMBER' },
                rawText: { type: 'STRING' },
                readConfidence: { type: 'NUMBER' },
              },
              required: ['drugName', 'rawText', 'readConfidence'],
            },
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini response missing content');
  }
  return JSON.parse(text) as GeminiListExtraction[];
}

const DRUG_CATALOG_INDEX = 'drug_catalog';
const MIN_MATCH_SCORE = 0.85;

let mossClientPromise: Promise<import('@moss-dev/moss').MossClient | null> | undefined;

async function getMossClient(): Promise<import('@moss-dev/moss').MossClient | null> {
  const projectId = process.env.MOSS_PROJECT_ID;
  const projectKey = process.env.MOSS_PROJECT_KEY;
  if (!projectId || !projectKey) {
    return null;
  }

  if (!mossClientPromise) {
    mossClientPromise = (async () => {
      const { MossClient } = await import('@moss-dev/moss');
      const client = new MossClient(projectId, projectKey);
      try {
        await client.loadIndex(DRUG_CATALOG_INDEX);
      } catch {
        await client.createIndex(DRUG_CATALOG_INDEX, drugCatalogDocs);
        await client.loadIndex(DRUG_CATALOG_INDEX);
      }
      return client;
    })();
  }

  return mossClientPromise;
}

interface DrugCatalogDoc {
  id: string;
  text: string;
  metadata?: Record<string, string>;
}

function localCatalogMatch(drugName: string): string | null {
  const needle = drugName.toLowerCase().trim();
  if (!needle) {
    return null;
  }
  const docs = drugCatalogDocs as DrugCatalogDoc[];
  for (const doc of docs) {
    const generic = doc.metadata?.generic?.toLowerCase();
    if (generic && (needle.includes(generic) || generic.includes(needle))) {
      return doc.metadata?.ingredientRxcui ?? doc.id;
    }
  }
  for (const doc of docs) {
    if (doc.text.toLowerCase().includes(needle)) {
      return doc.metadata?.ingredientRxcui ?? doc.id;
    }
  }
  return null;
}

async function resolveIngredientCode(drugName: string): Promise<string | null> {
  try {
    const client = await getMossClient();
    if (client) {
      const result = await client.query(DRUG_CATALOG_INDEX, drugName, { topK: 1 });
      const top = result.docs[0];
      if (top && top.score >= MIN_MATCH_SCORE) {
        return top.metadata?.ingredientRxcui ?? top.id;
      }
    }
  } catch (err) {
    console.warn('resolveIngredientCode: moss.dev unavailable, falling back to local catalog match:', err);
  }
  return localCatalogMatch(drugName);
}

function deriveConfidence(extraction: GeminiListExtraction, matchKey: string | null): number {
  if (!matchKey) {
    return 0.4;
  }
  if (extraction.strengthMg == null || extraction.dosesPerDay == null) {
    return 0.6;
  }
  return 0.9;
}

export async function extractMedList(base64Pdf: string): Promise<ExtractMedListResult> {
  const extractions = await callGeminiForPdf(base64Pdf);

  const medications = await Promise.all(
    extractions.map(async (extraction): Promise<MedListItem> => {
      const matchKey = await resolveIngredientCode(extraction.drugName);
      const med: MedListItem = {
        matchKey,
        display: extraction.drugName,
        rawText: extraction.rawText,
        confidence: deriveConfidence(extraction, matchKey),
      };
      if (extraction.strengthMg != null) {
        med.strengthMg = extraction.strengthMg;
      }
      if (extraction.dosesPerDay != null) {
        med.dosesPerDay = extraction.dosesPerDay;
      }
      return med;
    })
  );

  return { medications };
}

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as { pdf?: unknown });
    const pdf = body?.pdf;
    if (!pdf || typeof pdf !== 'string') {
      res.status(400).json({ error: 'Missing "pdf" (base64 PDF) in request body' });
      return;
    }

    const result = await extractMedList(pdf);
    res.status(200).json(result);
  } catch (err) {
    console.error('extract-medlist failed', err);
    res.status(500).json({ error: 'Extraction failed' });
  }
}
