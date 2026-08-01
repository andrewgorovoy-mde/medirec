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

/** Follow-up questions for a medication that's active in the EHR but was never found at home. */
export function notInHomeQuestions(display: string): string[] {
  return [
    `Did she ever fill the prescription for ${display}?`,
    'Could the bottle be somewhere else — another pharmacy, a family member, a bag not yet checked?',
    'Should the prescriber be told this may not actually be taken?',
  ];
}

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
      followUpQuestions: [
        'Can you get a clearer photo of the label, or read it aloud?',
        'Does the patient know what this medication is for?',
        'Is there a pharmacy label, box, or prescription slip nearby with more detail?',
      ],
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
      followUpQuestions: [
        'Who prescribed this, and when did she start taking it?',
        'Is it over-the-counter or a prescription medication?',
        'Should this be added to her active medication list?',
      ],
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
      followUpQuestions: [
        `Is she taking both the ${ehrSays.split(',')[0]} and the ${homeSays.split(',')[0]}, or just one?`,
        'Did the hospital tell her to stop the older bottle when the new one was started?',
        'Should the old bottle be discarded to avoid double-dosing?',
      ],
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
      followUpQuestions: [
        'Which dose is she actually taking right now — the bottle label or the chart?',
        'When did the dose change, and who authorized it?',
        'Has she had any symptoms that suggest the dose might be wrong (dizziness, fatigue, palpitations)?',
      ],
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
    followUpQuestions: [],
  };
}
