// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { useAgentMicrophone, useAgentPlayer } from '@deepgram/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { VoiceVisualState } from './AgentAudioVisualizerAura';

const ATTACK = 0.35;
const RELEASE = 0.08;
const UPDATE_INTERVAL_MS = 50;
const MIN_CHANGE_FOR_RENDER = 0.008;

type AuraVolumes = {
  microphoneVolume: number;
  agentOutputVolume: number;
  activeVolume: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothVolume(previous: number, raw: number): number {
  const smoothing = raw > previous ? ATTACK : RELEASE;
  return previous + (raw - previous) * smoothing;
}

export function useDeepgramAura(auraState: VoiceVisualState): AuraVolumes {
  const { getInputVolume } = useAgentMicrophone();
  const { getOutputVolume } = useAgentPlayer();
  const valuesRef = useRef({ microphoneVolume: 0, agentOutputVolume: 0 });
  const renderedRef = useRef({ microphoneVolume: 0, agentOutputVolume: 0 });
  const lastRenderRef = useRef(0);
  const [volumes, setVolumes] = useState({ microphoneVolume: 0, agentOutputVolume: 0 });

  useEffect(() => {
    let animationFrame = 0;

    const sample = (now: number) => {
      const rawMicrophoneVolume = clamp01(getInputVolume());
      const rawAgentOutputVolume = clamp01(getOutputVolume());
      const nextMicrophoneVolume = smoothVolume(valuesRef.current.microphoneVolume, rawMicrophoneVolume);
      const nextAgentOutputVolume = smoothVolume(valuesRef.current.agentOutputVolume, rawAgentOutputVolume);

      valuesRef.current = {
        microphoneVolume: nextMicrophoneVolume,
        agentOutputVolume: nextAgentOutputVolume,
      };

      const shouldRender =
        now - lastRenderRef.current >= UPDATE_INTERVAL_MS &&
        (Math.abs(renderedRef.current.microphoneVolume - nextMicrophoneVolume) > MIN_CHANGE_FOR_RENDER ||
          Math.abs(renderedRef.current.agentOutputVolume - nextAgentOutputVolume) > MIN_CHANGE_FOR_RENDER);

      if (shouldRender) {
        lastRenderRef.current = now;
        renderedRef.current = {
          microphoneVolume: nextMicrophoneVolume,
          agentOutputVolume: nextAgentOutputVolume,
        };
        setVolumes(renderedRef.current);
      }

      animationFrame = window.requestAnimationFrame(sample);
    };

    animationFrame = window.requestAnimationFrame(sample);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [getInputVolume, getOutputVolume]);

  return useMemo(() => {
    const proceduralBaseline = auraState === 'connecting' || auraState === 'thinking' ? 0.05 : 0;
    const activeVolume =
      auraState === 'speaking'
        ? Math.max(volumes.agentOutputVolume, proceduralBaseline)
        : Math.max(volumes.microphoneVolume, proceduralBaseline);

    return {
      microphoneVolume: volumes.microphoneVolume,
      agentOutputVolume: volumes.agentOutputVolume,
      activeVolume,
    };
  }, [auraState, volumes.agentOutputVolume, volumes.microphoneVolume]);
}
