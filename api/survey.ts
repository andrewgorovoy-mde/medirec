import { MedplumClient } from '@medplum/core';

// Machine-to-machine credential (SURVEY_CLIENT_ID / SURVEY_CLIENT_SECRET, deliberately not
// MEDPLUM_-prefixed so Vite never bundles them into client code — see .env.defaults) scoped to
// read-only access on Patient + QuestionnaireResponse. This is the one piece of real backend the
// patient survey portal needs in this pass: a patient's browser has no Medplum login, so there's
// no way to check "does this DOB match this patient" without an authenticated server-side call.

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

export interface VerifySurveyResult {
  verified: boolean;
}

// Never echo the real birthDate/name back to the caller — the response must not leak the thing
// being verified. A 404 (bad id) and a wrong DOB both just come back as verified: false, so a
// caller can't distinguish "no such link" from "wrong answer" (avoids a link-enumeration hint).
export async function verifySurveyIdentity(responseId: string, dob: string): Promise<VerifySurveyResult> {
  try {
    const medplum = await getServiceMedplum();
    const response = await medplum.readResource('QuestionnaireResponse', responseId);
    const patientRef = response.subject?.reference;
    if (!patientRef?.startsWith('Patient/')) {
      return { verified: false };
    }
    const patient = await medplum.readResource('Patient', patientRef.slice('Patient/'.length));
    return { verified: Boolean(patient.birthDate) && patient.birthDate === dob };
  } catch (err) {
    console.warn('verifySurveyIdentity failed:', err);
    return { verified: false };
  }
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
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as { id?: unknown; dob?: unknown });
    const { id, dob } = body ?? {};
    if (typeof id !== 'string' || typeof dob !== 'string') {
      res.status(400).json({ error: 'Missing "id" or "dob" in request body' });
      return;
    }

    const result = await verifySurveyIdentity(id, dob);
    res.status(200).json(result);
  } catch (err) {
    console.error('survey verify failed', err);
    res.status(500).json({ error: 'Verification failed' });
  }
}
