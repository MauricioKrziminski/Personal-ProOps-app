import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatActions } from '@/components/agent/chat-actions';
import { AgentChatStart } from '@/components/agent/agent-chat-start';
import { AgentRecentConversations } from '@/components/agent/agent-recent-conversations';
import { AgentThreadHeading } from '@/components/agent/agent-thread-heading';
import { ChatComposer } from '@/components/agent/chat-composer';
import { ChatMessage } from '@/components/agent/chat-message';
import { RenameConversationSheet } from '@/components/agent/rename-conversation-sheet';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth } from '@/constants/theme';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderActions } from '@/components/ui/header-actions';
import { Icon } from '@/components/ui/icon';
import { TAB_BAR_SPACE } from '@/components/ui/pill-tab-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Radius, Space } from '@/design/tokens';
import {
  agentKeys,
  useAgentMessages,
  useCreateAgentConversation,
  useDeleteAgentConversation,
  useRenameAgentConversation,
  useResolveAgentPending,
  useSendAgentMessage,
  useTurnoLocal,
} from '@/hooks/use-agent-chat';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import {
  AgentApiError,
  AgentAuthExpiredError,
  type AgentMessage,
  type AgentTurn,
  transcribeAudio,
} from '@/lib/agent-api';
import {
  abrirConversaNova,
  audioPossuiSinal,
  canSubmitMessage,
  compositorTravado,
  conversationRoute,
  falhaDoTurno,
  newClientMessageId,
  retryDoTurno,
  sementeDaConversa,
  tituloProvisorio,
  isNearChatEnd,
  novaTravaDeToque,
  parseUiActions,
  prependMessagePage,
  type UiOption,
} from '@/lib/agent-chat';
import { falaAoVivoDisponivel, ouvir, reconhecedorRecusou, type Escuta } from '@/lib/fala';
import { confirmDestructive } from '@/lib/item-actions';


interface Props {
  /** `undefined` na tela `new`: a conversa ainda não existe. */
  conversationId?: string;
  /** Frase pronta vinda de um atalho. Só semeia o campo. */
  initialText?: string;
  title?: string;
  /** A conversa nova mora na própria aba e deixa a dock visível. */
  tabMode?: boolean;
}

/** O lease do turno no servidor dura 300s. Depois disso ninguém está rodando. */
const LEASE_MS = 300_000;

type Item =
  | { key: string; kind: 'user' | 'assistant'; message: AgentMessage }
  | { key: string; kind: 'processing' }
  | { key: string; kind: 'failed'; texto: string; retryable: boolean };

/** `listening` é a escuta ao vivo do aparelho; `recording`/`transcribing`, o caminho da Groq. */
type EstadoDoAudio = 'idle' | 'starting' | 'recording' | 'listening' | 'transcribing';

/**
 * A conversa — a mesma tela para `new` e para `[id]`.
 *
 * Um componente só porque as duas fazem exatamente a mesma coisa: mostram o
 * histórico (vazio, no caso de `new`), escrevem uma mensagem e esperam a
 * resposta. A ÚNICA diferença é qual mutation o primeiro envio chama, e duplicar
 * a tela por causa disso seria duplicar também o retry, o `Pensando...`, o HITL
 * e o scroll — quatro lugares para divergir.
 *
 * `new` não grava nada antes do primeiro envio: abrir e voltar não deixa
 * conversa vazia na lista, e é por isso que a criação carrega a mensagem junto.
 */
