import { Alert, Button, Loader, Stack, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import type { JSX } from 'react';
import { useParams } from 'react-router';
import { verifySurveyIdentity } from '../../survey/api';
import { BRAND_PURPLE, TEXT_MUTED } from '../../theme/tokens';
import { PersistentVoiceAgent } from '../../voice/PersistentVoiceAgent';

// Unauthenticated, full-screen patient page — no sidebar, no Medplum login, no direct Medplum
// calls (only fetch('/api/survey') and, once verified, the Deepgram voice agent's own
// fetch('/api/deepgram/token')). See the plan's access-control note: a bare id in a URL is a
// bearer credential, so this DOB check is the minimum gate before anything patient-specific is
// shown or (eventually) written.
export function PatientSurveyPage(): JSX.Element {
  const { id } = useParams();
  const [verified, setVerified] = useState(false);
  const [dob, setDob] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();

  async function handleVerify(): Promise<void> {
    if (!id || !dob) {
      return;
    }
    setChecking(true);
    setError(undefined);
    try {
      const ok = await verifySurveyIdentity(id, dob);
      if (ok) {
        setVerified(true);
      } else {
        setError("That doesn't match our records — please try again.");
      }
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setChecking(false);
    }
  }

  if (!id) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Loader />
      </div>
    );
  }

  if (verified) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#F6F8FB' }}>
        <Title order={3} ta="center" pt={32} style={{ color: BRAND_PURPLE }}>
          TraceBack Check-In
        </Title>
        <PersistentVoiceAgent responseId={id} />
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#F6F8FB',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <Stack gap="md" maw={400} w="100%" align="center" style={{ textAlign: 'center' }}>
        <Title order={2} style={{ color: BRAND_PURPLE }}>
          TraceBack Check-In
        </Title>
        <Text c={TEXT_MUTED}>Your care team invited you to complete a quick check-in. Confirm your date of birth to continue.</Text>
        {error && (
          <Alert color="red" w="100%" onClose={() => setError(undefined)} withCloseButton>
            {error}
          </Alert>
        )}
        <TextInput
          type="date"
          label="Date of birth"
          value={dob}
          onChange={(e) => setDob(e.currentTarget.value)}
          w="100%"
        />
        <Button fullWidth loading={checking} disabled={!dob} onClick={() => void handleVerify()}>
          Continue
        </Button>
      </Stack>
    </div>
  );
}
