import { Divider, List, Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';
import type { CheckMedResponse, NotInHomeEntry, SessionSummaryResponse, Verdict } from '../capture/types';
import { TEXT_MUTED } from '../theme/tokens';

const GROUP_ORDER: Verdict[] = ['MATCH', 'DOSE_CONFLICT', 'DUPLICATE', 'NOT_IN_EHR', 'UNRESOLVED'];

const GROUP_TITLE: Record<Verdict, string> = {
  MATCH: 'Confirmed matches',
  DOSE_CONFLICT: 'Dose conflicts — needs prescriber review',
  DUPLICATE: 'Possible duplicate therapy — needs prescriber review',
  NOT_IN_EHR: 'Found at home, not on the EHR list — needs prescriber review',
  UNRESOLVED: 'Could not identify — needs follow-up',
  NOT_IN_HOME: 'On the EHR list, not found at home',
};

function ReportRow({ row }: { row: CheckMedResponse }): JSX.Element {
  return (
    <div style={{ marginBottom: 10 }}>
      <Text fw={600} size="sm">
        {row.display}
      </Text>
      {row.ehrSays && (
        <Text size="sm">
          <b>EHR:</b> {row.ehrSays}
        </Text>
      )}
      {row.homeSays && (
        <Text size="sm">
          <b>Home:</b> {row.homeSays}
        </Text>
      )}
      {row.evidence.length > 0 && (
        <List size="sm" mt={2}>
          {row.evidence.map((line) => (
            <List.Item key={line}>{line}</List.Item>
          ))}
        </List>
      )}
      {row.suggestedAction && (
        <Text size="sm" fs="italic">
          {row.suggestedAction}
        </Text>
      )}
      {row.followUpQuestions && row.followUpQuestions.length > 0 && (
        <>
          <Text size="sm" fw={600} mt={2}>
            Questions to ask:
          </Text>
          <List size="sm">
            {row.followUpQuestions.map((q) => (
              <List.Item key={q}>{q}</List.Item>
            ))}
          </List>
        </>
      )}
    </div>
  );
}

function NotInHomeRow({ entry }: { entry: NotInHomeEntry }): JSX.Element {
  return (
    <div style={{ marginBottom: 10 }}>
      <Text fw={600} size="sm">
        {entry.display}
      </Text>
      {entry.evidence.length > 0 && (
        <List size="sm" mt={2}>
          {entry.evidence.map((line) => (
            <List.Item key={line}>{line}</List.Item>
          ))}
        </List>
      )}
      {entry.followUpQuestions && entry.followUpQuestions.length > 0 && (
        <>
          <Text size="sm" fw={600} mt={2}>
            Questions to ask:
          </Text>
          <List size="sm">
            {entry.followUpQuestions.map((q) => (
              <List.Item key={q}>{q}</List.Item>
            ))}
          </List>
        </>
      )}
    </div>
  );
}

interface SessionReportProps {
  summary: SessionSummaryResponse;
}

/**
 * Physician-facing reconciliation report — every captured medication grouped by verdict, plus
 * anything on the EHR's active list that was never found at home. Rendered both on-screen and
 * (via the .reconciliation-report print rules in CaptureSessionPage) as the print/PDF output.
 */
export function SessionReport({ summary }: SessionReportProps): JSX.Element {
  const rowsByVerdict = new Map<Verdict, CheckMedResponse[]>();
  for (const row of summary.rows) {
    const bucket = rowsByVerdict.get(row.verdict) ?? [];
    bucket.push(row);
    rowsByVerdict.set(row.verdict, bucket);
  }

  return (
    <Stack gap="md" className="reconciliation-report">
      <div>
        <Title order={4}>Medication Reconciliation Report</Title>
        <Text size="sm" c={TEXT_MUTED}>
          {summary.patient.name} · Generated {new Date().toLocaleString()}
        </Text>
      </div>

      <Text size="sm">
        {summary.summary.matched} matched · {summary.summary.needsReview} need review ·{' '}
        {summary.summary.mustResolve} must resolve · {summary.summary.captured} captured total
      </Text>

      {GROUP_ORDER.map((verdict) => {
        const rows = rowsByVerdict.get(verdict);
        if (!rows || rows.length === 0) {
          return null;
        }
        return (
          <div key={verdict}>
            <Divider mb="xs" />
            <Text fw={700} size="sm" mb="xs">
              {GROUP_TITLE[verdict]}
            </Text>
            {rows.map((row) => (
              <ReportRow key={row.statementId} row={row} />
            ))}
          </div>
        );
      })}

      {summary.notInHome.length > 0 && (
        <div>
          <Divider mb="xs" />
          <Text fw={700} size="sm" mb="xs">
            {GROUP_TITLE.NOT_IN_HOME}
          </Text>
          {summary.notInHome.map((entry) => (
            <NotInHomeRow key={entry.matchKey} entry={entry} />
          ))}
        </div>
      )}

      <Divider />
      <Text size="sm" c={TEXT_MUTED}>
        Reviewed by: ______________________________ Date: ______________
      </Text>
    </Stack>
  );
}
