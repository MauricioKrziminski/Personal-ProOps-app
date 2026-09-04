import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function normalizeFingerprint(value) {
  if (typeof value !== 'string') {
    throw new TypeError('a impressão SHA-256 precisa ser uma string');
  }

  const normalized = value.replaceAll(':', '').replaceAll(' ', '').toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new TypeError('a impressão SHA-256 precisa conter 64 dígitos hexadecimais');
  }

  return normalized;
}

export function extractSignerDigests(output) {
  const digests = [];
  const pattern = /^Signer #\d+ certificate SHA-256 digest:\s*([^\s]+)\s*$/gim;

  for (const match of output.matchAll(pattern)) {
    digests.push(normalizeFingerprint(match[1]));
  }

  return digests;
}

export function assertExpectedSigner(digests, expectedFingerprint) {
  if (digests.length !== 1) {
    throw new Error(`o APK precisa ter exatamente um signer; encontrados: ${digests.length}`);
  }

  const expected = normalizeFingerprint(expectedFingerprint);
  if (digests[0] !== expected) {
    throw new Error('o APK foi assinado com uma chave diferente da esperada');
  }
}

function runCli() {
  const { values } = parseArgs({
    options: {
      apk: { type: 'string' },
      'expected-sha256': { type: 'string' },
      apksigner: { type: 'string', default: 'apksigner' },
    },
    strict: true,
  });

  if (!values.apk || !values['expected-sha256']) {
    throw new TypeError('--apk e --expected-sha256 são obrigatórios');
  }

  const result = spawnSync(
    values.apksigner,
    ['verify', '--verbose', '--print-certs', values.apk],
    { encoding: 'utf8' },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim() || 'erro sem detalhes';
    throw new Error(`apksigner recusou o APK: ${details}`);
  }

  assertExpectedSigner(
    extractSignerDigests(`${result.stdout}\n${result.stderr}`),
    values['expected-sha256'],
  );
  process.stdout.write('Assinatura do APK verificada.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Falha na verificação da assinatura: ${message}\n`);
    process.exitCode = 1;
  }
}
