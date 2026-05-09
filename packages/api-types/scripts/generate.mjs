// Generate TypeScript types from the gateway's OpenAPI spec.
//
// Source: GATEWAY_OPENAPI_SPEC env var, or a discovery fallback.
// Output: packages/api-types/src/generated/openapi.ts (gitignored).

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const outDir = resolve(pkgRoot, 'src/generated');
const outFile = resolve(outDir, 'openapi.ts');

const candidates = [
  process.env.GATEWAY_OPENAPI_SPEC,
  resolve(pkgRoot, 'openapi.yaml'),
  resolve(pkgRoot, '../../../ocpp/docs/api/openapi.yaml'),
  resolve(pkgRoot, '../../../../ocpp/docs/api/openapi.yaml'),
].filter(Boolean);

const source = candidates.find((p) => existsSync(p));
if (!source) {
  console.error('No OpenAPI spec found. Tried:');
  for (const c of candidates) console.error('  -', c);
  console.error(
    'Set GATEWAY_OPENAPI_SPEC=/path/to/openapi.yaml to point at a checkout of eveys-mobility/OCPP.',
  );
  process.exit(1);
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

console.log(`Generating api-types from ${source}`);
await exec('pnpm', ['exec', 'openapi-typescript', source, '-o', outFile], {
  cwd: pkgRoot,
  stdio: 'inherit',
});
console.log(`Wrote ${outFile}`);
