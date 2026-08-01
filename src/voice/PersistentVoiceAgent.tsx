import { init } from '@deepgram/agents-widget';
import type { AgentSettingsObject } from '@deepgram/agents';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';

const BILINGUAL_GREETING =
  'Hello! I can help you review your medications. You can speak in English or Spanish. Hola, puedo ayudarle a revisar sus medicamentos. Puede hablar en inglés o español.';

const PROMPT = `
You are a multilingual medication-reconciliation voice assistant used for a prototype demonstration.

Match the language of each user message independently.
Support English and Spanish.
If the user changes languages, respond in the language they just used.
Keep responses short and conversational.

For this initial test:
- Do not diagnose.
- Do not recommend starting, stopping, or changing medications.
- Do not claim that a medication has been identified.
- Do not call the computer-vision endpoint yet.
- Do not read or write FHIR resources.
- Tell users that this is a prototype when appropriate.
- Use only synthetic demonstration information.

You may ask simple questions such as:
- What language would you prefer?
- What would you like help with?
- Would you like to scan a medication?
`.trim();

type VoiceAgentStatus = 'available' | 'connecting' | 'listening' | 'speaking' | 'muted' | 'error';

type FluxMultilingualListenProvider = {
  type: 'deepgram';
  version: 'v2';
  model: 'flux-general-multi';
  language_hints: ['en', 'es'];
};

type MultilingualAgentSettings = AgentSettingsObject & {
  listen: {
    provider: FluxMultilingualListenProvider;
  };
};

interface DeepgramTokenPayload {
  accessToken?: unknown;
  access_token?: unknown;
  token?: unknown;
}

const AGENT_CONFIG: MultilingualAgentSettings = {
  listen: {
    provider: {
      type: 'deepgram',
      version: 'v2',
      model: 'flux-general-multi',
      language_hints: ['en', 'es'],
    },
  },
  think: {
    provider: {
      type: 'open_ai',
      model: 'gpt-4o-mini',
    },
    prompt: PROMPT,
  },
  speak: {
    provider: {
      type: 'deepgram',
      model: 'aura-2-javier-es',
    },
  },
  greeting: BILINGUAL_GREETING,
};

const STATUS_LABEL: Record<VoiceAgentStatus, string> = {
  available: 'Available',
  connecting: 'Connecting',
  listening: 'Listening',
  speaking: 'Speaking',
  muted: 'Muted',
  error: 'Error',
};

function extractTokenFromText(text: string, contentType: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Deepgram token response was empty');
  }

  if (contentType.includes('application/json')) {
    const payload = JSON.parse(trimmed) as DeepgramTokenPayload;
    const token = payload.accessToken ?? payload.access_token ?? payload.token;
    if (typeof token !== 'string' || !token.trim()) {
      throw new Error('Deepgram token response did not include accessToken');
    }
    return token.trim();
  }

  return trimmed;
}

async function fetchDeepgramToken(): Promise<string> {
  const response = await fetch('/api/deepgram/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const text = await response.text();

  if (!response.ok) {
    let detail = '';
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      detail = typeof parsed.error === 'string' ? `: ${parsed.error}` : '';
    } catch {
      detail = text.trim() ? `: ${text.trim()}` : '';
    }
    throw new Error(`Deepgram token request failed (${response.status})${detail}`);
  }

  return extractTokenFromText(text, response.headers.get('Content-Type') ?? '');
}

function hasMicIcon(button: HTMLButtonElement): boolean {
  return Boolean(button.querySelector('svg path[d^="M12 2a3"]'));
}

function hasSpeakerIcon(button: HTMLButtonElement): boolean {
  return Boolean(button.querySelector('svg polygon[points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"]'));
}

function hasMutedMicIcon(button: HTMLButtonElement): boolean {
  return Boolean(button.querySelector('svg line[x1="2"][x2="22"][y1="2"][y2="22"]'));
}

function hasMutedSpeakerIcon(button: HTMLButtonElement): boolean {
  return Boolean(button.querySelector('svg line[x1="22"][x2="16"][y1="9"][y2="15"]'));
}

function applyWidgetAccessibilityLabels(): boolean {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-dg-agent]'));
  const root = roots.at(-1);
  if (!root) {
    return false;
  }

  let micMuted = false;
  const controls = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
  for (const button of controls) {
    if (hasMicIcon(button)) {
      micMuted = hasMutedMicIcon(button);
      button.setAttribute('aria-label', micMuted ? 'Unmute microphone' : 'Mute microphone');
    } else if (hasSpeakerIcon(button)) {
      const speakerMuted = hasMutedSpeakerIcon(button);
      button.setAttribute('aria-label', speakerMuted ? 'Unmute speaker audio' : 'Mute speaker audio');
    }
  }

  const textInput = root.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  textInput?.setAttribute('aria-label', 'Voice agent text input');

  return micMuted;
}

function displayStatus(status: Exclude<VoiceAgentStatus, 'muted'>, micMuted: boolean): VoiceAgentStatus {
  if (status === 'error') {
    return 'error';
  }
  return micMuted && (status === 'listening' || status === 'speaking') ? 'muted' : status;
}

const panelStyle = {
  position: 'fixed',
  right: 24,
  bottom: 92,
  zIndex: 9998,
  width: 300,
  maxWidth: 'calc(100vw - 32px)',
  padding: 12,
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: 8,
  background: 'rgba(255, 255, 255, 0.96)',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.16)',
  color: '#111827',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  pointerEvents: 'auto',
} satisfies CSSProperties;

