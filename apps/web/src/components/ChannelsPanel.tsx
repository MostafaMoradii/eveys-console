// Channels tab UI for /sys/alerts. Lists Alertmanager receivers and
// hosts the Add / Edit / Remove / Test actions.
//
// Forms per receiver type live in this file because they each touch
// the same mutation and share the same submit/error/cancel chrome —
// splitting them across files just adds plumbing. They render through
// a Dialog so the operator can dismiss without committing.
//
// Secrets behaviour: the server returns masked secrets (e.g.
// "https://hooks.slack.com••••3a4b"). The form pre-fills with the
// mask; an unchanged value means "keep existing secret" on PUT. A
// freshly-typed non-masked value overwrites.

import { AlertCircle, Mail, MessageSquare, Plus, Trash2, Webhook, Wand2 } from 'lucide-react';
import { useState } from 'react';

import type { Channel, ChannelEmail, ChannelSlack, ChannelWebhook } from '@/api/alerts-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toaster';
import {
  useChannels,
  useCreateChannel,
  useDeleteChannel,
  useSetDefaultChannel,
  useTestChannel,
  useUpdateChannel,
} from '@/hooks/use-channels';
import { cn } from '@/lib/utils';

type DialogState =
  | { kind: 'closed' }
  | { kind: 'add'; type: Channel['type'] }
  | { kind: 'edit'; channel: Channel };

// Mirrors the server's CHANNEL_NAME_RE in apps/server/src/routes/sys-alerts.ts.
// Used client-side to gate the submit button so the operator sees the
// rule before they see a 400 toast.
const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/i;
function isValidChannelName(s: string): boolean {
  return CHANNEL_NAME_RE.test(s.trim());
}

