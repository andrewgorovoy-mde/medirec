import { Badge, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import type { CheckMedResponse } from '../capture/types';
import type { MedicationRequest } from '@medplum/fhirtypes';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useParams } from 'react-router';
import { parseMedicationStatementVerdict } from '../capture/realFhir';
import { VerdictCard } from './VerdictCard';

function medDisplay(req: MedicationRequest): string {
  return (
    req.medicationCodeableConcept?.text ?? req.medicationCodeableConcept?.coding?.[0]?.display ?? 'Unknown medication'
  );
}

function doseSummary(req: MedicationRequest): string {
  const dosage = req.dosageInstruction?.[0];
  if (dosage?.text) {
    return dosage.text;
  }
  const doseQty = dosage?.doseAndRate?.[0]?.doseQuantity;
  const frequency = dosage?.timing?.repeat?.frequency;
  const parts: string[] = [];
  if (doseQty?.value != null) {
    parts.push(`${doseQty.value}${doseQty.unit ? ` ${doseQty.unit}` : ''}`);
  }
  if (frequency != null) {
    parts.push(`${frequency}x/day`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Dose unknown';
}

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  completed: 'gray',
  stopped: 'red',
  'entered-in-error': 'red',
  cancelled: 'gray',
};

export function PatientMedications(): JSX.Element {
  const { id } = useParams();
  const medplum = useMedplum();
  const [requests, setRequests] = useState<MedicationRequest[]>();
  const [history, setHistory] = useState<CheckMedResponse[]>();

  useEffect(() => {
    if (!id) {
      return;
    }
    const patientRef = `Patient/${id}`;
    medplum
      .searchResources('MedicationRequest', { subject: patientRef })
      .then(setRequests)
      .catch(() => setRequests([]));

    // Every capture from every reconciliation session, newest first — this is what makes the
    // tab a "master list": it reflects the latest home-verified state, not just what was intended.
    medplum
      .searchResources('MedicationStatement', { subject: patientRef, _sort: '-_lastUpdated' })
      .then((statements) => {
        const rows = statements
          .map(parseMedicationStatementVerdict)
          .filter((r): r is { row: CheckMedResponse; lastUpdated: string | undefined } => r !== null)
          .sort((a, b) => (b.lastUpdated ?? '').localeCompare(a.lastUpdated ?? ''))
          .map((r) => r.row);
        setHistory(rows);
      })
      .catch(() => setHistory([]));
  }, [id, medplum]);

  if (!requests) {
    return <Loader m="md" />;
  }

  return (
    <Stack gap="lg" p="md">
      <div>
        <Title order={4} mb="sm">
          Intended Medications
        </Title>
        {requests.length === 0 && <Text c="dimmed">No medications on record.</Text>}
        <Stack gap="sm">
          {requests.map((req) => (
            <Card withBorder key={req.id} padding="sm">
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Text fw={600}>{medDisplay(req)}</Text>
                <Badge color={STATUS_COLOR[req.status] ?? 'gray'}>{req.status}</Badge>
              </Group>
              <Text size="sm" c="dimmed">
                {doseSummary(req)}
              </Text>
              {req.requester?.display && (
                <Text size="sm" c="dimmed">
                  Prescribed by {req.requester.display}
                </Text>
              )}
            </Card>
          ))}
        </Stack>
      </div>

      {history && history.length > 0 && (
        <div>
          <Title order={4} mb="sm">
            Reconciliation History
          </Title>
          <Text size="sm" c="dimmed" mb="sm">
            Every medication captured during a home visit, across all reconciliation sessions.
          </Text>
          <Stack gap="sm">
            {history.map((row) => (
              <VerdictCard key={row.statementId} result={row} />
            ))}
          </Stack>
        </div>
      )}
    </Stack>
  );
}
