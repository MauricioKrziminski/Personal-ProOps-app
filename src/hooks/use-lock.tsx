/**
 * A trava do app: a MESMA autenticação que abre o celular — Face ID, digital ou a senha/padrão
 * do aparelho, nessa ordem, resolvida pelo sistema.
 *
 * O app mostra saldo, dívida, patrimônio e a projeção de quando o dinheiro acaba. Sem isto,
 * qualquer um que pegue o celular destravado vê tudo — o "esconder saldo" ajuda e o próprio
 * `conceal.tsx` diz por que não basta: *"quem consegue olhar a tela também consegue tocar nela"*.
 *
 * ⚠️ **Não existe senha nossa, e isso é o desenho** (decisão do dono do produto, 14/09/2026):
 * *"a senha que eu queria é a que já usa no celular, igual bancos como banco do brasil, nubank,
 * e outros usam"*. `disableDeviceFallback: false` (o default) é a linha que faz isso: no iOS o
 * `LAPolicyDeviceOwnerAuthentication` tenta o Face ID e cai sozinho na senha do aparelho; no
 * Android o `BiometricPrompt` aceita a credencial do aparelho. A versão anterior usava
 * `true` — que é "eu cuido do fallback" — e por isso precisava de PIN próprio, SecureStore,
 * contagem de erros e espera de 30s. Tudo isso saiu.
 *
 * ⚠️ **A regra de QUANDO trancar mora em `lib/lock-policy.ts`, pura e testada.** Aqui fica só o
 * que precisa do React e do aparelho.
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
  aposAutenticar,
  deveTrancar,
  deveTrancarNoInicio,
  podeTrancar,
  type LockDelay,
  type LockMode,
} from '@/lib/lock-policy';

const CHAVE_MODO = 'lock-mode';
const CHAVE_ESPERA = 'lock-delay';

interface LockContexto {
  mode: LockMode;
  delaySeconds: LockDelay;
  /** `true` = o overlay de bloqueio cobre o app. */
  locked: boolean;
  /** Ainda lendo a preferência: o app segura o conteúdo em vez de piscar destravado. */
  carregando: boolean;
  /** O aparelho tem bloqueio de tela? Sem isso não há como provar quem é o dono. */
  disponivel: boolean;
  /**
   * Como o sistema vai pedir.
   *
   * ⚠️ **Uma frase só, e ela precisa caber nas DUAS regências**: sozinha no subtítulo do Perfil e
   * dentro de "Use ___ para continuar." no overlay. A primeira versão dizia "Face ID, com a senha
   * do celular como reserva" e no overlay virava *"Use Face ID, com a senha do celular como
   * reserva para continuar."* — visto na tela, não no código.
   */
  comoAutentica: string;
  /**
   * Em que ponto da autenticação a cortina está.
   *
   * ⚠️ **Mora aqui, não na tela.** Quem sabe se há um `authenticateAsync` em voo é quem o
   * disparou — e é essa a informação que impede o segundo. Na tela viraria um `ref` por
   * montagem, que não enxerga a chamada automática da abertura nem sobrevive a um Fast Refresh.
   */
  estado: 'trancado' | 'autenticando' | 'falhou';
  configurar: (mode: LockMode) => Promise<void>;
  definirEspera: (d: LockDelay) => Promise<void>;
  autenticar: () => Promise<'aberto' | 'trancado'>;
  /** Envolve uma operação que abre UI do sistema (arquivo, câmera) sem trancar o app. */
  semTrancar: <T>(fn: () => Promise<T>) => Promise<T>;
}

const Ctx = createContext<LockContexto | null>(null);

/**
 * O nome que o usuário reconhece, não o da API.
 *
 * ⚠️ **`supportedAuthenticationTypesAsync` responde o que o APARELHO TEM, não o que está
 * cadastrado** — um iPhone devolve `FACIAL_RECOGNITION` mesmo sem nenhum rosto salvo. Por isso a
 * frase só cita biometria quando `isEnrolledAsync()` confirmou que existe uma cadastrada;
 * caso contrário fala da senha, que é o que o prompt realmente vai pedir.
 */
