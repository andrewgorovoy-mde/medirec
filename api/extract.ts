import drugCatalogDocs from './drug_index.json' with { type: 'json' };

export interface FlatMed {
  matchKey: string | null;
  display: string;
  strengthMg?: number;
  dosesPerDay?: number;
  rawText: string;
}

export interface ExtractResult {
  med: FlatMed;
  confidence: number;
}

interface GeminiExtraction {
  drugName: string;
  strengthMg?: number;
  dosesPerDay?: number;
  rawText: string;
  readConfidence: number;
}

// "gemini-2.0-flash" was retired; use the alias so this doesn't go stale again as Google
// rotates model versions — confirmed working (resolves to gemini-3.6-flash as of this build).
const GEMINI_MODEL = 'gemini-flash-latest';

const EXTRACTION_PROMPT =
  'You are reading a prescription pill bottle label from a photo. ' +
  'Extract the drug name exactly as it identifies the product on the label, including the ' +
  'salt/ester form (e.g. "succinate", "tartrate") and any release modifier (ER, XL, IR, SR, CR) ' +
  'if present — this is more specific than the plain active ingredient (e.g. "metoprolol tartrate", ' +
  'not just "metoprolol"). ' +
  'Also extract the strength in mg if legible, the doses per day computed from the sig/instructions ' +
  'if it parses cleanly, and the raw label text verbatim. ' +
  'Omit strengthMg or dosesPerDay if not legible or not parseable — never guess. ' +
  'Set readConfidence to your confidence (0-1) that the drugName and rawText are correct.';

async function callGemini(base64Jpeg: string): Promise<GeminiExtraction> {
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
              { text: EXTRACTION_PROMPT },
              { inline_data: { mime_type: 'image/jpeg', data: base64Jpeg } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
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
  return JSON.parse(text) as GeminiExtraction;
}

// Resolves a free-text drug name to its ingredient-level RxNorm code (CUI) via a moss.dev
// semantic search index — e.g. "metoprolol tartrate" -> "6918" — so matchKey is never guessed
// by the vision model. Below this confidence, treat the drug as unresolved rather than risk a
// wrong ingredient code (a false NOT_IN_EHR is worse than a correct UNRESOLVED).
const DRUG_CATALOG_INDEX = 'drug_catalog';
// Empirically, true matches score ~1.0 and unrelated drugs still score ~0.75-0.78 (embedding
// noise floor) against this index — 0.5 would let noise through, so the cutoff sits well above it.
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
        // Index doesn't exist yet in this moss.dev project — seed it from the local
        // drug_index.json fixture, which already matches MossClient's {id, text, metadata} shape.
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

// Deterministic fallback over the same seed data moss.dev's index is built from — used when
// moss.dev itself is unreachable (e.g. @moss-dev/moss-core's Linux binary currently requires a
// newer glibc than Vercel's Node.js runtime ships, so the native module fails to load there).
// This never guesses: it only returns a code when the extracted name actually appears in the
// catalog's generic name or curated synonym list.
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
      console.warn(`resolveIngredientCode: no confident moss match for "${drugName}" (top=${top?.id} score=${top?.score})`);
    } else {
      console.warn('resolveIngredientCode: no moss client (MOSS_PROJECT_ID/MOSS_PROJECT_KEY not set)');
    }
  } catch (err) {
    console.warn('resolveIngredientCode: moss.dev unavailable, falling back to local catalog match:', err);
  }
  return localCatalogMatch(drugName);
}

function deriveConfidence(extraction: GeminiExtraction, matchKey: string | null): number {
  if (!matchKey) {
    return 0.4;
  }
  if (extraction.strengthMg == null || extraction.dosesPerDay == null) {
    return 0.6;
  }
  return 0.9;
}

export async function extractMed(base64Jpeg: string): Promise<ExtractResult> {
  const extraction = await callGemini(base64Jpeg);
  const matchKey = await resolveIngredientCode(extraction.drugName);

  const med: FlatMed = {
    matchKey,
    display: extraction.drugName,
    rawText: extraction.rawText,
  };
  if (extraction.strengthMg != null) {
    med.strengthMg = extraction.strengthMg;
  }
  if (extraction.dosesPerDay != null) {
    med.dosesPerDay = extraction.dosesPerDay;
  }

  return {
    med,
    confidence: deriveConfidence(extraction, matchKey),
  };
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
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as { image?: unknown });
    const image = body?.image;
    if (!image || typeof image !== 'string') {
      res.status(400).json({ error: 'Missing "image" (base64 JPEG) in request body' });
      return;
    }

    const result = await extractMed(image);
    res.status(200).json(result);
  } catch (err) {
    console.error('extract failed', err);
    res.status(500).json({ error: 'Extraction failed' });
  }
}
