import { Badge, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import type { MedicationRequest } from '@medplum/fhirtypes';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useParams } from 'react-router';

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

  useEffect(() => {
    if (!id) {
      return;
    }
    medplum
      .searchResources('MedicationRequest', { subject: `Patient/${id}` })
      .then(setRequests)
      .catch(() => setRequests([]));
  }, [id, medplum]);

  if (!requests) {
    return <Loader m="md" />;
  }

  return (
    <Stack gap="sm" p="md">
      <Title order={4}>Medications</Title>
      {requests.length === 0 && <Text c="dimmed">No medications on record.</Text>}
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
  );
}
