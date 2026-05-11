// Round-trip + validation tests for the RulesStore. Same shape as
// channels-store.test.ts.
//
// `promtool` tests are skipped when the binary isn't on PATH — the
// store falls back to `{ ok: true, skipped: true }` and we assert
// that path explicitly.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RulesStore, __test__, type AlertingRule } from '../src/store/rules-store.js';

let dir: string;
let cfgPath: string;
let store: RulesStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rules-'));
  cfgPath = join(dir, 'alerts-managed.yml');
  // Use a definitely-missing binary so validate() falls into the
  // skipped path deterministically. Tests that need promtool stub it
  // separately.
  store = new RulesStore(cfgPath, '/definitely-not-a-promtool-binary');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('RulesStore — empty / missing', () => {
  it('returns empty config when the file does not exist', async () => {
    expect(await store.read()).toEqual({ managed: [], preserved_groups: [] });
  });

  it('returns empty config for a YAML that parses to null', async () => {
    await writeFile(cfgPath, '', 'utf8');
    expect(await store.read()).toEqual({ managed: [], preserved_groups: [] });
  });
});

describe('RulesStore — seedIfMissing', () => {
  it('writes an empty managed file when none exists', async () => {
    const created = await store.seedIfMissing();
    expect(created).toBe(true);
    const text = await readFile(cfgPath, 'utf8');
    expect(text).toContain('Managed by the Console');
    expect(text).toContain('console-managed');
  });

  it('no-ops when the file already exists', async () => {
    await writeFile(cfgPath, 'existing: content', 'utf8');
    const created = await store.seedIfMissing();
    expect(created).toBe(false);
    expect(await readFile(cfgPath, 'utf8')).toBe('existing: content');
  });
});

describe('RulesStore — round-trip', () => {
  it('round-trips a managed alerting rule', async () => {
    const rule: AlertingRule = {
      name: 'TestAlert',
      expr: 'up == 0',
      duration: '5m',
      severity: 'warning',
      summary: 'something is down',
      description: 'longer description',
    };
    await store.updateManaged([rule]);
    const out = await store.read();
    expect(out.managed).toEqual([rule]);
    expect(out.preserved_groups).toEqual([]);
  });

  it('preserves bundled groups untouched', async () => {
    // Write a file with one console-managed entry plus a separate
    // group whose shape the store doesn't know.
    const seed = [
      '# pre-existing',
      'groups:',
      '  - name: console-managed',
      '    rules: []',
      '  - name: bundled',
      '    rules:',
      '      - alert: ConsoleDown',
      '        expr: up{job="eveys-console"} == 0',
      '        for: 5m',
      '        labels:',
      '          severity: warning',
      '        annotations:',
      '          summary: Console scrape failing',
      '          description: 5 minutes',
      '',
    ].join('\n');
    await writeFile(cfgPath, seed, 'utf8');
    const cfg = await store.read();
    expect(cfg.managed).toEqual([]);
    expect(cfg.preserved_groups).toHaveLength(1);
    expect(cfg.preserved_groups[0]?.name).toBe('bundled');
    expect(cfg.preserved_groups[0]?.rules?.[0]?.alert).toBe('ConsoleDown');
  });

  it('round-trips bundled + managed together', async () => {
    const seed = [
      'groups:',
      '  - name: bundled',
      '    rules:',
      '      - alert: ConsoleDown',
      '        expr: up == 0',
      '        for: 5m',
      '        labels: { severity: warning }',
      '        annotations: { summary: down }',
      '',
    ].join('\n');
    await writeFile(cfgPath, seed, 'utf8');
    const myRule: AlertingRule = {
      name: 'CustomAlert',
      expr: 'rate(http_requests[1m]) > 10',
      duration: '1m',
      severity: 'critical',
      summary: 'high request rate',
      description: '',
    };
    await store.updateManaged([myRule]);
    const out = await store.read();
    expect(out.managed).toEqual([myRule]);
    expect(out.preserved_groups[0]?.name).toBe('bundled');
    expect(out.preserved_groups[0]?.rules?.[0]?.alert).toBe('ConsoleDown');
  });

  it('omits empty annotations + duration on emit', async () => {
    const rule: AlertingRule = {
      name: 'Minimal',
      expr: 'up == 0',
      duration: '',
      severity: 'info',
      summary: '',
      description: '',
    };
    await store.updateManaged([rule]);
    const text = await readFile(cfgPath, 'utf8');
    expect(text).not.toContain('annotations:');
    expect(text).not.toMatch(/for:/);
  });

  it('drops malformed rules from the managed group on read', async () => {
    const seed = [
      'groups:',
      '  - name: console-managed',
      '    rules:',
      '      - alert: Good',
      '        expr: up == 0',
      '        labels: { severity: warning }',
      // missing alert name → dropped
      '      - expr: irrelevant',
      // missing expr → dropped
      '      - alert: NoExpr',
      '',
    ].join('\n');
    await writeFile(cfgPath, seed, 'utf8');
    const cfg = await store.read();
    expect(cfg.managed.map((r) => r.name)).toEqual(['Good']);
  });
});

describe('RulesStore — validate', () => {
  it('falls back to skipped=true when promtool is not on PATH', async () => {
    const result = await store.validate({ managed: [], preserved_groups: [] });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

describe('renderRulesYaml shape', () => {
  it('always emits a console-managed group, even when empty', () => {
    const out = __test__.renderRulesYaml({ managed: [], preserved_groups: [] });
    expect(out).toContain('name: console-managed');
  });

  it('emits severity under labels for managed rules', () => {
    const out = __test__.renderRulesYaml({
      managed: [
        {
          name: 'X',
          expr: 'up == 0',
          duration: '5m',
          severity: 'critical',
          summary: 's',
          description: '',
        },
      ],
      preserved_groups: [],
    });
    expect(out).toMatch(/labels:\s*\n\s*severity:\s*critical/);
  });
});
