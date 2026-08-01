import { Badge, Card, Group, List, Text, UnstyledButton } from '@mantine/core';
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconCopy,
  IconHelpCircle,
} from '@tabler/icons-react';
import type { ComponentType, JSX } from 'react';
import { useState } from 'react';
import type { CheckMedResponse, NotInHomeEntry, Severity, Verdict } from '../capture/types';
import { BADGE_TONES } from '../theme/tokens';

const SEVERITY_TONE: Record<Severity, keyof typeof BADGE_TONES> = {
  auto: 'success',
  review: 'info',
  must_resolve: 'danger',
};

const VERDICT_ICON: Record<Verdict, ComponentType<{ size?: number; color?: string }>> = {
  MATCH: IconCircleCheck,
  DOSE_CONFLICT: IconAlertTriangle,
  DUPLICATE: IconCopy,
  NOT_IN_EHR: IconAlertTriangle,
  NOT_IN_HOME: IconHelpCircle,
  UNRESOLVED: IconHelpCircle,
};

const VERDICT_LABEL: Record<Verdict, string> = {
  MATCH: 'Match',
  DOSE_CONFLICT: 'Dose conflict',
  DUPLICATE: 'Duplicate product',
  NOT_IN_EHR: 'Not in EHR',
  NOT_IN_HOME: 'Never found at home',
  UNRESOLVED: 'Unresolved',
};

interface VerdictCardData {
  verdict: Verdict;
  severity: Severity;
  display: string;
  ehrSays?: string;
  homeSays?: string;
  evidence: string[];
  confidence?: number;
  suggestedAction?: string;
  followUpQuestions?: string[];
}

function fromCheckMed(r: CheckMedResponse): VerdictCardData {
  return { ...r, followUpQuestions: r.followUpQuestions ?? [] };
}

function fromNotInHome(r: NotInHomeEntry): VerdictCardData {
  return { ...r, verdict: 'NOT_IN_HOME', followUpQuestions: r.followUpQuestions ?? [] };
}

function VerdictCardBody({ result }: { result: VerdictCardData }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const tone = BADGE_TONES[SEVERITY_TONE[result.severity]];
  const Icon = VERDICT_ICON[result.verdict];
  const questions = result.followUpQuestions ?? [];
  const expandable = result.verdict !== 'MATCH' && questions.length > 0;

  return (
    <Card
      withBorder
      padding="sm"
      style={{ borderLeft: `3px solid ${tone.border}`, cursor: expandable ? 'pointer' : 'default' }}
      onClick={expandable ? () => setExpanded((v) => !v) : undefined}
    >
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <Icon size={18} color={tone.color} />
          <Text fw={600} truncate>
            {result.display}
          </Text>
        </Group>
        <Group gap={8} wrap="nowrap">
          <Badge style={{ backgroundColor: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }}>
            {VERDICT_LABEL[result.verdict]}
          </Badge>
          {expandable && (expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />)}
        </Group>
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
      {result.confidence != null && (
        <Text size="xs" c="dimmed" mt={2}>
          Read confidence: {Math.round(result.confidence * 100)}%
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

      {expandable && !expanded && (
        <Text size="xs" c={tone.color} fw={600} mt="xs">
          Tap to see questions to ask &darr;
        </Text>
      )}

      {expandable && expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${tone.border}` }}>
          <Text size="xs" fw={700} tt="uppercase" c={tone.color} mb={4}>
            Questions to ask
          </Text>
          <List size="sm" spacing={4}>
            {questions.map((q) => (
              <List.Item key={q}>{q}</List.Item>
            ))}
          </List>
        </div>
      )}
    </Card>
  );
}

export function VerdictCard({ result }: { result: CheckMedResponse }): JSX.Element {
  return <VerdictCardBody result={fromCheckMed(result)} />;
}

export function NotInHomeCard({ entry }: { entry: NotInHomeEntry }): JSX.Element {
  return <VerdictCardBody result={fromNotInHome(entry)} />;
}