export function ChannelsPanel() {
  const { channels, defaultChannel, loading, error } = useChannels();
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<Channel | null>(null);

  return (
    <Card data-testid="channels-panel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-sm font-medium">Channels</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Where Alertmanager sends notifications.
          </p>
        </div>
        <AddReceiverMenu onPick={(type) => setDialog({ kind: 'add', type })} />
      </CardHeader>

      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground" data-testid="channels-loading">
            Loading channels…
          </p>
        ) : error ? (
          <Alert variant="destructive" data-testid="channels-error">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load channels</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : channels.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y rounded-md border" data-testid="channels-list">
            {channels.map((c) => (
              <ChannelRow
                key={c.name}
                channel={c}
                isDefault={c.name === defaultChannel}
                onEdit={() => setDialog({ kind: 'edit', channel: c })}
                onDelete={() => setConfirmDelete(c)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <ChannelDialog state={dialog} onClose={() => setDialog({ kind: 'closed' })} />

      <DeleteConfirm
        channel={confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onConfirmed={() => setConfirmDelete(null)}
      />
    </Card>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
      data-testid="channels-empty"
    >
      <p>No channels configured yet.</p>
      <p className="mt-1 text-xs">
        Add a receiver — Slack, email, or webhook — so Alertmanager has somewhere to send
        notifications.
      </p>
    </div>
  );
}

function AddReceiverMenu({ onPick }: { onPick: (type: Channel['type']) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        data-testid="add-channel-button"
        className="gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" /> Add receiver
      </Button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="absolute right-0 z-20 mt-1 w-48 rounded-md border bg-popover p-1 shadow-md"
            data-testid="add-channel-menu"
          >
            <MenuItem
              icon={<MessageSquare className="h-3.5 w-3.5" />}
              label="Slack"
              onPick={() => {
                onPick('slack');
                setOpen(false);
              }}
              testId="add-channel-slack"
            />
            <MenuItem
              icon={<Mail className="h-3.5 w-3.5" />}
              label="Email"
              onPick={() => {
                onPick('email');
                setOpen(false);
              }}
              testId="add-channel-email"
            />
            <MenuItem
              icon={<Webhook className="h-3.5 w-3.5" />}
              label="Webhook"
              onPick={() => {
                onPick('webhook');
                setOpen(false);
              }}
              testId="add-channel-webhook"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onPick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onPick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
      data-testid={testId}
    >
      {icon}
      {label}
    </button>
  );
}

function ChannelRow({
  channel,
  isDefault,
  onEdit,
  onDelete,
}: {
  channel: Channel;
  isDefault: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const test = useTestChannel();
  const setDefault = useSetDefaultChannel();
  const { toast } = useToast();
  const subtitle = summariseChannel(channel);
  const Icon = iconFor(channel.type);
  return (
    <li
      className="flex items-center justify-between gap-3 p-3"
      data-testid="channel-row"
      data-channel-name={channel.name}
      data-channel-type={channel.type}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{channel.name}</span>
          {isDefault ? (
            <Badge variant="success" className="text-[10px]">
              default
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs font-mono text-muted-foreground" title={subtitle}>
          {subtitle}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!isDefault ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
            disabled={setDefault.isPending}
            data-testid="set-default-channel-button"
            onClick={() => {
              setDefault.mutate(channel.name, {
                onSuccess: () => toast({ title: `Default receiver is now ${channel.name}` }),
                onError: (err) =>
                  toast({
                    variant: 'destructive',
                    title: `Couldn't switch default to ${channel.name}`,
                    description: err.message,
                  }),
              });
            }}
          >
            Set as default
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={test.isPending}
          data-testid="test-channel-button"
          onClick={() => {
            test.mutate(channel.name, {
              onSuccess: () =>
                toast({
                  title: `Test alert sent to ${channel.name}`,
                  description:
                    'Alertmanager accepted the synthetic alert. Check your destination for delivery.',
                }),
              onError: (err) =>
                toast({
                  variant: 'destructive',
                  title: `Test failed for ${channel.name}`,
                  description: err.message,
                }),
            });
          }}
        >
          <Wand2 className="h-3.5 w-3.5" /> Test
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={onEdit}
          data-testid="edit-channel-button"
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          data-testid="delete-channel-button"
          aria-label={`Remove ${channel.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

function iconFor(type: Channel['type']) {
  switch (type) {
    case 'slack':
      return MessageSquare;
    case 'email':
      return Mail;
    case 'webhook':
      return Webhook;
  }
}

function summariseChannel(c: Channel): string {
  switch (c.type) {
    case 'slack':
      return `slack → ${c.channel}`;
    case 'email':
      return `email → ${c.to}`;
    case 'webhook': {
      try {
        const u = new URL(c.url.includes('://') ? c.url : `https://${c.url}`);
        return `webhook → ${u.host}${u.pathname}`;
      } catch {
        return `webhook → ${c.url}`;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Add / Edit dialog
// ---------------------------------------------------------------------------

function ChannelDialog({ state, onClose }: { state: DialogState; onClose: () => void }) {
  if (state.kind === 'closed') return null;
  const isEdit = state.kind === 'edit';
  const type = isEdit ? state.channel.type : state.type;
  const initial = isEdit ? state.channel : undefined;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="channel-dialog">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${state.channel.name}` : titleFor(type)}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the receiver. Empty / masked secret fields keep the existing value.'
              : 'Receivers are persisted to the Console-managed Alertmanager config and reloaded immediately.'}
          </DialogDescription>
        </DialogHeader>

        {type === 'slack' ? (
          <SlackForm
            initial={initial as ChannelSlack | undefined}
            isEdit={isEdit}
            onClose={onClose}
          />
        ) : type === 'email' ? (
          <EmailForm
            initial={initial as ChannelEmail | undefined}
            isEdit={isEdit}
            onClose={onClose}
          />
        ) : (
          <WebhookForm
            initial={initial as ChannelWebhook | undefined}
            isEdit={isEdit}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function titleFor(type: Channel['type']): string {
  switch (type) {
    case 'slack':
      return 'Add Slack receiver';
    case 'email':
      return 'Add email receiver';
    case 'webhook':
      return 'Add webhook receiver';
  }
}

// ---- forms -----------------------------------------------------------------

interface FormBaseProps {
  isEdit: boolean;
  onClose: () => void;
}

function SlackForm({
  initial,
  isEdit,
  onClose,
}: FormBaseProps & { initial: ChannelSlack | undefined }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [apiUrl, setApiUrl] = useState(initial?.api_url ?? '');
  const [channel, setChannel] = useState(initial?.channel ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');

  const submit = useChannelSubmit(isEdit, onClose);
  const valid = isValidChannelName(name) && apiUrl.trim() && channel.trim();

  return (
    <FormShell
      onSubmit={() =>
        submit.go({
          type: 'slack',
          name: name.trim(),
          api_url: apiUrl.trim(),
          channel: channel.trim(),
          ...(title.trim() ? { title: title.trim() } : {}),
        })
      }
      onClose={onClose}
      isPending={submit.isPending}
      error={submit.error}
      valid={!!valid}
      isEdit={isEdit}
    >
      <Field
        label="Name"
        hint="lowercase / digits / -_ only · max 63 chars · no spaces or @"
        disabled={isEdit}
        value={name}
        onChange={setName}
        testId="slack-name"
        placeholder="ops-slack"
      />
      <Field
        label="Webhook URL"
        hint="Slack incoming-webhook URL — keep the existing value by leaving the masked text"
        value={apiUrl}
        onChange={setApiUrl}
        testId="slack-api-url"
        placeholder="https://hooks.slack.com/services/..."
      />
      <Field
        label="Channel"
        hint="Where the message goes — e.g. #ocpp-alerts"
        value={channel}
        onChange={setChannel}
        testId="slack-channel"
        placeholder="#ocpp-alerts"
      />
      <Field
        label="Title (optional)"
        hint="Override the default Alertmanager-rendered title"
        value={title}
        onChange={setTitle}
        testId="slack-title"
      />
    </FormShell>
  );
}

function EmailForm({
  initial,
  isEdit,
  onClose,
}: FormBaseProps & { initial: ChannelEmail | undefined }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [to, setTo] = useState(initial?.to ?? '');
  const [from, setFrom] = useState(initial?.from ?? '');
  const [smarthost, setSmarthost] = useState(initial?.smarthost ?? '');
  const [user, setUser] = useState(initial?.auth_username ?? '');
  const [pass, setPass] = useState(initial?.auth_password ?? '');
  const [tls, setTls] = useState(initial?.require_tls ?? true);

  const submit = useChannelSubmit(isEdit, onClose);
  const valid = isValidChannelName(name) && to.trim() && from.trim() && smarthost.trim();

  return (
    <FormShell
      onSubmit={() =>
        submit.go({
          type: 'email',
          name: name.trim(),
          to: to.trim(),
          from: from.trim(),
          smarthost: smarthost.trim(),
          ...(user.trim() ? { auth_username: user.trim() } : {}),
          ...(pass ? { auth_password: pass } : {}),
          require_tls: tls,
        })
      }
      onClose={onClose}
      isPending={submit.isPending}
      error={submit.error}
      valid={!!valid}
      isEdit={isEdit}
    >
      <Field
        label="Name"
        disabled={isEdit}
        value={name}
        onChange={setName}
        testId="email-name"
        placeholder="oncall-email"
        hint="lowercase / digits / -_ only · max 63 chars · no spaces or @"
      />
      <Field
        label="To"
        value={to}
        onChange={setTo}
        testId="email-to"
        placeholder="oncall@example.com"
      />
      <Field
        label="From"
        value={from}
        onChange={setFrom}
        testId="email-from"
        placeholder="console@example.com"
      />
      <Field
        label="SMTP host"
        hint="host:port — e.g. smtp.example.com:587"
        value={smarthost}
        onChange={setSmarthost}
        testId="email-smarthost"
      />
      <Field label="SMTP username (optional)" value={user} onChange={setUser} testId="email-user" />
      <Field
        label="SMTP password (optional)"
        hint="Masked — clear to keep existing value, type a new value to replace"
        value={pass}
        onChange={setPass}
        testId="email-pass"
        type="password"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={tls}
          onChange={(e) => setTls(e.currentTarget.checked)}
          data-testid="email-tls"
        />
        Require TLS
      </label>
    </FormShell>
  );
}

function WebhookForm({
  initial,
  isEdit,
  onClose,
}: FormBaseProps & { initial: ChannelWebhook | undefined }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [user, setUser] = useState(initial?.http_basic_auth_username ?? '');
  const [pass, setPass] = useState(initial?.http_basic_auth_password ?? '');

  const submit = useChannelSubmit(isEdit, onClose);
  const valid = isValidChannelName(name) && url.trim();

  return (
    <FormShell
      onSubmit={() =>
        submit.go({
          type: 'webhook',
          name: name.trim(),
          url: url.trim(),
          ...(user.trim() ? { http_basic_auth_username: user.trim() } : {}),
          ...(pass ? { http_basic_auth_password: pass } : {}),
        })
      }
      onClose={onClose}
      isPending={submit.isPending}
      error={submit.error}
      valid={!!valid}
      isEdit={isEdit}
    >
      <Field
        label="Name"
        disabled={isEdit}
        value={name}
        onChange={setName}
        testId="webhook-name"
        placeholder="pagerduty-bridge"
        hint="lowercase / digits / -_ only · max 63 chars · no spaces or @"
      />
      <Field
        label="URL"
        value={url}
        onChange={setUrl}
        testId="webhook-url"
        placeholder="https://events.example.com/hook"
      />
      <Field
        label="Basic-auth username (optional)"
        value={user}
        onChange={setUser}
        testId="webhook-user"
      />
      <Field
        label="Basic-auth password (optional)"
        hint="Masked — clear to keep existing value"
        value={pass}
        onChange={setPass}
        testId="webhook-pass"
        type="password"
      />
    </FormShell>
  );
}

function useChannelSubmit(isEdit: boolean, onClose: () => void) {
  const create = useCreateChannel();
  const update = useUpdateChannel();
  const { toast } = useToast();
  const m = isEdit ? update : create;
  return {
    isPending: m.isPending,
    error: m.error?.message ?? null,
    go: (channel: Channel) => {
      m.mutate(channel, {
        onSuccess: () => {
          toast({ title: isEdit ? `Updated ${channel.name}` : `Added ${channel.name}` });
          onClose();
        },
        onError: (err) =>
          toast({
            variant: 'destructive',
            title: isEdit ? `Failed to update ${channel.name}` : `Failed to add ${channel.name}`,
            description: err.message,
          }),
      });
    },
  };
}

function FormShell({
  onSubmit,
  onClose,
  isPending,
  error,
  valid,
  isEdit,
  children,
}: {
  onSubmit: () => void;
  onClose: () => void;
  isPending: boolean;
  error: string | null;
  valid: boolean;
  isEdit: boolean;
  children: React.ReactNode;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !isPending) onSubmit();
      }}
      className="space-y-3"
    >
      <div className="space-y-3">{children}</div>
      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Submit failed</AlertTitle>
          <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || isPending} data-testid="submit-channel">
          {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add receiver'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  disabled,
  testId,
  placeholder,
  type,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (s: string) => void;
  disabled?: boolean;
  testId: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        disabled={disabled}
        data-testid={testId}
        placeholder={placeholder}
        type={type}
        className={cn(type === 'password' && 'font-mono')}
      />
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ---- delete confirm --------------------------------------------------------

function DeleteConfirm({
  channel,
  onCancel,
  onConfirmed,
}: {
  channel: Channel | null;
  onCancel: () => void;
  onConfirmed: () => void;
}) {
  const del = useDeleteChannel();
  const { toast } = useToast();
  return (
    <AlertDialog open={!!channel} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent data-testid="delete-channel-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {channel?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Alerts routed to this receiver will fall back to the next available channel (or the
            synthetic default if none remain). The change takes effect immediately after
            Alertmanager reloads.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={del.isPending}
            onClick={() => {
              if (!channel) return;
              del.mutate(channel.name, {
                onSuccess: () => {
                  toast({ title: `Removed ${channel.name}` });
                  onConfirmed();
                },
                onError: (err) =>
                  toast({
                    variant: 'destructive',
                    title: `Failed to remove ${channel.name}`,
                    description: err.message,
                  }),
              });
            }}
            data-testid="delete-channel-confirm"
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Unused but kept exported for future severity-based default routing UI.
export { Select };
