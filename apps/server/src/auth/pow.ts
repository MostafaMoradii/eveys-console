// Anti-robot proof-of-work CAPTCHA for the login form. The server hands
// the client a signed challenge string; the client must find a `solution`
// (a short string) such that SHA-256(challenge + ':' + solution) has at
// least N leading zero BITS. The work is small (~50 ms at difficulty 16,
// ~1 s at 20) for a real browser; trivially blocks dumb credential-stuffing
// scripts that don't bother computing it.
//
// The signature on the challenge means we don't need server-side state —
// the verifier checks the HMAC, the timestamp, and the difficulty all
// from the challenge string itself.

import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

import type { Config } from '../config.js';

interface ChallengePayload {
  nonce: string;
  difficulty: number;
  issuedAt: number;
}

export interface PowChallenge {
  challenge: string; // The string the client signs solutions against.
  difficulty: number;
  expiresAt: number; // Unix ms.
}

export class PowVerifier {
  constructor(
    private readonly cfg: Pick<Config, 'JWT_SECRET' | 'AUTH_POW_DIFFICULTY' | 'AUTH_POW_TTL_SECONDS'>,
  ) {}

  issue(): PowChallenge {
    const payload: ChallengePayload = {
      nonce: randomBytes(12).toString('base64url'),
      difficulty: this.cfg.AUTH_POW_DIFFICULTY,
      issuedAt: Date.now(),
    };
    const body = encodePayload(payload);
    const sig = this.sign(body);
    return {
      challenge: `${body}.${sig}`,
      difficulty: payload.difficulty,
      expiresAt: payload.issuedAt + this.cfg.AUTH_POW_TTL_SECONDS * 1000,
    };
  }

  // Returns null on success; an error code string on failure.
  verify(challenge: string, solution: string): null | 'malformed' | 'bad_signature' | 'expired' | 'insufficient_work' {
    const idx = challenge.lastIndexOf('.');
    if (idx <= 0) return 'malformed';
    const body = challenge.slice(0, idx);
    const sig = challenge.slice(idx + 1);

    const expected = this.sign(body);
    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return 'bad_signature';
    }

    let payload: ChallengePayload;
    try {
      payload = decodePayload(body);
    } catch {
      return 'malformed';
    }

    if (Date.now() - payload.issuedAt > this.cfg.AUTH_POW_TTL_SECONDS * 1000) {
      return 'expired';
    }

    const digest = createHash('sha256').update(`${challenge}:${solution}`).digest();
    if (!hasLeadingZeroBits(digest, payload.difficulty)) {
      return 'insufficient_work';
    }
    return null;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.cfg.JWT_SECRET).update(body).digest('base64url');
  }
}

function encodePayload(p: ChallengePayload): string {
  return Buffer.from(JSON.stringify(p)).toString('base64url');
}

function decodePayload(body: string): ChallengePayload {
  const json = Buffer.from(body, 'base64url').toString('utf8');
  const parsed = JSON.parse(json) as ChallengePayload;
  if (
    typeof parsed.nonce !== 'string' ||
    typeof parsed.difficulty !== 'number' ||
    typeof parsed.issuedAt !== 'number'
  ) {
    throw new Error('bad payload');
  }
  return parsed;
}

function hasLeadingZeroBits(digest: Buffer, bits: number): boolean {
  let remaining = bits;
  for (const byte of digest) {
    if (remaining <= 0) return true;
    if (remaining >= 8) {
      if (byte !== 0) return false;
      remaining -= 8;
      continue;
    }
    const mask = 0xff << (8 - remaining);
    return (byte & mask) === 0;
  }
  return remaining <= 0;
}