const titleStyle = {
  margin: 0,
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.35,
} satisfies CSSProperties;

const statusStyle = {
  marginTop: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 12,
} satisfies CSSProperties;

const chipsStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 10,
} satisfies CSSProperties;

const detailStyle = {
  margin: '8px 0 0',
  color: '#b42318',
  fontSize: 12,
  lineHeight: 1.35,
} satisfies CSSProperties;

export function PersistentVoiceAgent(): JSX.Element | null {
  const [status, setStatus] = useState<Exclude<VoiceAgentStatus, 'muted'>>('available');
  const [micMuted, setMicMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const speakingTimer = useRef<number | undefined>(undefined);

  const renderedStatus = displayStatus(status, micMuted);

  const tokenFactory = useMemo(() => {
    return async () => {
      setStatus('connecting');
      setErrorMessage(undefined);
      try {
        return await fetchDeepgramToken();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Deepgram token request failed';
        setStatus('error');
        setErrorMessage(message);
        throw err;
      }
    };
  }, []);

  useEffect(() => {
    const clearSpeakingTimer = () => {
      if (speakingTimer.current) {
        window.clearTimeout(speakingTimer.current);
        speakingTimer.current = undefined;
      }
    };

    const markSpeaking = () => {
      clearSpeakingTimer();
      setStatus('speaking');
      speakingTimer.current = window.setTimeout(() => setStatus('listening'), 5000);
    };

    const refreshAccessibility = () => {
      setMicMuted(applyWidgetAccessibilityLabels());
    };

    const destroy = init({
      tokenFactory,
      agent: AGENT_CONFIG,
      layout: 'floating',
      placement: 'bottom-right',
      defaultOpen: true,
      dismissible: true,
      showTranscript: true,
      showMicToggle: true,
      showSpeakerToggle: true,
      showTextInput: true,
      playerSampleRate: 24_000,
      colorScheme: 'light',
      theme: {
        primary: '#2563eb',
        primaryHover: '#1d4ed8',
        primaryActive: '#1e40af',
        onPrimary: '#ffffff',
        background: '#ffffff',
        backgroundRaised: '#f8fafc',
        backgroundInput: '#f8fafc',
        text: '#111827',
        textMuted: '#4b5563',
        border: 'rgba(15, 23, 42, 0.14)',
        panelRadius: '8px',
        buttonRadius: '8px',
        inputRadius: '8px',
        messageRadius: '8px',
        fabSize: 56,
        font: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
      text: {
        name: 'Medication Voice Test',
        startLabel: 'Start microphone',
        stopLabel: 'Stop microphone',
        connectingLabel: 'Connecting voice agent...',
        inputPlaceholder: 'Type a test message in English or Spanish...',
        emptyStateHint: 'Click Start microphone when you are ready to test English or Spanish.',
      },
      on: {
        onConnect: () => {
          clearSpeakingTimer();
          setStatus('listening');
          setErrorMessage(undefined);
        },
        onDisconnect: () => {
          clearSpeakingTimer();
          setStatus('available');
          setMicMuted(false);
        },
        onReconnecting: () => {
          clearSpeakingTimer();
          setStatus('connecting');
        },
        onAgentStartedSpeaking: markSpeaking,
        onMessage: (message) => {
          if (message.role === 'assistant') {
            markSpeaking();
          } else if (message.role === 'user') {
            clearSpeakingTimer();
            setStatus('listening');
          }
        },
        onError: (err) => {
          clearSpeakingTimer();
          setStatus('error');
          setErrorMessage(err.message || 'Deepgram voice agent error');
        },
        onAgentError: () => {
          clearSpeakingTimer();
          setStatus('error');
          setErrorMessage('Deepgram voice agent returned an error');
        },
      },
    });

    refreshAccessibility();
    const observer = new MutationObserver(refreshAccessibility);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });

    return () => {
      clearSpeakingTimer();
      observer.disconnect();
      destroy();
    };
  }, [tokenFactory]);

  return (
    <aside aria-label="Multilingual voice agent test status" style={panelStyle}>
      {import.meta.env.DEV && <p style={titleStyle}>Multilingual Voice Test — English / Español</p>}
      <div aria-live="polite" role="status" aria-label="Voice agent connection status" style={statusStyle}>
        <span>Connection status</span>
        <strong>{STATUS_LABEL[renderedStatus]}</strong>
      </div>
      <div aria-label="Voice agent states" style={chipsStyle}>
        {(Object.keys(STATUS_LABEL) as VoiceAgentStatus[]).map((key) => {
          const active = renderedStatus === key;
          return (
            <span
              aria-current={active ? 'true' : undefined}
              key={key}
              style={{
                border: `1px solid ${active ? '#2563eb' : 'rgba(15, 23, 42, 0.16)'}`,
                borderRadius: 999,
                background: active ? '#eff6ff' : '#ffffff',
                color: active ? '#1d4ed8' : '#374151',
                fontSize: 11,
                fontWeight: active ? 700 : 500,
                lineHeight: 1,
                padding: '5px 7px',
              }}
            >
              {STATUS_LABEL[key]}
            </span>
          );
        })}
      </div>
      {errorMessage && (
        <p role="alert" style={detailStyle}>
          {errorMessage}
        </p>
      )}
    </aside>
  );
}
