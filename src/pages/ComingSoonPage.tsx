import { Stack, Text, Title } from '@mantine/core';
import type { ComponentType, JSX } from 'react';
import { TEXT_MUTED } from '../theme/tokens';

interface ComingSoonPageProps {
  title: string;
  description: string;
  icon: ComponentType<{ size?: number }>;
}

export function ComingSoonPage({ title, description, icon: Icon }: ComingSoonPageProps): JSX.Element {
  return (
    <Stack align="center" justify="center" gap="xs" p="xl" style={{ minHeight: '60vh' }}>
      <Icon size={40} />
      <Title order={3}>{title}</Title>
      <Text c={TEXT_MUTED} ta="center" maw={360}>
        {description}
      </Text>
      <Text size="xs" c={TEXT_MUTED} fw={600} tt="uppercase" mt="xs">
        Coming soon
      </Text>
    </Stack>
  );
}
