import { fetchGatewayConfig } from '@/api/config-client';
import { ConfigView } from '@/components/ConfigView';

// Read-only view of the gateway's configuration. Proxied through the
// Console server (browser → /sys/gateway-config → gateway:/api/v1/sys/config)
// so the browser only ever talks to one origin.

export function GatewayConfigPage() {
  return (
    <ConfigView
      scope="gateway"
      title="Gateway configuration"
      queryKey="sys-gateway-config"
      fetcher={fetchGatewayConfig}
      // Gateway keys can affect the gateway, the Console (e.g. Kafka topics
      // both ends must agree on), or both. Show the full filter set.
      filters={['all', 'gateway', 'console', 'both', 'none']}
    />
  );
}
