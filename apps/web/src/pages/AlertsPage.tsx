// Dedicated alerts page. Replaces the panel pile-up on SystemPage —
// firing alerts, active silences (and eventually channel config +
// rule display) get the room they need without crowding the dashboard
// at-a-glance.
//
// Tabs are URL-backed (?tab=…) so a deep-link to a specific tab is
// shareable and the back-button works after switching.

import { useNavigate, useSearch } from '@tanstack/react-router';
import { BellRing } from 'lucide-react';

import { ActiveSilencesPanel } from '@/components/ActiveSilencesPanel';
import { AlertmanagerDocsStrip } from '@/components/AlertmanagerDocsStrip';
import { ChannelsPanel } from '@/components/ChannelsPanel';
import { FiringAlertsPanel } from '@/components/FiringAlertsPanel';
import { ManagedRulesPanel } from '@/components/ManagedRulesPanel';
import { RecommendedRulesPanel } from '@/components/RecommendedRulesPanel';
import { RulesPanel } from '@/components/RulesPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFiringAlerts } from '@/hooks/use-firing-alerts';
import { useSilences } from '@/hooks/use-silences';

type TabValue = 'firing' | 'silences' | 'channels' | 'rules';

const TAB_VALUES: readonly TabValue[] = ['firing', 'silences', 'channels', 'rules'] as const;

function isTabValue(v: unknown): v is TabValue {
  return typeof v === 'string' && (TAB_VALUES as readonly string[]).includes(v);
}

export function AlertsPage() {
  const search = useSearch({ from: '/sys/alerts' }) as { tab?: TabValue };
  const navigate = useNavigate({ from: '/sys/alerts' });
  const tab: TabValue = search.tab && isTabValue(search.tab) ? search.tab : 'firing';

  const firing = useFiringAlerts();
  const silences = useSilences();

  const setTab = (next: TabValue) => {
    void navigate({
      search: (prev: Record<string, unknown>) => ({ ...prev, tab: next }),
      replace: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BellRing className="h-5 w-5 text-brand-orange" />
        <div>
          <h2 className="text-xl font-semibold">Alerts</h2>
          <p className="text-sm text-muted-foreground">
            Firing alerts, active silences, channel configuration and rule definitions.
          </p>
        </div>
      </div>

      <AlertmanagerDocsStrip />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} data-testid="alerts-tabs">
        <TabsList>
          <TabsTrigger value="firing" data-testid="tab-firing">
            Firing
            {firing.alerts.length > 0 ? (
              <span
                className="ml-2 rounded-full bg-destructive/15 px-1.5 text-xs text-destructive"
                data-testid="firing-count"
              >
                {firing.alerts.length}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="silences" data-testid="tab-silences">
            Silences
            {silences.silences.length > 0 ? (
              <span
                className="ml-2 rounded-full bg-muted px-1.5 text-xs text-muted-foreground"
                data-testid="silences-count"
              >
                {silences.silences.length}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="channels" data-testid="tab-channels">
            Channels
          </TabsTrigger>
          <TabsTrigger value="rules" data-testid="tab-rules">
            Rules
          </TabsTrigger>
        </TabsList>

        <TabsContent value="firing">
          <FiringAlertsPanel
            alerts={firing.alerts}
            unavailable={firing.unavailable}
            loading={firing.loading}
          />
        </TabsContent>

        <TabsContent value="silences">
          <ActiveSilencesPanel
            silences={silences.silences}
            unavailable={silences.unavailable}
            loading={silences.loading}
          />
        </TabsContent>

        <TabsContent value="channels">
          <ChannelsPanel />
        </TabsContent>

        <TabsContent value="rules" className="space-y-4">
          <RecommendedRulesPanel />
          <ManagedRulesPanel />
          <RulesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
