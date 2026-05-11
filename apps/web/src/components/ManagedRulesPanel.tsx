// Managed-rules panel for the Rules tab on /sys/alerts. Lets the
// operator add / edit / delete rules in the Console-managed group
// without SSHing the host. Pairs with RulesPanel (which shows the
// live state from Prometheus) — together they answer:
//
//   - what rules are loaded? (RulesPanel)
//   - which of them did the Console write? (this panel)
//
// Validation: the server runs `promtool check rules` before commit.
// A malformed PromQL expression returns 400 with the promtool stderr,
// which we surface inline on the form. When promtool is missing on the
// host the server returns `validation_skipped: true` — we render a
// banner so the operator knows their dev env lacks the safety net.

import { AlertCircle, AlertTriangle, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { ManagedAlertingRule } from '@/api/alerts-client';
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
  useCreateManagedRule,
  useDeleteManagedRule,
  useManagedRules,
  useUpdateManagedRule,
} from '@/hooks/use-managed-rules';
import { cn } from '@/lib/utils';

type DialogState =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; rule: ManagedAlertingRule };

export function ManagedRulesPanel() {
  const { rules, validationSkipped, loading, error } = useManagedRules();
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<ManagedAlertingRule | null>(null);

  return (
    <Card data-testid="managed-rules-panel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-sm font-medium">Managed rules</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Console-managed Prometheus rules. Edits reload Prometheus immediately.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialog({ kind: 'add' })}
          data-testid="add-managed-rule-button"
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" /> Add rule
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {validationSkipped ? (
          <Alert variant="default" data-testid="managed-rules-validation-skipped">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>PromQL validation skipped</AlertTitle>
            <AlertDescription>
              The server's <code className="font-mono text-xs">promtool</code> isn't on PATH so the
              last write went through without syntax checking. Production images include promtool;
              this only happens in dev.
            </AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="managed-rules-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" /> Loading managed rules…
          </div>
        ) : error ? (
          <Alert variant="destructive" data-testid="managed-rules-error">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load managed rules</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : rules.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y rounded-md border" data-testid="managed-rules-list">
            {rules.map((r) => (
              <RuleRow
                key={r.name}
                rule={r}
                onEdit={() => setDialog({ kind: 'edit', rule: r })}
                onDelete={() => setConfirmDelete(r)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <RuleDialog state={dialog} onClose={() => setDialog({ kind: 'closed' })} />

      <DeleteConfirm
        rule={confirmDelete}
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
      data-testid="managed-rules-empty"
    >
      <p>No managed rules yet.</p>
      <p className="mt-1 text-xs">
        Add a rule to have Prometheus evaluate it on every scrape cycle. Bundled rules from
        deploy/observability/alerts.yml still load — those aren't editable here.
      </p>
    </div>
  );
}

function RuleRow({
  rule,
  onEdit,
  onDelete,
}: {
  rule: ManagedAlertingRule;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      className="space-y-1.5 px-3 py-2.5"
      data-testid="managed-rule-row"
      data-rule-name={rule.name}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{rule.name}</span>
            <Badge variant={severityVariant(rule.severity)} className="text-[10px]">
              {rule.severity}
            </Badge>
            {rule.duration ? (
              <Badge variant="muted" className="font-mono text-[10px]">
                for: {rule.duration}
              </Badge>
            ) : null}
          </div>
          {rule.summary ? <p className="text-xs">{rule.summary}</p> : null}
          <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono text-[11px] text-foreground/90">
            {rule.expr}
          </pre>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={onEdit}
            data-testid="edit-managed-rule-button"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-destructive hover:bg-destructive/10"
            onClick={onDelete}
            data-testid="delete-managed-rule-button"
            aria-label={`Remove ${rule.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </li>
  );
}

function severityVariant(
  s: ManagedAlertingRule['severity'],
): 'destructive' | 'warning' | 'secondary' {
  if (s === 'critical') return 'destructive';
  if (s === 'warning') return 'warning';
  return 'secondary';
}

// ---------------------------------------------------------------------------
// Add / Edit dialog
// ---------------------------------------------------------------------------

function RuleDialog({ state, onClose }: { state: DialogState; onClose: () => void }) {
  if (state.kind === 'closed') return null;
  const isEdit = state.kind === 'edit';
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="managed-rule-dialog" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${state.rule.name}` : 'Add managed rule'}</DialogTitle>
          <DialogDescription>
            Prometheus evaluates this on every scrape cycle. Edits reload Prometheus immediately —
            an invalid expression is rejected before write so a typo can't break the rule engine.
          </DialogDescription>
        </DialogHeader>
        <RuleForm initial={isEdit ? state.rule : undefined} isEdit={isEdit} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function RuleForm({
  initial,
  isEdit,
  onClose,
}: {
  initial: ManagedAlertingRule | undefined;
  isEdit: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [expr, setExpr] = useState(initial?.expr ?? '');
  const [duration, setDuration] = useState(initial?.duration ?? '5m');
  const [severity, setSeverity] = useState<ManagedAlertingRule['severity']>(
    initial?.severity ?? 'warning',
  );
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  const create = useCreateManagedRule();
  const update = useUpdateManagedRule();
  const { toast } = useToast();
  const m = isEdit ? update : create;

  const valid = name.trim().length > 0 && expr.trim().length > 0;

  const submit = () => {
    const payload: ManagedAlertingRule = {
      name: name.trim(),
      expr: expr.trim(),
      duration: duration.trim(),
      severity,
      summary: summary.trim(),
      description: description.trim(),
    };
    m.mutate(payload, {
      onSuccess: () => {
        toast({ title: isEdit ? `Updated ${payload.name}` : `Added ${payload.name}` });
        onClose();
      },
      onError: (err) =>
        toast({
          variant: 'destructive',
          title: isEdit ? `Failed to update ${payload.name}` : `Failed to add ${payload.name}`,
          description: err.message,
        }),
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !m.isPending) submit();
      }}
      className="space-y-3"
    >
      <Field
        label="Name"
        hint="Alphanumeric with - or _, up to 63 chars. Can't be changed after creation."
        value={name}
        onChange={setName}
        disabled={isEdit}
        testId="managed-rule-name"
        placeholder="HighErrorRate"
      />
      <Field
        label="Expression"
        hint="PromQL — fires when the result is non-empty. Validated by promtool on the server."
        value={expr}
        onChange={setExpr}
        testId="managed-rule-expr"
        placeholder='rate(http_requests_total{status=~"5.."}[5m]) > 0.5'
        multiline
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="For"
          hint="Pending window before firing. Empty = fire immediately. e.g. 5m, 1h."
          value={duration}
          onChange={setDuration}
          testId="managed-rule-duration"
          placeholder="5m"
        />
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Severity
          </label>
          <Select
            value={severity}
            onChange={(e) => setSeverity(e.currentTarget.value as ManagedAlertingRule['severity'])}
            data-testid="managed-rule-severity"
          >
            <option value="critical">critical</option>
            <option value="warning">warning</option>
            <option value="info">info</option>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Routed through Alertmanager — make sure a channel handles this severity.
          </p>
        </div>
      </div>
      <Field
        label="Summary"
        hint="One-line operator-readable. Rendered in firing alerts."
        value={summary}
        onChange={setSummary}
        testId="managed-rule-summary"
        placeholder="HTTP 5xx rate elevated"
      />
      <Field
        label="Description (optional)"
        hint="Longer description; shown when an operator expands the firing alert."
        value={description}
        onChange={setDescription}
        testId="managed-rule-description"
        multiline
      />
      {m.error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Submit failed</AlertTitle>
          <AlertDescription className="font-mono text-xs">{m.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={m.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || m.isPending} data-testid="submit-managed-rule">
          {m.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add rule'}
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
  multiline,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (s: string) => void;
  disabled?: boolean;
  testId: string;
  placeholder?: string;
  multiline?: boolean;
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
          rows={3}
          className={cn(
            'flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          disabled={disabled}
          data-testid={testId}
          placeholder={placeholder}
        />
      )}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete confirm
// ---------------------------------------------------------------------------

function DeleteConfirm({
  rule,
  onCancel,
  onConfirmed,
}: {
  rule: ManagedAlertingRule | null;
  onCancel: () => void;
  onConfirmed: () => void;
}) {
  const del = useDeleteManagedRule();
  const { toast } = useToast();
  return (
    <AlertDialog open={!!rule} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent data-testid="delete-managed-rule-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {rule?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Prometheus will stop evaluating this rule on the next /-/reload. Currently firing
            instances will resolve. Bundled rules in deploy/observability/alerts.yml are unaffected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={del.isPending}
            data-testid="delete-managed-rule-confirm"
            onClick={() => {
              if (!rule) return;
              del.mutate(rule.name, {
                onSuccess: () => {
                  toast({ title: `Removed ${rule.name}` });
                  onConfirmed();
                },
                onError: (err) =>
                  toast({
                    variant: 'destructive',
                    title: `Failed to remove ${rule.name}`,
                    description: err.message,
                  }),
              });
            }}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
