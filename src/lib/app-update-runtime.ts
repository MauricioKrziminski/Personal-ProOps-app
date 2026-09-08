import * as Application from 'expo-application';
import { fetch } from 'expo/fetch';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';

import {
  AppUpdateError,
  MAX_UPDATE_MANIFEST_BYTES,
  UPDATE_MANIFEST_URL,
  downloadAndVerifyApkStream,
  hasNewerVersion,
  parseUpdateManifest,
  readTextStreamWithLimit,
  type UpdateManifest,
} from '@/lib/app-update';
import {
  canRequestPackageInstalls,
  getApkContentUri,
} from '../../modules/proops-apk-installer';

const MANIFEST_TIMEOUT_MS = 15_000;
const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;

function contentLengthOf(response: Response): number | null {
  const raw = response.headers.get('content-length');
  if (!raw || !/^\d+$/.test(raw)) return null;

  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function rejectHtml(response: Response, resource: string) {
  if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
    throw new AppUpdateError(`${resource} devolveu HTML em vez do arquivo esperado.`);
  }
}

function installedVersionCode(): number {
  const value = Number(Application.nativeBuildVersion);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppUpdateError('Não foi possível identificar a versão instalada do app.');
  }
  return value;
}

export function installedVersionName(): string {
  return Application.nativeApplicationVersion ?? 'desconhecida';
}

export async function checkForApkUpdate(): Promise<UpdateManifest | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);

  try {
    const response = await fetch(UPDATE_MANIFEST_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    rejectHtml(response, 'O endereço de atualização');
    if (!response.ok) {
      throw new AppUpdateError(`O servidor de atualização respondeu ${response.status}.`);
    }

    const announcedLength = contentLengthOf(response);
    if (announcedLength !== null && announcedLength > MAX_UPDATE_MANIFEST_BYTES) {
      throw new AppUpdateError('O manifesto ultrapassou o limite de 64 KB.');
    }
    if (!response.body) {
      throw new AppUpdateError('O servidor devolveu um manifesto vazio.');
    }

    const body = await readTextStreamWithLimit(response.body.getReader());
    const manifest = parseUpdateManifest(body);
    return hasNewerVersion(manifest, installedVersionCode()) ? manifest : null;
  } catch (error) {
    if (error instanceof AppUpdateError) throw error;
    throw new AppUpdateError('Não deu para procurar atualizações. Verifique sua conexão.');
  } finally {
    clearTimeout(timeout);
  }
}

function resetUpdateCache(): Directory {
  const directory = new Directory(Paths.cache, 'apk-updates');
  if (directory.exists) directory.delete();
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export async function downloadApkUpdate(
  manifest: UpdateManifest,
  onProgress: (progress: number) => void,
): Promise<string> {
  const directory = resetUpdateCache();
  const file = new File(directory, `personal-proops-${manifest.versionCode}.apk`);

  try {
    const response = await fetch(manifest.url, { headers: { Accept: APK_MIME_TYPE } });
    rejectHtml(response, 'O endereço do APK');
    if (!response.ok) {
      throw new AppUpdateError(`O download do APK respondeu ${response.status}.`);
    }
    if (!response.body) {
      throw new AppUpdateError('O servidor devolveu um APK vazio.');
    }

    file.create({ overwrite: true });
    const handle = file.open(FileMode.WriteOnly);
    await downloadAndVerifyApkStream({
      reader: response.body.getReader(),
      expectedSha256: manifest.sha256,
      totalBytes: contentLengthOf(response),
      sink: {
        write: (chunk) => handle.writeBytes(chunk),
        close: () => handle.close(),
        remove: () => {
          if (file.exists) file.delete();
        },
      },
      onProgress,
    });

    return file.uri;
  } catch (error) {
    if (file.exists) {
      try {
        file.delete();
      } catch {
        // A próxima tentativa limpa o diretório inteiro antes de baixar novamente.
      }
    }
    if (error instanceof AppUpdateError) throw error;
    throw new AppUpdateError('O download foi interrompido. Verifique o espaço e a conexão.');
  }
}

export function hasApkInstallPermission(): boolean {
  return canRequestPackageInstalls();
}

function requireApplicationId(): string {
  if (!Application.applicationId) {
    throw new AppUpdateError('Não foi possível identificar este app no Android.');
  }
  return Application.applicationId;
}

export async function openApkInstallPermissionSettings(): Promise<void> {
  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
    { data: `package:${requireApplicationId()}` },
  );
}

export async function launchApkInstaller(fileUri: string): Promise<void> {
  const contentUri = getApkContentUri(fileUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: APK_MIME_TYPE,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}
