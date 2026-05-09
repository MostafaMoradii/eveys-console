// Generate a bcrypt hash for inclusion in CONSOLE_USERS. Reads the
// password from stdin (no shell history leak) and writes only the hash
// to stdout. Cost 10 (~75 ms on a recent laptop).
//
//   pnpm --filter @eveys-console/server hash-password
//   <type the password and hit Ctrl-D>
//
// Then prepend the username and a colon, append to CONSOLE_USERS:
//   CONSOLE_USERS=admin:$2a$10$abcd...,operator:$2a$10$efgh...

import { createInterface } from 'node:readline';
import bcrypt from 'bcryptjs';
const { hash } = bcrypt;

const isTTY = process.stdin.isTTY;
if (isTTY) {
  process.stderr.write('Password: ');
}

const rl = createInterface({ input: process.stdin, terminal: false });
let password = '';
for await (const line of rl) {
  password += line;
  break;
}

if (!password) {
  process.stderr.write('No password read from stdin.\n');
  process.exit(1);
}

const result = await hash(password, 10);
process.stdout.write(result + '\n');
