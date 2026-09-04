import { requireOptionalNativeModule } from 'expo-modules-core';

type ProOpsApkInstallerNativeModule = {
  canRequestPackageInstalls(): boolean;
  getApkContentUri(fileUri: string): string;
};

const nativeModule =
  requireOptionalNativeModule<ProOpsApkInstallerNativeModule>('ProOpsApkInstaller');

export function canRequestPackageInstalls(): boolean {
  return nativeModule?.canRequestPackageInstalls() ?? false;
}

export function getApkContentUri(fileUri: string): string {
  if (!nativeModule) {
    throw new Error('O instalador de APK so esta disponivel no Android.');
  }

  return nativeModule.getApkContentUri(fileUri);
}
