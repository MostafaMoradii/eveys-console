// Console-managed Alertmanager templates.
//
// Alertmanager renders receiver bodies through Go text/html templates.
// Without a `templates:` block + named templates, every receiver
// falls back to Alertmanager's built-in defaults — which are tuned
// for email (subject + plain body) and look identical on every
// channel. Operators read the same blob in Telegram as in their
// inbox; that's the symptom this module fixes.
//
// We write one consolidated templates file the Console owns. The
// managed config (alertmanager-managed.yml) grows a `templates:`
// list pointing at the in-container path; receivers reference the
// named templates via {{ template "eveys.email.html" . }}.
//
// File layout:
//
//   {{ define "eveys.email.subject" }} … {{ end }}
//   {{ define "eveys.email.html" }} … {{ end }}
//   …
//
// Persistence: a single file at ALERTMANAGER_TEMPLATES_PATH, written
// atomically (tmp + rename) so Alertmanager never sees a half-
// written file mid-reload. Idempotent seed on first boot.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { DEFAULT_TEMPLATES, renderTemplatesYaml } from './templates-defaults.js';

export class TemplatesStore {
  constructor(private readonly path: string) {}

  /** Read the rendered YAML straight from disk. The Templates tab
   *  in a future PR will diff this against the defaults to surface
   *  which templates are operator-overridden. */
  async read(): Promise<string> {
    try {
      return await readFile(this.path, 'utf8');
    } catch (err: unknown) {
      if (isNoEntry(err)) return '';
      throw err;
    }
  }

  /** Write the defaults file. PR 1 ships only defaults; PR 2 will
   *  extend this signature to accept per-name overrides. The atomic
   *  rename is the same pattern ChannelsStore uses — Alertmanager
   *  watches the file and reloads on rename; partial writes never
   *  become visible. */
  async write(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const yaml = renderTemplatesYaml(DEFAULT_TEMPLATES);
    const tmp = `${this.path}.tmp-${process.pid}`;
    await writeFile(tmp, yaml, 'utf8');
    await rename(tmp, this.path);
  }

  /** Write the file if it doesn't exist yet. Idempotent — re-running
   *  on boot doesn't clobber operator state. Returns true when the
   *  file was created. */
  async seedIfMissing(): Promise<boolean> {
    try {
      await readFile(this.path, 'utf8');
      return false;
    } catch (err: unknown) {
      if (!isNoEntry(err)) throw err;
      await this.write();
      return true;
    }
  }
}

function isNoEntry(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}
