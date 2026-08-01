// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Group, Stack } from '@mantine/core';
import { ResourceTable } from '@medplum/react';
import type { JSX } from 'react';
import { Link, useParams } from 'react-router';
import { PatientCoverage } from './PatientCoverage';
import { PatientStatCards } from './PatientStatCards';

export function PatientOverview(): JSX.Element {
  const { id } = useParams();
  return (
    <Stack gap="lg" p="md">
      <Group justify="flex-end">
        <Button variant="default" component={Link} to={`/Patient/${id}/MedicationRequest/import`}>
          Upload Medication List (PDF)
        </Button>
        <Button variant="default" component={Link} to={`/Patient/${id}/MedicationRequest/new`}>
          Add Intended Medication
        </Button>
        <Button component={Link} to={`/Patient/${id}/capture`}>
          Start Reconciliation
        </Button>
      </Group>
      <PatientStatCards />
      <PatientCoverage />
      <div style={{ background: 'white', border: '1px solid #DCE4EC', borderRadius: 8, padding: 20 }}>
        <ResourceTable value={{ reference: `Patient/${id}` }} />
      </div>
    </Stack>
  );
}
