// Static OCPP 1.6 conformance reference. Lists every spec'd 1.6
// message + the gateway's hand-curated status (implemented / partial /
// not-implemented) and a one-line operator-facing description.
//
// The data is sourced by reading the gateway's handlers in
// src/eveys_ocpp/handlers/v16/ and @router.post routes in
// src/eveys_ocpp/api/commands.py — there is no runtime introspection
// endpoint; v1 of this page is a hand-curated reference.

import { ArrowDownLeft, ArrowUpRight, Check, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  countByStatus,
  groupByProfile,
  OCPP_MESSAGES,
  OCPP_PROFILES,
  OCPP_PROFILE_BLURBS,
  OCPP_PROFILE_LABELS,
  type OcppMessage,
  type OcppProfile,
  type OcppStatus,
} from '@/lib/ocpp-conformance';
import { cn } from '@/lib/utils';

type StatusFilter = 'all' | OcppStatus;

const STATUS_BADGE: Record<
  OcppStatus,
  { variant: 'success' | 'warning' | 'muted'; label: string }
> = {
  implemented: { variant: 'success', label: 'implemented' },
  partial: { variant: 'warning', label: 'partial' },
  'not-implemented': { variant: 'muted', label: 'not implemented' },
};

export function OcppConformancePage() {
  const [search, setSearch] = useState('');
  const [activeProfiles, setActiveProfiles] = useState<ReadonlySet<OcppProfile>>(
    () => new Set(OCPP_PROFILES),
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const totals = useMemo(() => countByStatus(OCPP_MESSAGES), []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return OCPP_MESSAGES.filter((msg) => {
      if (!activeProfiles.has(msg.profile)) return false;
      if (statusFilter !== 'all' && msg.status !== statusFilter) return false;
      if (needle && !msg.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [search, activeProfiles, statusFilter]);

  const grouped = useMemo(() => groupByProfile(filtered), [filtered]);
  const visibleProfiles = OCPP_PROFILES.filter((p) => grouped[p].length > 0);

  function toggleProfile(profile: OcppProfile) {
    setActiveProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(profile)) next.delete(profile);
      else next.add(profile);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold">OCPP 1.6 conformance</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every OCPP 1.6 message the spec defines, with this gateway's implementation status. The
          list is hand-curated against the gateway's handlers and command routes — there is no
          runtime introspection endpoint. The Security Whitepaper extensions are bucketed separately
          so you can see what we ship on top of base 1.6.
        </p>
        <div className="flex flex-wrap gap-2 pt-1 text-xs">
          <Badge variant="success" data-testid="total-implemented">
            {totals.implemented} implemented
          </Badge>
          <Badge variant="warning" data-testid="total-partial">
            {totals.partial} partial
          </Badge>
          <Badge variant="muted" data-testid="total-not-implemented">
            {totals['not-implemented']} not implemented
          </Badge>
        </div>
      </header>

      <section className="space-y-3 rounded-md border bg-muted/30 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            type="search"
            placeholder="Search by message name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search OCPP messages by name"
            className="sm:max-w-sm"
          />
          <div
            className="flex flex-wrap items-center gap-2"
            role="radiogroup"
            aria-label="Filter by status"
          >
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Status</span>
            {(['all', 'implemented', 'partial', 'not-implemented'] as StatusFilter[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? 'default' : 'outline'}
                onClick={() => setStatusFilter(s)}
                aria-pressed={statusFilter === s}
                role="radio"
                aria-checked={statusFilter === s}
              >
                {s === 'all' ? 'all' : s === 'not-implemented' ? 'not implemented' : s}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Profile</span>
          {OCPP_PROFILES.map((p) => {
            const on = activeProfiles.has(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => toggleProfile(p)}
                aria-pressed={on}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  on
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background text-muted-foreground hover:bg-accent',
                )}
              >
                {OCPP_PROFILE_LABELS[p]}
              </button>
            );
          })}
        </div>
      </section>

      {filtered.length === 0 ? (
        <div className="rounded-md border bg-background p-6 text-center text-sm text-muted-foreground">
          No messages match the current filters. Clear the search or re-enable a profile chip.
        </div>
      ) : (
        visibleProfiles.map((profile) => (
          <ProfileSection key={profile} profile={profile} messages={grouped[profile]} />
        ))
      )}
    </div>
  );
}

function ProfileSection({
  profile,
  messages,
}: {
  profile: OcppProfile;
  messages: readonly OcppMessage[];
}) {
  return (
    <section className="space-y-2" data-testid={`profile-section-${profile}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-base font-semibold">{OCPP_PROFILE_LABELS[profile]}</h3>
        <span className="text-xs text-muted-foreground">
          {messages.length} message{messages.length === 1 ? '' : 's'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{OCPP_PROFILE_BLURBS[profile]}</p>
      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" aria-label="direction" />
              <TableHead className="w-48">Name</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="w-36">Status</TableHead>
              <TableHead className="w-24" aria-label="action" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {messages.map((msg) => (
              <MessageRow key={`${msg.profile}-${msg.name}-${msg.direction}`} message={msg} />
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function MessageRow({ message }: { message: OcppMessage }) {
  const status = STATUS_BADGE[message.status];
  const directionTitle =
    message.direction === 'charger-to-csms'
      ? 'Charger → CSMS (charger-initiated)'
      : 'CSMS → Charger (gateway-initiated)';
  const DirectionIcon = message.direction === 'charger-to-csms' ? ArrowDownLeft : ArrowUpRight;
  return (
    <TableRow data-testid={`row-${message.name}-${message.direction}`}>
      <TableCell>
        <span title={directionTitle} aria-label={directionTitle}>
          <DirectionIcon
            className={cn(
              'h-4 w-4',
              message.direction === 'charger-to-csms'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-brand-orange',
            )}
          />
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs">{message.name}</TableCell>
      <TableCell className="text-sm">
        <div>{message.summary}</div>
        {message.gatewayNote ? (
          <div className="mt-1 text-xs text-muted-foreground">{message.gatewayNote}</div>
        ) : null}
      </TableCell>
      <TableCell>
        <Badge variant={status.variant} data-testid={`badge-${message.name}-${message.direction}`}>
          {status.label}
        </Badge>
      </TableCell>
      <TableCell>
        {message.status === 'implemented' &&
        message.direction === 'csms-to-charger' &&
        message.consoleCommandSlug ? (
          <CopySlugButton slug={message.consoleCommandSlug} />
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function CopySlugButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(slug);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can fail in jsdom or when the document isn't focused.
      // Silent — the button is informational, not load-bearing.
    }
  }
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={copy}
      title={`Copy slug "${slug}" — available in the All commands drawer on each charger page.`}
      aria-label={`Copy command slug ${slug}`}
      className="h-7 gap-1 px-2 text-xs"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      <span className="font-mono">{slug}</span>
    </Button>
  );
}
