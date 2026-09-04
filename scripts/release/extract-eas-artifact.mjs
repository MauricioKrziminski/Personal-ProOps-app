import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export function extractArtifactUrl(result) {
  const builds = Array.isArray(result) ? result : [result];
  if (builds.length !== 1 || !builds[0] || typeof builds[0] !== 'object') {
    throw new Error(`a saída precisa conter exatamente um build; encontrados: ${builds.length}`);
  }

  const [build] = builds;
  if (build.status !== 'FINISHED') {
    throw new Error(`o build não terminou com sucesso; status: ${build.status ?? 'ausente'}`);
  }

  const url = build.artifacts?.applicationArchiveUrl ?? build.artifacts?.buildUrl;
  if (typeof url !== 'string') {
    throw new Error('o EAS não devolveu uma URL para o artefato Android');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('a URL do artefato devolvida pelo EAS é inválida');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('a URL do artefato precisa usar HTTPS');
  }

  return url;
}

function runCli() {
  const { values } = parseArgs({
    options: { input: { type: 'string' } },
    strict: true,
  });
  if (!values.input) {
    throw new TypeError('--input é obrigatório');
  }

  const result = JSON.parse(readFileSync(values.input, 'utf8'));
  process.stdout.write(`${extractArtifactUrl(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Não foi possível localizar o APK do EAS: ${message}\n`);
    process.exitCode = 1;
  }
}
