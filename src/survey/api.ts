import type { MedplumClient } from '@medplum/core';
import type { QuestionnaireResponse } from '@medplum/fhirtypes';

// The practitioner's browser is already authenticated (same MedplumClient used everywhere else
// in this app), so creating/listing the survey session happens as a normal FHIR call here — no
// new credential needed for this half. The *patient's* browser, opening the generated link later,
// has no Medplum login at all; that side goes through /api/survey (see api/survey.ts) instead.

export async function startInitialSurvey(
  medplum: MedplumClient,
  patientId: string
): Promise<{ id: string; url: string }> {
  const response = await medplum.createResource<QuestionnaireResponse>({
    resourceType: 'QuestionnaireResponse',
    status: 'in-progress',
    subject: { reference: `Patient/${patientId}` },
    authored: new Date().toISOString(),
  });
  return { id: response.id as string, url: `${window.location.origin}/survey/${response.id}` };
}

export async function listSurveySessions(medplum: MedplumClient, patientId: string): Promise<QuestionnaireResponse[]> {
  return medplum.searchResources('QuestionnaireResponse', {
    subject: `Patient/${patientId}`,
    _sort: '-_lastUpdated',
  });
}

export async function verifySurveyIdentity(id: string, dob: string): Promise<boolean> {
  const res = await fetch('/api/survey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, dob }),
  });
  if (!res.ok) {
    return false;
  }
  const { verified } = (await res.json()) as { verified: boolean };
  return verified;
}

export interface RecordMedicationInput {
  responseId: string;
  name: string;
  frequency: string;
  reason?: string;
}

// Called from the Deepgram voice agent's record_medication tool (see PersistentVoiceAgent.tsx) —
// the patient's browser has no Medplum login, so this goes through the same server-side survey
// credential used for identity verification rather than a direct FHIR write.
export async function recordReportedMedication(input: RecordMedicationInput): Promise<boolean> {
  const res = await fetch('/api/survey-medication', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    return false;
  }
  const { ok } = (await res.json()) as { ok: boolean };
  return ok;
}
