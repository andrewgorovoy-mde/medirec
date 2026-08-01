import { MedplumClient } from '@medplum/core';
import drugCatalogDocs from './drug_index.json' with { type: 'json' };

// Self-contained on purpose — no import from api/survey.ts or api/deepgram/token.ts. A prior
// cross-file import between two Vercel function entry points failed in production with
// ERR_MODULE_NOT_FOUND; see api/extract-medlist.ts for the same convention.

let medplumPromise: Promise<MedplumClient> | undefined;

async function getServiceMedplum(): Promise<MedplumClient> {
  if (!medplumPromise) {
    medplumPromise = (async () => {
      const clientId = process.env.SURVEY_CLIENT_ID;
      const clientSecret = process.env.SURVEY_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error('SURVEY_CLIENT_ID / SURVEY_CLIENT_SECRET are not set');
      }
      const medplum = new MedplumClient({
        baseUrl: process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com',
        fetch,
      });
      await medplum.startClientLogin(clientId, clientSecret);
      return medplum;
    })();
  }
  return medplumPromise;
}

interface DrugCatalogDoc {
  id: string;
  text: string;
  metadata?: Record<string, string>;
}

// Same best-effort local match used in api/extract-medlist.ts — dead simple, no external lookup,
// consistent with how this catalog is already resolved elsewhere in the app.
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

const RXNORM_SYSTEM = 'http://www.nlm.nih.gov/research/umls/rxnorm';

// Shaped to match CheckMedResponse (src/capture/types.ts) so it renders automatically through the
// existing VerdictCard / "Reconciliation History" list in PatientMedications.tsx via
// parseMedicationStatementVerdict — no new practitioner-facing UI needed for this first pass.
function buildVerdictNote(name: string, frequency: string, matchKey: string | null, reason?: string): string {
  return JSON.stringify({
    verdict: 'UNRESOLVED',
    ok: false,
    severity: 'review',
    matchKey,
    display: name,
    homeSays: reason ? `${frequency} — ${reason}` : frequency,
    evidence: ['Reported by the patient during a voice check-in — pending clinician review.'],
    confidence: matchKey ? 0.6 : 0.4,
    suggestedAction: 'Confirm with the patient and reconcile against the active medication list.',
    followUpQuestions: [],
  });
}

export interface RecordMedicationResult {
  ok: boolean;
  statementId?: string;
}

export async function recordSurveyMedication(
  responseId: string,
  name: string,
  frequency: string,
  reason?: string
): Promise<RecordMedicationResult> {
  const medplum = await getServiceMedplum();
  const response = await medplum.readResource('QuestionnaireResponse', responseId);
  const patientRef = response.subject?.reference;
  if (!patientRef?.startsWith('Patient/')) {
    return { ok: false };
  }

  const matchKey = localCatalogMatch(name);
  const statement = await medplum.createResource({
    resourceType: 'MedicationStatement',
    status: 'active',
    subject: { reference: patientRef },
    medicationCodeableConcept: {
      coding: matchKey ? [{ system: RXNORM_SYSTEM, code: matchKey, display: name }] : undefined,
      text: name,
    },
    dosage: [{ text: frequency }],
    reasonCode: reason ? [{ text: reason }] : undefined,
    note: [{ text: buildVerdictNote(name, frequency, matchKey, reason) }],
  });

  return { ok: true, statementId: statement.id };
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
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body)
        : (req.body as { responseId?: unknown; name?: unknown; frequency?: unknown; reason?: unknown });
    const { responseId, name, frequency, reason } = body ?? {};
    if (typeof responseId !== 'string' || typeof name !== 'string' || typeof frequency !== 'string') {
      res.status(400).json({ error: 'Missing "responseId", "name", or "frequency" in request body' });
      return;
    }

    const result = await recordSurveyMedication(responseId, name, frequency, typeof reason === 'string' ? reason : undefined);
    res.status(200).json(result);
  } catch (err) {
    console.error('survey-medication failed', err);
    res.status(500).json({ ok: false, error: 'Failed to record medication' });
  }
}
