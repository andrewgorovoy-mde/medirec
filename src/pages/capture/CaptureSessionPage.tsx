import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  Loader,
  NumberInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { Document, useMedplum } from '@medplum/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useParams } from 'react-router';
import { captureVideoFrameToBase64Jpeg } from '../../capture/image';
import { checkMed, getSummary, startSession } from '../../capture/medplumApi';
import type {
  CheckMedResponse,
  MedInput,
  SessionStartResponse,
  SessionSummaryResponse,
  Severity,
} from '../../capture/types';

const SEVERITY_COLOR: Record<Severity, string> = {
  auto: 'gray',
  review: 'yellow',
  must_resolve: 'red',
};

function sessionStorageKey(patientId: string): string {
  return `capture-session:${patientId}`;
}

function VerdictCard({ result }: { result: CheckMedResponse }): JSX.Element {
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>{result.display}</Text>
        <Badge color={SEVERITY_COLOR[result.severity]}>{result.verdict}</Badge>
      </Group>
      {result.ehrSays && (
        <Text size="sm">
          <b>EHR says:</b> {result.ehrSays}
        </Text>
      )}
      {result.homeSays && (
        <Text size="sm">
          <b>Home says:</b> {result.homeSays}
        </Text>
      )}
      {result.evidence.length > 0 && (
        <List size="sm" mt="xs">
          {result.evidence.map((line) => (
            <List.Item key={line}>{line}</List.Item>
          ))}
        </List>
      )}
      {result.suggestedAction && (
        <Text size="sm" mt="xs" fs="italic">
          {result.suggestedAction}
        </Text>
      )}
    </Card>
  );
}

