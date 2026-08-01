// Shared contract between the mock (mockBots.ts) and real FHIR (realFhir.ts) reconciliation
// backends — computeVerdict operates only on these plain types, so either backend can drive it.

export interface EhrMed {
  matchKey: string;
  display: string;
  strengthMg?: number;
  dosesPerDay?: number;
  prescriber?: string;
}

export interface SessionPatient {
  id: string;
  name: string;
  age?: number;
}

export interface SessionStartResponse {
  sessionId: string;
  patient: SessionPatient;
  ehrMeds: EhrMed[];
  startedAt: string;
}

export type CaptureSource = 'label_photo' | 'voice' | 'pill_image';

export interface CaptureInput {
  source: CaptureSource;
  confidence: number;
}

export interface MedInput {
  matchKey: string | null;
  display: string;
  strengthMg?: number;
  dosesPerDay?: number;
  rawText: string;
}

export type Verdict = 'MATCH' | 'DOSE_CONFLICT' | 'DUPLICATE' | 'NOT_IN_EHR' | 'NOT_IN_HOME' | 'UNRESOLVED';
export type Severity = 'auto' | 'review' | 'must_resolve';

export interface CheckMedResponse {
  verdict: Verdict;
  ok: boolean;
  severity: Severity;
  matchKey: string | null;
  display: string;
  ehrSays?: string;
  homeSays?: string;
  evidence: string[];
  confidence: number;
  suggestedAction?: string;
  /** Follow-up questions worth asking the patient/prescriber — empty for MATCH. */
  followUpQuestions: string[];
  statementId: string;
}

export interface NotInHomeEntry {
  matchKey: string;
  display: string;
  evidence: string[];
  severity: Severity;
  followUpQuestions: string[];
}

export interface SessionSummaryResponse {
  sessionId: string;
  patient: Pick<SessionPatient, 'id' | 'name'>;
  summary: { matched: number; needsReview: number; mustResolve: number; captured: number };
  rows: CheckMedResponse[];
  notInHome: NotInHomeEntry[];
}
