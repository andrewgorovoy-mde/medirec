import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FileInput,
  Group,
  NumberInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMedplum } from '@medplum/react';
import { IconFileUpload } from '@tabler/icons-react';
import { useState } from 'react';
import type { JSX } from 'react';
import { useNavigate, useParams } from 'react-router';
import { BADGE_TONES, BORDER, TEXT_MUTED } from '../../theme/tokens';

const RXNORM_SYSTEM = 'http://www.nlm.nih.gov/research/umls/rxnorm';

// The whole file is base64-encoded (+~33%) and sent as one JSON request body to
// /api/extract-medlist. Measured against the deployed Vercel function, that request gets
// rejected with a 413 (FUNCTION_PAYLOAD_TOO_LARGE) once the base64 payload passes ~4-4.5MB —
// so the raw file needs to stay comfortably under that after encoding. Multi-page scanned
// discharge summaries routinely exceed this, which is what "upload PDF isn't working" turned
// out to be: a cryptic 413 with no explanation. Guard here so the failure is actionable instead.
const MAX_PDF_BYTES = 3 * 1024 * 1024;

interface ParsedMed {
  id: string;
  selected: boolean;
  matchKey: string | null;
  display: string;
  strengthMg: string | number;
  dosesPerDay: string | number;
  rawText: string;
  confidence: number;
}

