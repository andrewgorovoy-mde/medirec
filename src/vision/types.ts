export const MEDICATION_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type MedicationImageContentType = (typeof MEDICATION_IMAGE_CONTENT_TYPES)[number];

export const MAX_MEDICATION_IMAGE_BYTES = 5 * 1024 * 1024;

export type MedicationIdentificationStatus = 'possible_match' | 'no_match' | 'unresolved' | 'error';

export type MedicationIdentificationSource = 'external_cv_service' | 'local_extract';

export interface NormalizedMedication {
  name: string;
  strength?: string | null;
  strengthMg?: number | null;
  dosageForm?: string | null;
  imprint?: string | null;
  manufacturer?: string | null;
  rxnormCode?: string | null;
  rawText?: string | null;
}

export interface MedicationIdentifyRequest {
  image?: string;
  imageId?: string | null;
  contentType?: MedicationImageContentType;
}

export interface MedicationIdentifyResponse {
  status: MedicationIdentificationStatus;
  medication: NormalizedMedication | null;
  confidence: number;
  alternatives: NormalizedMedication[];
  warnings: string[];
  requiresConfirmation: boolean;
  source?: MedicationIdentificationSource;
}
