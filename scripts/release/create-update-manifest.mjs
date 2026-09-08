import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const MAX_ANDROID_VERSION_CODE = 2_100_000_000;
const MAX_NOTES_LENGTH = 16_384;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} precisa ser uma string não vazia`);
  }

  return value;
}

export function createUpdateManifest(input) {
  const { versionCode } = input;
  if (
    !Number.isSafeInteger(versionCode) ||
    versionCode <= 0 ||
    versionCode > MAX_ANDROID_VERSION_CODE
  ) {
    throw new TypeError(
      `versionCode precisa ser um inteiro entre 1 e ${MAX_ANDROID_VERSION_CODE}`,
    );
  }

  const versionName = requireString(input.versionName, 'versionName');
  if (!SEMVER_PATTERN.test(versionName)) {
    throw new TypeError('versionName precisa seguir o formato semântico X.Y.Z');
  }

  const url = requireString(input.url, 'url');
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new TypeError('url precisa ser uma URL válida');
  }
  if (parsedUrl.protocol !== 'https:' || !parsedUrl.pathname.toLowerCase().endsWith('.apk')) {
    throw new TypeError('url precisa apontar por HTTPS para um arquivo APK');
  }

  const sha256 = requireString(input.sha256, 'sha256').toLowerCase();
  if (!SHA256_PATTERN.test(sha256)) {
    throw new TypeError('sha256 precisa conter exatamente 64 dígitos hexadecimais');
  }

  if (typeof input.notes !== 'string' || input.notes.length > MAX_NOTES_LENGTH) {
    throw new TypeError(`notes precisa ter no máximo ${MAX_NOTES_LENGTH} caracteres`);
  }

  return {
    versionCode,
    versionName,
    url,
    sha256,
    notes: input.notes,
  };
}

function runCli() {
  const { values } = parseArgs({
    options: {
      'version-code': { type: 'string' },
      'version-name': { type: 'string' },
      url: { type: 'string' },
      sha256: { type: 'string' },
      notes: { type: 'string', default: '' },
      output: { type: 'string' },
    },
    strict: true,
  });

  const manifest = createUpdateManifest({
    versionCode: Number(values['version-code']),
    versionName: values['version-name'],
    url: values.url,
    sha256: values.sha256,
    notes: values.notes,
  });
  const json = `${JSON.stringify(manifest, null, 2)}\n`;

  if (values.output) {
    writeFileSync(values.output, json, 'utf8');
    return;
  }

  process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Não foi possível gerar update.json: ${message}\n`);
    process.exitCode = 1;
  }
}
