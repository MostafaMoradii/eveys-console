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

import { AlertCircle, Mail, MessageSquare, Plus, Send, Trash2, Webhook, Wand2 } from 'lucide-react';
import { useState } from 'react';

import type {
  Channel,
  ChannelEmail,
  ChannelSlack,
  ChannelTelegram,
  ChannelWebhook,
} from '@/api/alerts-client';
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
            <MenuItem
              icon={<Send className="h-3.5 w-3.5" />}
              label="Telegram"
              onPick={() => {
                onPick('telegram');
                setOpen(false);
              }}
              testId="add-channel-telegram"
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
                onSuccess: (res) => {
                  toast({ title: `Default receiver is now ${channel.name}` });
                  if (res.reload && !res.reload.ok && !res.reload.skipped) {
                    toast({
                      variant: 'destructive',
                      title: 'Alertmanager refused the reload',
                      description: `${res.reload.detail} — the file on disk is updated but the running Alertmanager is still on the previous config. Restart it or fix the error and try again.`,
                    });
                  }
                },
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
    case 'telegram':
      return Send;
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
    case 'telegram':
      return `telegram → chat ${c.chat_id}`;
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
        ) : type === 'telegram' ? (
          <TelegramForm
            initial={initial as ChannelTelegram | undefined}
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
    case 'telegram':
      return 'Add Telegram receiver';
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
  const [text, setText] = useState(initial?.text ?? '');

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
          ...(text.trim() ? { text: text.trim() } : {}),
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
      <OverrideSection testId="slack-overrides" defaultOpen={Boolean(title.trim() || text.trim())}>
        <Field
          label="Title override"
          hint="Override the default Slack title template"
          value={title}
          onChange={setTitle}
          testId="slack-title"
        />
        <Field
          label="Text override"
          hint="Override the default Slack body template"
          value={text}
          onChange={setText}
          testId="slack-text"
          multiline
          rows={4}
        />
      </OverrideSection>
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
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [html, setHtml] = useState(initial?.html ?? '');
  const [text, setText] = useState(initial?.text ?? '');

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
          ...(subject.trim() ? { subject: subject.trim() } : {}),
          ...(html.trim() ? { html } : {}),
          ...(text.trim() ? { text } : {}),
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
      <OverrideSection
        testId="email-overrides"
        defaultOpen={Boolean(subject.trim() || html.trim() || text.trim())}
      >
        <Field
          label="Subject override"
          hint="Header that lands in the Subject: line — single line"
          value={subject}
          onChange={setSubject}
          testId="email-subject"
        />
        <Field
          label="HTML body override"
          hint="Replaces the managed `eveys.email.html` template"
          value={html}
          onChange={setHtml}
          testId="email-html"
          multiline
          rows={5}
        />
        <Field
          label="Text body override"
          hint="Plain-text fallback for clients that don't render HTML"
          value={text}
          onChange={setText}
          testId="email-text"
          multiline
          rows={4}
        />
      </OverrideSection>
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
  // Default auth-mode is whichever the existing channel has; new
  // channels start on "none" so a quick webhook with no auth is one
  // less field to skip past.
  const initialAuthMode: 'none' | 'basic' | 'bearer' = initial?.http_bearer_token
    ? 'bearer'
    : initial?.http_basic_auth_username || initial?.http_basic_auth_password
      ? 'basic'
      : 'none';
  const [authMode, setAuthMode] = useState<'none' | 'basic' | 'bearer'>(initialAuthMode);
  const [user, setUser] = useState(initial?.http_basic_auth_username ?? '');
  const [pass, setPass] = useState(initial?.http_basic_auth_password ?? '');
  const [bearer, setBearer] = useState(initial?.http_bearer_token ?? '');

  const submit = useChannelSubmit(isEdit, onClose);
  const valid = isValidChannelName(name) && url.trim();

  return (
    <FormShell
      onSubmit={() => {
        const base = { type: 'webhook' as const, name: name.trim(), url: url.trim() };
        const withAuth: ChannelWebhook =
          authMode === 'basic'
            ? {
                ...base,
                ...(user.trim() ? { http_basic_auth_username: user.trim() } : {}),
                ...(pass ? { http_basic_auth_password: pass } : {}),
              }
            : authMode === 'bearer'
              ? { ...base, ...(bearer ? { http_bearer_token: bearer } : {}) }
              : base;
        submit.go(withAuth);
      }}
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
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Auth mode
        </span>
        <select
          value={authMode}
          onChange={(e) => setAuthMode(e.currentTarget.value as 'none' | 'basic' | 'bearer')}
          data-testid="webhook-auth-mode"
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="none">None</option>
          <option value="basic">Basic auth</option>
          <option value="bearer">Bearer token</option>
        </select>
      </div>
      {authMode === 'basic' ? (
        <>
          <Field
            label="Basic-auth username"
            value={user}
            onChange={setUser}
            testId="webhook-user"
          />
          <Field
            label="Basic-auth password"
            hint="Masked — clear to keep existing value"
            value={pass}
            onChange={setPass}
            testId="webhook-pass"
            type="password"
          />
        </>
      ) : null}
      {authMode === 'bearer' ? (
        <Field
          label="Bearer token"
          hint="Sent as `Authorization: Bearer <token>` · Masked — clear to keep existing value"
          value={bearer}
          onChange={setBearer}
          testId="webhook-bearer"
          type="password"
        />
      ) : null}
    </FormShell>
  );
}

