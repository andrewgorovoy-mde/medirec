import { ActionIcon, AppShell, Box, Burger, Group, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { Practitioner } from '@medplum/fhirtypes';
import { ResourceName, useMedplum, useMedplumProfile } from '@medplum/react';
import {
  IconChartBar,
  IconClipboardList,
  IconLayoutDashboard,
  IconLogout,
  IconPill,
  IconSettings,
  IconStethoscope,
  IconUsers,
} from '@tabler/icons-react';
import type { ComponentType, JSX, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { SIDEBAR_ACTIVE_BG, SIDEBAR_BG, SIDEBAR_TEXT, SIDEBAR_TEXT_ACTIVE } from '../theme/tokens';

interface NavItemProps {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  active: boolean;
  onClick: () => void;
}

function NavItem({ href, label, icon: Icon, active, onClick }: NavItemProps): JSX.Element {
  return (
    <UnstyledButton
      component={Link}
      to={href}
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        marginBottom: 4,
        color: active ? SIDEBAR_TEXT_ACTIVE : SIDEBAR_TEXT,
        backgroundColor: active ? SIDEBAR_ACTIVE_BG : 'transparent',
      }}
    >
      <Group gap={10} wrap="nowrap">
        <Icon size={18} />
        <Text component="span" fz={14} fw={500} c="inherit">
          {label}
        </Text>
      </Group>
    </UnstyledButton>
  );
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: IconLayoutDashboard },
  { href: '/', label: 'Patients', icon: IconUsers },
  { href: '/medications', label: 'Medications', icon: IconPill },
  { href: '/tasks', label: 'Tasks', icon: IconClipboardList },
  { href: '/care-coordination', label: 'Care Team', icon: IconStethoscope },
  { href: '/reports', label: 'Reports', icon: IconChartBar },
  { href: '/settings', label: 'Settings', icon: IconSettings },
];

export function AppLayout({ children }: { children: ReactNode }): JSX.Element {
  const [opened, { toggle, close }] = useDisclosure();
  const medplum = useMedplum();
  const profile = useMedplumProfile() as Practitioner | undefined;
  const location = useLocation();
  const navigate = useNavigate();

  async function handleSignOut(): Promise<void> {
    await medplum.signOut();
    await navigate('/');
  }

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header withBorder style={{ borderColor: '#DCE4EC' }}>
        <Group h="100%" px="md" justify="space-between">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <div />
          <Group gap="sm">
            {profile && (
              <Text size="sm" c="dimmed">
                <ResourceName value={profile} />
              </Text>
            )}
            <ActionIcon variant="subtle" color="gray" onClick={() => void handleSignOut()} aria-label="Log out">
              <IconLogout size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar style={{ backgroundColor: SIDEBAR_BG, border: 'none' }} p="md">
        <Group gap={10} mb="xl">
          <img src="/logo.png" alt="" style={{ width: 44, height: 44, objectFit: 'contain' }} />
          <Text fw={700} size="xl" c={SIDEBAR_TEXT_ACTIVE}>
            MediRec
          </Text>
        </Group>
        <Box style={{ flex: 1 }}>
          {NAV_ITEMS.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={location.pathname === item.href}
              onClick={close}
            />
          ))}
        </Box>
      </AppShell.Navbar>

      <AppShell.Main style={{ backgroundColor: '#F6F8FB' }}>{children}</AppShell.Main>
    </AppShell>
  );
}
