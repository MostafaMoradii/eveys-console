import { Alert, Anchor, Badge, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import type { ChargePointSummary } from '@eveys-console/protocol';

import { useSubscription } from '../hooks/use-subscription';

export function FleetPage() {
  const sub = useSubscription('charge-points', {});

  // Apply the latest delta on top of the snapshot. For v1 we keep the whole
  // table client-side and reduce on every render — fine up to a few thousand
  // chargers. For larger fleets, switch to a useReducer that mutates a Map.
  const rows = useMemo<ChargePointSummary[]>(() => {
    if (!sub.snapshot || sub.snapshot.kind !== 'charge-points') return [];
    const byId = new Map<string, ChargePointSummary>(
      sub.snapshot.rows.map((r) => [r.cp_id, r]),
    );
    if (sub.lastDelta && sub.lastDelta.kind === 'charge-points') {
      const d = sub.lastDelta;
      if (d.op === 'upsert' && d.row) byId.set(d.row.cp_id, d.row);
      if (d.op === 'remove' && d.cp_id) byId.delete(d.cp_id);
    }
    return Array.from(byId.values()).sort((a, b) => a.cp_id.localeCompare(b.cp_id));
  }, [sub.snapshot, sub.lastDelta]);

  if (sub.error) {
    return (
      <Alert color="red" title="Couldn't load fleet">
        {sub.error}
      </Alert>
    );
  }
  if (sub.loading || !sub.snapshot) {
    return (
      <Group>
        <Loader size="sm" /> <Text>Loading fleet…</Text>
      </Group>
    );
  }

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
