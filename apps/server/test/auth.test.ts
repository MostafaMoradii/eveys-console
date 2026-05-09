import { createHash } from 'node:crypto';

import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';

const bcryptHash = bcrypt.hash;

import { PowVerifier } from '../src/auth/pow.js';
import { UserStore } from '../src/auth/users.js';

describe('UserStore', () => {
  it('parses CONSOLE_USERS into a username→hash map', async () => {
    const hash = await bcryptHash('hunter2', 4);
    const store = new UserStore({ CONSOLE_USERS: `alice:${hash}` });
    expect(store.size).toBe(1);

    const ok = await store.verify('alice', 'hunter2');
    expect(ok?.username).toBe('alice');

    const bad = await store.verify('alice', 'wrong');
    expect(bad).toBeNull();
  });

  it('returns null on unknown users (and still spends time)', async () => {
    const store = new UserStore({ CONSOLE_USERS: '' });
    expect(store.size).toBe(0);
    const t0 = Date.now();
    const result = await store.verify('nobody', 'whatever');
    const elapsed = Date.now() - t0;
    expect(result).toBeNull();
    expect(elapsed).toBeGreaterThan(0); // bcrypt always burns some time
  });

  it('rejects malformed CONSOLE_USERS entries', () => {
    expect(() => new UserStore({ CONSOLE_USERS: 'no-colon' })).toThrow(/no colon/);
    expect(() => new UserStore({ CONSOLE_USERS: ':no-username' })).toThrow();
    expect(() => new UserStore({ CONSOLE_USERS: 'name:' })).toThrow(/empty username or hash/);
  });

  it('rejects duplicate usernames', async () => {
    const h = await bcryptHash('p', 4);
    expect(
      () => new UserStore({ CONSOLE_USERS: `alice:${h},alice:${h}` }),
    ).toThrow(/duplicate username/);
  });
});

describe('PowVerifier', () => {
  const cfg = {
    JWT_SECRET: 'a-test-secret-of-at-least-16-bytes',
    AUTH_POW_DIFFICULTY: 8,
    AUTH_POW_TTL_SECONDS: 60,
  } as const;

  function solve(challenge: string, difficulty: number): string {
    let counter = 0;
    while (true) {
      const solution = `s-${counter}`;
      const digest = createHash('sha256').update(`${challenge}:${solution}`).digest();
      if (hasZeros(digest, difficulty)) return solution;
      counter++;
    }
  }
  function hasZeros(d: Buffer, bits: number): boolean {
    let r = bits;
    for (const b of d) {
      if (r <= 0) return true;
      if (r >= 8) {
        if (b !== 0) return false;
        r -= 8;
        continue;
      }
      const mask = 0xff << (8 - r);
      return (b & mask) === 0;
    }
    return r <= 0;
  }

  it('issues and verifies a valid challenge+solution', () => {
    const v = new PowVerifier(cfg);
    const ch = v.issue();
    const solution = solve(ch.challenge, cfg.AUTH_POW_DIFFICULTY);
    expect(v.verify(ch.challenge, solution)).toBeNull();
  });

  it('rejects an unsigned (forged) challenge', () => {
    const v = new PowVerifier(cfg);
    const fake = `${Buffer.from(JSON.stringify({ nonce: 'x', difficulty: 8, issuedAt: Date.now() })).toString('base64url')}.aaaa`;
    expect(v.verify(fake, 'whatever')).toBe('bad_signature');
  });

  it('rejects an expired challenge', async () => {
    const v = new PowVerifier({ ...cfg, AUTH_POW_TTL_SECONDS: 1 });
    const ch = v.issue();
    const solution = solve(ch.challenge, cfg.AUTH_POW_DIFFICULTY);
    // Wait for the TTL to actually elapse, then verify.
    await new Promise((r) => setTimeout(r, 1100));
    expect(v.verify(ch.challenge, solution)).toBe('expired');
  });

  it('rejects insufficient work', () => {
    const v = new PowVerifier({ ...cfg, AUTH_POW_DIFFICULTY: 24 }); // out of reach quickly
    const ch = v.issue();
    expect(v.verify(ch.challenge, 'no-work')).toBe('insufficient_work');
  });
});
