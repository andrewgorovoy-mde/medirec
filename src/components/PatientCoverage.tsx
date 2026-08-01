import { Badge, Card, Group, Text, Title } from '@mantine/core';
import type { Coverage } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconShieldCheck } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useParams } from 'react-router';
import { BADGE_TONES } from '../theme/tokens';

export function PatientCoverage(): JSX.Element | null {
  const { id } = useParams();
  const medplum = useMedplum();
  const [coverages, setCoverages] = useState<Coverage[]>();

  useEffect(() => {
    if (!id) {
      return;
    }
    medplum
      .searchResources('Coverage', { beneficiary: `Patient/${id}` })
      .then((results) => setCoverages([...results].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))))
      .catch((err) => {
        console.warn('Coverage search failed:', err);
        setCoverages([]);
      });
  }, [id, medplum]);

  if (!coverages || coverages.length === 0) {
    return null;
  }

  return (
    <div>
      <Title order={5} mb="xs">
        Insurance Coverage
      </Title>
      <Group gap="sm" align="stretch" wrap="wrap">
        {coverages.map((coverage) => {
          const tone = coverage.order === 1 ? BADGE_TONES.info : BADGE_TONES.neutral;
          return (
            <Card key={coverage.id} withBorder padding="sm" style={{ minWidth: 220, flex: '1 1 220px' }}>
              <Group justify="space-between">
                <Group gap={6}>
                  <IconShieldCheck size={16} />
                  <Text fw={600}>{coverage.payor?.[0]?.display ?? 'Unknown payer'}</Text>
                </Group>
                <Badge style={{ backgroundColor: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }}>
                  {coverage.order === 1 ? 'Primary' : coverage.order === 2 ? 'Secondary' : 'Coverage'}
                </Badge>
              </Group>
              {coverage.class?.[0]?.name && (
                <Text size="sm" c="dimmed">
                  {coverage.class[0].name}
                </Text>
              )}
              {coverage.subscriberId && (
                <Text size="sm" c="dimmed">
                  Member ID {coverage.subscriberId}
                </Text>
              )}
            </Card>
          );
        })}
      </Group>
    </div>
  );
}
