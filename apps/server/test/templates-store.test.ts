// Tests for the TemplatesStore — the disk-side of PR #169.
// What we're guarding:
//   - seed-on-boot is idempotent (operator state survives restarts)
//   - the atomic write doesn't leave half-written files visible to
//     Alertmanager during reload
//   - read() never throws on a missing file (callers render the
//     empty-state UI instead)

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TemplatesStore } from '../src/store/templates-store.js';

let dir: string;
let filePath: string;
let store: TemplatesStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'templates-'));
  filePath = join(dir, 'alertmanager-templates.yml');
  store = new TemplatesStore(filePath);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('TemplatesStore — seedIfMissing', () => {
  it('writes the defaults file when none exists', async () => {
    const created = await store.seedIfMissing();
    expect(created).toBe(true);
    const text = await readFile(filePath, 'utf8');
    expect(text).toContain('Managed by the Console');
    expect(text).toContain('{{ define "eveys.email.html" }}');
    expect(text).toContain('{{ define "eveys.telegram.message" }}');
    expect(text).toContain('{{ define "eveys.slack.title" }}');
  });

  it('is a no-op when the file already exists (operator state preserved)', async () => {
    await writeFile(filePath, '# operator-edited content\n', 'utf8');
    const created = await store.seedIfMissing();
    expect(created).toBe(false);
    const text = await readFile(filePath, 'utf8');
    expect(text).toBe('# operator-edited content\n');
  });
});

describe('TemplatesStore — read', () => {
  it('returns an empty string when the file does not exist', async () => {
    expect(await store.read()).toBe('');
  });

  it('returns the file contents otherwise', async () => {
    await writeFile(filePath, 'hello', 'utf8');
    expect(await store.read()).toBe('hello');
  });
});

describe('TemplatesStore — write atomicity', () => {
  it('does not leave the tmp file behind on success', async () => {
    await store.write();
    const entries = await readdir(dir);
    // exactly one file — the rename target. No `.tmp-...` siblings.
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe('alertmanager-templates.yml');
  });

  it('creates the parent dir on a fresh deploy where data/ is absent', async () => {
    const nested = join(dir, 'fresh', 'install', 'alertmanager-templates.yml');
    const s = new TemplatesStore(nested);
    await s.write();
    expect(await readFile(nested, 'utf8')).toContain('{{ define "eveys.email.html" }}');
  });
});
