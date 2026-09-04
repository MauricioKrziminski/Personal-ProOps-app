import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Stack, router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { ChatActions } from '@/components/agent/chat-actions';
import { ChatComposer } from '@/components/agent/chat-composer';
import { ChatMessage } from '@/components/agent/chat-message';
import { RenameConversationSheet } from '@/components/agent/rename-conversation-sheet';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderMenu } from '@/components/ui/header-actions';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Radius, Space } from '@/design/tokens';
import {
  useAgentMessages,
  useCreateAgentConversation,
  useDeleteAgentConversation,
  useRenameAgentConversation,
  useResolveAgentPending,
  useSendAgentMessage,
  useTurnoLocal,
} from '@/hooks/use-agent-chat';
import { useTheme } from '@/hooks/use-theme';
import {
  AgentApiError,
  AgentAuthExpiredError,
  type AgentMessage,
  type AgentTurn,
} from '@/lib/agent-api';
import {
  conversationRoute,
  isNearChatEnd,
  parseUiActions,
  prependMessagePage,
  type UiOption,
} from '@/lib/agent-chat';
import { confirmDestructive } from '@/lib/item-actions';

interface Props {
  /** `undefined` na tela `new`: a conversa ainda não existe. */
  conversationId?: string;
  /** Frase pronta vinda do estado vazio da lista. Só semeia o campo. */
  initialText?: string;
  title?: string;
}

/** O lease do turno no servidor dura 300s. Depois disso ninguém está rodando. */
const LEASE_MS = 300_000;

