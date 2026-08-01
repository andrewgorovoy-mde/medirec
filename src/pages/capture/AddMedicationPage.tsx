import { Alert, Button, NumberInput, Select, Stack, TextInput, Title } from '@mantine/core';
import { Document, useMedplum } from '@medplum/react';
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useNavigate, useParams } from 'react-router';
import drugCatalog from '../../capture/drugCatalog.json';

const RXNORM_SYSTEM = 'http://www.nlm.nih.gov/research/umls/rxnorm';

interface DrugCatalogEntry {
  id: string;
  text: string;
  metadata?: Record<string, string>;
}

const CATALOG = drugCatalog as DrugCatalogEntry[];

export function AddMedicationPage(): JSX.Element {
  const { id: patientId } = useParams();
  const medplum = useMedplum();
  const navigate = useNavigate();

  const options = useMemo(
    () => CATALOG.map((d) => ({ value: d.id, label: d.metadata?.generic ?? d.text })),
    []
  );

  const [drugId, setDrugId] = useState<string | null>(null);
  const [strengthMg, setStrengthMg] = useState<string | number>('');
  const [dosesPerDay, setDosesPerDay] = useState<string | number>('');
  const [prescriber, setPrescriber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit() {
    if (!patientId || !drugId) {
      return;
    }
    const entry = CATALOG.find((d) => d.id === drugId);
    if (!entry) {
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const generic = entry.metadata?.generic ?? entry.text;
      const displayText = strengthMg ? `${generic} ${strengthMg} MG` : generic;
      const doseText = dosesPerDay ? `${dosesPerDay}x/day` : undefined;

      await medplum.createResource({
        resourceType: 'MedicationRequest',
        status: 'active',
        intent: 'order',
        subject: { reference: `Patient/${patientId}` },
        medicationCodeableConcept: {
          coding: [
            { system: RXNORM_SYSTEM, code: entry.metadata?.ingredientRxcui ?? entry.id, display: generic },
          ],
          text: displayText,
        },
        dosageInstruction: [
          {
            text: [displayText, doseText].filter(Boolean).join(', '),
            timing: dosesPerDay
              ? { repeat: { frequency: Number(dosesPerDay), period: 1, periodUnit: 'd' } }
              : undefined,
            doseAndRate: strengthMg ? [{ doseQuantity: { value: Number(strengthMg), unit: 'mg' } }] : undefined,
          },
        ],
        requester: prescriber.trim() ? { display: prescriber.trim() } : undefined,
      });

      await navigate(`/Patient/${patientId}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Document>
      <Title order={3} mb="md">
        Add Intended Medication
      </Title>
      <Stack gap="sm" maw={420}>
        {error && (
          <Alert color="red" onClose={() => setError(undefined)} withCloseButton>
            {error}
          </Alert>
        )}
        <Select
          label="Medication"
          placeholder="Search by name..."
          data={options}
          searchable
          value={drugId}
          onChange={setDrugId}
        />
        <NumberInput label="Strength (mg)" value={strengthMg} onChange={setStrengthMg} />
        <NumberInput label="Doses per day" value={dosesPerDay} onChange={setDosesPerDay} />
        <TextInput
          label="Prescriber"
          value={prescriber}
          onChange={(e) => setPrescriber(e.currentTarget.value)}
        />
        <Button loading={busy} disabled={!drugId} onClick={() => void handleSubmit()}>
          Add Medication
        </Button>
      </Stack>
    </Document>
  );
}