export function ConversationScreen({ conversationId, initialText = '', title, tabMode = false }: Props) {
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const lista = useRef<FlashListRef<Item>>(null);

  const [texto, setTexto] = useState(initialText);
  const [audioState, setAudioState] = useState<EstadoDoAudio>('idle');
  const audioPhase = useRef<EstadoDoAudio>('idle');
  /** A escuta ao vivo em curso (`lib/fala.ts`); `null` fora dela. */
  const escuta = useRef<Escuta | null>(null);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder);
  const niveisDaGravacao = useRef<number[]>([]);
  useEffect(() => () => {
    // O hook libera o gravador ao desmontar; o modo de áudio é global e precisa voltar
    // se a pessoa sair com o microfone aberto. Outra conversa pode estar montada:
    // não mexer no modo global quando esta tela já encerrou a gravação.
    if (audioPhase.current === 'starting' || audioPhase.current === 'recording') {
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
    escuta.current?.cancelar();
  }, []);
  useEffect(() => {
    if (recorderState.isRecording && typeof recorderState.metering === 'number') {
      niveisDaGravacao.current.push(recorderState.metering);
    }
  }, [recorderState.durationMillis, recorderState.isRecording, recorderState.metering]);
  const [erro, setErro] = useState<AgentApiError | null>(null);
  const [desistiu, setDesistiu] = useState(false);
  const [perto, setPerto] = useState(true);
  const [renomeando, setRenomeando] = useState(false);
  // O sticky translada a barra sem encolher sua posição no layout. A lista
  // precisa de uma JANELA menor; padding no conteúdo não muda o alinhamento
  // inferior de conversas curtas feito pela FlashList.
  const alturaDoTeclado = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const obstrucao = Math.max(0, alturaDoTeclado - insets.bottom);
  const entradaDaAba = tabMode && !conversationId;

  const turno = useTurnoLocal();
  const criar = useCreateAgentConversation();
  const enviar = useSendAgentMessage(conversationId ?? '');
  const resolver = useResolveAgentPending(conversationId ?? '');
  const renomear = useRenameAgentConversation();
  const excluir = useDeleteAgentConversation();
  const historico = useAgentMessages(conversationId);

  const mensagens = useMemo(
    () =>
      (historico.data?.pages ?? []).reduce<AgentMessage[]>(
        // A paginação anda para trás: cada página nova é MAIS VELHA que a
        // anterior, então ela entra no começo.
        (acc, p) => prependMessagePage(acc, p.items),
        [],
      ),
    [historico.data],
  );

  const local = turno.turno;

  /** A última coisa que o usuário mandou — a âncora do turno em aberto. */
  const ultimaDoUsuario = useMemo(
    () => [...mensagens].reverse().find((m) => m.role === 'user'),
    [mensagens],
  );

  /**
   * A mesma mensagem, já gravada pelo servidor.
   *
   * É ela que substitui um estado `processando` na tela: enquanto ela não
   * existe, o balão é o local; enquanto ela está `processing`, o turno ainda
   * roda — inclusive quando quem está rodando é OUTRO worker e a mutation já
   * voltou. Derivar do cache em vez de guardar um booleano é o que faz o
   * `Pensando...` sumir sozinho quando a resposta chega pela releitura.
   */
  const espelho = local
    ? mensagens.find((m) => m.client_message_id === local.clientMessageId)
    : undefined;

  /**
   * O turno que ainda não terminou, venha de onde vier.
   *
   * `local` cobre o envio desta sessão da tela. O segundo ramo cobre o caso que
   * um estado em memória NUNCA cobriria: a pessoa fechou o app com a mensagem
   * `processing` (lease morto) ou `failed` e voltou depois. O UUID que torna o
   * retry idempotente está gravado na própria linha — sem lê-lo de volta, o
   * "Tentar novamente" sumiria justamente quando ele é mais necessário.
   */
  const emVoo = useMemo(
    () =>
      local ??
      (ultimaDoUsuario?.status !== 'completed' && ultimaDoUsuario?.client_message_id
        ? {
            clientMessageId: ultimaDoUsuario.client_message_id,
            content: ultimaDoUsuario.content,
          }
        : null),
    [local, ultimaDoUsuario],
  );

  const noBanco = local ? espelho : ultimaDoUsuario;
  const noServidor = noBanco?.status === 'processing';
  // `criar` fica de fora: a criação navega no toque, e o estado dela chega à
  // tela de destino pelo CACHE (`noServidor`). Contá-lo aqui deixaria o
  // compositor da aba travado enquanto a conversa roda em outra tela.
  const rodando = enviar.isPending || resolver.isPending || noServidor;

  const ultima = mensagens[mensagens.length - 1];
  const pergunta = ultima?.role === 'assistant' ? ultima.ui_payload : null;
  // HITL aberto aceita texto e áudio de correção, além dos botões. Rascunhos
  // também aceitam texto; só um turno ainda em voo bloqueia o próximo envio.
  // Conversa que o servidor ainda não confirmou trava: a saída é o
  // "Tentar novamente", que recria com o mesmo par de ids.
  const esperandoAcao = compositorTravado(mensagens, {
    awaitingAction: Boolean(pergunta?.pending_id && !pergunta.resolved),
  });

  // O teto do lease. Sem ele, um turno que morreu no servidor deixaria a tela
  // com "Pensando..." para sempre, e ele nunca viraria um botão. A contagem sai
  // do `created_at` da mensagem, não da montagem: quem reabre o app com um turno
  // travado de ontem não espera mais cinco minutos para ver o botão.
  const desde = noBanco?.created_at ?? null;
  useEffect(() => {
    if (!rodando) return;
    const inicio = desde ? Date.parse(desde) : Date.now();
    const t = setTimeout(() => setDesistiu(true), Math.max(0, LEASE_MS - (Date.now() - inicio)));
    return () => clearTimeout(t);
  }, [rodando, desde]);

  const disparar = useCallback(
    (t: { clientMessageId: string; content: string }) => {
      setErro(null);
      setDesistiu(false);
      enviar.mutate(
        { clientMessageId: t.clientMessageId, content: t.content },
        {
          onSuccess: (resultado: AgentTurn) => {
            // `processing` significa que outro worker já roda ESTE turno. Não há
            // nada a reenviar; o `Pensando...` continua porque a mensagem no
            // cache continua `processing`, e a releitura o encerra.
            if (resultado.status !== 'processing') turno.concluir();
          },
          onError: (e: Error) => {
            // A sessão acabou: o `signOut()` já rodou e o portão do `_layout` vai
            // desmontar esta tela. Um toast aqui apareceria depois dela sumir.
            if (e instanceof AgentAuthExpiredError) return;
            const api = e as AgentApiError;
            setErro(api);
            if (api.policy?.paywall) router.push('/paywall');
          },
        },
      );
    },
    [enviar, turno],
  );

  const [trava] = useState(novaTravaDeToque);

  const mudarAudioState = useCallback((state: EstadoDoAudio) => {
    audioPhase.current = state;
    setAudioState(state);
  }, []);

  /** O caminho de antes: grava o áudio e, ao parar, transcreve na Groq. */
  const gravarNaGroq = useCallback(async () => {
    mudarAudioState('starting');
    let iniciou = false;
    let ativouModo = false;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Microfone sem acesso',
          'Permita o microfone nos ajustes do aparelho para gravar áudio.',
          [
            { text: 'Agora não', style: 'cancel' },
            { text: 'Abrir ajustes', onPress: () => { void Linking.openSettings(); } },
          ],
        );
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      ativouModo = true;
      await recorder.prepareToRecordAsync();
      recorder.record();
      iniciou = true;
      niveisDaGravacao.current = [];
      mudarAudioState('recording');
    } catch {
      toast({ message: 'Não consegui iniciar a gravação.', tone: 'error' });
    } finally {
      if (!iniciou) {
        if (ativouModo) await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
        mudarAudioState('idle');
      }
    }
  }, [mudarAudioState, recorder, toast]);

  /**
   * Ouve e escreve no campo enquanto a pessoa fala (`lib/fala.ts`). O que já estava digitado fica
   * na frente; o texto da escuta é refeito inteiro a cada palavra, nunca somado.
   */
  const escutar = useCallback(async () => {
    mudarAudioState('starting');
    const antes = texto.trim();
    let acabou = false;
    try {
      const e = await ouvir(
        (falado) => setTexto([antes, falado].filter(Boolean).join(' ')),
        ({ erro }) => {
          acabou = true;
          escuta.current = null;
          mudarAudioState('idle');
          // Sem reconhecedor (Siri e ditado desligados): grava e transcreve na Groq, sem erro na
          // tela — a pessoa tocou para falar, e existe outro jeito de ouvir.
          if (reconhecedorRecusou(erro)) {
            void gravarNaGroq();
            return;
          }
          // Parar e o silêncio não são falha: o que foi ouvido já está no campo.
          if (erro && erro !== 'aborted' && erro !== 'no-speech') {
            toast({ message: 'Não consegui ouvir. Tente de novo ou digite.', tone: 'error' });
          }
        },
      );
      if (e === 'negada') {
        mudarAudioState('idle');
        Alert.alert(
          'Microfone sem acesso',
          'Permita o microfone e o reconhecimento de fala nos ajustes do aparelho.',
          [
            { text: 'Agora não', style: 'cancel' },
            { text: 'Abrir ajustes', onPress: () => { void Linking.openSettings(); } },
          ],
        );
        return;
      }
      if (!e) {
        mudarAudioState('idle');
        return;
      }
      // O reconhecedor pode terminar antes de o `start` voltar (erro na hora): não reabrir.
      if (acabou) return;
      escuta.current = e;
      mudarAudioState('listening');
    } catch {
      mudarAudioState('idle');
      toast({ message: 'Não consegui iniciar a gravação.', tone: 'error' });
    }
  }, [gravarNaGroq, mudarAudioState, texto, toast]);

  const gravarOuTranscrever = useCallback(async () => {
    if (rodando || audioPhase.current === 'starting' || audioPhase.current === 'transcribing') return;
    if (audioPhase.current === 'listening') {
      escuta.current?.parar();
      return;
    }
    if (audioPhase.current === 'idle' && falaAoVivoDisponivel()) {
      await escutar();
      return;
    }
    if (audioPhase.current === 'idle') {
      await gravarNaGroq();
      return;
    }

    mudarAudioState('transcribing');
    let gravacaoUri: string | null = null;
    let modoRestaurado = false;
    try {
      await recorder.stop();
      try {
        await setAudioModeAsync({ allowsRecording: false });
        modoRestaurado = true;
      } catch { /* o arquivo gravado ainda pode ser transcrito */ }
      gravacaoUri = recorder.uri;
      if (!gravacaoUri) throw new Error('recording_without_file');
      if (!audioPossuiSinal(niveisDaGravacao.current)) {
        throw new AgentApiError(422, 'empty_audio', 'O microfone não captou som. Confira a entrada de áudio e tente novamente.');
      }
      const { text } = await transcribeAudio(gravacaoUri);
      const proximo = [texto.trim(), text.trim()].filter(Boolean).join('\n');
      if (proximo.length > 4_000) {
        toast({ message: 'O texto ficou longo demais. Apague um trecho e grave novamente.', tone: 'error' });
        return;
      }
      // A transcrição cai no campo como texto digitado: a pessoa lê, corrige se quiser, e o
      // próprio "enviar" é a confirmação — não há um segundo botão para o áudio (28/09/2026).
      setTexto(proximo);
    } catch (error) {
      toast({
        message: error instanceof AgentApiError ? error.message : 'Não consegui transcrever o áudio. Tente novamente.',
        tone: 'error',
      });
    } finally {
      if (gravacaoUri) {
        try { new File(gravacaoUri).delete(); } catch { /* cache da gravação pode já ter sido limpo */ }
      }
      if (!modoRestaurado) await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      mudarAudioState('idle');
    }
  }, [escutar, gravarNaGroq, mudarAudioState, recorder, rodando, texto, toast]);


  const submeter = useCallback(() => {
    if (audioPhase.current !== 'idle' || rodando || !canSubmitMessage(texto, { sending: rodando })) return;
    const conteudo = texto.trim();
    setTexto('');
    if (conversationId) {
      disparar(turno.iniciar(conteudo));
      return;
    }
    // Conversa nova: a tela da conversa abre NO TOQUE, com a mensagem já no
    // cache dela. Nenhum callback no `.mutate()` — o resultado chega pelo cache
    // (callbacks do hook), e na aba um callback aqui abriria o paywall duas vezes.
    // A trava barra o 2º toque do mesmo quadro e se libera sozinha no seguinte.
    abrirConversaNova(conteudo, {
      trava,
      gerarId: newClientMessageId,
      semear: (id, t) =>
        qc.setQueryData(agentKeys.messages(id), sementeDaConversa(t.clientMessageId, t.content)),
      enviar: (v) => criar.mutate(v),
      // A raiz da aba precisa continuar na pilha para o Android voltar à
      // conversa nova. A rota /agent/new já ocupa um detalhe e é substituída.
      navegar: (id) => (tabMode ? router.push(conversationRoute(id)) : router.replace(conversationRoute(id))),
    });
  }, [conversationId, criar, disparar, qc, rodando, tabMode, texto, trava, turno]);

  const tentarDeNovo = useCallback(() => {
    // O MESMO UUID de antes. Gerar um novo criaria um segundo lançamento do que
    // talvez já tenha rodado no servidor — a idempotência mora nessa chave, e o
    // servidor responde a ela com `recover_turn` em vez de reexecutar.
    if (!emVoo) return;
    if (conversationId && retryDoTurno(mensagens) === 'criar') {
      // A criação ainda não voltou do servidor: repete o POST com o MESMO par
      // (id da conversa + cmid). O estado sai do cache, como no primeiro envio.
      setDesistiu(false);
      criar.mutate({ id: conversationId, clientMessageId: emVoo.clientMessageId, content: emVoo.content });
      return;
    }
    disparar(emVoo);
  }, [conversationId, criar, disparar, emVoo, mensagens]);

  // 404 na criação: este id não é uma conversa desta pessoa. Ficar aqui seria
  // uma tela vazia sem saída; volta para o Agente e diz o que houve.
  const saiu = useRef(false);
  const sair = conversationId && noBanco?.status === 'failed' && falhaDoTurno(noBanco).sair;
  useEffect(() => {
    if (!sair || saiu.current) return;
    saiu.current = true;
    toast({ message: 'Não deu para abrir essa conversa.', tone: 'error' });
    if (router.canGoBack()) router.back();
    else router.replace('/agent');
  }, [sair, toast]);

  // O cabeçalho nasce com o título que o servidor VAI dar (mesma regra) e não
  // some enquanto a lista de conversas é relida — sem salto de layout.
  const provisorio =
    mensagens.length > 0 && retryDoTurno(mensagens) === 'criar'
      ? tituloProvisorio(mensagens[0].content)
      : undefined;
  const [tituloVisto, setTituloVisto] = useState<string | undefined>(undefined);
  const tituloAtual = title ?? provisorio;
  if (tituloAtual && tituloAtual !== tituloVisto) setTituloVisto(tituloAtual);
  const titulo = tituloAtual ?? tituloVisto;

  const decidir = useCallback(
    (mensagem: AgentMessage, opcao: UiOption) => {
      if (opcao.decision === 'draft') {
        // Rascunho não tem rota de resolução: o clique é uma MENSAGEM levando o
        // id cru do botão. O rótulo vira o texto do balão do usuário, como no
        // HITL — quem reabrir a conversa amanhã precisa ver o que respondeu, não
        // um payload.
        //
        // O mesmo par que `disparar` faz antes de todo envio: sem ele o
        // "demorou demais" do turno ANTERIOR fica na tela embaixo da resposta
        // que acabou de chegar (visto no emulador em 15/09/2026).
        setErro(null);
        setDesistiu(false);
        enviar.mutate(
          { clientMessageId: turno.novoId(), content: opcao.label, clickedId: opcao.id },
          {
            onError: (e: Error) => {
              if (e instanceof AgentAuthExpiredError) return;
              const api = e as AgentApiError;
              if (api.policy?.paywall) {
                router.push('/paywall');
                return;
              }
              toast({ message: 'Não deu para responder agora.', tone: 'error' });
            },
          },
        );
        return;
      }
      const pendingId = mensagem.ui_payload?.pending_id;
      if (!pendingId) return;
      resolver.mutate(
        {
          pendingId,
          clientMessageId: turno.novoId(),
          decision: opcao.decision,
          candidateId: opcao.candidateId,
        },
        {
          onError: (e: Error) => {
            if (e instanceof AgentAuthExpiredError) return;
            const api = e as AgentApiError;
            if (api.policy?.paywall) {
              router.push('/paywall');
              return;
            }
            // Sem retry aqui de propósito: a pergunta continua aberta e os
            // botões continuam na tela, que já são o "tentar de novo" dela.
            toast({
              message:
                api.status === 422
                  ? 'Essa confirmação expirou.'
                  : 'Não deu para responder agora.',
              tone: 'error',
            });
          },
        },
      );
    },
    [enviar, resolver, toast, turno],
  );

  const itens = useMemo<Item[]>(() => {
    const out: Item[] = mensagens.map((m) => ({ key: m.id, kind: m.role, message: m }));
    // O balão local só existe ENQUANTO o servidor não gravou o dele. Mantê-lo
    // depois duplicaria a mensagem na tela; guardá-lo no cache faria o mesmo.
    if (local && !espelho) {
      out.push({
        key: `local:${local.clientMessageId}`,
        kind: 'user',
        message: {
          id: `local:${local.clientMessageId}`,
          role: 'user',
          content: local.content,
          status: 'processing',
        },
      });
    }

    const falha = erro
      ? { texto: erro.message, retryable: erro.policy.retryable }
      // Turno que terminou não "demorou demais": a resposta está logo acima.
      : desistiu && noBanco?.status !== 'completed'
        ? { texto: 'Essa mensagem demorou demais.', retryable: true }
        : noBanco?.status === 'failed'
          ? falhaDoTurno(noBanco)
          : null;

    if (falha) {
      out.push({
        key: 'falhou',
        kind: 'failed',
        texto: falha.texto,
        retryable: falha.retryable && Boolean(emVoo),
      });
    } else if (rodando) {
      out.push({ key: 'pensando', kind: 'processing' });
    }
    return out;
  }, [mensagens, local, espelho, erro, desistiu, noBanco, emVoo, rodando]);

  const desenharLinha = useCallback(
    ({ item }: { item: Item }) => (
      <View style={styles.messageFrame}>
        <Linha item={item} busy={rodando} onDecide={decidir} onRetry={tentarDeNovo} />
      </View>
    ),
    // A identidade precisa ser estável: sem isso cada tecla digitada no composer
    // devolveria um `renderItem` novo e a conversa inteira remontaria.
    [rodando, decidir, tentarDeNovo],
  );

  const aoRolar = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const novo = isNearChatEnd({
      contentOffset: contentOffset.y,
      layoutHeight: layoutMeasurement.height,
      contentHeight: contentSize.height,
    });
    // Só troca quando o booleano muda: `onScroll` dispara dezenas de vezes por
    // rolagem e um `setState` por evento remontaria a conversa inteira.
    setPerto((atual) => (atual === novo ? atual : novo));
  }, []);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = historico;
  const carregarAnteriores = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const acoesDoHeader = conversationId
    ? [
        { label: 'Renomear', icon: 'pencil' as const, onPress: () => setRenomeando(true) },
        {
          label: 'Apagar',
          icon: 'trash' as const,
          destructive: true,
          onPress: () =>
            confirmDestructive(
              'Apagar conversa?',
              'Apagar',
              () =>
                excluir.mutate(conversationId, {
                  onSuccess: () => router.replace('/agent/history'),
                  onError: (e) =>
                    toast({
                      message:
                        (e as AgentApiError).status === 409
                          ? 'O turno ainda está terminando. Tenta em instantes.'
                          : 'Não deu para apagar a conversa.',
                      tone: 'error',
                    }),
                }),
              'O histórico e as confirmações pendentes desta conversa serão apagados.',
            ),
        },
      ]
    : [];

  return (
    <View style={[
      styles.raiz,
      { backgroundColor: theme.background },
      tabMode && Platform.OS === 'android' ? { paddingBottom: TAB_BAR_SPACE + insets.bottom } : null,
    ]}>
      {!tabMode ? <Stack.Screen options={{ title: conversationId ? 'Conversa' : 'Nova conversa' }} /> : null}
      {!tabMode ? <HeaderActions
        actions={[
          {
            label: 'Histórico de conversas',
            icon: 'clock.arrow.circlepath',
            onPress: () => router.push('/agent/history'),
          },
        ]}
        menu={conversationId ? {
          title: 'Conversa',
          actions: [
            { label: 'Nova conversa', icon: 'square.and.pencil', onPress: () => router.replace('/agent/new') },
            ...acoesDoHeader,
          ],
        } : undefined}
      /> : null}

      {conversationId && titulo ? <AgentThreadHeading title={titulo} /> : null}

      {entradaDaAba ? (
        <KeyboardAwareScrollView
          style={styles.lista}
          // No iOS a `NativeTabs` põe a barra dentro da área segura: sem somar `insets.bottom`
          // (a mesma conta do `Screen`), o fim da entrada — o "Ver todas" das recentes — ficava
          // atrás da barra. No Android quem reserva a pílula é o `paddingBottom` da raiz.
          contentContainerStyle={[
            styles.entradaScroll,
            Platform.OS === 'ios' ? { paddingBottom: Space.xxxl + insets.bottom } : null,
          ]}
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          bottomOffset={Space.xl}>
          <AgentChatStart
            onSelectPrompt={setTexto}
            recent={<AgentRecentConversations />}
            composer={
              <ChatComposer
                inline
                value={texto}
                onChangeText={setTexto}
                onSubmit={submeter}
                sending={rodando}
                awaitingAction={esperandoAcao}
                audioState={audioState}
                onAudioPress={gravarOuTranscrever}
              />
            }
          />
        </KeyboardAwareScrollView>
      ) : (
        <>
          <View style={[styles.lista, { paddingBottom: obstrucao }]}>
            {historico.isPending && conversationId ? (
              <View style={styles.esqueleto}>
                {/* Alturas diferentes de propósito: o esqueleto tem a FORMA da
                    conversa (pergunta curta, resposta longa), não três barras iguais. */}
                {[70, 44, 90].map((h) => (
                  <Skeleton key={h} height={h} radius={Radius.md} />
                ))}
              </View>
            ) : historico.isError && !historico.data ? (
              <EmptyState
                icon="exclamationmark.triangle"
                title="Não consegui carregar essa conversa"
                hint="Confere a conexão e tenta de novo."
                action={{ label: 'Tentar novamente', onPress: () => historico.refetch() }}
              />
            ) : (
              <ConversationTimeline
                key={conversationId ?? 'new'}
                listRef={lista}
                items={itens}
                renderItem={desenharLinha}
                onScroll={aoRolar}
                onStartReached={carregarAnteriores}
                onSelectPrompt={setTexto}
              />
            )}

            {!perto ? (
              <Pressable
                onPress={() => lista.current?.scrollToEnd({ animated: true })}
                accessibilityRole="button"
                accessibilityLabel="Ir para a mensagem mais recente"
                style={[
                  styles.irAoFim,
                  {
                    bottom: obstrucao + Space.sm,
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.cardBorder,
                  },
                ]}>
                <Icon name="arrow.down" size={18} color="text" />
              </Pressable>
            ) : null}
          </View>

          <ChatComposer
            value={texto}
            onChangeText={setTexto}
            onSubmit={submeter}
            sending={rodando}
            awaitingAction={esperandoAcao}
            audioState={audioState}
            onAudioPress={gravarOuTranscrever}
          />
        </>
      )}

      <RenameConversationSheet
        key={renomeando ? 'aberto' : 'fechado'}
        visible={renomeando}
        initialTitle={titulo ?? ''}
        saving={renomear.isPending}
        onClose={() => setRenomeando(false)}
        onSave={(novo) => {
          if (!conversationId) return;
          renomear.mutate(
            { id: conversationId, title: novo },
            {
              onSuccess: () => setRenomeando(false),
              onError: () =>
                toast({ message: 'Não deu para renomear a conversa.', tone: 'error' }),
            },
          );
        }}
      />
    </View>
  );
}

