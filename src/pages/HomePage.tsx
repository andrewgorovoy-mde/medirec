import { Badge, Button, Group, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { calculateAge, formatHumanName } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Link, useNavigate } from 'react-router';
import { BADGE_TONES, BORDER, TEXT_MUTED } from '../theme/tokens';

export function HomePage(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const [patients, setPatients] = useState<Patient[]>();
  const [query, setQuery] = useState('');

  useEffect(() => {
    medplum
      .searchResources('Patient', { _sort: '-_lastUpdated' })
      .then(setPatients)
      .catch(() => setPatients([]));
  }, [medplum]);

  const filtered = useMemo(() => {
    if (!patients) {
      return undefined;
    }
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return patients;
    }
    return patients.filter((p) => formatHumanName(p.name?.[0]).toLowerCase().includes(needle));
  }, [patients, query]);

  return (
    <Stack gap="lg" p="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>Patients</Title>
          <Text c={TEXT_MUTED} size="sm">
            FHIR-connected patient records
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} component={Link} to="/Patient/new">
          Create Patient
        </Button>
      </Group>

      <TextInput
        placeholder="Search by name..."
        leftSection={<IconSearch size={16} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        maw={360}
      />

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', background: 'white' }}>
        <Table verticalSpacing="sm" horizontalSpacing="lg" style={{ minWidth: 480 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ color: TEXT_MUTED, textTransform: 'uppercase', fontSize: 12 }}>Name</Table.Th>
              <Table.Th style={{ color: TEXT_MUTED, textTransform: 'uppercase', fontSize: 12 }}>Age</Table.Th>
              <Table.Th style={{ color: TEXT_MUTED, textTransform: 'uppercase', fontSize: 12 }}>Gender</Table.Th>
              <Table.Th style={{ color: TEXT_MUTED, textTransform: 'uppercase', fontSize: 12 }}>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered?.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text c={TEXT_MUTED} ta="center" py="md">
                    No patients found.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {filtered?.map((patient) => {
              const tone = patient.active === false ? BADGE_TONES.neutral : BADGE_TONES.success;
              return (
                <Table.Tr
                  key={patient.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/Patient/${patient.id}`)}
                >
                  <Table.Td style={{ fontWeight: 600 }}>{formatHumanName(patient.name?.[0]) || 'Unnamed'}</Table.Td>
                  <Table.Td>{patient.birthDate ? `${calculateAge(patient.birthDate).years}` : '—'}</Table.Td>
                  <Table.Td style={{ textTransform: 'capitalize' }}>{patient.gender ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge
                      style={{ backgroundColor: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }}
                    >
                      {patient.active === false ? 'Inactive' : 'Active'}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </div>
    </Stack>
  );
}
