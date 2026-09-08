import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const REQUIRED_ATTRIBUTES = ['name', 'versionCode', 'versionName'];

export function parseAapt2Badging(output) {
  if (typeof output !== 'string') {
    throw new TypeError('a saída do aapt2 precisa ser uma string');
  }

  const packageLine = output
    .split(/\r?\n/u)
    .find((line) => line.startsWith('package:'));

  if (!packageLine) {
    throw new Error('a saída do aapt2 não contém a linha package');
  }

  const attributes = new Map();
  const attributePattern = /(?:^|\s)([A-Za-z][A-Za-z0-9]*)='([^']*)'/gu;

  for (const match of packageLine.matchAll(attributePattern)) {
    const [, name, value] = match;
    if (attributes.has(name)) {
      throw new Error(`atributo duplicado: ${name}`);
    }
    attributes.set(name, value);
  }

  for (const name of REQUIRED_ATTRIBUTES) {
    if (!attributes.get(name)) {
      throw new Error(`a linha package não contém ${name}`);
    }
  }

  return {
    applicationId: attributes.get('name'),
    versionCode: attributes.get('versionCode'),
    versionName: attributes.get('versionName'),
  };
}

function runCli() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
    },
    strict: true,
  });

  if (!values.input) {
    throw new TypeError('--input é obrigatório');
  }

  const info = parseAapt2Badging(readFileSync(values.input, 'utf8'));
  process.stdout.write(
    `${info.applicationId}\t${info.versionCode}\t${info.versionName}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Falha ao ler o APK: ${message}\n`);
    process.exitCode = 1;
  }
}
