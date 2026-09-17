import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/**
 * Qual cartão está na frente da carteira — o MESMO em todas as telas.
 *
 * ⚠️ **A escolha é o `account_id`, nunca um índice.** Índice não sobrevive a nada: quando a query
 * dos cartões voltava a carregar, a pilha remontava no cartão 0 — a queixa foi literal, *"eu
 * seleciono o do nubank e depois ele volta para o BB sozinho"*.
 *
 * Ela mora em dois lugares: no `AsyncStorage` (atravessa o fechar e abrir do app) e nesta
 * variável de módulo, que é a leitura SÍNCRONA — sem ela, cada remontagem nasceria no cartão 0 e
 * corrigiria um quadro depois. E é uma loja com assinatura (`useSyncExternalStore`) porque quem
 * troca o cartão agora é a Carteira, empilhada POR CIMA do Financeiro: a pilha de baixo precisa
 * se reordenar sozinha para o cartão voltar voando para o lugar certo.
 *
 * `undefined` = o disco ainda não respondeu; `null` = respondeu e não havia escolha.
 */
const STORAGE_KEY = 'card-stack-front';

let escolhido: string | null | undefined;
let lendo = false;
const ouvintes = new Set<() => void>();

function avisar() {
  ouvintes.forEach((ouvinte) => ouvinte());
}

function ler() {
  if (lendo) return;
  lendo = true;
  AsyncStorage.getItem(STORAGE_KEY)
    .then((id) => {
      if (escolhido !== undefined) return;
      escolhido = id;
      avisar();
    })
    .catch(() => {
      if (escolhido !== undefined) return;
      escolhido = null;
      avisar();
    });
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  if (escolhido === undefined) ler();
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function escolherCartao(id: string) {
  if (escolhido === id) return;
  escolhido = id;
  avisar();
  AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
}

export function useCartaoEscolhido(): string | null | undefined {
  return useSyncExternalStore(assinar, () => escolhido);
}
