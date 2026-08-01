import type { CheckMedResponse, MedInput, SessionSummaryResponse } from '../capture/types';
import type { MedicationImageContentType, MedicationIdentifyResponse, NormalizedMedication } from '../vision/types';

export type VoiceToolName =
  | 'get_current_medication_list'
  | 'identify_medication_image'
  | 'compare_identified_medication'
  | 'confirm_medication'
  | 'correct_medication'
  | 'create_medication_review_task'
  | 'get_patient_allergies'
  | 'get_preferred_language'
  | 'end_medication_reconciliation';

export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: readonly string[];
  nullable?: boolean;
};

export interface VoiceToolDefinition {
  name: VoiceToolName;
  purpose: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  internalEndpoint: string;
  requiresPatientConfirmation: boolean;
  requiresClinicianReview: boolean;
  failureStates: string[];
}

export interface VoiceToolContextInput {
  patientId: string;
  sessionId?: string;
}

export interface VoiceMedicationSummary {
  matchKey: string | null;
  display: string;
  strengthMg?: number;
  dosesPerDay?: number;
  prescriber?: string;
  status?: string;
}

export interface GetCurrentMedicationListInput extends VoiceToolContextInput {}

export interface GetCurrentMedicationListOutput {
  medications: VoiceMedicationSummary[];
  warnings: string[];
}

export interface IdentifyMedicationImageInput extends VoiceToolContextInput {
  image?: string;
  imageId?: string | null;
  contentType?: MedicationImageContentType;
}

export type IdentifyMedicationImageOutput = MedicationIdentifyResponse;

export interface CompareIdentifiedMedicationInput extends VoiceToolContextInput {
  medication: NormalizedMedication;
  confidence: number;
}

export interface CompareIdentifiedMedicationOutput {
  result: CheckMedResponse;
}

export interface ConfirmMedicationInput extends VoiceToolContextInput {
  medication: MedInput;
  confirmation: 'confirmed' | 'corrected' | 'rejected';
  correction?: MedInput;
}

export interface ConfirmMedicationOutput {
  status: 'draft_recorded' | 'review_task_created' | 'rejected';
  reviewRequired: boolean;
  draftResourceId?: string;
  taskId?: string;
  warnings: string[];
}

export interface CorrectMedicationInput extends VoiceToolContextInput {
  previousMedication: NormalizedMedication;
  correctedMedication: NormalizedMedication;
}

export interface CorrectMedicationOutput {
  medication: NormalizedMedication;
  requiresConfirmation: true;
  warnings: string[];
}

export interface CreateMedicationReviewTaskInput extends VoiceToolContextInput {
  reason: string;
  medication?: NormalizedMedication;
  evidence: string[];
}

export interface CreateMedicationReviewTaskOutput {
  taskId: string;
  status: 'requested' | 'accepted' | 'rejected';
  warnings: string[];
}

export interface GetPatientAllergiesInput {
  patientId: string;
}

export interface GetPatientAllergiesOutput {
  allergies: Array<{ substance: string; reaction?: string; severity?: string }>;
  warnings: string[];
}

export interface GetPreferredLanguageInput {
  patientId: string;
}

export interface GetPreferredLanguageOutput {
  language: string | null;
  source: 'patient.communication' | 'default' | 'unknown';
}

export interface EndMedicationReconciliationInput extends VoiceToolContextInput {}

export interface EndMedicationReconciliationOutput {
  summary: SessionSummaryResponse['summary'];
  unresolvedCount: number;
  mustReviewCount: number;
  warnings: string[];
}

const contextProperties = {
  patientId: { type: 'string', description: 'FHIR Patient id or reference for the current SMART context.' },
  sessionId: { type: 'string', description: 'Current reconciliation Encounter/session reference.', nullable: true },
} satisfies Record<string, JsonSchema>;

const normalizedMedicationSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string' },
    strength: { type: 'string', nullable: true },
    strengthMg: { type: 'number', nullable: true },
    dosageForm: { type: 'string', nullable: true },
    imprint: { type: 'string', nullable: true },
    manufacturer: { type: 'string', nullable: true },
    rxnormCode: { type: 'string', nullable: true },
    rawText: { type: 'string', nullable: true },
  },
};

const warningsSchema: JsonSchema = {
  type: 'array',
  items: { type: 'string' },
};

