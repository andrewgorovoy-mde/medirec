import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { Coverage, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconShieldCheck } from '@tabler/icons-react';
import { useState } from 'react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { BADGE_TONES, BORDER, TEXT_MUTED } from '../theme/tokens';

interface DiscoveredCoverage {
  payerName: string;
  payerId?: string;
  memberId?: string;
  groupNumber?: string;
  planName?: string;
  confidence?: string;
}

interface EligibilityResult {
  source: 'stedi' | 'mock';
  coveragesFound: number;
  items: DiscoveredCoverage[];
  cob?: { checked: boolean; overlap?: boolean; order: string[] };
  note?: string;
}

export function CreatePatientPage(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<string | null>(null);
  const [address1, setAddress1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [patientId, setPatientId] = useState<string>();
  const [eligibility, setEligibility] = useState<EligibilityResult>();

  async function handleSubmit(): Promise<void> {
    if (!firstName.trim() || !lastName.trim() || !birthDate) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const patient = await medplum.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: [firstName.trim()], family: lastName.trim() }],
        birthDate,
        gender: (gender as Patient['gender']) ?? undefined,
        address: address1
          ? [{ line: [address1], city: city || undefined, state: state || undefined, postalCode: postalCode || undefined }]
          : undefined,
      });
      setPatientId(patient.id);

      const res = await fetch('/api/eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth: birthDate,
          address: address1 ? { address1, city, state, postalCode } : undefined,
        }),
      });
      if (res.ok) {
        const result = (await res.json()) as EligibilityResult;
        setEligibility(result);

        const primacyOrder = result.cob?.order ?? [];
        await Promise.all(
          result.items.map((item, i) => {
            const order = primacyOrder.length > 0 ? primacyOrder.indexOf(item.payerName) + 1 || undefined : i + 1;
            return medplum.createResource<Coverage>({
              resourceType: 'Coverage',
              status: 'active',
              beneficiary: { reference: `Patient/${patient.id}` },
              payor: [{ display: item.payerName }],
              subscriberId: item.memberId,
              order,
              class: item.groupNumber
                ? [{ type: { text: 'group' }, value: item.groupNumber, name: item.planName }]
                : undefined,
            });
          })
        );
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (patientId) {
    return (
      <Stack gap="md" p="md" maw={560}>
        <Title order={3}>Patient Created</Title>
        {eligibility && eligibility.items.length > 0 ? (
          <Stack gap="sm">
            <Text size="sm" fw={600}>
              Discovered coverage ({eligibility.coveragesFound})
            </Text>
            {eligibility.note && (
              <Alert color="yellow" title="Demo data">
                {eligibility.note}
              </Alert>
            )}
            {eligibility.items.map((item, i) => {
              const primary = eligibility.cob?.order?.[0] === item.payerName;
              return (
                <Card key={i} withBorder padding="sm">
                  <Group justify="space-between">
                    <Group gap={6}>
                      <IconShieldCheck size={16} />
                      <Text fw={600}>{item.payerName}</Text>
                    </Group>
                    {eligibility.cob?.checked && (
                      <Badge
                        style={{
                          backgroundColor: primary ? BADGE_TONES.info.bg : BADGE_TONES.neutral.bg,
                          color: primary ? BADGE_TONES.info.color : BADGE_TONES.neutral.color,
                          border: `1px solid ${primary ? BADGE_TONES.info.border : BADGE_TONES.neutral.border}`,
                        }}
                      >
                        {primary ? 'Primary' : 'Secondary'}
                      </Badge>
                    )}
                  </Group>
                  <Text size="sm" c={TEXT_MUTED}>
                    {item.planName ?? 'Plan unknown'} · Member ID {item.memberId ?? 'unknown'}
                  </Text>
                </Card>
              );
            })}
            {eligibility.cob?.overlap && (
              <Alert color="orange" title="Coverage overlap detected">
                This patient has more than one active payer — her medication fill history may be
                split across pharmacies/benefit managers, so the home medication list is likely
                incomplete.
              </Alert>
            )}
          </Stack>
        ) : (
          <Text c={TEXT_MUTED}>No coverage discovered from demographics alone.</Text>
        )}
        <Button onClick={() => navigate(`/Patient/${patientId}`)}>Continue to Patient</Button>
      </Stack>
    );
  }

  return (
    <Stack gap="md" p="md" maw={480}>
      <Title order={3}>Create Patient</Title>
      {error && (
        <Alert color="red" onClose={() => setError(undefined)} withCloseButton>
          {error}
        </Alert>
      )}
      <div style={{ background: 'white', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 20 }}>
        <Stack gap="sm">
          <Group grow>
            <TextInput label="First name" value={firstName} onChange={(e) => setFirstName(e.currentTarget.value)} />
            <TextInput label="Last name" value={lastName} onChange={(e) => setLastName(e.currentTarget.value)} />
          </Group>
          <Group grow>
            <TextInput
              label="Date of birth"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.currentTarget.value)}
            />
            <Select
              label="Gender"
              data={['male', 'female', 'other', 'unknown']}
              value={gender}
              onChange={setGender}
            />
          </Group>
          <TextInput label="Address" value={address1} onChange={(e) => setAddress1(e.currentTarget.value)} />
          <Group grow>
            <TextInput label="City" value={city} onChange={(e) => setCity(e.currentTarget.value)} />
            <TextInput label="State" value={state} onChange={(e) => setState(e.currentTarget.value)} />
            <TextInput label="ZIP" value={postalCode} onChange={(e) => setPostalCode(e.currentTarget.value)} />
          </Group>
          <Text size="xs" c={TEXT_MUTED}>
            Address helps match insurance coverage from demographics alone — optional, but improves match rate.
          </Text>
          <Button
            loading={busy}
            disabled={!firstName.trim() || !lastName.trim() || !birthDate}
            onClick={() => void handleSubmit()}
          >
            Create Patient &amp; Check Eligibility
          </Button>
        </Stack>
      </div>
    </Stack>
  );
}
