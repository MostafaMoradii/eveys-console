import { Alert, Anchor, Badge, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';

import type { ChargePointSummary } from '@eveys-console/protocol';

import { useSubscription } from '../hooks/use-subscription';

export function FleetPage() {
  const sub = useSubscription('charge-points', {});

  if (sub.error) {
    return (
      <Alert color="red" title="Couldn't load fleet">
        {sub.error}
      </Alert>
    );
  }
  if (sub.loading || !sub.snapshot || sub.snapshot.kind !== 'charge-points') {
    return (
      <Group>
        <Loader size="sm" /> <Text>Loading fleet…</Text>
      </Group>
    );
  }

  const rows = sub.snapshot.rows;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Fleet — {rows.length} chargers</Title>
        <Text size="sm" c="dimmed">
          Live; updates as chargers connect, change status, or boot.
        </Text>
      </Group>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>cp_id</Table.Th>
            <Table.Th>online</Table.Th>
            <Table.Th>last status</Table.Th>
            <Table.Th>vendor / model</Table.Th>
            <Table.Th>last heartbeat</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <FleetRow key={row.cp_id} row={row} />
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function FleetRow({ row }: { row: ChargePointSummary }) {
  return (
    <Table.Tr>
      <Table.Td>
        <Anchor component={Link} to={`/charge-points/${row.cp_id}`}>
          {row.cp_id}
        </Anchor>
      </Table.Td>
      <Table.Td>
        <Badge color={row.online ? 'teal' : 'gray'} variant="light">
          {row.online ? 'online' : 'offline'}
        </Badge>
      </Table.Td>
      <Table.Td>{row.last_status ?? '—'}</Table.Td>
      <Table.Td>
        {row.vendor ?? '—'} / {row.model ?? '—'}
      </Table.Td>
      <Table.Td>{row.last_heartbeat_at ?? '—'}</Table.Td>
    </Table.Tr>
  );
}
