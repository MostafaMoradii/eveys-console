import { fetchConsoleConfig } from '@/api/config-client';
import { ConfigView } from '@/components/ConfigView';

// Read-only view of the Console server's configuration. Console-side
// keys never affect the gateway, so the filter bar omits Gateway/Both.

export function ConsoleConfigPage() {
  return (
    <ConfigView
      scope="console"
      title="Console configuration"
      queryKey="sys-console-config"
      fetcher={fetchConsoleConfig}
      filters={['all', 'console', 'none']}
    />
  );
}
