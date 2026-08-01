// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  AgentProvider,
  useAgentConversation,
  useAgentMicrophone,
  useAgentMode,
  useAgentPlayer,
  useAgentSession,
  useAgentState,
} from '@deepgram/react';
import type { AgentSessionConfig, AgentSettingsObject, MicrophoneOptions } from '@deepgram/react';
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { AuraDevTestPanel } from './AuraDevTestPanel';
import type { VoiceVisualState } from './AgentAudioVisualizerAura';
import { TealVoiceOrb } from './TealVoiceOrb';
import './voiceOrb.css';

const BILINGUAL_GREETING =
  'Hello! I can help you review your medications. You can speak in English or Spanish. Hola, puedo ayudarle a revisar sus medicamentos. Puede hablar en inglés o español.';
const DEVELOPMENT_LABEL = 'Multilingual Voice Test — English / Español';
const HOME_PROMPT = 'Tap to speak or ask a question.';
const SELECTED_VOICE_MODEL = 'aura-2-selena-es';

const PROMPT = `
You are a multilingual medication-reconciliation voice assistant used for a prototype demonstration.

Match the language of each user message independently. If the user speaks English, respond in English. If the user speaks Spanish, respond in Spanish. If the user changes languages, follow the language used in the latest message.
Support English and Spanish.
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

type FluxMultilingualListenProvider = {
  type: 'deepgram';
  version: 'v2';
  model: 'flux-general-multi';
  language_hints: ['en', 'es'];
};

type SelenaBilingualSpeakProvider = {
  type: 'deepgram';
  version: 'v1';
  model: typeof SELECTED_VOICE_MODEL;
  speed: 0.98;
};

type MultilingualAgentSettings = AgentSettingsObject & {
  listen: {
    provider: FluxMultilingualListenProvider;
  };
  speak: {
    provider: SelenaBilingualSpeakProvider;
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
      version: 'v1',
      model: SELECTED_VOICE_MODEL,
      speed: 0.98,
    },
  },
  greeting: BILINGUAL_GREETING,
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
  idle: 'Start voice medication assistant microphone',
  disconnected: 'Start voice medication assistant microphone',
  connecting: 'Voice medication assistant connection in progress',
  listening: 'Mute voice medication assistant microphone',
  thinking: 'Mute voice medication assistant microphone',
  speaking: 'Interrupt voice medication assistant speech',
  muted: 'Unmute voice medication assistant microphone',
  error: 'Retry voice medication assistant connection',
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
  tokenError,
  clearTokenError,
}: {
  tokenError?: string;
  clearTokenError: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const { conversation, clearConversation } = useAgentConversation();
  const { start, stop, isActive, isConnecting, isReconnecting } = useAgentState();
  const { micMuted, setMicMuted } = useAgentMicrophone();
  const { setOutputMuted } = useAgentPlayer();
  const { visualState, errorMessage, setErrorMessage, setThinking } = useVoiceVisualState(tokenError);
  const isBusy = isConnecting || isReconnecting;

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
    setMicMuted(false);
    setOutputMuted(false);
    setThinking(false);
    setErrorMessage(undefined);
    clearTokenError();
    stop();
    clearConversation();
  }

  function interruptSpeech() {
    setOutputMuted(true);
    window.setTimeout(() => setOutputMuted(false), 60);
  }

  function handleOrbClick() {
    setExpanded(true);
    if (visualState === 'idle' || visualState === 'disconnected' || visualState === 'error') {
      void startSession();
      return;
    }
    if (visualState === 'muted') {
      setMicMuted(false);
      return;
    }
    if (visualState === 'speaking') {
      interruptSpeech();
      return;
    }
    if (visualState === 'listening' || visualState === 'thinking') {
      setMicMuted(true);
    }
  }

  const statusMessage = STATUS_MESSAGE[visualState];
  const primaryActionLabel = ORB_ACTION_LABEL[visualState];
  const primaryControlLabel =
    visualState === 'muted'
      ? 'Unmute'
      : visualState === 'idle' || visualState === 'disconnected' || visualState === 'error'
        ? 'Start'
        : visualState === 'speaking'
          ? 'Interrupt'
          : 'Mute';

  return (
    <aside
      className={expanded ? 'voice-agent-shell voice-agent-shell--expanded' : 'voice-agent-shell'}
      aria-label="Medication voice assistant"
    >
      {!expanded ? (
        <div className="voice-agent-collapsed">
          <TealVoiceOrb
            visualState={visualState}
            expanded={false}
            disabled={isBusy}
            ariaLabel={primaryActionLabel}
            onClick={handleOrbClick}
          />
          <button
            type="button"
            className="voice-agent-collapsed__label"
            onClick={() => setExpanded(true)}
            aria-label="Open medication voice assistant panel"
          >
            <span>{statusMessage}</span>
            <em>{HOME_PROMPT}</em>
            <strong>{import.meta.env.DEV ? DEVELOPMENT_LABEL : 'English / Español'}</strong>
          </button>
        </div>
      ) : (
        <div className="voice-agent-panel">
          <div className="voice-agent-panel__header">
            <div>
              <h2>Medication Voice Assistant</h2>
              <p>{import.meta.env.DEV ? DEVELOPMENT_LABEL : 'English / Español'}</p>
            </div>
            <button
              type="button"
              className="voice-agent-icon-button"
              onClick={() => setExpanded(false)}
              aria-label="Collapse voice assistant"
            >
              ×
            </button>
          </div>

          <div className="voice-agent-panel__orb">
            <TealVoiceOrb
              visualState={visualState}
              expanded
              disabled={isBusy}
              ariaLabel={primaryActionLabel}
              onClick={handleOrbClick}
            />
          </div>

          <div className="voice-agent-status" aria-label="Voice assistant connection status" aria-live="polite">
            {statusMessage}
          </div>

          {errorMessage && (
            <p className="voice-agent-error" role="alert">
              {errorMessage}
            </p>
          )}

          <div className="voice-agent-transcript" aria-label="Voice assistant transcript">
            {conversation.length === 0 ? (
              <p className="voice-agent-transcript__empty">Transcript appears here during this test session.</p>
            ) : (
              conversation.slice(-16).map((line) => (
                <p className={`voice-agent-transcript__line voice-agent-transcript__line--${line.role}`} key={line.id}>
                  <span>{line.role === 'assistant' ? 'Assistant' : 'You'}</span>
                  {line.content}
                </p>
              ))
            )}
          </div>

          <div className="voice-agent-controls">
            <button
              type="button"
              className="voice-agent-control-button"
              onClick={() => {
                if (visualState === 'idle' || visualState === 'disconnected' || visualState === 'error') {
                  void startSession();
                } else if (visualState === 'muted') {
                  setMicMuted(false);
                } else if (visualState === 'speaking') {
                  interruptSpeech();
                } else {
                  setMicMuted(!micMuted);
                }
              }}
              disabled={isBusy}
              aria-label={primaryActionLabel}
            >
              {primaryControlLabel}
            </button>
            <button
              type="button"
              className="voice-agent-control-button voice-agent-control-button--quiet"
              onClick={endSession}
              disabled={!isActive || isBusy}
              aria-label="Stop voice session and release microphone"
            >
              End
            </button>
          </div>

          <p className="voice-agent-voice-label">Voice: {SELECTED_VOICE_MODEL}</p>
        </div>
      )}
    </aside>
  );
}

export function PersistentVoiceAgent(): JSX.Element {
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
      <VoiceAgentPanel tokenError={tokenError} clearTokenError={() => setTokenError(undefined)} />
      <AuraDevTestPanel />
    </AgentProvider>
  );
}

export { AGENT_CONFIG, SELECTED_VOICE_MODEL };
