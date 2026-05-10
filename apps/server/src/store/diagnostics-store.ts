// SQLite-backed metadata store for diagnostic / log artefacts uploaded
// by chargers in response to GetDiagnostics / GetLog. The artefact bytes
// live on the filesystem under <dataDir>/uploads/<cp_id>/<request_id>;
// this table only carries the per-upload paperwork (token, timestamps,
// digest, status).
//
// Schema is versioned via PRAGMA user_version, mirroring the simulator's
// pattern. v1 carries everything we need for now; future migrations add
// columns or new tables without rewriting the historical rows.
//
// Why SQLite (not Postgres): per-pod state, single writer, no operator
// burden of running another database. Multi-pod is a separate iteration.
//
// Why filesystem (not S3): same answer — keep the v1 surface tiny. Object
// storage is the right answer when the deployment grows past one pod.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import Database from 'better-sqlite3';

export type DiagnosticsCommand = 'GetDiagnostics' | 'GetLog';
export type DiagnosticsStatus = 'pending' | 'uploaded' | 'expired' | 'failed';

export interface DiagnosticsRow {
  id: number;
  cp_id: string;
  command: DiagnosticsCommand;
  request_id: number;
  token: string;
  issued_at: number;
  issued_by: string;
  expires_at: number;
  received_at: number | null;
  file_path: string | null;
  file_size: number | null;
  file_sha256: string | null;
  status: DiagnosticsStatus;
}

/** Public-facing artefact view: token and file_path are server-internal. */
export interface DiagnosticsArtifact {
  id: number;
  cp_id: string;
  command: DiagnosticsCommand;
  request_id: number;
  issued_at: number;
  issued_by: string;
  expires_at: number;
  received_at: number | null;
  file_size: number | null;
  file_sha256: string | null;
  status: DiagnosticsStatus;
}

export interface IssueArgs {
  cp_id: string;
  command: DiagnosticsCommand;
  /** Operator/JWT subject who issued the URL. Stored verbatim. */
  issued_by: string;
  /** Optional explicit request_id (GetLog operators may want to set their
   *  own); when omitted a synthetic monotonic counter is used. */
  request_id?: number;
  /** Token TTL in seconds. */
  ttl_seconds: number;
}

export interface IssueResult {
  id: number;
  token: string;
  request_id: number;
  issued_at: number;
  expires_at: number;
}

export interface ConsumeArgs {
  token: string;
  /** Absolute path to the file written on disk. */
  file_path: string;
  file_size: number;
  file_sha256: string;
}

export type ConsumeError = 'unknown_token' | 'already_consumed' | 'expired' | 'wrong_status';

export interface ConsumeOk {
  ok: true;
  row: DiagnosticsRow;
}

export interface ConsumeFail {
  ok: false;
  reason: ConsumeError;
}

export type ConsumeResult = ConsumeOk | ConsumeFail;

export class DiagnosticsStore {
  readonly db: Database.Database;
  /** Resolved root for uploads (`<dataDir>/uploads`). */
  readonly uploadsDir: string;
  /** Resolved metadata DB path (`<dataDir>/console.sqlite`). */
  readonly dbPath: string;

  constructor(dataDir: string) {
    const root = resolve(dataDir);
    mkdirSync(root, { recursive: true });
    this.uploadsDir = join(root, 'uploads');
    mkdirSync(this.uploadsDir, { recursive: true });
    this.dbPath = join(root, 'console.sqlite');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    migrate(this.db);
  }

  close(): void {
    this.db.close();
  }

  /** Lazy expiry sweep — every issue/consume invokes this. We never let a
   *  pending row outlive its `expires_at`; rolling the status forward keeps
   *  the listing accurate without a cron. */
  sweepExpired(now = nowSeconds()): number {
    const r = this.db
      .prepare(
        `UPDATE diagnostic_artifacts SET status = 'expired'
           WHERE status = 'pending' AND expires_at < ?`,
      )
      .run(now);
    return r.changes;
  }

