// Reads and writes the Prometheus rules file the Console manages.
//
// File lifecycle (mirrors ChannelsStore):
//   - Deploy seeds `data/alerts-managed.yml` from the bundled
//     `deploy/observability/alerts.yml` on first boot (one-time).
//   - Console writes through the `console-managed` group from then on.
//   - Other groups in the file (bundled / hand-edited) round-trip
//     untouched. The Rules-tab UI only manages the console-managed
//     group; the rest exists for the operator to inspect.
//
// PromQL validation is done by the route layer via `promtool check
// rules`, NOT in this store — the store is the persistence boundary,
// not the policy boundary. Callers run validation against a candidate
// file before write, then the store commits atomically.

import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { parse, stringify } from 'yaml';

export interface AlertingRule {
  /** The alert name (used as the `alert:` key in Prometheus rule
   *  files). Must be unique within the managed group. */
  name: string;
  /** PromQL expression. */
  expr: string;
  /** `for:` duration as the operator types it ('5m', '1h', '30s').
   *  Empty string means no pending window. */
  duration: string;
  /** Required so Alertmanager routing has something to match on. */
  severity: 'critical' | 'warning' | 'info';
  /** One-line operator-readable summary; rendered in firing alerts. */
  summary: string;
  /** Longer description; rendered in firing alerts when expanded. */
  description: string;
}

export interface ManagedRulesConfig {
  /** Rules in the Console-managed group. Editable through the UI. */
  managed: AlertingRule[];
  /** Other groups in the file (bundled / hand-edited). Preserved
   *  round-trip but not exposed for editing. */
  preserved_groups: RawGroup[];
}

/** A group as the YAML emits it. Kept loose because we round-trip
 *  groups whose shape we don't control. */
interface RawGroup {
  name: string;
  interval?: string;
  rules: RawRule[];
}

interface RawRule {
  // alerting rule
  alert?: string;
  expr?: string;
  for?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  // recording rule
  record?: string;
  // plus anything else the operator typed; passed through.
  [key: string]: unknown;
}

const MANAGED_GROUP_NAME = 'console-managed';

const VALID_SEVERITIES = new Set(['critical', 'warning', 'info']);

// ----------------------------------------------------------------------------
// Store
// ----------------------------------------------------------------------------

export class RulesStore {
  constructor(
    private readonly path: string,
    private readonly promtoolPath: string,
  ) {}

