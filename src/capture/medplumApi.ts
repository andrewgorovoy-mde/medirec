import type { MedplumClient } from '@medplum/core';
import { mockCheckMed, mockGetSummary, mockStartSession } from './mockBots';
import * as realFhir from './realFhir';
import type { CaptureInput, CheckMedResponse, MedInput, SessionStartResponse, SessionSummaryResponse } from './types';

// Mock is the default: only the literal string "false" switches to the real FHIR backend below.
const MOCK_MODE = import.meta.env.MEDPLUM_MOCK_BOTS !== 'false';

export async function startSession(medplum: MedplumClient, patientId: string): Promise<SessionStartResponse> {
  if (MOCK_MODE) {
    return mockStartSession(patientId);
  }
  return realFhir.startSession(medplum, patientId);
}

export async function checkMed(
  medplum: MedplumClient,
  sessionId: string,
  med: MedInput,
  capture: CaptureInput
): Promise<CheckMedResponse> {
  if (MOCK_MODE) {
    return mockCheckMed(sessionId, med, capture);
  }
  return realFhir.checkMed(medplum, sessionId, med, capture);
}

export async function getSummary(medplum: MedplumClient, sessionId: string): Promise<SessionSummaryResponse> {
  if (MOCK_MODE) {
    return mockGetSummary(sessionId);
  }
  return realFhir.getSummary(medplum, sessionId);
}
