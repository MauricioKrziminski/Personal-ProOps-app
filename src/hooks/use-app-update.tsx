import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';

import {
  AppUpdateError,
  appUpdateAction,
  type AppUpdateState,
} from '@/lib/app-update';
import {
  checkForApkUpdate,
  downloadApkUpdate,
  hasApkInstallPermission,
  installedVersionName,
  launchApkInstaller,
  openApkInstallPermissionSettings,
} from '@/lib/app-update-runtime';

interface AppUpdateContextValue {
  state: AppUpdateState;
  installedVersionName: string;
  runNextStep: () => Promise<void>;
}

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

function messageFrom(error: unknown, fallback: string): string {
  if (error instanceof AppUpdateError) return error.message;
  console.warn('[app-update]', error);
  return fallback;
}

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppUpdateState>(
    Platform.OS === 'android' ? { status: 'idle' } : { status: 'unsupported' },
  );
  const stateRef = useRef(state);
  const operationRef = useRef(false);

  const changeState = useCallback((next: AppUpdateState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const check = useCallback(async () => {
    if (Platform.OS !== 'android' || operationRef.current) return;
    const current = stateRef.current;
    if (
      current.status === 'downloading' ||
      current.status === 'ready' ||
      current.status === 'permissionRequired' ||
      current.status === 'installing'
    ) {
      return;
    }

    operationRef.current = true;
    changeState({ status: 'checking' });
    try {
      const manifest = await checkForApkUpdate();
      changeState(manifest ? { status: 'available', manifest } : { status: 'upToDate' });
    } catch (error) {
      changeState({
        status: 'error',
        message: messageFrom(error, 'Não deu para procurar atualizações.'),
      });
    } finally {
      operationRef.current = false;
    }
  }, [changeState]);

  const download = useCallback(async () => {
    if (operationRef.current || stateRef.current.status !== 'available') return;

    const { manifest } = stateRef.current;
    operationRef.current = true;
    changeState({ status: 'downloading', manifest, progress: null });
    try {
      const fileUri = await downloadApkUpdate(manifest, (progress) => {
        changeState({ status: 'downloading', manifest, progress });
      });
      changeState({ status: 'ready', manifest, fileUri });
    } catch (error) {
      changeState({
        status: 'error',
        message: messageFrom(error, 'Não deu para baixar a atualização.'),
      });
    } finally {
      operationRef.current = false;
    }
  }, [changeState]);

  const install = useCallback(async () => {
    if (operationRef.current) return;
    const current = stateRef.current;
    if (current.status !== 'ready' && current.status !== 'permissionRequired') return;

    const downloaded = { manifest: current.manifest, fileUri: current.fileUri };
    operationRef.current = true;
    try {
      if (!hasApkInstallPermission()) {
        changeState({ status: 'permissionRequired', ...downloaded });
        await openApkInstallPermissionSettings();
        changeState({
          status: hasApkInstallPermission() ? 'ready' : 'permissionRequired',
          ...downloaded,
        });
        return;
      }

      changeState({ status: 'installing', ...downloaded });
      await launchApkInstaller(downloaded.fileUri);
      changeState({ status: 'ready', ...downloaded });
    } catch (error) {
      changeState({
        status: 'error',
        message: messageFrom(error, 'Não deu para abrir o instalador do Android.'),
      });
    } finally {
      operationRef.current = false;
    }
  }, [changeState]);

  const runNextStep = useCallback(async () => {
    switch (appUpdateAction(stateRef.current)) {
      case 'check':
        await check();
        break;
      case 'download':
        await download();
        break;
      case 'install':
        await install();
        break;
      case null:
        break;
    }
  }, [check, download, install]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const initialCheckTimer = setTimeout(() => {
      void check();
    }, 0);
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returnedToForeground = nextState === 'active' && previousState !== 'active';
      previousState = nextState;
      if (!returnedToForeground) return;

      const current = stateRef.current;
      if (current.status === 'permissionRequired') {
        if (hasApkInstallPermission()) {
          changeState({
            status: 'ready',
            manifest: current.manifest,
            fileUri: current.fileUri,
          });
        }
        return;
      }
      if (
        current.status === 'downloading' ||
        current.status === 'ready' ||
        current.status === 'installing'
      ) {
        return;
      }

      void check();
    });

    return () => {
      clearTimeout(initialCheckTimer);
      subscription.remove();
    };
  }, [changeState, check]);

  const value = useMemo<AppUpdateContextValue>(
    () => ({ state, installedVersionName: installedVersionName(), runNextStep }),
    [runNextStep, state],
  );

  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>;
}

export function useAppUpdate(): AppUpdateContextValue {
  const value = useContext(AppUpdateContext);
  if (!value) throw new Error('useAppUpdate precisa estar dentro de AppUpdateProvider.');
  return value;
}
