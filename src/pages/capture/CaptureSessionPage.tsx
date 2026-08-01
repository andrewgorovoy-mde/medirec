import { ActionIcon, Alert, Button, Card, Group, Loader, NumberInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import { IconArrowLeft, IconCamera, IconCheck, IconPrinter, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useNavigate, useParams } from 'react-router';
import { captureVideoFrameToBase64Jpeg } from '../../capture/image';
import { checkMed, getSummary, startSession } from '../../capture/medplumApi';
import type { CheckMedResponse, MedInput, SessionStartResponse, SessionSummaryResponse } from '../../capture/types';
import { VerdictCard } from '../../components/VerdictCard';
import { SessionReport } from '../../components/SessionReport';

// Print rules for the "Generate Report" button below — only .reconciliation-report (rendered by
// SessionReport) survives to the printed/PDF page, breaking out of this page's fixed full-screen
// layout so it prints as a normal flowing document instead of a single clipped viewport.
const PRINT_STYLES = `
  @media print {
    body * { visibility: hidden; }
    .reconciliation-report, .reconciliation-report * { visibility: visible; }
    .reconciliation-report { position: absolute; top: 0; left: 0; width: 100%; }
  }
`;

const TOP_BAR_HEIGHT = 56;
const BOTTOM_BAR_HEIGHT = 84;

interface QueueItem {
  id: string;
  thumbnail: string; // base64 JPEG, no data: prefix
  status: 'queued' | 'processing' | 'done' | 'error';
  verdict?: CheckMedResponse;
  errorMessage?: string;
}

function sessionStorageKey(patientId: string): string {
  return `capture-session:${patientId}`;
}

function newId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function QueueThumb({ item }: { item: QueueItem }): JSX.Element {
  const border =
    item.status === 'done'
      ? '#2F7A4C'
      : item.status === 'error'
        ? '#B03052'
        : item.status === 'processing'
          ? '#43205F'
          : '#CCDCE9';
  return (
    <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
      <img
        src={`data:image/jpeg;base64,${item.thumbnail}`}
        alt=""
        style={{
          width: 56,
          height: 56,
          objectFit: 'cover',
          borderRadius: 8,
          border: `2px solid ${border}`,
        }}
      />
      {item.status === 'processing' && (
        <Loader size={16} style={{ position: 'absolute', inset: 0, margin: 'auto' }} />
      )}
      {item.status === 'done' && (
        <IconCheck
          size={16}
          color="white"
          style={{ position: 'absolute', bottom: -4, right: -4, background: '#2F7A4C', borderRadius: '50%', padding: 2 }}
        />
      )}
      {item.status === 'error' && (
        <IconX
          size={16}
          color="white"
          style={{ position: 'absolute', bottom: -4, right: -4, background: '#B03052', borderRadius: '50%', padding: 2 }}
        />
      )}
    </div>
  );
}

export function CaptureSessionPage(): JSX.Element {
  const { id: patientId } = useParams();
  const medplum = useMedplum();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream>(null);
  const processingRef = useRef(false);

  const [session, setSession] = useState<SessionStartResponse>();
  const [results, setResults] = useState<CheckMedResponse[]>([]);
  const [summary, setSummary] = useState<SessionSummaryResponse>();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState<'starting' | 'summarizing'>();
  const [error, setError] = useState<string>();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manual, setManual] = useState({ matchKey: '', display: '', strengthMg: '', dosesPerDay: '', rawText: '' });

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }, []);

  // Release the camera if the nurse navigates away mid-capture, not just via Done.
  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOpen]);

  async function startCamera(): Promise<void> {
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

  // Sequential background worker: picks up the next queued photo and processes it
  // (extract -> checkMed) without blocking the live camera view, so the nurse can keep
  // snapping bottles while earlier ones are still being read.
  useEffect(() => {
    if (processingRef.current || !session) {
      return;
    }
    const next = queue.find((item) => item.status === 'queued');
    if (!next) {
      return;
    }
    processingRef.current = true;
    setQueue((q) => q.map((it) => (it.id === next.id ? { ...it, status: 'processing' } : it)));

    void (async () => {
      try {
        const res = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: next.thumbnail }),
        });
        if (!res.ok) {
          throw new Error(`Extraction failed (${res.status})`);
        }
        const { med, confidence } = (await res.json()) as { med: MedInput; confidence: number };
        const verdict = await checkMed(medplum, session.sessionId, med, { source: 'label_photo', confidence });
        setQueue((q) => q.map((it) => (it.id === next.id ? { ...it, status: 'done', verdict } : it)));
        setResults((prev) => [verdict, ...prev]);
      } catch (err) {
        setQueue((q) =>
          q.map((it) => (it.id === next.id ? { ...it, status: 'error', errorMessage: String(err) } : it))
        );
      } finally {
        processingRef.current = false;
      }
    })();
  }, [queue, session, medplum]);

  function handleCapture(): void {
    if (!videoRef.current) {
      return;
    }
    const thumbnail = captureVideoFrameToBase64Jpeg(videoRef.current);
    setQueue((q) => [...q, { id: newId(), thumbnail, status: 'queued' }]);
  }

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

  async function handleManualSubmit() {
    setManualBusy(true);
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
      setManualBusy(false);
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Loader />
      </div>
    );
  }

  const pendingCount = queue.filter((q) => q.status === 'queued' || q.status === 'processing').length;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#F6F8FB', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          height: TOP_BAR_HEIGHT,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          background: 'white',
          borderBottom: '1px solid #DCE4EC',
          zIndex: 2,
        }}
      >
        <ActionIcon variant="subtle" color="gray" onClick={() => navigate(`/Patient/${patientId}`)} aria-label="Back">
          <IconArrowLeft size={20} />
        </ActionIcon>
        <Text fw={600} size="sm" style={{ flex: 1 }} truncate>
          Reconciliation — {session.patient.name}
        </Text>
        <Button size="xs" variant="light" loading={busy === 'summarizing'} onClick={() => void handleFinish()}>
          Finish
        </Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {error && (
          <Alert color="red" mb="md" onClose={() => setError(undefined)} withCloseButton>
            {error}
          </Alert>
        )}

        {cameraOpen && (
          <Stack gap="xs" mb="md">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: '50vh', objectFit: 'cover' }}
            />
            {queue.length > 0 && (
              <Group gap={6} wrap="nowrap" style={{ overflowX: 'auto' }}>
                {queue.map((item) => (
                  <QueueThumb key={item.id} item={item} />
                ))}
              </Group>
            )}
          </Stack>
        )}

        <Title order={5} mb="xs">
          Currently prescribed
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
              <Button loading={manualBusy} onClick={() => void handleManualSubmit()}>
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
            <Group justify="space-between" mb="xs">
              <Title order={5}>Session summary</Title>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPrinter size={14} />}
                onClick={() => window.print()}
              >
                Generate Report
              </Button>
            </Group>
            <SessionReport summary={summary} />
          </>
        )}
      </div>
      <style>{PRINT_STYLES}</style>

      <div
        style={{
          height: BOTTOM_BAR_HEIGHT,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: 'white',
          borderTop: '1px solid #DCE4EC',
          zIndex: 2,
        }}
      >
        {cameraOpen ? (
          <>
            <ActionIcon
              size={64}
              radius="xl"
              onClick={handleCapture}
              style={{ backgroundColor: '#43205F' }}
              aria-label="Capture"
            >
              <IconCamera size={28} />
            </ActionIcon>
            <Button variant="subtle" onClick={stopCamera}>
              Done{pendingCount > 0 ? ` (${pendingCount} processing)` : ''}
            </Button>
          </>
        ) : (
          <>
            <Button leftSection={<IconCamera size={16} />} onClick={() => void startCamera()}>
              Take Photo
            </Button>
            <Button variant="subtle" onClick={() => setManualOpen((v) => !v)}>
              {manualOpen ? 'Hide manual entry' : 'Enter manually'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