  /** Read + parse the managed file. Returns an empty managed group
   *  plus the preserved groups when the file is missing — caller
   *  renders the "no rules" empty state. */
  async read(): Promise<ManagedRulesConfig> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (err) {
      if (isNoEntry(err)) return { managed: [], preserved_groups: [] };
      throw err;
    }
    return parseRulesYaml(text);
  }

  /** Replace the managed group's rules and persist. Returns the new
   *  config. Caller validated the rules (via validate()) before
   *  reaching here. */
  async updateManaged(rules: AlertingRule[]): Promise<ManagedRulesConfig> {
    const current = await this.read();
    const next: ManagedRulesConfig = { ...current, managed: rules };
    await this.write(next);
    return next;
  }

  /** Atomically write the managed file. Creates the parent dir on
   *  first write. */
  async write(cfg: ManagedRulesConfig): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const yaml = renderRulesYaml(cfg);
    const tmp = `${this.path}.tmp-${process.pid}`;
    await writeFile(tmp, yaml, 'utf8');
    await rename(tmp, this.path);
  }

  /** Validate a candidate config via `promtool check rules`. Renders
   *  the YAML to a tmpfile, runs promtool against it, and returns
   *  `{ ok: true }` if exit code is 0. On promtool exit != 0,
   *  returns `{ ok: false, error: stderr }`. When promtool isn't
   *  found on PATH, returns `{ ok: true, skipped: true }` — the
   *  caller logs a warning. */
  async validate(cfg: ManagedRulesConfig): Promise<ValidationResult> {
    const yaml = renderRulesYaml(cfg);
    const tmp = `${this.path}.validate-${process.pid}`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(tmp, yaml, 'utf8');
    try {
      return await runPromtool(this.promtoolPath, tmp);
    } finally {
      // Best-effort cleanup; if promtool didn't write to it, this is
      // fine to fail.
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  /** One-time seed on boot. Mirrors ChannelsStore.seedIfMissing. */
  async seedIfMissing(): Promise<boolean> {
    try {
      await readFile(this.path, 'utf8');
      return false;
    } catch (err) {
      if (!isNoEntry(err)) throw err;
      await this.write({ managed: [], preserved_groups: [] });
      return true;
    }
  }
}

export interface ValidationResult {
  ok: boolean;
  /** Set when promtool was skipped because the binary wasn't found.
   *  The route surfaces this so the UI can hint that the dev
   *  environment lacks the safety net. */
  skipped?: boolean;
  /** promtool stderr when ok=false. */
  error?: string;
}

// ----------------------------------------------------------------------------
// YAML serialization
// ----------------------------------------------------------------------------

interface PrometheusRulesYaml {
  groups?: RawGroup[];
}

function parseRulesYaml(text: string): ManagedRulesConfig {
  const raw = parse(text) as PrometheusRulesYaml | null;
  if (!raw || typeof raw !== 'object') return { managed: [], preserved_groups: [] };
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  let managed: AlertingRule[] = [];
  const preserved: RawGroup[] = [];
  for (const g of groups) {
    if (!g || typeof g.name !== 'string') continue;
    if (g.name === MANAGED_GROUP_NAME) {
      managed = (g.rules ?? []).map(parseManagedRule).filter((r): r is AlertingRule => r !== null);
    } else {
      preserved.push(g);
    }
  }
  return { managed, preserved_groups: preserved };
}

function parseManagedRule(r: RawRule): AlertingRule | null {
  if (typeof r.alert !== 'string' || r.alert.length === 0) return null;
  if (typeof r.expr !== 'string') return null;
  const sev = r.labels?.severity;
  const severity = VALID_SEVERITIES.has(sev ?? '') ? (sev as AlertingRule['severity']) : 'info';
  return {
    name: r.alert,
    expr: r.expr,
    duration: typeof r.for === 'string' ? r.for : '',
    severity,
    summary: r.annotations?.summary ?? '',
    description: r.annotations?.description ?? '',
  };
}

function renderRulesYaml(cfg: ManagedRulesConfig): string {
  const groups: RawGroup[] = [];

  // Managed group always emitted, even when empty — Prometheus
  // accepts an empty group, and an empty file would round-trip to
  // "groups: undefined" which is ambiguous.
  groups.push({
    name: MANAGED_GROUP_NAME,
    rules: cfg.managed.map(toRawRule),
  });

  // Preserved groups round-trip unchanged. Skip a stray group that
  // happens to share the managed name (defensive against hand edits).
  for (const g of cfg.preserved_groups) {
    if (g.name === MANAGED_GROUP_NAME) continue;
    groups.push(g);
  }

  return (
    '# Managed by the Console — the `console-managed` group is editable\n' +
    '# via /sys/alerts → Rules. Other groups are preserved on round-trip\n' +
    '# but not exposed for editing through the UI.\n' +
    stringify({ groups }, { lineWidth: 0 })
  );
}

function toRawRule(rule: AlertingRule): RawRule {
  const out: RawRule = {
    alert: rule.name,
    expr: rule.expr,
    labels: { severity: rule.severity },
    annotations: {},
  };
  if (rule.duration) out.for = rule.duration;
  if (rule.summary) out.annotations!.summary = rule.summary;
  if (rule.description) out.annotations!.description = rule.description;
  // Don't emit an empty annotations block.
  if (Object.keys(out.annotations!).length === 0) delete out.annotations;
  return out;
}

// ----------------------------------------------------------------------------
// promtool
// ----------------------------------------------------------------------------

function runPromtool(promtoolPath: string, file: string): Promise<ValidationResult> {
  return new Promise((resolve) => {
    const proc = spawn(promtoolPath, ['check', 'rules', file], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    let stdout = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    proc.on('error', (err) => {
      // ENOENT — promtool isn't on PATH. Common in dev; not fatal.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ ok: true, skipped: true });
        return;
      }
      resolve({ ok: false, error: err.message });
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      // promtool prints validation errors to stderr; stdout has the
      // summary line when --help is passed but we want the actual
      // error here.
      resolve({ ok: false, error: stderr || stdout || `promtool exited with code ${code}` });
    });
  });
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function isNoEntry(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}

export const __test__ = {
  parseRulesYaml,
  renderRulesYaml,
  toRawRule,
  MANAGED_GROUP_NAME,
};
