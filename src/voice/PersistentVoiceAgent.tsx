// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  AgentProvider,
  useAgentClientTool,
  useAgentMicrophone,
  useAgentMode,
  useAgentSession,
  useAgentState,
} from '@deepgram/react';
import type { AgentSessionConfig, AgentSettingsObject, MicrophoneOptions } from '@deepgram/react';
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { recordReportedMedication } from '../survey/api';
import { AuraDevTestPanel } from './AuraDevTestPanel';
import type { VoiceVisualState } from './AgentAudioVisualizerAura';
import { TealVoiceOrb } from './TealVoiceOrb';
import './voiceOrb.css';

const GREETING = "Hi! I'd like to go over the medications you're currently taking. What's the first one?";
const SUBTITLE = 'Medication check-in';
const SELECTED_VOICE_MODEL = 'aura-2-thalia-en';

const PROMPT = `
You are a friendly voice assistant helping a patient report the medications they currently take, as part of a
medication check-in for their care team. Speak English only. Keep the conversation short, simple, and
conversational — one question at a time.

For each medication the patient mentions:
1. Get the medication name.
2. Ask how often they take it (e.g. once daily, twice a day, as needed).
3. Ask why they take it, if they know (e.g. blood pressure, diabetes, pain) — it's fine if they don't know.
4. Call record_medication with the name, frequency, and reason (if given).
5. Ask if there is another medication to report.

When the patient says they're done, thank them and let them know their care team will review the list.

Do not diagnose. Do not recommend starting, stopping, or changing any medication — only record what the patient
reports.
`.trim();

type FluxListenProvider = {
  type: 'deepgram';
  version: 'v2';
  model: 'flux-general-multi';
  language_hints: ['en'];
};

type ThaliaSpeakProvider = {
  type: 'deepgram';
  version: 'v1';
  model: typeof SELECTED_VOICE_MODEL;
  speed: 0.98;
};

type VoiceAgentSettings = AgentSettingsObject & {
  listen: {
    provider: FluxListenProvider;
  };
  speak: {
    provider: ThaliaSpeakProvider;
  };
};

interface DeepgramTokenPayload {
  accessToken?: unknown;
  access_token?: unknown;
  token?: unknown;
}

const AGENT_CONFIG: VoiceAgentSettings = {
  listen: {
    provider: {
      type: 'deepgram',
      version: 'v2',
      model: 'flux-general-multi',
      language_hints: ['en'],
    },
  },
  think: {
    provider: {
      type: 'open_ai',
      model: 'gpt-4o-mini',
    },
    prompt: PROMPT,
    functions: [
      {
        name: 'record_medication',
        description:
          "Record a medication the patient reports currently taking, including how often they take it and why.",
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The medication name as the patient said it.' },
            frequency: {
              type: 'string',
              description: 'How often the patient takes it, e.g. "once daily", "twice a day", "as needed".',
            },
            reason: {
              type: 'string',
              description: 'Why the patient takes it, if they know (e.g. "blood pressure", "diabetes").',
            },
          },
          required: ['name', 'frequency'],
        },
      },
    ],
  },
  speak: {
    provider: {
      type: 'deepgram',
      version: 'v1',
      model: SELECTED_VOICE_MODEL,
      speed: 0.98,
    },
  },
  greeting: GREETING,
};

const MICROPHONE_OPTIONS = {
  vad: true,
  noiseSuppression: true,
  echoCancellation: true,
} satisfies MicrophoneOptions & { vad: boolean };

const STATUS_MESSAGE: Record<VoiceVisualState, string> = {
  idle: 'Tap to start',
  disconnected: 'Voice assistant disconnected',
  connecting: 'Connecting…',
  listening: 'I’m listening…',
  thinking: 'Checking your medications…',
  speaking: 'Speaking…',
  muted: 'Microphone muted',
  error: 'Unable to connect',
};