function descrever(tipos: LocalAuthentication.AuthenticationType[], temBiometria: boolean): string {
  if (!temBiometria) return 'a senha do celular';
  if (tipos.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION))
    return Platform.OS === 'ios' ? 'Face ID ou a senha do celular' : 'seu rosto ou a senha do celular';
  if (tipos.includes(LocalAuthentication.AuthenticationType.FINGERPRINT))
    return 'sua digital ou a senha do celular';
  return 'a senha do celular';
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LockMode>('off');
  const [delaySeconds, setDelay] = useState<LockDelay>(0);
  const [locked, setLocked] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [disponivel, setDisponivel] = useState(false);
  const [comoAutentica, setComo] = useState('a senha do celular');
  const [estado, setEstado] = useState<'trancado' | 'autenticando' | 'falhou'>('trancado');
  /*
    O espelho que o listener de AppState lê.

    ⚠️ **`useRef`, não `useState`**: o listener é montado uma vez e fecharia sobre o estado
    congelado do primeiro render. É o mesmo motivo pelo qual `backgroundedAt` não pode ser state.
  */
  const vigia = useRef({ mode: 'off' as LockMode, delaySeconds: 0 as LockDelay, backgroundedAt: null as number | null, systemUiOpen: false });

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [m, d] = await Promise.all([
        AsyncStorage.getItem(CHAVE_MODO),
        AsyncStorage.getItem(CHAVE_ESPERA),
      ]);
      /*
        ⚠️ **A preferência só vale se o aparelho ainda souber autenticar.** Quem ligou a trava e
        depois tirou o bloqueio de tela do celular ficaria com o app trancado num prompt que nunca
        abre — e desta vez não há PIN nosso para servir de saída. Nesse caso a trava cai para
        `off`, e a tela do Perfil explica o que houve.
      */
      const nivel = Platform.OS === 'web' ? 0 : await LocalAuthentication.getEnrolledLevelAsync();
      const podeUsar = podeTrancar(nivel);
      const modo = ((m as LockMode) ?? 'off') === 'on' && podeUsar ? 'on' : 'off';
      const espera = (Number(d) === 30 || Number(d) === 60 ? Number(d) : 0) as LockDelay;
      if (!vivo) return;
      setMode(modo);
      setDelay(espera);
      setDisponivel(podeUsar);
      setLocked(deveTrancarNoInicio(modo));
      vigia.current = { ...vigia.current, mode: modo, delaySeconds: espera };
      setCarregando(false);
      if (Platform.OS !== 'web') {
        const [tipos, temBiometria] = await Promise.all([
          LocalAuthentication.supportedAuthenticationTypesAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        if (vivo) setComo(descrever(tipos, temBiometria));
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  /*
    O último `autenticar`, para o listener de AppState poder chamá-lo.

    ⚠️ **O listener é montado uma vez, com `[]`** — ele fecharia sobre o `autenticar` do primeiro
    render. Um ref atualizado por efeito é o caminho normal para "callback estável que chama a
    versão de agora"; pôr `autenticar` nas deps remontaria o listener a cada render dele.
  */
  const pedirRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        // Trancar de novo ZERA o estado: sem isso a cortina reabre mostrando o "não deu certo"
        // da sessão passada, que é informação velha na primeira coisa que a pessoa vê.
        if (deveTrancar(vigia.current, Date.now())) {
          setLocked(true);
          setEstado('trancado');
          /*
            ⚠️ **E pede de novo.** Sem esta linha, voltar ao app com a cortina JÁ montada não
            disparava prompt nenhum — o efeito de montagem não roda de novo —, e a pessoa ficava
            olhando a cortina até descobrir que o disco era tocável. `deveTrancar` já é a guarda
            certa: ela devolve `false` quando quem tirou o app do primeiro plano foi o próprio
            prompt (`systemUiOpen`), que no Android é o caso normal e viraria um laço.
          */
          pedirRef.current();
        }
        vigia.current.backgroundedAt = null;
      } else if (s === 'background' || s === 'inactive') {
        vigia.current.backgroundedAt = Date.now();
      }
    });
    return () => sub.remove();
  }, []);

  const configurar = useCallback(async (novo: LockMode) => {
    await AsyncStorage.setItem(CHAVE_MODO, novo);
    setMode(novo);
    vigia.current.mode = novo;
    if (novo === 'off') setLocked(false);
  }, []);

  const definirEspera = useCallback(async (d: LockDelay) => {
    await AsyncStorage.setItem(CHAVE_ESPERA, String(d));
    setDelay(d);
    vigia.current.delaySeconds = d;
  }, []);

  /*
    ⚠️ **A guarda é um `ref`, e ela existe porque o SEGUNDO prompt mata o primeiro.** Dois
    `authenticateAsync` empilhados devolvem `system_cancel` no que estava aberto — indistinguível
    de a pessoa ter cancelado. Acontece de dois jeitos: tocar em "Desbloquear" com o prompt já na
    tela, e o StrictMode montando a cortina duas vezes em desenvolvimento. `useState` não serve:
    o segundo toque chega antes do re-render.
  */
  const emVoo = useRef(false);

  const autenticar = useCallback(async () => {
    if (emVoo.current) return 'trancado' as const;
    emVoo.current = true;
    setEstado('autenticando');
    // O prompt tira o app do primeiro plano no Android — sem a bandeira, voltar dele trancaria
    // de novo por cima do overlay que já estava aberto.
    vigia.current.systemUiOpen = true;
    try {
      const r = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloquear o app',
        // ⚠️ Sem `disableDeviceFallback: true`: é justamente o fallback do SISTEMA que queremos.
        // Escrever a chave como `false` é redundante, mas é o comentário mais importante do
        // arquivo — foi a linha que mudou de sentido.
        disableDeviceFallback: false,
        requireConfirmation: false,
      });
      const saida = aposAutenticar(r);
      if (saida === 'aberto') setLocked(false);
      // Falhou FICA falhado: o botão passa a dizer "Tentar de novo" e a cortina diz o porquê.
      // Voltar sozinho para `trancado` apagaria a única pista de que a tentativa aconteceu.
      setEstado(saida === 'aberto' ? 'trancado' : 'falhou');
      return saida;
    } finally {
      emVoo.current = false;
      /*
        ⚠️ **A bandeira cai um TIQUE depois, não aqui.** O `active` do AppState chega DEPOIS de
        `authenticateAsync` resolver — é o sistema devolvendo o foco ao app quando o prompt sai —,
        e com a bandeira já limpa esse evento é lido como "voltou do segundo plano": `deveTrancar`
        devolve `true` e a cortina reabre POR CIMA do app que acabou de ser destravado.

        Medido no simulador: Face ID aceito, app aberto, e o primeiro toque na tela trancava tudo
        de novo. É exatamente a lição que `semTrancar` (logo abaixo) já carregava — ela só não
        tinha sido aplicada aqui, que é o caminho mais usado dos dois.
      */
      setTimeout(() => {
        vigia.current.systemUiOpen = false;
      }, 1000);
    }
  }, []);

  useEffect(() => {
    pedirRef.current = () => void autenticar();
  }, [autenticar]);

  const semTrancar = useCallback(async <T,>(fn: () => Promise<T>) => {
    vigia.current.systemUiOpen = true;
    try {
      return await fn();
    } finally {
      // Um tique depois: o `active` do AppState chega DEPOIS do `await` resolver.
      setTimeout(() => {
        vigia.current.systemUiOpen = false;
      }, 1000);
    }
  }, []);

  const valor = useMemo(
    () => ({
      mode,
      delaySeconds,
      locked,
      carregando,
      disponivel,
      comoAutentica,
      estado,
      configurar,
      definirEspera,
      autenticar,
      semTrancar,
    }),
    [mode, delaySeconds, locked, carregando, disponivel, comoAutentica, estado, configurar, definirEspera, autenticar, semTrancar]
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useLock() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLock fora do LockProvider');
  return ctx;
}
