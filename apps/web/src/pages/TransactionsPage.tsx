import { Alert, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';

import { useSubscription } from '../hooks/use-subscription';

export function TransactionsPage() {
  const sub = useSubscription('transactions-active', {});

  if (sub.error) {
    return (
      <Alert color="red" title="Couldn't load transactions">
        {sub.error}
      </Alert>
    );
  }
  if (sub.loading || !sub.snapshot || sub.snapshot.kind !== 'transactions-active') {
    return (
      <Group>
        <Loader size="sm" /> <Text>Loading transactions…</Text>
      </Group>
    );
  }

  return (
    <Stack>
      <Title order={3}>Active transactions — {sub.snapshot.rows.length}</Title>
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>transaction_id</Table.Th>
            <Table.Th>cp_id</Table.Th>
            <Table.Th>id_tag</Table.Th>
            <Table.Th>started</Table.Th>
            <Table.Th>energy (Wh)</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sub.snapshot.rows.map((r) => (
            <Table.Tr key={r.transaction_id}>
              <Table.Td>{r.transaction_id}</Table.Td>
              <Table.Td>{r.cp_id}</Table.Td>
              <Table.Td>{r.id_tag}</Table.Td>
              <Table.Td>{r.start_at}</Table.Td>
              <Table.Td>{r.energy_delivered_wh ?? '—'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