/**
 * A âncora inicial pertence ao ciclo de vida da lista, não ao número atual de
 * mensagens. A quinta mensagem não muda a posição de uma conversa em leitura.
 */
function ConversationTimeline({
  listRef,
  items,
  renderItem,
  onScroll,
  onStartReached,
  onSelectPrompt,
}: {
  listRef: RefObject<FlashListRef<Item> | null>;
  items: Item[];
  renderItem: ({ item }: { item: Item }) => ReactElement;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onStartReached: () => void;
  onSelectPrompt: (prompt: string) => void;
}) {
  const [startAtBottom] = useState(() => items.length > 4);
  return (
    <FlashList keyboardShouldPersistTaps="handled"
      ref={listRef}
      style={styles.lista}
      data={items}
      keyExtractor={(item) => item.key}
      getItemType={(item) => item.kind}
      renderItem={renderItem}
      contentContainerStyle={{ paddingHorizontal: Space.lg, paddingVertical: Space.md }}
      onScroll={onScroll}
      scrollEventThrottle={64}
      maintainVisibleContentPosition={{
        startRenderingFromBottom: startAtBottom,
        autoscrollToBottomThreshold: 0.2,
      }}
      onStartReachedThreshold={0.3}
      onStartReached={onStartReached}
      ListEmptyComponent={<AgentChatStart onSelectPrompt={onSelectPrompt} />}
    />
  );
}

