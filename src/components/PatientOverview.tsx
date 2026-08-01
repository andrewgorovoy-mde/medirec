// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Group, Title } from '@mantine/core';
import { Document, ResourceTable } from '@medplum/react';
import type { JSX } from 'react';
import { Link, useParams } from 'react-router';

/*
 * You can combine Medplum components with plain HTML to quickly display patient data.
 * Medplum has out of the box components to render common data types such as
 *   - Addresses
 *   - Phone numbers
 *   - Patient/Provider names
 *   - Patient/Provider profile photo
 * */
export function PatientOverview(): JSX.Element {
  const { id } = useParams();
  return (
    <Document>
      <Group justify="space-between" mb="xl">
        <Title order={3}>Patient Overview</Title>
        <Group>
          <Button variant="light" component={Link} to={`/Patient/${id}/MedicationRequest/new`}>
            Add Intended Medication
          </Button>
          <Button component={Link} to={`/Patient/${id}/capture`}>
            Start Reconciliation
          </Button>
        </Group>
      </Group>
      <ResourceTable value={{ reference: `Patient/${id}` }} />
    </Document>
  );
}
