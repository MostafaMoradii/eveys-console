import { useEffect, useState } from 'react';

import { fetchConsoleConfig, fetchGatewayConfig } from '@/api/config-client';
import { ConfigView } from '@/components/ConfigView';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Single Configuration page with two tabs. Console keys (the
// JWT-protected /sys/config endpoint here) and Gateway keys (proxied
// to the gateway's /api/v1/sys/config). Tab state syncs to ?tab so a
// refresh / deep-link / back-button preserves the operator's view.

type TabKey = 'console' | 'gateway';

function readTabFromUrl(): TabKey {
  if (typeof window === 'undefined') return 'console';
  const value = new URLSearchParams(window.location.search).get('tab');
  return value === 'gateway' ? 'gateway' : 'console';
}

function writeTabToUrl(tab: TabKey) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (tab === 'console') url.searchParams.delete('tab');
  else url.searchParams.set('tab', tab);
  window.history.replaceState(null, '', url.toString());
}

export function SystemConfigPage() {
  const [tab, setTab] = useState<TabKey>(readTabFromUrl);

  useEffect(() => {
    writeTabToUrl(tab);
  }, [tab]);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-4">
      <TabsList>
        <TabsTrigger value="console">Console</TabsTrigger>
        <TabsTrigger value="gateway">Gateway</TabsTrigger>
      </TabsList>

      <TabsContent value="console" className="mt-4">
        <ConfigView
          scope="console"
          title="Console configuration"
          queryKey="sys-console-config"
          fetcher={fetchConsoleConfig}
          filters={['all', 'console', 'none']}
        />
      </TabsContent>

      <TabsContent value="gateway" className="mt-4">
        <ConfigView
          scope="gateway"
          title="Gateway configuration"
          queryKey="sys-gateway-config"
          fetcher={fetchGatewayConfig}
          filters={['all', 'gateway', 'none']}
        />
      </TabsContent>
    </Tabs>
  );
}
