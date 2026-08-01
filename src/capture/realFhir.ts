import type { MedplumClient } from '@medplum/core';
import type { CodeableConcept, Encounter, MedicationRequest, MedicationStatement } from '@medplum/fhirtypes';
import { computeVerdict, notInHomeQuestions } from './verdict';
import type {
  CaptureInput,
  CheckMedResponse,
  EhrMed,
  MedInput,
  NotInHomeEntry,
  SessionStartResponse,
  SessionSummaryResponse,
} from './types';

const RXNORM_SYSTEM = 'http://www.nlm.nih.gov/research/umls/rxnorm';

function ingredientCode(concept?: CodeableConcept): string | null {
  return concept?.coding?.find((c) => c.system === RXNORM_SYSTEM)?.code ?? null;
}

function displayOf(concept?: CodeableConcept): string {
  return concept?.text ?? concept?.coding?.[0]?.display ?? 'Unknown medication';
}

function ehrMedFromRequest(req: MedicationRequest): EhrMed | null {
  const matchKey = ingredientCode(req.medicationCodeableConcept);
  if (!matchKey) {
    return null;
  }
  const dosage = req.dosageInstruction?.[0];
  return {
    matchKey,
    display: displayOf(req.medicationCodeableConcept),
    strengthMg: dosage?.doseAndRate?.[0]?.doseQuantity?.value,
    dosesPerDay: dosage?.timing?.repeat?.frequency,
    prescriber: req.requester?.display,
  };
}

function fullName(patient: { name?: { given?: string[]; family?: string }[] }): string {
  const name = patient.name?.[0];
  if (!name) {
    return 'Unknown Patient';
  }
  return [name.given?.join(' '), name.family].filter(Boolean).join(' ') || 'Unknown Patient';
}

function calculateAge(birthDate?: string): number | undefined {
  if (!birthDate) {
    return undefined;
  }
  const dob = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

async function activeEhrMeds(medplum: MedplumClient, patientRef: string): Promise<EhrMed[]> {
  const requests = await medplum.searchResources('MedicationRequest', { subject: patientRef, status: 'active' });
  return requests.map(ehrMedFromRequest).filter((m): m is EhrMed => m !== null);
}

export async function startSession(medplum: MedplumClient, patientId: string): Promise<SessionStartResponse> {
  const patient = await medplum.readResource('Patient', patientId.replace('Patient/', ''));

  const encounter = await medplum.createResource<Encounter>({
    resourceType: 'Encounter',
    status: 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
    subject: { reference: patientId },
  });

  const ehrMeds = await activeEhrMeds(medplum, patientId);

  return {
    sessionId: `Encounter/${encounter.id}`,
    patient: { id: patientId, name: fullName(patient), age: calculateAge(patient.birthDate) },
    ehrMeds,
    startedAt: new Date().toISOString(),
  };
}

export async function checkMed(
  medplum: MedplumClient,
  sessionId: string,
  med: MedInput,
  capture: CaptureInput
): Promise<CheckMedResponse> {
  const encounter = await medplum.readReference<Encounter>({ reference: sessionId });
  const patientRef = encounter.subject!.reference!;
  const ehrMeds = await activeEhrMeds(medplum, patientRef);

  const verdict = computeVerdict(med, ehrMeds, capture.confidence);

  const statement = await medplum.createResource<MedicationStatement>({
    resourceType: 'MedicationStatement',
    status: 'active',
    subject: { reference: patientRef },
    context: { reference: sessionId },
    medicationCodeableConcept: {
      coding: med.matchKey ? [{ system: RXNORM_SYSTEM, code: med.matchKey, display: med.display }] : undefined,
      text: med.rawText,
    },
    dosage: med.dosesPerDay
      ? [{ text: med.rawText, timing: { repeat: { frequency: med.dosesPerDay, period: 1, periodUnit: 'd' } } }]
      : undefined,
    // Verdict details (evidence, ehrSays/homeSays, suggestedAction, etc.) don't have a natural
    // FHIR home, so they're round-tripped as JSON here and parsed back out in getSummary. The
    // statementId itself is deliberately NOT included — it's derived from the resource's own id.
    note: [{ text: JSON.stringify(verdict) }],
  });

  return { ...verdict, statementId: `MedicationStatement/${statement.id}` };
}

/**
 * Verdict details (evidence, ehrSays/homeSays, suggestedAction, followUpQuestions, etc.) don't
 * have a natural FHIR home, so checkMed round-trips them as JSON in MedicationStatement.note[0].text.
 * This parses that back out — shared by getSummary and by the patient Medications tab, which
 * shows a patient's full reconciliation history across all sessions, not just one.
 */
export function parseMedicationStatementVerdict(
  statement: MedicationStatement
): { row: CheckMedResponse; lastUpdated: string | undefined } | null {
  const noteText = statement.note?.[0]?.text;
  if (!noteText) {
    return null;
  }
  try {
    const verdict = JSON.parse(noteText) as Omit<CheckMedResponse, 'statementId'>;
    return {
      row: { ...verdict, statementId: `MedicationStatement/${statement.id}` },
      lastUpdated: statement.meta?.lastUpdated,
    };
  } catch {
    return null;
  }
}

export async function getSummary(medplum: MedplumClient, sessionId: string): Promise<SessionSummaryResponse> {
  const encounter = await medplum.readReference<Encounter>({ reference: sessionId });
  const patientRef = encounter.subject!.reference!;

  const [patient, statements, ehrMeds] = await Promise.all([
    medplum.readResource('Patient', patientRef.replace('Patient/', '')),
    medplum.searchResources('MedicationStatement', { context: sessionId }),
    activeEhrMeds(medplum, patientRef),
  ]);

  const rows: CheckMedResponse[] = statements
    .map(parseMedicationStatementVerdict)
    .filter((r): r is { row: CheckMedResponse; lastUpdated: string | undefined } => r !== null)
    .sort((a, b) => (b.lastUpdated ?? '').localeCompare(a.lastUpdated ?? ''))
    .map((r) => r.row);

  const capturedMatchKeys = new Set(rows.map((r) => r.matchKey).filter((k): k is string => k != null));
  const notInHome: NotInHomeEntry[] = ehrMeds
    .filter((m) => !capturedMatchKeys.has(m.matchKey))
    .map((m) => ({
      matchKey: m.matchKey,
      display: m.display,
      evidence: ["Active in the record, but no bottle was found and she didn't mention it"],
      severity: 'review' as const,
      followUpQuestions: notInHomeQuestions(m.display),
    }));

  return {
    sessionId,
    patient: { id: patientRef, name: fullName(patient) },
    summary: {
      matched: rows.filter((r) => r.verdict === 'MATCH').length,
      needsReview: rows.filter((r) => r.severity === 'review').length,
      mustResolve: rows.filter((r) => r.severity === 'must_resolve').length,
      captured: rows.length,
    },
    rows,
    notInHome,
  };
}