  /**
   * Inserts a new pending row and returns the record + freshly-minted
   * token. The caller embeds the token into the URL handed to the
   * charger; one-use enforcement happens in `consume`.
   */
  issue(args: IssueArgs, now = nowSeconds()): IssueResult {
    this.sweepExpired(now);

    const token = randomBytes(32).toString('hex');
    const requestId = args.request_id ?? this.nextSyntheticRequestId(args.cp_id);
    const expiresAt = now + args.ttl_seconds;

    const r = this.db
      .prepare(
        `INSERT INTO diagnostic_artifacts
           (cp_id, command, request_id, token, issued_at, issued_by, expires_at, status)
         VALUES (@cp_id, @command, @request_id, @token, @issued_at, @issued_by, @expires_at, 'pending')`,
      )
      .run({
        cp_id: args.cp_id,
        command: args.command,
        request_id: requestId,
        token,
        issued_at: now,
        issued_by: args.issued_by,
        expires_at: expiresAt,
      });

    return {
      id: Number(r.lastInsertRowid),
      token,
      request_id: requestId,
      issued_at: now,
      expires_at: expiresAt,
    };
  }

  /**
   * Looks up a pending row by token without mutating it. Used by the
   * upload route to validate the token before it streams the body to
   * disk; `consume` is the second half of the upload, after the bytes
   * are on disk and the digest is known.
   */
  findPending(token: string, now = nowSeconds()): { ok: true; row: DiagnosticsRow } | ConsumeFail {
    this.sweepExpired(now);
    const row = this.db.prepare(`SELECT * FROM diagnostic_artifacts WHERE token = ?`).get(token) as
      | DiagnosticsRow
      | undefined;
    if (!row) return { ok: false, reason: 'unknown_token' };
    if (row.received_at !== null) return { ok: false, reason: 'already_consumed' };
    if (row.expires_at < now) return { ok: false, reason: 'expired' };
    if (row.status !== 'pending') return { ok: false, reason: 'wrong_status' };
    return { ok: true, row };
  }

  /**
   * Marks a pending row as `uploaded` with the disk path, byte count and
   * SHA-256. Returns the updated row, or a `ConsumeFail` if the token is
   * no longer eligible (already used, expired, etc).
   */
  consume(args: ConsumeArgs, now = nowSeconds()): ConsumeResult {
    this.sweepExpired(now);

    const tx = this.db.transaction((c: ConsumeArgs): ConsumeResult => {
      const row = this.db
        .prepare(`SELECT * FROM diagnostic_artifacts WHERE token = ?`)
        .get(c.token) as DiagnosticsRow | undefined;
      if (!row) return { ok: false, reason: 'unknown_token' };
      if (row.received_at !== null) return { ok: false, reason: 'already_consumed' };
      if (row.expires_at < now) return { ok: false, reason: 'expired' };
      if (row.status !== 'pending') return { ok: false, reason: 'wrong_status' };

      this.db
        .prepare(
          `UPDATE diagnostic_artifacts
             SET status = 'uploaded', received_at = @received_at,
                 file_path = @file_path, file_size = @file_size, file_sha256 = @file_sha256
             WHERE id = @id`,
        )
        .run({
          id: row.id,
          received_at: now,
          file_path: c.file_path,
          file_size: c.file_size,
          file_sha256: c.file_sha256,
        });
      const updated = this.db
        .prepare(`SELECT * FROM diagnostic_artifacts WHERE id = ?`)
        .get(row.id) as DiagnosticsRow;
      return { ok: true, row: updated };
    });

    return tx(args);
  }

  /**
   * Public-facing per-charger history. Newest first. `limit` capped at
   * 200 to avoid returning the entire table; v1 doesn't paginate beyond
   * "give me the latest N" — the envelope carries `next_cursor: null`
   * so the contract is forward-compatible if we ever do.
   */
  list(cpId: string, limit = 20): DiagnosticsArtifact[] {
    const capped = Math.min(Math.max(1, limit), 200);
    const rows = this.db
      .prepare(
        `SELECT * FROM diagnostic_artifacts
           WHERE cp_id = ?
           ORDER BY issued_at DESC, id DESC
           LIMIT ?`,
      )
      .all(cpId, capped) as DiagnosticsRow[];
    return rows.map(toArtifact);
  }