const ORB_ACTION_LABEL: Record<VoiceVisualState, string> = {
  idle: 'Start medication voice check-in',
  disconnected: 'Start medication voice check-in',
  connecting: 'Medication voice check-in connecting',
  listening: 'Stop medication voice check-in',
  thinking: 'Stop medication voice check-in',
  speaking: 'Stop medication voice check-in',
  muted: 'Stop medication voice check-in',
  error: 'Retry medication voice check-in',
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

function agentErrorMessage(message: unknown): string {
  if (message instanceof Error) {
    return message.message || 'Deepgram voice agent error';
  }
  if (typeof message === 'object' && message) {
    const payload = message as { message?: unknown; description?: unknown; error?: unknown };
    if (typeof payload.message === 'string') {
      return payload.message;
    }
    if (typeof payload.description === 'string') {
      return payload.description;
    }
    if (typeof payload.error === 'string') {
      return payload.error;
    }
  }
  return 'Deepgram voice agent error';
}

function useVoiceVisualState(externalError: string | undefined): {
  visualState: VoiceVisualState;
  errorMessage: string | undefined;
  setErrorMessage: (message: string | undefined) => void;
  setThinking: (thinking: boolean) => void;
} {
  const session = useAgentSession();
  const { isConnecting, isConnected, isDisconnected, isReconnecting } = useAgentState();
  const { isListening, isSpeaking } = useAgentMode();
  const { micActive, micMuted } = useAgentMicrophone();
  const [isThinking, setThinking] = useState(false);
  const [sessionError, setSessionError] = useState<string>();

  useEffect(() => {
    const clearThinking = () => setThinking(false);
    const markThinking = () => {
      setSessionError(undefined);
      setThinking(true);
    };
    const markAgentError = (message: unknown) => {
      clearThinking();
      setSessionError(agentErrorMessage(message));
    };

    session.on('agent-thinking', markThinking);
    session.on('agent-started-speaking', clearThinking);
    session.on('agent-audio-done', clearThinking);
    session.on('settings-applied', clearThinking);
    session.on('user-started-speaking', clearThinking);
    session.on('disconnected', clearThinking);
    session.on('error', markAgentError);
    session.on('sdk-error', markAgentError);

    return () => {
      session.off('agent-thinking', markThinking);
      session.off('agent-started-speaking', clearThinking);
      session.off('agent-audio-done', clearThinking);
      session.off('settings-applied', clearThinking);
      session.off('user-started-speaking', clearThinking);
      session.off('disconnected', clearThinking);
      session.off('error', markAgentError);
      session.off('sdk-error', markAgentError);
    };
  }, [session]);

  const errorMessage = externalError ?? sessionError;
  const visualState = useMemo<VoiceVisualState>(() => {
    if (errorMessage) {
      return 'error';
    }
    if (isConnecting || isReconnecting) {
      return 'connecting';
    }
    if (micActive && micMuted) {
      return 'muted';
    }
    if (isSpeaking) {
      return 'speaking';
    }
    if (isThinking && isConnected) {
      return 'thinking';
    }
    if (isListening && isConnected) {
      return 'listening';
    }
    if (isDisconnected) {
      return 'disconnected';
    }
    return 'idle';
  }, [
    errorMessage,
    isConnecting,
    isConnected,
    isDisconnected,
    isListening,
    isReconnecting,
    isSpeaking,
    isThinking,
    micActive,
    micMuted,
  ]);

  return {
    visualState,
    errorMessage,
    setErrorMessage: setSessionError,
    setThinking,
  };
}

function VoiceAgentPanel({
  responseId,
  tokenError,
  clearTokenError,
}: {
  responseId: string;
  tokenError?: string;
  clearTokenError: () => void;
}): JSX.Element {
  const { start, stop, isConnecting, isReconnecting } = useAgentState();
  const { visualState, errorMessage, setErrorMessage, setThinking } = useVoiceVisualState(tokenError);
  const isBusy = isConnecting || isReconnecting;
  const isActive = visualState !== 'idle' && visualState !== 'disconnected' && visualState !== 'error';

  useAgentClientTool('record_medication', async (fn) => {
    try {
      const args = JSON.parse(fn.arguments) as { name?: string; frequency?: string; reason?: string };
      if (!args.name || !args.frequency) {
        return JSON.stringify({ error: 'Missing required name or frequency' });
      }
      const ok = await recordReportedMedication({
        responseId,
        name: args.name,
        frequency: args.frequency,
        reason: args.reason,
      });
      return JSON.stringify({ recorded: ok });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to record medication' });
    }
  });

  async function startSession() {
    clearTokenError();
    setErrorMessage(undefined);
    setThinking(false);
    try {
      await start();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to start the Deepgram voice session');
    }
  }

  function endSession() {
    setThinking(false);
    setErrorMessage(undefined);
    clearTokenError();
    stop();
  }

  function handleOrbClick() {
    if (isBusy) {
      return;
    }
    if (isActive) {
      endSession();
    } else {
      void startSession();
    }
  }

  const statusMessage = STATUS_MESSAGE[visualState];
  const primaryActionLabel = ORB_ACTION_LABEL[visualState];

  return (
    <aside className="voice-agent-shell" aria-label="Medication voice assistant">
      <div className="voice-agent-collapsed">
        <TealVoiceOrb
          visualState={visualState}
          expanded={false}
          disabled={isBusy}
          ariaLabel={primaryActionLabel}
          onClick={handleOrbClick}
        />
        <div className="voice-agent-collapsed__label" aria-live="polite">
          <span>{statusMessage}</span>
          <strong>{SUBTITLE}</strong>
        </div>
        {errorMessage && (
          <p className="voice-agent-error" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </aside>
  );
}

export function PersistentVoiceAgent({ responseId }: { responseId: string }): JSX.Element {
  const [tokenError, setTokenError] = useState<string>();

  const tokenFactory = useMemo(() => {
    return async () => {
      setTokenError(undefined);
      try {
        return await fetchDeepgramToken();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Deepgram token request failed';
        setTokenError(message);
        throw err;
      }
    };
  }, []);

  const agentSessionConfig = useMemo<AgentSessionConfig>(
    () => ({
      auth: { tokenFactory },
      agent: AGENT_CONFIG,
      audio: {
        input: { encoding: 'linear16', sampleRate: 16_000 },
        output: { encoding: 'linear16', sampleRate: 24_000 },
      },
    }),
    [tokenFactory]
  );

  return (
    <AgentProvider
      config={agentSessionConfig}
      microphone
      microphoneOptions={MICROPHONE_OPTIONS}
      tts
      playerSampleRate={24_000}
      autoStart={false}
    >
      <VoiceAgentPanel responseId={responseId} tokenError={tokenError} clearTokenError={() => setTokenError(undefined)} />
      <AuraDevTestPanel />
    </AgentProvider>
  );
}

export { AGENT_CONFIG, SELECTED_VOICE_MODEL };