function newId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ImportMedicationsPage(): JSX.Element {
  const { id: patientId } = useParams();
  const medplum = useMedplum();
  const navigate = useNavigate();

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string>();
  const [meds, setMeds] = useState<ParsedMed[]>();

  async function handleFileSelect(selected: File | null): Promise<void> {
    setFile(selected);
    setMeds(undefined);
    setError(undefined);
    if (!selected) {
      return;
    }
    if (selected.size > MAX_PDF_BYTES) {
      setError(
        `This PDF is ${(selected.size / (1024 * 1024)).toFixed(1)} MB, which is too large to upload. ` +
          'Please use a file under 3 MB — try scanning at a lower resolution/black & white, or splitting ' +
          'a multi-page document into smaller files.'
      );
      setFile(null);
      return;
    }

    setParsing(true);
    try {
      const pdf = await fileToBase64(selected);
      const res = await fetch('/api/extract-medlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf }),
      });
      if (!res.ok) {
        throw new Error(`Extraction failed (${res.status})`);
      }
      const { medications } = (await res.json()) as {
        medications: { matchKey: string | null; display: string; strengthMg?: number; dosesPerDay?: number; rawText: string; confidence: number }[];
      };
      setMeds(
        medications.map((m) => ({
          id: newId(),
          selected: true,
          matchKey: m.matchKey,
          display: m.display,
          strengthMg: m.strengthMg ?? '',
          dosesPerDay: m.dosesPerDay ?? '',
          rawText: m.rawText,
          confidence: m.confidence,
        }))
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setParsing(false);
    }
  }

  function updateMed(id: string, patch: Partial<ParsedMed>): void {
    setMeds((prev) => prev?.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  async function handleImport(): Promise<void> {
    if (!patientId || !meds) {
      return;
    }
    const toImport = meds.filter((m) => m.selected);
    if (toImport.length === 0) {
      return;
    }

    setImporting(true);
    setError(undefined);
    try {
      await Promise.all(
        toImport.map((m) => {
          const strengthMg = m.strengthMg === '' ? undefined : Number(m.strengthMg);
          const dosesPerDay = m.dosesPerDay === '' ? undefined : Number(m.dosesPerDay);
          const displayText = strengthMg ? `${m.display} ${strengthMg} MG` : m.display;
          const doseText = dosesPerDay ? `${dosesPerDay}x/day` : undefined;

          return medplum.createResource({
            resourceType: 'MedicationRequest',
            status: 'active',
            intent: 'order',
            subject: { reference: `Patient/${patientId}` },
            medicationCodeableConcept: {
              coding: m.matchKey ? [{ system: RXNORM_SYSTEM, code: m.matchKey, display: m.display }] : undefined,
              text: displayText,
            },
            dosageInstruction: [
              {
                text: [displayText, doseText, m.rawText].filter(Boolean).join(' — '),
                timing: dosesPerDay ? { repeat: { frequency: dosesPerDay, period: 1, periodUnit: 'd' } } : undefined,
                doseAndRate: strengthMg ? [{ doseQuantity: { value: strengthMg, unit: 'mg' } }] : undefined,
              },
            ],
          });
        })
      );
      await navigate(`/Patient/${patientId}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  }

  const selectedCount = meds?.filter((m) => m.selected).length ?? 0;

  return (
    <Stack gap="md" p="md" maw={560}>
      <Title order={3}>Upload Medication List</Title>
      <Text size="sm" c={TEXT_MUTED}>
        Upload a discharge summary or pharmacy printout (PDF). We'll read it and pull out a
        proposed medication list for you to review before adding anything.
      </Text>

      {error && (
        <Alert color="red" onClose={() => setError(undefined)} withCloseButton>
          {error}
        </Alert>
      )}

      <FileInput
        placeholder="Choose a PDF..."
        accept="application/pdf"
        leftSection={<IconFileUpload size={16} />}
        value={file}
        onChange={(f) => void handleFileSelect(f)}
        clearable
      />

      {parsing && <Text c={TEXT_MUTED}>Reading document…</Text>}

      {meds && meds.length === 0 && !parsing && (
        <Text c={TEXT_MUTED}>No medications found in this document.</Text>
      )}

      {meds && meds.length > 0 && (
        <>
          <Stack gap="sm">
            {meds.map((m) => (
              <Card key={m.id} withBorder padding="sm" style={{ borderColor: BORDER }}>
                <Group align="flex-start" wrap="nowrap" gap="sm">
                  <Checkbox
                    mt={6}
                    checked={m.selected}
                    onChange={(e) => updateMed(m.id, { selected: e.currentTarget.checked })}
                  />
                  <Stack gap={6} style={{ flex: 1 }}>
                    <Group justify="space-between" wrap="nowrap">
                      <TextInput
                        variant="unstyled"
                        fw={600}
                        style={{ flex: 1 }}
                        value={m.display}
                        onChange={(e) => updateMed(m.id, { display: e.currentTarget.value })}
                      />
                      {m.matchKey ? (
                        <Badge
                          style={{
                            backgroundColor: BADGE_TONES.success.bg,
                            color: BADGE_TONES.success.color,
                            border: `1px solid ${BADGE_TONES.success.border}`,
                          }}
                        >
                          Matched
                        </Badge>
                      ) : (
                        <Badge
                          style={{
                            backgroundColor: BADGE_TONES.neutral.bg,
                            color: BADGE_TONES.neutral.color,
                            border: `1px solid ${BADGE_TONES.neutral.border}`,
                          }}
                        >
                          Unmatched
                        </Badge>
                      )}
                    </Group>
                    <Group grow>
                      <NumberInput
                        size="xs"
                        label="Strength (mg)"
                        value={m.strengthMg}
                        onChange={(v) => updateMed(m.id, { strengthMg: v })}
                      />
                      <NumberInput
                        size="xs"
                        label="Doses per day"
                        value={m.dosesPerDay}
                        onChange={(v) => updateMed(m.id, { dosesPerDay: v })}
                      />
                    </Group>
                    <Text size="xs" c={TEXT_MUTED}>
                      {m.rawText}
                    </Text>
                  </Stack>
                </Group>
              </Card>
            ))}
          </Stack>
          <Button loading={importing} disabled={selectedCount === 0} onClick={() => void handleImport()}>
            Import {selectedCount} medication{selectedCount === 1 ? '' : 's'}
          </Button>
        </>
      )}
    </Stack>
  );
}