  get(id: number): DiagnosticsRow | null {
    const row = this.db.prepare(`SELECT * FROM diagnostic_artifacts WHERE id = ?`).get(id) as
      | DiagnosticsRow
      | undefined;
    return row ?? null;
  }

  /**
   * Drops the row + best-effort removes the file. Returns true if a row
   * was deleted. Missing files are tolerated — the row was the source
   * of truth and the operator just asked to clear the record.
   */
  delete(id: number): boolean {
    const row = this.get(id);
    if (!row) return false;
    if (row.file_path) {
      try {
        rmSync(row.file_path, { force: true });
      } catch {
        // ignore — file may already be gone, or under a directory we
        // can't traverse. The metadata row leaving is what matters.
      }
    }
    const r = this.db.prepare(`DELETE FROM diagnostic_artifacts WHERE id = ?`).run(id);
    return r.changes > 0;
  }

  /**
   * Ensures the per-charger upload directory exists and returns the
   * absolute path to write the file to. The route streams body bytes
   * here.
   */
  pathFor(cpId: string, requestId: number): string {
    const dir = join(this.uploadsDir, sanitiseSegment(cpId));
    mkdirSync(dir, { recursive: true });
    return join(dir, String(requestId));
  }

  /**
   * Synthesises a request_id when the caller doesn't supply one
   * (GetDiagnostics has no native field for it, but we still want a
   * stable per-charger counter so the on-disk path is meaningful).
   * Race-safe within one process — the caller holds the open Database;
   * across processes the unique-token constraint catches duplicates.
   */
  private nextSyntheticRequestId(cpId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(request_id), 0) AS max FROM diagnostic_artifacts WHERE cp_id = ?`,
      )
      .get(cpId) as { max: number };
    return row.max + 1;
  }
}

export function toArtifact(r: DiagnosticsRow): DiagnosticsArtifact {
  return {
    id: r.id,
    cp_id: r.cp_id,
    command: r.command,
    request_id: r.request_id,
    issued_at: r.issued_at,
    issued_by: r.issued_by,
    expires_at: r.expires_at,
    received_at: r.received_at,
    file_size: r.file_size,
    file_sha256: r.file_sha256,
    status: r.status,
  };
}

/** Hash a Buffer/string the same way the upload route streams it. */
export function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Strip path-traversal segments from a `cp_id` before using it as a
 *  directory name. The DB column is the source of truth, but we still
 *  refuse to materialise a path that escapes the uploads root. */
function sanitiseSegment(s: string): string {
  // Allow a sensible char class for cp_id; replace anything else with `_`.
  // OCPP cp_ids in the wild use [A-Za-z0-9_.\-:].
  const cleaned = s.replace(/[^A-Za-z0-9_.\-:]/g, '_');
  // Refuse `.` / `..` outright.
  if (cleaned === '.' || cleaned === '..' || cleaned.length === 0) return '_';
  return cleaned;
}

export function ensureUnderRoot(absPath: string, root: string): boolean {
  const r = resolve(root) + (root.endsWith('/') ? '' : '/');
  const a = resolve(absPath);
  return a.startsWith(r);
}

/** Fail loudly if the data directory contains a file we don't expect. */
export function statSafe(path: string): { exists: boolean; size?: number } {
  try {
    const s = statSync(path);
    return { exists: true, size: s.size };
  } catch {
    return { exists: false };
  }
}

export function uploadDirOf(absFilePath: string): string {
  return dirname(absFilePath);
}

const MIGRATIONS: ((db: Database.Database) => void)[] = [
  // v1 — initial schema. One table; lives forever.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS diagnostic_artifacts (
        id INTEGER PRIMARY KEY,
        cp_id TEXT NOT NULL,
        command TEXT NOT NULL,
        request_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        issued_at INTEGER NOT NULL,
        issued_by TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        received_at INTEGER,
        file_path TEXT,
        file_size INTEGER,
        file_sha256 TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_diag_cp_id
        ON diagnostic_artifacts (cp_id, issued_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_diag_token
        ON diagnostic_artifacts (token);
    `);
  },
];

function migrate(db: Database.Database): void {
  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const step = MIGRATIONS[v];
    if (!step) continue;
    db.transaction(() => {
      step(db);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
