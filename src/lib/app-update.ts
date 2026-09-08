import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const UPDATE_MANIFEST_URL =
  'https://github.com/almeidagabriel01/Personal-ProOps-app-releases/releases/latest/download/update.json';
export const MAX_UPDATE_MANIFEST_BYTES = 64 * 1024;

export class AppUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppUpdateError';
  }
}

export interface UpdateManifest {
  versionCode: number;
  versionName: string;
  url: string;
  sha256: string;
  notes: string;
}

type DownloadedUpdate = {
  manifest: UpdateManifest;
  fileUri: string;
};

export type AppUpdateState =
  | { status: 'unsupported' }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'upToDate' }
  | { status: 'available'; manifest: UpdateManifest }
  | { status: 'downloading'; manifest: UpdateManifest; progress: number | null }
  | ({ status: 'ready' } & DownloadedUpdate)
  | ({ status: 'permissionRequired' } & DownloadedUpdate)
  | ({ status: 'installing' } & DownloadedUpdate)
  | { status: 'error'; message: string };

export type AppUpdateAction = 'check' | 'download' | 'install' | null;

function invalidManifest(reason: string): Error {
  return new AppUpdateError(`Manifesto de atualização inválido: ${reason}`);
}

export function parseUpdateManifest(text: string): UpdateManifest {
  const trimmed = text.trim();
  if (trimmed.startsWith('<')) {
    throw invalidManifest('o servidor devolveu HTML em vez de JSON');
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw invalidManifest('o corpo não é JSON');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidManifest('a raiz precisa ser um objeto');
  }

  const record = value as Record<string, unknown>;
  if (!Number.isInteger(record.versionCode) || (record.versionCode as number) <= 0) {
    throw invalidManifest('versionCode precisa ser um inteiro positivo');
  }

  if (typeof record.versionName !== 'string' || record.versionName.trim().length === 0) {
    throw invalidManifest('versionName precisa ser uma string não vazia');
  }

  if (typeof record.url !== 'string') {
    throw invalidManifest('url precisa ser uma string HTTPS');
  }
  try {
    if (new URL(record.url).protocol !== 'https:') {
      throw invalidManifest('url precisa usar HTTPS');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Manifesto de atualização inválido:')) {
      throw error;
    }
    throw invalidManifest('url precisa ser uma URL HTTPS válida');
  }

  if (typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(record.sha256)) {
    throw invalidManifest('sha256 precisa conter 64 dígitos hexadecimais');
  }

  if (record.notes !== undefined && typeof record.notes !== 'string') {
    throw invalidManifest('notes precisa ser texto quando estiver presente');
  }

  return {
    versionCode: record.versionCode as number,
    versionName: record.versionName.trim(),
    url: record.url,
    sha256: record.sha256.toLowerCase(),
    notes: record.notes ?? '',
  } as UpdateManifest;
}

export async function readTextStreamWithLimit(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limit = MAX_UPDATE_MANIFEST_BYTES,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new AppUpdateError(
          `O manifesto ultrapassou o limite de ${Math.round(limit / 1024)} KB.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

export function hasNewerVersion(manifest: UpdateManifest, installedVersionCode: number): boolean {
  return manifest.versionCode > installedVersionCode;
}

export function downloadPercent(receivedBytes: number, totalBytes: number | null): number | null {
  if (
    !Number.isFinite(receivedBytes) ||
    receivedBytes < 0 ||
    totalBytes === null ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0
  ) {
    return null;
  }

  return Math.min(100, Math.floor((receivedBytes / totalBytes) * 100));
}

interface ApkDownloadSink {
  write(chunk: Uint8Array): void;
  close(): void;
  remove(): void;
}

interface DownloadAndVerifyApkOptions {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  expectedSha256: string;
  totalBytes: number | null;
  sink: ApkDownloadSink;
  onProgress?: (progress: number) => void;
}

export async function downloadAndVerifyApkStream({
  reader,
  expectedSha256,
  totalBytes,
  sink,
  onProgress,
}: DownloadAndVerifyApkOptions): Promise<{ bytesWritten: number; sha256: string }> {
  if (!/^[0-9a-f]{64}$/i.test(expectedSha256)) {
    throw new TypeError('O SHA-256 esperado do APK é inválido.');
  }

  const hash = sha256.create();
  let bytesWritten = 0;
  let lastProgress: number | null = null;
  let sinkClosed = false;

  const closeSink = () => {
    if (sinkClosed) return;
    sinkClosed = true;
    sink.close();
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sink.write(value);
      hash.update(value);
      bytesWritten += value.byteLength;

      const progress = downloadPercent(bytesWritten, totalBytes);
      if (progress !== null && progress !== lastProgress) {
        lastProgress = progress;
        onProgress?.(progress);
      }
    }

    closeSink();

    if (totalBytes !== null && bytesWritten !== totalBytes) {
      throw new AppUpdateError(
        'O download terminou com um tamanho diferente do anunciado. Baixe novamente.',
      );
    }

    const digest = bytesToHex(hash.digest());
    if (digest !== expectedSha256.toLowerCase()) {
      throw new AppUpdateError(
        'O APK baixado não confere com o arquivo publicado. Baixe novamente.',
      );
    }

    return { bytesWritten, sha256: digest };
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // A stream pode já ter fechado; a falha original continua sendo a que importa.
    }
    try {
      closeSink();
    } catch {
      // Mesmo se o handle falhar ao fechar, ainda tentamos apagar o parcial abaixo.
    }
    try {
      sink.remove();
    } catch {
      // O erro original é mais útil que uma segunda falha de limpeza.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function withNotes(message: string, manifest: UpdateManifest): string {
  return manifest.notes.trim() ? `${message}\n${manifest.notes.trim()}` : message;
}

export function appUpdateSubtitle(state: AppUpdateState, installedVersionName: string): string {
  switch (state.status) {
    case 'unsupported':
      return `Versão ${installedVersionName}`;
    case 'idle':
      return `Versão ${installedVersionName} instalada`;
    case 'checking':
      return 'Procurando uma versão nova…';
    case 'upToDate':
      return `Versão ${installedVersionName} — está atualizada`;
    case 'available':
      return withNotes(`Versão ${state.manifest.versionName} disponível`, state.manifest);
    case 'downloading':
      return withNotes(
        state.progress === null ? 'Baixando…' : `Baixando ${state.progress}%`,
        state.manifest,
      );
    case 'ready':
      return withNotes(`Versão ${state.manifest.versionName} pronta para instalar`, state.manifest);
    case 'permissionRequired':
      return withNotes('Permita a instalação nos Ajustes e toque novamente', state.manifest);
    case 'installing':
      return withNotes('Abrindo o instalador do Android…', state.manifest);
    case 'error':
      return state.message;
  }
}

export function appUpdateAction(state: AppUpdateState): AppUpdateAction {
  switch (state.status) {
    case 'idle':
    case 'upToDate':
    case 'error':
      return 'check';
    case 'available':
      return 'download';
    case 'ready':
    case 'permissionRequired':
      return 'install';
    case 'unsupported':
    case 'checking':
    case 'downloading':
    case 'installing':
      return null;
  }
}
