import type {
  CaptureInput,
  CheckMedResponse,
  EhrMed,
  MedInput,
  NotInHomeEntry,
  SessionStartResponse,
  SessionSummaryResponse,
  Severity,
} from './types';
import { computeVerdict } from './verdict';

const MOCK_PATIENT = { id: 'Patient/maria-alvarez', name: 'Maria Alvarez', age: 78 };

// matchKey values are ingredient-level RxNorm CUIs. metoprolol (6918) and furosemide (4603)
// are taken directly from the API spec; lisinopril's CUI here is a best-effort placeholder
// for internal mock self-consistency only — it is never sent to a real backend.
const MOCK_EHR_MEDS: EhrMed[] = [
  {
    matchKey: '6918',
    display: 'metoprolol succinate 25 MG ER tablet',
    strengthMg: 25,
    dosesPerDay: 1,
    prescriber: 'Dr. Chen',
  },
  { matchKey: '29046', display: 'lisinopril 10 MG tablet', strengthMg: 10, dosesPerDay: 1, prescriber: 'Dr. Chen' },
  { matchKey: '4603', display: 'furosemide 40 MG tablet', strengthMg: 40, dosesPerDay: 1, prescriber: 'Dr. Chen' },
];

interface MockSession {
  sessionId: string;
  captured: CheckMedResponse[];
}

const sessions = new Map<string, MockSession>();
let statementCounter = 0;

function storageKey(sessionId: string): string {
  return `mock-session:${sessionId}`;
}

function loadSession(sessionId: string): MockSession {
  let session = sessions.get(sessionId);
  if (session) {
    return session;
  }

  const raw = sessionStorage.getItem(storageKey(sessionId));
  session = raw ? (JSON.parse(raw) as MockSession) : { sessionId, captured: [] };
  sessions.set(sessionId, session);

  // statementCounter is in-memory only, but captured rows (with their statementIds) persist
  // across reloads via sessionStorage — reseed the counter so a reload can't hand out an id
  // that's already in use.
  for (const row of session.captured) {
    const match = /mock-(\d+)$/.exec(row.statementId);
    if (match) {
      statementCounter = Math.max(statementCounter, Number(match[1]));
    }
  }

  return session;
}

function persistSession(session: MockSession): void {
  sessionStorage.setItem(storageKey(session.sessionId), JSON.stringify(session));
}

function nextStatementId(): string {
  statementCounter += 1;
  return `MedicationStatement/mock-${statementCounter}`;
}

export function mockStartSession(patientId: string): SessionStartResponse {
  const sessionId = `Encounter/mock-${Date.now()}`;
  sessions.set(sessionId, { sessionId, captured: [] });
  persistSession(sessions.get(sessionId)!);
  return {
    sessionId,
    patient: { ...MOCK_PATIENT, id: patientId || MOCK_PATIENT.id },
    ehrMeds: MOCK_EHR_MEDS,
    startedAt: new Date().toISOString(),
  };
}

export function mockCheckMed(sessionId: string, med: MedInput, capture: CaptureInput): CheckMedResponse {
  const session = loadSession(sessionId);
  const result: CheckMedResponse = {
    ...computeVerdict(med, MOCK_EHR_MEDS, capture.confidence),
    statementId: nextStatementId(),
  };

  session.captured.push(result);
  persistSession(session);
  return result;
}

export function mockGetSummary(sessionId: string): SessionSummaryResponse {
  const session = loadSession(sessionId);
  const rows = [...session.captured].reverse();

  const capturedMatchKeys = new Set(session.captured.map((r) => r.matchKey).filter((k): k is string => k != null));
  const notInHome: NotInHomeEntry[] = MOCK_EHR_MEDS.filter((m) => !capturedMatchKeys.has(m.matchKey)).map((m) => ({
    matchKey: m.matchKey,
    display: m.display,
    evidence: ["Active in the record, but no bottle was found and she didn't mention it"],
    severity: 'review' as Severity,
  }));

  return {
    sessionId,
    patient: { id: MOCK_PATIENT.id, name: MOCK_PATIENT.name },
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