type Item =
  | { key: string; kind: 'user' | 'assistant'; message: AgentMessage }
  | { key: string; kind: 'processing' }
  | { key: string; kind: 'failed'; texto: string; retryable: boolean };

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
export function ConversationScreen({ conversationId, initialText = '', title }: Props) {
  const theme = useTheme();
  const toast = useToast();
  const lista = useRef<FlashListRef<Item>>(null);

  const [texto, setTexto] = useState(initialText);
  const [erro, setErro] = useState<AgentApiError | null>(null);
  const [desistiu, setDesistiu] = useState(false);
  const [perto, setPerto] = useState(true);
  const [renomeando, setRenomeando] = useState(false);

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
  const noServidor = espelho?.status === 'processing';
  const rodando =
    criar.isPending || enviar.isPending || resolver.isPending || noServidor;

  const ultima = mensagens[mensagens.length - 1];
  const pergunta = ultima?.role === 'assistant' ? ultima.ui_payload : null;
  /** Uma pergunta aberta trava o campo: a resposta dela sai dos botões. */
  const esperandoAcao = Boolean(pergunta?.pending_id && !pergunta.resolved);

  // O teto do lease. Sem ele, um turno que morreu no servidor deixaria a tela
  // com "Pensando..." para sempre, e ele nunca viraria um botão.
  useEffect(() => {
    if (!rodando) return;
    const t = setTimeout(() => setDesistiu(true), LEASE_MS);
    return () => clearTimeout(t);
  }, [rodando]);

  const disparar = useCallback(
    (t: { clientMessageId: string; content: string }) => {
      setErro(null);
      setDesistiu(false);
      const opcoes = {
        onSuccess: (resultado: AgentTurn) => {
          // `processing` significa que outro worker já roda ESTE turno. Não há
          // nada a reenviar; o `Pensando...` continua porque a mensagem no
          // cache continua `processing`, e a releitura o encerra.
          if (resultado.status !== 'processing') turno.concluir();
          if (!conversationId) router.replace(conversationRoute(resultado.conversation.id));
        },
        onError: (e: Error) => {
          // A sessão acabou: o `signOut()` já rodou e o portão do `_layout` vai
          // desmontar esta tela. Um toast aqui apareceria depois dela sumir.
          if (e instanceof AgentAuthExpiredError) return;
          const api = e as AgentApiError;
          setErro(api);
          if (api.policy?.paywall) router.push('/paywall');
        },
      };
      const variaveis = { clientMessageId: t.clientMessageId, content: t.content };
      if (conversationId) enviar.mutate(variaveis, opcoes);
      else criar.mutate(variaveis, opcoes);
    },
    [conversationId, criar, enviar, turno],
  );

  const submeter = useCallback(() => {
    const t = turno.iniciar(texto.trim());
    setTexto('');
    disparar(t);
  }, [disparar, texto, turno]);

  const tentarDeNovo = useCallback(() => {
    // O MESMO UUID de antes. Gerar um novo criaria um segundo lançamento do que
    // talvez já tenha rodado no servidor — a idempotência mora nessa chave.
    const t = turno.retentar();
    if (t) disparar(t);
  }, [disparar, turno]);

  const decidir = useCallback(
    (mensagem: AgentMessage, opcao: UiOption) => {
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
    [resolver, toast, turno],
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
    if (erro) {
      out.push({
        key: 'falhou',
        kind: 'failed',
        texto: erro.message,
        retryable: erro.policy.retryable && Boolean(local),
      });
    } else if (desistiu) {
      out.push({
        key: 'falhou',
        kind: 'failed',
        texto: 'Essa mensagem demorou demais.',
        retryable: Boolean(local),
      });
    } else if (rodando) {
      out.push({ key: 'pensando', kind: 'processing' });
    }
    return out;
  }, [mensagens, local, espelho, erro, desistiu, rodando]);

  const desenharLinha = useCallback(
    ({ item }: { item: Item }) => (
      <Linha item={item} busy={rodando} onDecide={decidir} onRetry={tentarDeNovo} />
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

  const acoesDoHeader = conversationId
    ? [
        { label: 'Renomear', icon: 'pencil' as const, onPress: () => setRenomeando(true) },
        {
          label: 'Excluir',
          icon: 'trash' as const,
          destructive: true,
          onPress: () =>
            confirmDestructive(
              'Excluir conversa?',
              'Excluir',
              () =>
                excluir.mutate(conversationId, {
                  onSuccess: () => router.replace('/agent'),
                  onError: (e) =>
                    toast({
                      message:
                        (e as AgentApiError).status === 409
                          ? 'O turno ainda está terminando. Tenta em instantes.'
                          : 'Não deu para excluir a conversa.',
                      tone: 'error',
                    }),
                }),
              'O histórico e as confirmações pendentes desta conversa serão apagados.',
            ),
        },
      ]
    : [];

  return (
    <View style={[styles.raiz, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: title ?? '' }} />
      <HeaderMenu title={title ?? 'Conversa'} actions={acoesDoHeader} />

      {historico.isPending && conversationId ? (
        <View style={styles.esqueleto}>
          {[70, 44, 90].map((h, i) => (
            <Skeleton key={i} height={h} radius={Radius.md} />
          ))}
        </View>
      ) : historico.isError ? (
        <EmptyState
          icon="exclamationmark.triangle"
          title="Não consegui carregar essa conversa"
          hint="Confere a conexão e tenta de novo."
          action={{ label: 'Tentar novamente', onPress: () => historico.refetch() }}
        />
      ) : (
        <FlashList
          ref={lista}
          data={itens}
          keyExtractor={(i) => i.key}
          getItemType={(i) => i.kind}
          renderItem={desenharLinha}
          contentContainerStyle={styles.conteudo}
          onScroll={aoRolar}
          scrollEventThrottle={64}
          /*
            `startRenderingFromBottom`: a conversa abre na última mensagem, que é
            onde ela parou. `autoscrollToBottomThreshold` faz a resposta que
            chega seguir o fim SÓ quando a pessoa já estava lá — longe do fim ela
            está lendo, e puxar a lista é arrancar a tela da mão dela.
          */
          maintainVisibleContentPosition={{
            startRenderingFromBottom: true,
            autoscrollToBottomThreshold: 0.2,
          }}
          onStartReachedThreshold={0.3}
          onStartReached={() => {
            if (historico.hasNextPage && !historico.isFetchingNextPage) {
              historico.fetchNextPage();
            }
          }}
          ListEmptyComponent={
            <EmptyState
              title="Pergunta o que quiser"
              hint="“Gastei 45 no mercado”, “quanto sobrou esse mês?”, “me lembra do aluguel dia 5”."
            />
          }
        />
      )}

      {!perto ? (
        <Pressable
          onPress={() => lista.current?.scrollToEnd({ animated: true })}
          accessibilityRole="button"
          accessibilityLabel="Ir para a mensagem mais recente"
          style={[
            styles.irAoFim,
            { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder },
          ]}>
          <Icon name="arrow.down" size={18} color="text" />
        </Pressable>
      ) : null}

      <ChatComposer
        value={texto}
        onChangeText={setTexto}
        onSubmit={submeter}
        sending={rodando}
        awaitingAction={esperandoAcao}
      />

      <RenameConversationSheet
        key={renomeando ? 'aberto' : 'fechado'}
        visible={renomeando}
        initialTitle={title ?? ''}
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
      <View style={styles.status} accessibilityLiveRegion="polite">
        <ThemedText type="footnote" themeColor="textSecondary">
          Pensando…
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
      {item.message.status === 'failed' ? (
        <ThemedText type="footnote" style={{ color: theme.danger }}>
          Essa mensagem não foi processada.
        </ThemedText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  raiz: { flex: 1 },
  conteudo: { paddingHorizontal: Space.lg, paddingVertical: Space.md },
  item: { paddingVertical: Space.sm },
  status: { paddingVertical: Space.sm, gap: Space.sm, alignItems: 'flex-start' },
  esqueleto: { padding: Space.lg, gap: Space.md },
  irAoFim: {
    position: 'absolute',
    right: Space.lg,
    bottom: 96,
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
