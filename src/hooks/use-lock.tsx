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
import type * as LocalAuthentication from 'expo-local-authentication';
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

import { useSession } from '@/hooks/use-session';

import { protegerAoSair } from '../../modules/proops-privacidade';

import {
  aposAutenticar,
  bandeiraCaiAoTerminar,
  bandeiraCaiNoActive,
  deveTrancar,
  deveTrancarNoInicio,
  deveVelarAoSair,
  podeTrancar,
  type LockDelay,
  type LockMode,
} from '@/lib/lock-policy';
import { congelarTimersSeDiagnostico, marcar } from '@/lib/trilha-da-abertura';

/**
 * O módulo nativo — ou `null` quando ele não está neste build.
 *
 * ⚠️ **`import` estático aqui MATA O APP INTEIRO num build sem o módulo**, e não é hipótese: em
 * 14/09/2026 aconteceu duas vezes num dia. `expo-local-authentication` lança em
 * `requireNativeModule` durante a AVALIAÇÃO do módulo, e a corrente é
 * `_layout.tsx → lock-overlay.tsx → use-lock.tsx` — ou seja, a raiz do app. Tela vermelha antes
 * de qualquer rota montar, e a mensagem fala de um módulo que quem abriu o app não conhece.
 *
 * O risco real não é o emulador com um APK velho: é **OTA**, e isso é medido, não suposto.
 * `app.json` usa `runtimeVersion: { policy: 'appVersion' }`, e o `version` ficou em `1.3.26`
 * ANTES e DEPOIS do commit que somou `expo-local-authentication` (`3375cd0`) — ou seja, o binário
 * sem o módulo e o JS que precisa dele compartilham a MESMA runtime version, e o update chega
 * nele. Com esta linha como `import` estático, ele morria no boot, sem caminho de volta pelo
 * próprio app. (Com a política `fingerprint` o update nem seria entregue; não é a daqui.)
 *
 * Sem ele, `podeTrancar(0)` é `false`: a trava cai para `off`, `disponivel` fica `false` e o
 * Perfil mostra a explicação em vez do controle. É o MESMO caminho de quem tirou o bloqueio de
 * tela do celular, que já existia e já era testado.
 */
const bio: typeof LocalAuthentication | null = (() => {
  if (Platform.OS === 'web') return null;
  try {
    // `require` é o ponto todo: um `import` estático não dá para embrulhar em try/catch — ele
    // avalia antes de qualquer linha deste arquivo rodar, que é exatamente o que derruba o app.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-local-authentication') as typeof LocalAuthentication;
  } catch {
    return null;
  }
})();

const CHAVE_MODO = 'lock-mode';
const CHAVE_ESPERA = 'lock-delay';
/** Quanto o sucesso do prompt espera o `active` da mesma visita antes de ler o estado real. */
const ESPERA_DO_ACTIVE_MS = 3000;