export function CaptureSessionPage(): JSX.Element {
  const { id: patientId } = useParams();
  const medplum = useMedplum();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream>(null);

  const [session, setSession] = useState<SessionStartResponse>();
  const [results, setResults] = useState<CheckMedResponse[]>([]);
  const [summary, setSummary] = useState<SessionSummaryResponse>();
  const [busy, setBusy] = useState<'starting' | 'extracting' | 'summarizing'>();
  const [error, setError] = useState<string>();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ matchKey: '', display: '', strengthMg: '', dosesPerDay: '', rawText: '' });

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }, []);

  // Release the camera if the nurse navigates away mid-capture, not just on Cancel.
  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOpen]);

  async function startCamera() {
    setError(undefined);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      setCameraOpen(true);
    } catch (err) {
      setError(`Could not open camera: ${String(err)}`);
    }
  }

  useEffect(() => {
    if (!patientId) {
      return;
    }
    const key = sessionStorageKey(patientId);
    const stored = sessionStorage.getItem(key);

    if (stored) {
      const parsed = JSON.parse(stored) as SessionStartResponse;
      setSession(parsed);
      getSummary(medplum, parsed.sessionId)
        .then((res) => setResults(res.rows))
        .catch((err) => setError(String(err)));
      return;
    }

    setBusy('starting');
    startSession(medplum, `Patient/${patientId}`)
      .then((res) => {
        sessionStorage.setItem(key, JSON.stringify(res));
        setSession(res);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  async function submitMed(med: MedInput, source: 'label_photo' | 'voice' | 'pill_image', confidence: number) {
    if (!session) {
      return;
    }
    try {
      const verdict = await checkMed(medplum, session.sessionId, med, { source, confidence });
      setResults((prev) => [verdict, ...prev]);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleCapture() {
    if (!videoRef.current) {
      return;
    }
    const image = captureVideoFrameToBase64Jpeg(videoRef.current);
    stopCamera();

    setBusy('extracting');
    setError(undefined);
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      });
      if (!res.ok) {
        throw new Error(`Extraction failed (${res.status})`);
      }
      const { med, confidence } = (await res.json()) as { med: MedInput; confidence: number };
      await submitMed(med, 'label_photo', confidence);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function handleManualSubmit() {
    setBusy('extracting');
    setError(undefined);
    try {
      const med: MedInput = {
        matchKey: manual.matchKey.trim() || null,
        display: manual.display.trim(),
        rawText: manual.rawText.trim(),
        ...(manual.strengthMg ? { strengthMg: Number(manual.strengthMg) } : {}),
        ...(manual.dosesPerDay ? { dosesPerDay: Number(manual.dosesPerDay) } : {}),
      };
      await submitMed(med, 'label_photo', 1);
      setManual({ matchKey: '', display: '', strengthMg: '', dosesPerDay: '', rawText: '' });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function handleFinish() {
    if (!session) {
      return;
    }
    setBusy('summarizing');
    setError(undefined);
    try {
      setSummary(await getSummary(medplum, session.sessionId));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(undefined);
    }
  }

  if (!session) {
    return (
      <Document>
        <Loader />
      </Document>
    );
  }

  return (
    <Document>
      <Title order={3} mb="md">
        Medication Reconciliation — {session.patient.name}
      </Title>

      {error && (
        <Alert color="red" mb="md" onClose={() => setError(undefined)} withCloseButton>
          {error}
        </Alert>
      )}

      <Title order={5} mb="xs">
        What the EHR already believes
      </Title>
      <Stack gap="xs" mb="lg">
        {session.ehrMeds.map((med) => (
          <Card withBorder padding="sm" key={med.matchKey}>
            <Text fw={600}>{med.display}</Text>
            <Text size="sm" c="dimmed">
              {med.strengthMg != null ? `${med.strengthMg} MG` : 'strength unknown'} ·{' '}
              {med.dosesPerDay != null ? `${med.dosesPerDay}x/day` : 'frequency unknown'}
              {med.prescriber ? ` · ${med.prescriber}` : ''}
            </Text>
          </Card>
        ))}
      </Stack>

      <Title order={5} mb="xs">
        Capture a bottle
      </Title>

      {cameraOpen && (
        <Stack gap="xs" mb="md">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', maxWidth: 480, borderRadius: 8, background: '#000' }}
          />
          <Group>
            <Button loading={busy === 'extracting'} onClick={() => void handleCapture()}>
              Capture
            </Button>
            <Button variant="subtle" onClick={stopCamera}>
              Cancel
            </Button>
          </Group>
        </Stack>
      )}

      <Group mb="md">
        <Button loading={busy === 'extracting'} onClick={() => void startCamera()}>
          Take Photo
        </Button>
        <Button variant="subtle" onClick={() => setManualOpen((v) => !v)}>
          {manualOpen ? 'Hide manual entry' : 'Enter manually (testing)'}
        </Button>
        <Button variant="light" loading={busy === 'summarizing'} onClick={() => void handleFinish()}>
          Finish session
        </Button>
      </Group>

      {manualOpen && (
        <Card withBorder padding="sm" mb="lg">
          <Stack gap="xs">
            <TextInput
              label="matchKey (RxNorm ingredient code)"
              placeholder="e.g. 6918"
              value={manual.matchKey}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setManual((m) => ({ ...m, matchKey: value }));
              }}
            />
            <TextInput
              label="Display"
              value={manual.display}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setManual((m) => ({ ...m, display: value }));
              }}
            />
            <Group grow>
              <NumberInput
                label="Strength (mg)"
                value={manual.strengthMg}
                onChange={(v) => setManual((m) => ({ ...m, strengthMg: String(v) }))}
              />
              <NumberInput
                label="Doses per day"
                value={manual.dosesPerDay}
                onChange={(v) => setManual((m) => ({ ...m, dosesPerDay: String(v) }))}
              />
            </Group>
            <TextInput
              label="Raw text"
              value={manual.rawText}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setManual((m) => ({ ...m, rawText: value }));
              }}
            />
            <Button loading={busy === 'extracting'} onClick={() => void handleManualSubmit()}>
              Submit
            </Button>
          </Stack>
        </Card>
      )}

      {results.length > 0 && (
        <>
          <Title order={5} mb="xs">
            Captured so far
          </Title>
          <Stack gap="xs" mb="lg">
            {results.map((r) => (
              <VerdictCard key={r.statementId} result={r} />
            ))}
          </Stack>
        </>
      )}

      {summary && (
        <>
          <Title order={5} mb="xs">
            Session summary
          </Title>
          <Text mb="xs">
            {summary.summary.matched} matched · {summary.summary.needsReview} need review ·{' '}
            {summary.summary.mustResolve} must resolve · {summary.summary.captured} captured total
          </Text>
          {summary.notInHome.length > 0 && (
            <>
              <Text fw={600} mb="xs">
                Never found
              </Text>
              <Stack gap="xs">
                {summary.notInHome.map((entry) => (
                  <Card withBorder padding="sm" key={entry.matchKey}>
                    <Group justify="space-between">
                      <Text fw={600}>{entry.display}</Text>
                      <Badge color={SEVERITY_COLOR[entry.severity]}>NOT_IN_HOME</Badge>
                    </Group>
                    <List size="sm" mt="xs">
                      {entry.evidence.map((line) => (
                        <List.Item key={line}>{line}</List.Item>
                      ))}
                    </List>
                  </Card>
                ))}
              </Stack>
            </>
          )}
        </>
      )}
    </Document>
  );
}
