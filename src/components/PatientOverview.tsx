// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Card, Group, Modal, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { ResourceTable, useMedplum } from '@medplum/react';
import type { QuestionnaireResponse } from '@medplum/fhirtypes';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Link, useParams } from 'react-router';
import { listSurveySessions, startInitialSurvey } from '../survey/api';
import { BORDER, TEXT_MUTED } from '../theme/tokens';
import { PatientCoverage } from './PatientCoverage';
import { PatientStatCards } from './PatientStatCards';

function SurveyLinkModal({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  function handleCopy(): void {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Modal opened onClose={onClose} title="Initial survey link" centered>
      <Stack gap="sm">
        <Text size="sm" c={TEXT_MUTED}>
          Share this link with the patient — opening it does not require a Medplum login.
        </Text>
        <Group gap="xs" wrap="nowrap">
          <TextInput value={url} readOnly style={{ flex: 1 }} />
          <Button
            variant="light"
            leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            onClick={handleCopy}
          >
            {copied ? 'Copied' : 'Copy Link'}
          </Button>
        </Group>
        <Group gap="xs">
          <Tooltip label="Coming soon">
            <Button variant="default" disabled style={{ flex: 1 }}>
              Send via Text
            </Button>
          </Tooltip>
          <Tooltip label="Coming soon">
            <Button variant="default" disabled style={{ flex: 1 }}>
              Send via Email
            </Button>
          </Tooltip>
        </Group>
      </Stack>
    </Modal>
  );
}

export function PatientOverview(): JSX.Element {
  const { id } = useParams();
  const medplum = useMedplum();
  const [sessions, setSessions] = useState<QuestionnaireResponse[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [linkUrl, setLinkUrl] = useState<string>();

  useEffect(() => {
    if (!id) {
      return;
    }
    listSurveySessions(medplum, id)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [id, medplum]);

  async function handleStartSurvey(): Promise<void> {
    if (!id) {
      return;
    }
    setStarting(true);
    setError(undefined);
    try {
      const { url } = await startInitialSurvey(medplum, id);
      setLinkUrl(url);
      setSessions(await listSurveySessions(medplum, id));
    } catch (err) {
      setError(String(err));
    } finally {
      setStarting(false);
    }
  }

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
        <Button variant="default" loading={starting} onClick={() => void handleStartSurvey()}>
          Start Initial Survey
        </Button>
      </Group>
      {error && (
        <Alert color="red" onClose={() => setError(undefined)} withCloseButton>
          {error}
        </Alert>
      )}
      <PatientStatCards />
      <PatientCoverage />
      {sessions.length > 0 && (
        <Card withBorder padding="sm" style={{ borderColor: BORDER }}>
          <Text fw={600} size="sm" mb="xs">
            Survey links sent
          </Text>
          <Stack gap="xs">
            {sessions.map((s) => (
              <Group key={s.id} justify="space-between" wrap="nowrap">
                <Text size="sm" c={TEXT_MUTED}>
                  {s.authored ? new Date(s.authored).toLocaleString() : 'Unknown date'} — {s.status}
                </Text>
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<IconCopy size={14} />}
                  onClick={() => setLinkUrl(`${window.location.origin}/survey/${s.id}`)}
                >
                  View Link
                </Button>
              </Group>
            ))}
          </Stack>
        </Card>
      )}
      <div style={{ background: 'white', border: '1px solid #DCE4EC', borderRadius: 8, padding: 20 }}>
        <ResourceTable value={{ reference: `Patient/${id}` }} />
      </div>
      {linkUrl && <SurveyLinkModal url={linkUrl} onClose={() => setLinkUrl(undefined)} />}
    </Stack>
  );
}
