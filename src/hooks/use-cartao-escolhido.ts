import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useSyncExternalStore } from 'react';

import { useSession } from '@/hooks/use-session';

/**
 * Qual cartão está na frente da carteira — o MESMO em todas as telas, e o de CADA conta.
 *
 * ⚠️ **A escolha é o `account_id`, nunca um índice.** Índice não sobrevive a nada: quando a query
 * dos cartões voltava a carregar, a pilha remontava no cartão 0 — a queixa foi literal, *"eu
 * seleciono o do nubank e depois ele volta para o BB sozinho"*.
 *
 * ⚠️ **Só o TOQUE num cartão da Carteira grava** (`escolherCartao`). Deslizar é folhear, e abrir a
 * Carteira pela miniatura de Cartões não é escolher: a escolha é o "padrão" que a pessoa vê ao
 * abrir o Financeiro, e ele não pode mudar porque ela passou os olhos por outro cartão.
 *
 * ⚠️ **A chave é POR USUÁRIO** (`card-stack-front:<userId>`). Era uma chave só no aparelho: quem
 * saía e entrava com outra conta herdava o `account_id` da anterior, que não existia na lista e
 * derrubava a pilha no primeiro cartão — e, voltando, a primeira conta tinha perdido a dela.
 *
 * Ela mora em dois lugares: no `AsyncStorage` (atravessa o fechar e abrir do app) e neste mapa de
 * módulo, que é a leitura SÍNCRONA — sem ele, cada remontagem nasceria no cartão 0 e corrigiria
 * um quadro depois. E é uma loja com assinatura (`useSyncExternalStore`) porque quem troca o
 * cartão é a Carteira, empilhada POR CIMA do Financeiro: a pilha de baixo precisa se reordenar
 * sozinha para o cartão voltar voando para o lugar certo.
 *
 * Ausente do mapa = o disco ainda não respondeu (`undefined`); `null` = respondeu e não havia
 * escolha. Cada usuário é lido do disco UMA vez por processo.
 */
const PREFIXO = 'card-stack-front:';
/** A chave antiga, global. Sem migração: ela não diz de qual conta era. */
const CHAVE_ANTIGA = 'card-stack-front';

const escolhidos = new Map<string, string | null>();
const lidos = new Set<string>();
const ouvintes = new Set<() => void>();
let antigaApagada = false;

function avisar() {
  ouvintes.forEach((ouvinte) => ouvinte());
}

function ler(userId: string) {
  if (lidos.has(userId)) return;
  lidos.add(userId);
  if (!antigaApagada) {
    antigaApagada = true;
    AsyncStorage.removeItem(CHAVE_ANTIGA).catch(() => {});
  }
  const guardar = (id: string | null) => {
    // Um toque que chegou antes do disco vale mais que o disco.
    if (escolhidos.has(userId)) return;
    escolhidos.set(userId, id);
    avisar();
  };
  AsyncStorage.getItem(PREFIXO + userId)
    .then(guardar)
    .catch(() => guardar(null));
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** A escolha AGORA, fora do render — o `beforeRemove` da Carteira roda antes de a pilha re-renderizar. */
export function cartaoEscolhido(userId: string | undefined): string | null | undefined {
  return userId ? escolhidos.get(userId) : null;
}

export function escolherCartao(userId: string | undefined, id: string) {
  if (!userId || escolhidos.get(userId) === id) return;
  escolhidos.set(userId, id);
  avisar();
  AsyncStorage.setItem(PREFIXO + userId, id).catch(() => {});
}

/**
 * O cartão da frente de quem está na sessão. O usuário sai do `useSession()` AQUI, e não de um
 * argumento: com a troca de conta passando por fora, haveria um render com o usuário novo e a
 * escolha do antigo. Sem sessão não há pilha, e o valor é `null`.
 */
export function useCartaoEscolhido(): string | null | undefined {
  const userId = useSession().session?.user.id;
  const assinarUsuario = useCallback(
    (ouvinte: () => void) => {
      if (userId) ler(userId);
      return assinar(ouvinte);
    },
    [userId]
  );
  return useSyncExternalStore(assinarUsuario, () => cartaoEscolhido(userId));
}
