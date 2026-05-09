import { AppShell, Badge, Group, NavLink, Text, TextInput, Title } from '@mantine/core';
import { IconBolt, IconList, IconReceipt2 } from '@tabler/icons-react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';

import { useConsoleClient } from '../lib/ws-context';

export function ConsoleShell() {
  const { status, token, setToken } = useConsoleClient();
  const router = useRouterState();

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 240, breakpoint: 'sm' }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <IconBolt size={22} />
            <Title order={4}>Eveys Console</Title>
          </Group>
          <Group gap="md">
            <Badge color={status === 'open' ? 'teal' : status === 'connecting' ? 'yellow' : 'red'}>
              {status}
            </Badge>
            <TextInput
              size="xs"
              w={260}
              placeholder="Bearer JWT (paste here)"
              value={token ?? ''}
              onChange={(e) => setToken(e.currentTarget.value || null)}
            />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <NavLink
          component={Link}
          to="/"
          label="Fleet overview"
          leftSection={<IconList size={16} />}
          active={router.location.pathname === '/'}
        />
        <NavLink
          component={Link}
          to="/transactions"
          label="Active transactions"
          leftSection={<IconReceipt2 size={16} />}
          active={router.location.pathname.startsWith('/transactions')}
        />
        <Text size="xs" c="dimmed" mt="md" px="sm">
          Drill into a charger from the Fleet view.
        </Text>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
