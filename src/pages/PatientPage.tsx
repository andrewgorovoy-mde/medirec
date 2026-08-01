// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Badge, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { calculateAge, formatHumanName, getReferenceString } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { useResource } from '@medplum/react';
import { IconArrowLeft } from '@tabler/icons-react';
import { Fragment } from 'react';
import type { JSX } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { BADGE_TONES, BORDER, TEXT_MUTED } from '../theme/tokens';

const TAB_VALUES = ['overview', 'medications', 'timeline', 'history'];

export function PatientPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const patient = useResource<Patient>({ reference: `Patient/${id}` });
  if (!patient) {
    return <Loader m="md" />;
  }

  const currentTab = location.pathname.split('/')[3];
  const activeTab = TAB_VALUES.includes(currentTab) ? currentTab : 'overview';

  const tone = patient.active === false ? BADGE_TONES.neutral : BADGE_TONES.success;
  const details = [
    patient.gender,
    patient.birthDate ? `${calculateAge(patient.birthDate).years} years` : undefined,
    patient.birthDate,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Fragment key={getReferenceString(patient)}>
      <Stack gap="md" p="md" pb={0}>
        <Group gap={6}>
          <IconArrowLeft size={16} />
          <Text
            component={Link}
            to="/"
            size="sm"
            fw={500}
            c={TEXT_MUTED}
            style={{ textDecoration: 'none' }}
          >
            Back to patients
          </Text>
        </Group>

        <div style={{ background: 'white', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 20 }}>
          <Group gap="xs">
            <Title order={3}>{formatHumanName(patient.name?.[0]) || 'Unnamed Patient'}</Title>
            <Badge style={{ backgroundColor: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }}>
              {patient.active === false ? 'Inactive' : 'Active'}
            </Badge>
          </Group>
          {details && (
            <Text size="sm" c={TEXT_MUTED} mt={4} style={{ textTransform: 'capitalize' }}>
              {details}
            </Text>
          )}
        </div>

        <Tabs
          variant="pills"
          radius="md"
          value={activeTab}
          onChange={(t) => navigate(`./${t}`)?.catch(console.error)}
        >
          <Tabs.List
            style={{
              flexWrap: 'nowrap',
              overflowX: 'auto',
              background: '#EEF2F6',
              padding: 4,
              borderRadius: 8,
              display: 'inline-flex',
            }}
          >
            <Tabs.Tab value="overview">Overview</Tabs.Tab>
            <Tabs.Tab value="medications">Medications</Tabs.Tab>
            <Tabs.Tab value="timeline">Timeline</Tabs.Tab>
            <Tabs.Tab value="history">History</Tabs.Tab>
          </Tabs.List>
        </Tabs>
      </Stack>
      <Outlet />
    </Fragment>
  );
}