/** Uma linha da conversa. Fora do componente-pai para não remontar a cada tecla. */
const Linha = memo(function Linha({
  item,
  busy,
  onDecide,
  onRetry,
}: {
  item: Item;
  busy: boolean;
  onDecide: (m: AgentMessage, o: UiOption) => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  if (item.kind === 'processing') {
    return (
      // Uma linha ESTÁVEL, sem bolha entrando e saindo: o que muda é o texto, e
      // a lista não se mexe. `polite` para o leitor de tela anunciar sem cortar
      // o que estava lendo.
      <View style={[styles.status, styles.statusBusy]} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={theme.textSecondary} />
        <ThemedText type="footnote" themeColor="textSecondary">
          Organizando sua resposta…
        </ThemedText>
      </View>
    );
  }

  if (item.kind === 'failed') {
    return (
      <View style={styles.status}>
        <ThemedText type="footnote" themeColor="danger">
          {item.texto}
        </ThemedText>
        {item.retryable ? (
          <Button label="Tentar novamente" variant="secondary" size="sm" onPress={onRetry} />
        ) : null}
      </View>
    );
  }

  const { body, options } = parseUiActions(item.message.ui_payload);
  return (
    <View style={styles.item}>
      {/*
        Com botões, o balão mostra o `body` e não o `content`: o `content` é o
        texto numerado do WhatsApp ("1) ... responde com o número"), que aqui
        seria a mesma pergunta escrita duas vezes.
      */}
      <ChatMessage
        role={item.kind}
        content={options.length > 0 && body ? body : item.message.content}
      />
      {item.message.ui_payload ? (
        <ChatActions
          payload={item.message.ui_payload}
          busy={busy}
          onDecide={(o) => onDecide(item.message, o)}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  raiz: { flex: 1 },
  lista: { flex: 1 },
  entradaScroll: { paddingBottom: Space.xxxl },
  messageFrame: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  item: { paddingVertical: Space.lg },
  status: { paddingVertical: Space.lg, gap: Space.sm, alignItems: 'flex-start' },
  statusBusy: { flexDirection: 'row', alignItems: 'center' },
  esqueleto: { padding: Space.lg, gap: Space.md },
  irAoFim: {
    position: 'absolute',
    right: Space.lg,
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
