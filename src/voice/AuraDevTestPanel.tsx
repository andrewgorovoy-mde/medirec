// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import type { JSX } from 'react';
import { AgentAudioVisualizerAura } from './AgentAudioVisualizerAura';
import type { VoiceVisualState } from './AgentAudioVisualizerAura';

const TEST_STATES = ['connecting', 'listening', 'thinking', 'speaking'] as const satisfies readonly VoiceVisualState[];

function isAuraTestEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('auraTest') === '1';
}

export function AuraDevTestPanel(): JSX.Element | null {
  const [state, setState] = useState<VoiceVisualState>('listening');
  const [volume, setVolume] = useState(0.3);

  if (!import.meta.env.DEV || !isAuraTestEnabled()) {
    return null;
  }

  return (
    <aside className="voice-agent-aura-dev" aria-label="Aura development test controls">
      <AgentAudioVisualizerAura
        size="xl"
        color="#2EC4B6"
        colorShift={0.05}
        state={state}
        volume={volume}
        themeMode="dark"
        className="voice-agent-aura-dev__visual"
      />
      <div className="voice-agent-aura-dev__controls">
        {TEST_STATES.map((testState) => (
          <button
            type="button"
            aria-pressed={state === testState}
            className="voice-agent-aura-dev__button"
            key={testState}
            onClick={() => setState(testState)}
          >
            {testState}
          </button>
        ))}
      </div>
      <label className="voice-agent-aura-dev__slider">
        <span>Volume {volume.toFixed(2)}</span>
        <input
          max={1}
          min={0}
          step={0.01}
          type="range"
          value={volume}
          onChange={(event) => setVolume(Number(event.currentTarget.value))}
        />
      </label>
    </aside>
  );
}
