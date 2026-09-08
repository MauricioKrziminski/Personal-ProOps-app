import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { productionRuntimeConfig } from './native-compatibility.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFingerprintAsync } = require('@expo/fingerprint');
const { getConfig } = require('@expo/config');
const output = process.argv[2];
if (!output) throw new Error('Informe caminho de saída.');
if (process.env.APP_VARIANT !== 'production') throw new Error('APP_VARIANT=production obrigatório.');
const { exp } = getConfig(process.cwd());
const runtime = productionRuntimeConfig(exp, JSON.parse(readFileSync('eas.json', 'utf8')));
const publicEnvironment = Object.entries(process.env).filter(([key]) => key.startsWith('EXPO_PUBLIC_')).sort(([a], [b]) => a.localeCompare(b));
if (!publicEnvironment.length) throw new Error('Ambiente público ausente; execute através de eas env:exec.');
const fingerprint = await createFingerprintAsync(process.cwd(), { platforms: ['android'], sourceSkips: 0 });
writeFileSync(output, JSON.stringify({
  schema: 1,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  ...runtime,
  fingerprint: fingerprint.hash,
  fingerprintVersion: require('@expo/fingerprint/package.json').version,
  publicEnvironmentHash: createHash('sha256').update(JSON.stringify(publicEnvironment)).digest('hex'),
}, null, 2) + '\n');