interface LockContexto {
  mode: LockMode;
  delaySeconds: LockDelay;
  /** `true` = o overlay de bloqueio cobre o app. Nunca sem conta aberta. */
  locked: boolean;
  /**
   * O app saiu da frente com a trava ligada: uma tinta lisa cobre tudo até a volta decidir se
   * tranca (a trava entra por cima dela) ou não (ela esmaece).
   */
  velado: boolean;
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

interface TentativaDeAbertura {
  userId: string | undefined;
  cancelada: boolean;
  autenticada: boolean;
  aoVoltar?: (permitir: boolean) => void;
}

/**
 * O nome que o usuário reconhece, não o da API.
 *
 * ⚠️ **`supportedAuthenticationTypesAsync` responde o que o APARELHO TEM, não o que está
 * cadastrado** — um iPhone devolve `FACIAL_RECOGNITION` mesmo sem nenhum rosto salvo. Por isso a
 * frase só cita biometria quando `isEnrolledAsync()` confirmou que existe uma cadastrada;
 * caso contrário fala da senha, que é o que o prompt realmente vai pedir.
 */
function descrever(tipos: LocalAuthentication.AuthenticationType[], temBiometria: boolean): string {
  if (!bio || !temBiometria) return 'a senha do celular';
  if (tipos.includes(bio.AuthenticationType.FACIAL_RECOGNITION))
    return Platform.OS === 'ios' ? 'Face ID ou a senha do celular' : 'seu rosto ou a senha do celular';
  if (tipos.includes(bio.AuthenticationType.FINGERPRINT))
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
  const [velado, setVelado] = useState(false);
  /*
    O espelho que o listener de AppState lê.

    ⚠️ **`useRef`, não `useState`**: o listener é montado uma vez e fecharia sobre o estado
    congelado do primeiro render. É o mesmo motivo pelo qual `backgroundedAt` não pode ser state.
  */
  const vigia = useRef({ mode: 'off' as LockMode, delaySeconds: 0 as LockDelay, backgroundedAt: null as number | null, systemUiOpen: false, temSessao: false });

  /*
    ⚠️ **Sem sessão não há o que trancar** — a porta de entrada é o login. A trava ligada numa conta
    que saiu cobria a tela de login na abertura seguinte e pedia a senha do celular para chegar nela.

    Entrar ou sair da conta DESTRAVA: entrar já provou quem é, e sair não deixa nada para esconder.
    O primeiro valor resolvido (a abertura) não é troca — `undefined` até o `getSession` voltar.
  */
  const { session, loading: sessaoCarregando } = useSession();
  const temSessao = !!session;
  const sessaoAgora = sessaoCarregando ? undefined : session?.user.id ?? null;
  const [sessaoAntes, setSessaoAntes] = useState(sessaoAgora);
  if (sessaoAntes !== sessaoAgora) {
    setSessaoAntes(sessaoAgora);
    if (sessaoAntes !== undefined && sessaoAgora !== undefined) {
      if (sessaoAntes === null || sessaoAgora === null) {
        setLocked(false);
        setVelado(false);
      }
      // Uma troca direta de conta também descarta o estado ocupado da tentativa anterior,
      // preservando a cobertura que já existia até a conta atual autenticar.
      setEstado('trancado');
    }
  }
  useEffect(() => {
    vigia.current.temSessao = temSessao;
  }, [temSessao]);

  /*
    A tinta do JS (`velado`) cobre a tela VIVA; a foto que o sistema tira na pausa — o cartão dos
    recentes e o quadro da volta — sai antes dela e mostrava a Hoje. Quem esconde a foto é nativo.
  */
  useEffect(() => {
    protegerAoSair(mode === 'on' && temSessao);
  }, [mode, temSessao]);

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
      const nivel = bio ? await bio.getEnrolledLevelAsync() : 0;
      const podeUsar = podeTrancar(nivel);
      const modo = ((m as LockMode) ?? 'off') === 'on' && podeUsar ? 'on' : 'off';
      const espera = (Number(d) === 30 || Number(d) === 60 ? Number(d) : 0) as LockDelay;
      marcar('trava:preferencia', { modo, nivel, espera });
      if (!vivo) return;
      setMode(modo);
      setDelay(espera);
      setDisponivel(podeUsar);
      setLocked(deveTrancarNoInicio(modo));
      vigia.current = { ...vigia.current, mode: modo, delaySeconds: espera };
      setCarregando(false);
      if (bio) {
        const [tipos, temBiometria] = await Promise.all([
          bio.supportedAuthenticationTypesAsync(),
          bio.isEnrolledAsync(),
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

  /*
    Quantas operações de UI do sistema estão em voo (prompt, seletor de arquivo, câmera).

    ⚠️ **É contador, não booleano**: o pedido automático da abertura e um toque no disco podem
    se sobrepor, e um `false` escrito pelo primeiro a terminar destravaria a guarda do outro.
  */
  const aberturas = useRef(0);
  const tentativaAtual = useRef<TentativaDeAbertura | null>(null);
  const pedirNaVolta = useRef(false);
  const vivo = useRef(true);

  const invalidarTentativa = useCallback(() => {
    const tentativa = tentativaAtual.current;
    if (tentativa) {
      tentativa.cancelada = true;
      tentativa.aoVoltar?.(false);
    }
    pedirNaVolta.current = false;
  }, []);

  useEffect(() => {
    const tentativa = tentativaAtual.current;
    // O efeito filho pode iniciar a senha para a sessão restaurada antes deste efeito pai.
    // Só um pedido pertencente a OUTRA conta é antigo; a hidratação não cancela o pedido novo.
    if (tentativa && tentativa.userId !== session?.user.id) {
      invalidarTentativa();
    }
  }, [session?.user.id, invalidarTentativa]);

  const abrirUiDoSistema = useCallback(() => {
    aberturas.current += 1;
    vigia.current.systemUiOpen = true;
  }, []);

  const fecharUiDoSistema = useCallback(() => {
    aberturas.current = Math.max(0, aberturas.current - 1);
    if (bandeiraCaiAoTerminar(aberturas.current, vigia.current.backgroundedAt !== null)) {
      vigia.current.systemUiOpen = false;
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    vivo.current = true;
    const sub = AppState.addEventListener('change', (s) => {
      marcar('appstate', {
        para: s,
        pedirNaVolta: pedirNaVolta.current,
        tentativa: tentativaAtual.current ? { autenticada: tentativaAtual.current.autenticada, cancelada: tentativaAtual.current.cancelada } : null,
        systemUiOpen: vigia.current.systemUiOpen,
      });
      if (s === 'active') {
        const tentativa = tentativaAtual.current;
        if (tentativa?.autenticada && !tentativa.cancelada) tentativa.aoVoltar?.(true);
        // Trancar de novo ZERA o estado: sem isso a cortina reabre mostrando o "não deu certo"
        // da sessão passada, que é informação velha na primeira coisa que a pessoa vê.
        if ((pedirNaVolta.current && vigia.current.mode === 'on' && vigia.current.temSessao)
          || deveTrancar(vigia.current, Date.now())) {
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
        /*
          ⚠️ **A bandeira é CONSUMIDA aqui, e é isso que tira o relógio da conta.** Este é o
          `active` que o fechamento da UI do sistema produz — ele pode demorar (1,3 s medidos no
          simulador). Se `pedirRef` acabou de abrir outro prompt, `aberturas` já subiu e ela fica.
        */
        if (bandeiraCaiNoActive(aberturas.current)) vigia.current.systemUiOpen = false;
        // Trancando, a trava monta no MESMO render e nasce coberta: não há quadro sem tinta.
        setVelado(false);
      } else if (s === 'background' || s === 'inactive') {
        vigia.current.backgroundedAt = Date.now();
        const tentativa = tentativaAtual.current;
        // No iOS o prompt só deixa o app inactive. Background é uma saída real.
        // No Android a tela de credencial também usa background; depois do resultado,
        // porém, uma nova saída já não pertence ao prompt que acabou de autenticar.
        if (s === 'background' && tentativa && (Platform.OS === 'ios' || tentativa.autenticada)) {
          tentativa.cancelada = true;
          tentativa.aoVoltar?.(false);
          vigia.current.systemUiOpen = false;
          pedirNaVolta.current = vigia.current.mode === 'on' && vigia.current.temSessao;
          if (pedirNaVolta.current) setLocked(true);
          setEstado('trancado');
        }
        // Só `background`: no iOS `inactive` é também a central de controle e o próprio Face ID.
        if (s === 'background' && deveVelarAoSair(vigia.current)) setVelado(true);
      }
    });
    return () => {
      vivo.current = false;
      invalidarTentativa();
      sub.remove();
    };
  }, [invalidarTentativa]);

  const configurar = useCallback(async (novo: LockMode) => {
    await AsyncStorage.setItem(CHAVE_MODO, novo);
    setMode(novo);
    vigia.current.mode = novo;
    if (novo === 'off') {
      invalidarTentativa();
      setLocked(false);
      setVelado(false);
      setEstado('trancado');
    }
  }, [invalidarTentativa]);

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
    marcar('trava:autenticar', { vivo: vivo.current, emVoo: emVoo.current });
    if (!vivo.current || emVoo.current) return 'trancado' as const;
    if (AppState.currentState !== 'active') {
      marcar('trava:autenticar:fica-para-a-volta');
      pedirNaVolta.current = true;
      return 'trancado' as const;
    }
    emVoo.current = true;
    pedirNaVolta.current = false;
    const tentativa: TentativaDeAbertura = {
      userId: session?.user.id,
      cancelada: false,
      autenticada: false,
    };
    tentativaAtual.current = tentativa;
    setEstado('autenticando');
    // O prompt tira o app do primeiro plano — sem a bandeira, voltar dele trancaria de novo por
    // cima do overlay que já estava aberto.
    abrirUiDoSistema();
    try {
      // Sem o módulo nativo não há como provar quem é o dono — e a trava nem chega a ficar
      // ligada (`podeTrancar(0)`), então este ramo é cinto de segurança, não caminho.
      const r = bio
        ? await bio.authenticateAsync({
            promptMessage: 'Desbloquear o app',
            // ⚠️ Sem `disableDeviceFallback: true`: é justamente o fallback do SISTEMA que
            // queremos. Escrever a chave como `false` é redundante, mas é o comentário mais
            // importante do arquivo — foi a linha que mudou de sentido.
            disableDeviceFallback: false,
            requireConfirmation: false,
          })
        : { success: false as const };
      const saida = aposAutenticar(r);
      marcar('trava:resultado', { saida, erro: 'error' in r ? r.error : null, cancelada: tentativa.cancelada });
      if (tentativa.cancelada) return 'trancado' as const;
      if (saida === 'aberto') {
        tentativa.autenticada = true;
        // Sucesso nativo pode chegar antes do active, inclusive mais de um segundo antes.
        // Só o retorno dessa mesma visita permite revelar; sair de novo invalida a espera.
        if (AppState.currentState !== 'active') {
          // Com teto: se o `active` desta visita se perder, `emVoo` ficava preso e nem o toque no
          // disco pedia de novo. Passado o teto, vale o estado real do app.
          const permitir = await Promise.race([
            new Promise<boolean>((resolve) => { tentativa.aoVoltar = resolve; }),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(AppState.currentState === 'active'), ESPERA_DO_ACTIVE_MS)),
          ]);
          marcar('trava:espera-do-active', { permitir, cancelada: tentativa.cancelada });
          if (!permitir || tentativa.cancelada || AppState.currentState !== 'active') return 'trancado' as const;
        }
        marcar('trava:destravou');
        congelarTimersSeDiagnostico();
        setLocked(false);
      }
      // Falhou FICA falhado: o botão passa a dizer "Tentar de novo" e a cortina diz o porquê.
      // Voltar sozinho para `trancado` apagaria a única pista de que a tentativa aconteceu.
      setEstado(saida === 'aberto' ? 'trancado' : 'falhou');
      return saida;
    } catch (erro) {
      marcar('trava:excecao', { erro: String(erro) });
      if (!tentativa.cancelada) setEstado('falhou');
      return 'trancado' as const;
    } finally {
      if (tentativaAtual.current === tentativa) tentativaAtual.current = null;
      emVoo.current = false;
      // Quem baixa a bandeira é o `active` do fechamento, não um prazo — ver `bandeiraCaiAoTerminar`.
      fecharUiDoSistema();
      // O active pode ter chegado com a tentativa antiga ainda em voo. O retry só começa
      // depois que ela termina, preservando a guarda que impede dois prompts simultâneos.
      if (vivo.current && pedirNaVolta.current && AppState.currentState === 'active'
        && vigia.current.mode === 'on' && vigia.current.temSessao) pedirRef.current();
    }
  }, [abrirUiDoSistema, fecharUiDoSistema, session?.user.id]);

  useEffect(() => {
    pedirRef.current = () => void autenticar();
  }, [autenticar]);

  useEffect(() => {
    /*
      ⚠️ **O pedido que ficou para "a volta" também sai quando a SESSÃO chega** (08/10/2026, *"às
      vezes termina a animação da logo e a cortina trava fechada"*). Na abertura a cortina monta
      com o app ainda não `active` e guarda o pedido (`pedirNaVolta`); o `active` que viria
      cumpri-lo só pede com sessão conhecida — e quando a sessão chegava DEPOIS dele, ninguém mais
      pedia a senha: a marca ficava parada até o teto de 20 s da abertura.
    */
    if (temSessao && pedirNaVolta.current && vigia.current.mode === 'on' && AppState.currentState === 'active') {
      pedirRef.current();
    }
  }, [temSessao]);

  const semTrancar = useCallback(async <T,>(fn: () => Promise<T>) => {
    abrirUiDoSistema();
    try {
      return await fn();
    } finally {
      fecharUiDoSistema();
    }
  }, [abrirUiDoSistema, fecharUiDoSistema]);

  const valor = useMemo(
    () => ({
      mode,
      delaySeconds,
      locked: locked && temSessao,
      velado: velado && temSessao,
      carregando: carregando || sessaoCarregando,
      disponivel,
      comoAutentica,
      estado,
      configurar,
      definirEspera,
      autenticar,
      semTrancar,
    }),
    [mode, delaySeconds, locked, velado, temSessao, carregando, sessaoCarregando, disponivel, comoAutentica, estado, configurar, definirEspera, autenticar, semTrancar]
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useLock() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLock fora do LockProvider');
  return ctx;
}
