import { SimpleGrid, Text } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import { IconClipboardList, IconClockHour4, IconPill } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { ComponentType, JSX } from 'react';
import { useParams } from 'react-router';
import type { StatAccent } from '../theme/tokens';
import { STAT_ACCENTS } from '../theme/tokens';

interface StatCardProps {
  label: string;
  value: string;
  icon: ComponentType<{ size?: number }>;
  accent: StatAccent;
}

function StatCard({ label, value, icon: Icon, accent }: StatCardProps): JSX.Element {
  return (
    <div
      style={{
        background: accent.bg,
        border: '1px solid #DCE6F0',
        borderTop: `2px solid ${accent.border}`,
        borderRadius: 8,
        padding: '16px 20px',
      }}
    >
      <Text size="sm" fw={600} c={accent.text} mb={6}>
        <Icon size={16} /> <span style={{ verticalAlign: 'middle' }}>{label}</span>
      </Text>
      <Text size="xl" fw={700}>
        {value}
      </Text>
    </div>
  );
}

export function PatientStatCards(): JSX.Element {
  const { id } = useParams();
  const medplum = useMedplum();
  const [activeMeds, setActiveMeds] = useState<number>();
  const [sessions, setSessions] = useState<number>();
  const [lastSession, setLastSession] = useState<string>();

  useEffect(() => {
    if (!id) {
      return;
    }
    const patientRef = `Patient/${id}`;
    medplum
      .searchResources('MedicationRequest', { subject: patientRef, status: 'active' })
      .then((res) => setActiveMeds(res.length))
      .catch(() => setActiveMeds(0));
    medplum
      .searchResources('Encounter', { subject: patientRef, _sort: '-_lastUpdated' })
      .then((res) => {
        setSessions(res.length);
        const latest = res[0]?.meta?.lastUpdated;
        setLastSession(latest ? new Date(latest).toLocaleDateString() : 'Never');
      })
      .catch(() => {
        setSessions(0);
        setLastSession('Never');
      });
  }, [id, medplum]);

  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
      <StatCard
        label="Active Medications"
        value={activeMeds != null ? String(activeMeds) : '—'}
        icon={IconPill}
        accent={STAT_ACCENTS.blue}
      />
      <StatCard
        label="Reconciliation Sessions"
        value={sessions != null ? String(sessions) : '—'}
        icon={IconClipboardList}
        accent={STAT_ACCENTS.purple}
      />
      <StatCard
        label="Last Reconciliation"
        value={lastSession ?? '—'}
        icon={IconClockHour4}
        accent={STAT_ACCENTS.green}
      />
    </SimpleGrid>
  );
}
