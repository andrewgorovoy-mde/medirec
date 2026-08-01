import type { CheckMedResponse, EhrMed, MedInput } from './types';

export function formatDoseText(dosesPerDay?: number): string {
  if (dosesPerDay == null) {
    return 'frequency unknown';
  }
  if (dosesPerDay === 1) {
    return 'once daily';
  }
  if (dosesPerDay === 2) {
    return 'twice daily';
  }
  if (dosesPerDay === 3) {
    return 'three times daily';
  }
  return `${dosesPerDay}x daily`;
}

export function formatSays(display: string, strengthMg?: number, dosesPerDay?: number): string {
  const dailyMg = strengthMg != null && dosesPerDay != null ? ` (${strengthMg * dosesPerDay} mg/day)` : '';
  const strengthText = strengthMg != null ? `${strengthMg} MG, ` : '';
  return `${display}, ${strengthText}${formatDoseText(dosesPerDay)}${dailyMg}`;
}

const PRODUCT_MARKERS = ['succinate', 'tartrate', 'er', 'ir', 'xl', 'sr', 'cr'];

export function productMarkers(display: string): string[] {
  const lower = display.toLowerCase();
  return PRODUCT_MARKERS.filter((marker) => new RegExp(`\\b${marker}\\b`).test(lower));
}

export type VerdictResult = Omit<CheckMedResponse, 'statementId'>;

/**
 * Precedence: DUPLICATE -> DOSE_CONFLICT -> NOT_IN_EHR -> MATCH (UNRESOLVED short-circuits first).
 * Pure function over plain objects — doesn't care whether ehrMeds came from a mock array or a
 * real FHIR search, which is what lets the mock and real-FHIR backends share this logic exactly.
 */
export function computeVerdict(med: MedInput, ehrMeds: EhrMed[], confidence: number): VerdictResult {
  if (!med.matchKey) {
    return {
      verdict: 'UNRESOLVED',
      ok: false,
      severity: 'review',
      matchKey: null,
      display: med.display,
      evidence: [`Could not identify: "${med.rawText}"`],
      confidence,
      suggestedAction: 'Identify the medication and re-capture',
    };
  }

  const match = ehrMeds.find((m) => m.matchKey === med.matchKey);

  if (!match) {
    return {
      verdict: 'NOT_IN_EHR',
      ok: false,
      severity: 'must_resolve',
      matchKey: med.matchKey,
      display: med.display,
      homeSays: formatSays(med.display, med.strengthMg, med.dosesPerDay),
      evidence: ['Found in the house, but not in the active EHR medication list'],
      confidence,
      suggestedAction: 'Confirm this medication with the prescriber and add to the record if appropriate',
    };
  }

  const ehrSays = formatSays(match.display, match.strengthMg, match.dosesPerDay);
  const homeSays = formatSays(med.display, med.strengthMg, med.dosesPerDay);
  const ehrMarkers = productMarkers(match.display);
  const homeMarkers = productMarkers(med.display);
  const productDiffers =
    ehrMarkers.length > 0 && homeMarkers.length > 0 && ehrMarkers.join(',') !== homeMarkers.join(',');
  const doseDiffers =
    (match.strengthMg != null && med.strengthMg != null && match.strengthMg !== med.strengthMg) ||
    (match.dosesPerDay != null && med.dosesPerDay != null && match.dosesPerDay !== med.dosesPerDay);

  if (productDiffers) {
    return {
      verdict: 'DUPLICATE',
      ok: false,
      severity: 'must_resolve',
      matchKey: med.matchKey,
      display: match.display,
      ehrSays,
      homeSays,
      evidence: [
        `Hospital record has ${ehrSays}`,
        `The bottle on the counter is ${homeSays}`,
        'Both are the same ingredient in different products — she may be taking both at once',
      ],
      confidence,
      suggestedAction: 'Confirm with the prescriber whether the older product should stop',
    };
  }

  if (doseDiffers) {
    return {
      verdict: 'DOSE_CONFLICT',
      ok: false,
      severity: 'must_resolve',
      matchKey: med.matchKey,
      display: match.display,
      ehrSays,
      homeSays,
      evidence: [`EHR says ${ehrSays}`, `Home bottle says ${homeSays}`, 'Same product, different dose'],
      confidence,
      suggestedAction: 'Confirm the correct dose with the prescriber',
    };
  }

  return {
    verdict: 'MATCH',
    ok: true,
    severity: 'auto',
    matchKey: med.matchKey,
    display: match.display,
    ehrSays,
    homeSays,
    evidence: ['Matches the active EHR medication'],
    confidence,
  };
}