function TelegramForm({
  initial,
  isEdit,
  onClose,
}: FormBaseProps & { initial: ChannelTelegram | undefined }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [botToken, setBotToken] = useState(initial?.bot_token ?? '');
  const [chatId, setChatId] = useState(initial?.chat_id ?? '');
  const [apiUrl, setApiUrl] = useState(initial?.api_url ?? '');
  const [parseMode, setParseMode] = useState<'HTML' | 'MarkdownV2'>(initial?.parse_mode ?? 'HTML');
  const [message, setMessage] = useState(initial?.message ?? '');

  const submit = useChannelSubmit(isEdit, onClose);
  // On add, bot_token is required; on edit, an empty value means
  // "keep the existing secret" (server's mergeKeepSecrets handles
  // this), so name + chat_id are the only must-have fields.
  const valid =
    isValidChannelName(name) && /^-?\d+$/.test(chatId.trim()) && (isEdit || !!botToken.trim());

  return (
    <FormShell
      onSubmit={() => {
        const base: ChannelTelegram = {
          type: 'telegram',
          name: name.trim(),
          bot_token: botToken,
          chat_id: chatId.trim(),
        };
        if (apiUrl.trim()) base.api_url = apiUrl.trim();
        if (parseMode) base.parse_mode = parseMode;
        if (message.trim()) base.message = message;
        submit.go(base);
      }}
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
        testId="telegram-name"
        placeholder="oncall-telegram"
        hint="lowercase / digits / -_ only · max 63 chars · no spaces or @"
      />
      <Field
        label="Bot token"
        hint="From @BotFather · format `<bot_id>:<token>` · masked — clear to keep existing value"
        value={botToken}
        onChange={setBotToken}
        testId="telegram-bot-token"
        type="password"
      />
      <Field
        label="Chat ID"
        hint="Channel ids start with -100… · groups are negative · DMs are positive"
        value={chatId}
        onChange={setChatId}
        testId="telegram-chat-id"
        placeholder="-1001234567890"
      />
      <Field
        label="API URL (optional)"
        hint="Defaults to https://api.telegram.org — override only for a self-hosted Bot API"
        value={apiUrl}
        onChange={setApiUrl}
        testId="telegram-api-url"
        placeholder="https://api.telegram.org"
      />
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Message format
        </span>
        <select
          value={parseMode}
          onChange={(e) => setParseMode(e.currentTarget.value as 'HTML' | 'MarkdownV2')}
          data-testid="telegram-parse-mode"
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="HTML">HTML (default)</option>
          <option value="MarkdownV2">MarkdownV2</option>
        </select>
      </div>
      <OverrideSection testId="telegram-overrides" defaultOpen={Boolean(message.trim())}>
        <Field
          label="Message override"
          hint="Replaces the managed `eveys.telegram.message` template — respects the parse mode above"
          value={message}
          onChange={setMessage}
          testId="telegram-message"
          multiline
          rows={5}
        />
      </OverrideSection>
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
        onSuccess: (res) => {
          toast({ title: isEdit ? `Updated ${channel.name}` : `Added ${channel.name}` });
          if (res.reload && !res.reload.ok && !res.reload.skipped) {
            toast({
              variant: 'destructive',
              title: 'Alertmanager refused the reload',
              description: `${res.reload.detail} — the file on disk is updated but the running Alertmanager is still on the previous config. Restart it or fix the error and try again.`,
            });
          }
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
  multiline,
  rows,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (s: string) => void;
  disabled?: boolean;
  testId: string;
  placeholder?: string;
  type?: string;
  /** Render a `<textarea>` instead of `<input>`. Used by override
   *  fields (html / text / message) where the operator pastes
   *  multi-line content. */
  multiline?: boolean;
  /** Visible rows for the textarea. Ignored when `multiline` is
   *  falsy. Defaults to 4. */
  rows?: number;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          disabled={disabled}
          data-testid={testId}
          placeholder={placeholder}
          rows={rows ?? 4}
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          disabled={disabled}
          data-testid={testId}
          placeholder={placeholder}
          type={type}
          className={cn(type === 'password' && 'font-mono')}
        />
      )}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Disclosure wrapper for the per-channel template-override fields.
 *  Always-collapsed by default to keep the form small for the common
 *  case (operator wants the managed defaults); operators who need to
 *  customise expand it and edit. Open-by-default when any nested
 *  field already has a value, so an edit-flow on an existing override
 *  doesn't hide what's there. */
function OverrideSection({
  testId,
  defaultOpen,
  children,
}: {
  testId: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      data-testid={testId}
      className="rounded-md border bg-muted/30 px-3 py-2"
    >
      <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Custom message (optional)
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-[11px] text-muted-foreground">
          Leave empty to use the managed default templates. When set, the literal value goes into
          Alertmanager. Allowed root references: <code>.Alerts</code>, <code>.CommonLabels</code>,{' '}
          <code>.CommonAnnotations</code>, <code>.GroupLabels</code>, <code>.Status</code>,{' '}
          <code>.ExternalURL</code>.
        </p>
        {children}
      </div>
    </details>
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
                onSuccess: (res) => {
                  toast({ title: `Removed ${channel.name}` });
                  if (res.reload && !res.reload.ok && !res.reload.skipped) {
                    toast({
                      variant: 'destructive',
                      title: 'Alertmanager refused the reload',
                      description: `${res.reload.detail} — the file on disk is updated but the running Alertmanager is still on the previous config. Restart it or fix the error and try again.`,
                    });
                  }
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
