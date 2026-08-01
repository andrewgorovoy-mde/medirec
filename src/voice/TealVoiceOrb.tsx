// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { JSX } from 'react';
import { AgentAudioVisualizerAura } from './AgentAudioVisualizerAura';
import type { VoiceVisualState } from './AgentAudioVisualizerAura';
import { useDeepgramAura } from './useDeepgramAura';
import { SIDEBAR_BG } from '../theme/tokens';

type TealVoiceOrbProps = {
  visualState: VoiceVisualState;
  expanded: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onClick: () => void;
};

export function TealVoiceOrb({
  visualState,
  expanded,
  disabled,
  ariaLabel,
  onClick,
}: TealVoiceOrbProps): JSX.Element {
  const { activeVolume } = useDeepgramAura(visualState);

  return (
    <button
      type="button"
      className={[
        'teal-voice-orb',
        expanded ? 'teal-voice-orb--expanded' : 'teal-voice-orb--collapsed',
        `teal-voice-orb--${visualState}`,
      ].join(' ')}
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      <AgentAudioVisualizerAura
        size="xl"
        color={SIDEBAR_BG}
        colorShift={0.05}
        state={visualState}
        themeMode="dark"
        volume={activeVolume}
        className="voice-agent-aura"
      />
    </button>
  );
}
