/**
 * A trava do app: senha de 6 dígitos e/ou biometria, independente da trava do sistema.
 *
 * O app mostra saldo, dívida, patrimônio e a projeção de quando o dinheiro acaba. Hoje qualquer
 * um que pegue o celular desbloqueado vê tudo — o "esconder saldo" ajuda e o próprio
 * `conceal.tsx` diz por que não basta: *"quem consegue olhar a tela também consegue tocar nela"*.
 *
 * ⚠️ **A regra de QUANDO trancar mora em `lib/lock-policy.ts`, pura e testada.** Aqui fica só o
 * que precisa do React e do aparelho.
 *
 * ⚠️ **O PIN é obrigatório mesmo com biometria ligada.** Digital falha molhada, Face ID falha no
 * escuro, e a pessoa troca de aparelho. Biometria sem saída própria é trancar alguém fora dos
 * próprios dados — por isso `disableDeviceFallback: true`: o fallback é o NOSSO PIN, não o do
 * sistema (que abriria o aparelho inteiro, não este app).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
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
  aposBiometria,
  deveTrancar,
  deveTrancarNoInicio,
  type LockDelay,
  type LockMode,
} from '@/lib/lock-policy';
import { apagarPin, conferirPin, definirPin, temPin } from '@/lib/lock-secret';

const CHAVE_MODO = 'lock-mode';
const CHAVE_ESPERA = 'lock-delay';

interface LockContexto {
  mode: LockMode;
  delaySeconds: LockDelay;
  /** `true` = o overlay de bloqueio cobre o app. */
  locked: boolean;
  /** Ainda lendo a preferência: o app segura o conteúdo em vez de piscar destravado. */
  carregando: boolean;
  biometriaDisponivel: boolean;
  configurar: (mode: LockMode, pin?: string) => Promise<void>;
  definirEspera: (d: LockDelay) => Promise<void>;
  destravarComPin: (pin: string) => Promise<boolean>;
  tentarBiometria: () => Promise<'aberto' | 'pedir-pin'>;
  /** Envolve uma operação que abre UI do sistema (arquivo, câmera) sem trancar o app. */
  semTrancar: <T>(fn: () => Promise<T>) => Promise<T>;
}

const Ctx = createContext<LockContexto | null>(null);

export function LockProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LockMode>('off');
  const [delaySeconds, setDelay] = useState<LockDelay>(0);
  const [locked, setLocked] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [biometriaDisponivel, setBio] = useState(false);
  // `useRef`: o listener de AppState é montado uma vez e leria o estado congelado do primeiro
  // render. É o mesmo motivo pelo qual `backgroundedAt` não pode ser `useState`.
  const estado = useRef({ mode: 'off' as LockMode, delaySeconds: 0 as LockDelay, backgroundedAt: null as number | null, systemUiOpen: false });

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [m, d] = await Promise.all([
        AsyncStorage.getItem(CHAVE_MODO),
        AsyncStorage.getItem(CHAVE_ESPERA),
      ]);
      // A preferência só vale se o segredo existir: PIN apagado (logout, reinstalação) com a
      // preferência sobrando trancaria o app numa senha que ninguém tem.
      /*
        A preferência só vale com o segredo presente: PIN apagado (logout, reinstalação) e
        preferência sobrando trancariam o app numa senha que ninguém tem.
      */
      const modo = ((m as LockMode) ?? 'off') !== 'off' && (await temPin()) ? (m as LockMode) : 'off';
      const espera = (Number(d) === 30 || Number(d) === 60 ? Number(d) : 0) as LockDelay;
      if (!vivo) return;
      setMode(modo);
      setDelay(espera);
      setLocked(deveTrancarNoInicio(modo));
      estado.current = { ...estado.current, mode: modo, delaySeconds: espera };
      setCarregando(false);
      if (Platform.OS !== 'web') {
        const [hw, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        // ⚠️ Sem digital/face CADASTRADA a opção nem aparece na tela de configuração: oferecer
        // biometria que o aparelho não tem é um botão que só sabe falhar.
        if (vivo) setBio(hw && enrolled);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        if (deveTrancar(estado.current, Date.now())) setLocked(true);
        estado.current.backgroundedAt = null;
      } else if (s === 'background' || s === 'inactive') {
        estado.current.backgroundedAt = Date.now();
      }
    });
    return () => sub.remove();
  }, []);

  const configurar = useCallback(async (novo: LockMode, pin?: string) => {
    if (novo === 'off') {
      await apagarPin();
      await AsyncStorage.setItem(CHAVE_MODO, 'off');
      setMode('off');
      estado.current.mode = 'off';
      setLocked(false);
      return;
    }
    if (pin) await definirPin(pin);
    await AsyncStorage.setItem(CHAVE_MODO, novo);
    setMode(novo);
    estado.current.mode = novo;
  }, []);

  const definirEspera = useCallback(async (d: LockDelay) => {
    await AsyncStorage.setItem(CHAVE_ESPERA, String(d));
    setDelay(d);
    estado.current.delaySeconds = d;
  }, []);

  const destravarComPin = useCallback(async (pin: string) => {
    const ok = await conferirPin(pin);
    if (ok) setLocked(false);
    return ok;
  }, []);

  const tentarBiometria = useCallback(async () => {
    // O prompt tira o app do primeiro plano no Android — sem a bandeira, voltar dele trancaria
    // de novo por cima do overlay que já estava aberto.
    estado.current.systemUiOpen = true;
    try {
      const r = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloquear',
        cancelLabel: 'Usar senha',
        fallbackLabel: 'Usar senha',
        disableDeviceFallback: true,
        requireConfirmation: false,
      });
      const saida = aposBiometria(r);
      if (saida === 'aberto') setLocked(false);
      return saida;
    } finally {
      estado.current.systemUiOpen = false;
    }
  }, []);

  const semTrancar = useCallback(async <T,>(fn: () => Promise<T>) => {
    estado.current.systemUiOpen = true;
    try {
      return await fn();
    } finally {
      // Um tique depois: o `active` do AppState chega DEPOIS do `await` resolver.
      setTimeout(() => {
        estado.current.systemUiOpen = false;
      }, 1000);
    }
  }, []);

  const valor = useMemo(
    () => ({
      mode,
      delaySeconds,
      locked,
      carregando,
      biometriaDisponivel,
      configurar,
      definirEspera,
      destravarComPin,
      tentarBiometria,
      semTrancar,
    }),
    [mode, delaySeconds, locked, carregando, biometriaDisponivel, configurar, definirEspera, destravarComPin, tentarBiometria, semTrancar]
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useLock() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLock fora do LockProvider');
  return ctx;
}
