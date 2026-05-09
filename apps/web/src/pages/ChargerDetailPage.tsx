import { Alert, Badge, Button, Group, Loader, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlayerPlay, IconPlayerStop, IconRefresh } from '@tabler/icons-react';
import { useParams } from '@tanstack/react-router';

import { useConsoleClient } from '../lib/ws-context';
import { useSubscription } from '../hooks/use-subscription';

export function ChargerDetailPage() {
  const { cpId } = useParams({ strict: false }) as { cpId: string };
  const { client } = useConsoleClient();
  const sub = useSubscription('charge-point', { cp_id: cpId });

  const runRpc = async (method: string, params: Record<string, unknown>) => {
    try {
      await client.rpc(method, params);
      notifications.show({ color: 'teal', title: method, message: 'Command accepted by charger' });
    } catch (err) {
      notifications.show({
        color: 'red',
        title: method,
        message: err instanceof Error ? err.message : 'Command failed',
      });
    }
  };

  if (sub.error) {
    return (
      <Alert color="red" title={`Couldn't load ${cpId}`}>
        {sub.error}
      </Alert>
    );
  }
  if (sub.loading || !sub.snapshot || sub.snapshot.kind !== 'charge-point') {
    return (
      <Group>
        <Loader size="sm" /> <Text>Loading charger…</Text>
      </Group>
    );
  }

  const cp = sub.snapshot.row;

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={3}>{cp.cp_id}</Title>
          <Text c="dimmed" size="sm">
            {cp.vendor ?? '—'} / {cp.model ?? '—'} · firmware {cp.firmware_version ?? '?'}
          </Text>
        </div>
        <Group>
          <Badge color={cp.online ? 'teal' : 'gray'}>{cp.online ? 'online' : 'offline'}</Badge>
          <Badge variant="light">last_status: {cp.last_status ?? '—'}</Badge>
        </Group>
      </Group>

      <Paper p="md" withBorder>
        <Title order={5} mb="xs">
          Commands
        </Title>
        <Group>
          <Button
            leftSection={<IconPlayerPlay size={14} />}
            onClick={() => runRpc('remote-start', { cp_id: cp.cp_id, id_tag: 'OPERATOR' })}
          >
            RemoteStart
          </Button>
          <Button
            color="red"
            variant="light"
            leftSection={<IconPlayerStop size={14} />}
            onClick={() => runRpc('remote-stop', { cp_id: cp.cp_id, transaction_id: 0 })}
          >
            RemoteStop
          </Button>
          <Button
            variant="light"
            leftSection={<IconRefresh size={14} />}
            onClick={() => runRpc('reset', { cp_id: cp.cp_id, type: 'Soft' })}
          >
            Soft Reset
          </Button>
        </Group>
      </Paper>

      <Paper p="md" withBorder>
        <Title order={5} mb="xs">
          Connectors
        </Title>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>connector_id</Table.Th>
              <Table.Th>status</Table.Th>
              <Table.Th>error_code</Table.Th>
              <Table.Th>last_changed_at</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {cp.connectors.map((c) => (
              <Table.Tr key={c.connector_id}>
                <Table.Td>{c.connector_id}</Table.Td>
                <Table.Td>{c.status}</Table.Td>
                <Table.Td>{c.error_code ?? '—'}</Table.Td>
                <Table.Td>{c.last_changed_at ?? '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}