export const VOICE_TOOL_DEFINITIONS = [
  {
    name: 'get_current_medication_list',
    purpose: 'Read the active medication list for the current SMART patient.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['patientId'],
      properties: contextProperties,
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['medications', 'warnings'],
      properties: {
        medications: { type: 'array', items: { type: 'object' } },
        warnings: warningsSchema,
      },
    },
    internalEndpoint: 'future authenticated FHIR context service',
    requiresPatientConfirmation: false,
    requiresClinicianReview: false,
    failureStates: ['unauthorized_patient', 'patient_not_found', 'fhir_read_failed'],
  },
  {
    name: 'identify_medication_image',
    purpose: 'Identify a possible medication from a patient-provided image.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['patientId'],
      properties: {
        ...contextProperties,
        image: { type: 'string', description: 'Base64 image payload without a data URL prefix.', nullable: true },
        imageId: { type: 'string', description: 'Previously uploaded image identifier.', nullable: true },
        contentType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] },
      },
    },
    outputSchema: { type: 'object' },
    internalEndpoint: 'POST /api/medications/identify',
    requiresPatientConfirmation: true,
    requiresClinicianReview: true,
    failureStates: ['missing_image', 'unsupported_content_type', 'image_too_large', 'vision_service_unavailable'],
  },
  {
    name: 'compare_identified_medication',
    purpose: 'Compare a normalized home medication against current EHR medication data.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['patientId', 'sessionId', 'medication', 'confidence'],
      properties: {
        ...contextProperties,
        medication: normalizedMedicationSchema,
        confidence: { type: 'number' },
      },
    },
    outputSchema: { type: 'object' },
    internalEndpoint: 'future authenticated reconciliation service',
    requiresPatientConfirmation: true,
    requiresClinicianReview: true,
    failureStates: ['session_not_found', 'missing_rxnorm_code', 'fhir_read_failed'],
  },
  {
    name: 'confirm_medication',
    purpose: 'Record a patient confirmation, correction, or rejection without making final medication-list changes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['patientId', 'sessionId', 'medication', 'confirmation'],
      properties: {
        ...contextProperties,
        medication: { type: 'object' },
        confirmation: { type: 'string', enum: ['confirmed', 'corrected', 'rejected'] },
        correction: { type: 'object', nullable: true },
      },
    },
    outputSchema: { type: 'object' },
    internalEndpoint: 'future POST /api/medications/confirm',
    requiresPatientConfirmation: true,
    requiresClinicianReview: true,
    failureStates: ['unauthorized_patient', 'invalid_correction', 'write_blocked'],
  },
  {
    name: 'correct_medication',
    purpose: 'Normalize a patient-provided correction before comparison or confirmation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['patientId', 'previousMedication', 'correctedMedication'],
      properties: {
        ...contextProperties,
        previousMedication: normalizedMedicationSchema,
        correctedMedication: normalizedMedicationSchema,
      },
    },
    outputSchema: { type: 'object' },
    internalEndpoint: 'client/server validation helper',
    requiresPatientConfirmation: true,
    requiresClinicianReview: true,
    failureStates: ['invalid_medication_fields', 'session_not_found'],
  },
  {
    name: 'create_medication_review_task',
    purpose: 'Create a clinician-review task for unresolved or conflicting medication information.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['patientId', 'sessionId', 'reason', 'evidence'],
      properties: {
        ...contextProperties,
        reason: { type: 'string' },
        medication: normalizedMedicationSchema,
        evidence: { type: 'array', items: { type: 'string' } },
      },
    },
    outputSchema: { type: 'object' },
    internalEndpoint: 'future Task-writing endpoint',
    requiresPatientConfirmation: false,
    requiresClinicianReview: true,
    failureStates: ['missing_reason', 'unauthorized_write', 'fhir_write_failed'],
  },
  {
    name: 'get_patient_allergies',
    purpose: 'Read allergy context relevant to medication reconciliation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['patientId'],
      properties: { patientId: contextProperties.patientId },
    },
    outputSchema: { type: 'object' },
    internalEndpoint: 'future authenticated FHIR context service',
    requiresPatientConfirmation: false,
    requiresClinicianReview: false,
    failureStates: ['unauthorized_patient', 'fhir_read_failed'],
  },
  {
    name: 'get_preferred_language',
    purpose: 'Read preferred language hints for voice-agent localization.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['patientId'],
      properties: { patientId: contextProperties.patientId },
    },
    outputSchema: { type: 'object' },
    internalEndpoint: 'future authenticated FHIR context service',
    requiresPatientConfirmation: false,
    requiresClinicianReview: false,
    failureStates: ['patient_not_found', 'language_unknown'],
  },
  {
    name: 'end_medication_reconciliation',
    purpose: 'End the medication-reconciliation session and return an unresolved-item summary.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['patientId', 'sessionId'],
      properties: contextProperties,
    },
    outputSchema: { type: 'object' },
    internalEndpoint: 'future authenticated summary service',
    requiresPatientConfirmation: false,
    requiresClinicianReview: true,
    failureStates: ['session_not_found', 'summary_failed'],
  },
] satisfies readonly VoiceToolDefinition[];
