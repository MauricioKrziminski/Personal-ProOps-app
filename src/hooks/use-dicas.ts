import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { useSession } from '@/hooks/use-session';
import {
  dicaDaVez,
  encerrar,
  reacender,
  telasDaDica,
  type DicaId,
  type EstadoDasDicas,
  type Tela,
} from '@/lib/dicas';

/**
 * A loja das dicas no lugar (`lib/dicas.ts`), por USUÁRIO — o mesmo desenho de
 * `useCartaoEscolhido`: um mapa de módulo para a leitura síncrona, o `AsyncStorage` para
 * atravessar o fechar e abrir do app (`dicas:<userId>`), e assinatura para as telas reagirem.
 *
 * Grava só o que precisa durar: as encerradas e se o guia já foi aberto. As telas "quietas" e a
 * dica pedida pelo guia valem só nesta abertura do app.
 */
const PREFIXO = 'dicas:';

type DoUsuario = { estado: EstadoDasDicas; guia: boolean };

const porUsuario = new Map<string, DoUsuario>();
const lidos = new Set<string>();
/**
 * Mudanças pedidas ANTES de o disco responder (abrir o app direto num link: o extrato de uma conta,
 * o guia). Aplicadas por cima do que foi lido — gravar antes apagaria o que já estava encerrado.
 */
const pendentes = new Map<string, ((u: DoUsuario) => DoUsuario)[]>();
/** Quais dicas estão na tela agora, por tela — a da vez só sai entre elas. */
const montadas = new Map<Tela, Map<DicaId, number>>();
const ouvintes = new Set<() => void>();
let usuarioAtual: string | undefined;

function avisar() {
  ouvintes.forEach((ouvinte) => ouvinte());
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function ler(userId: string) {
  if (lidos.has(userId)) return;
  lidos.add(userId);
  const guardar = (texto: string | null) => {
    let encerradas: DicaId[] = [];
    let guia = false;
    try {
      const salvo = texto ? (JSON.parse(texto) as { encerradas?: DicaId[]; guia?: boolean }) : null;
      encerradas = Array.isArray(salvo?.encerradas) ? salvo.encerradas : [];
      guia = salvo?.guia === true;
    } catch {
      // Gravado corrompido: começa do zero, que é mostrar as dicas de novo — nunca travar a tela.
    }
    const lido: DoUsuario = { estado: { encerradas, suspensas: [], forcada: null }, guia };
    const fila = pendentes.get(userId) ?? [];
    pendentes.delete(userId);
    const atual = fila.reduce((u, fn) => fn(u), lido);
    porUsuario.set(userId, atual);
    if (atual !== lido) gravar(userId, atual);
    avisar();
  };
  AsyncStorage.getItem(PREFIXO + userId)
    .then(guardar)
    .catch(() => guardar(null));
}

function gravar(userId: string, u: DoUsuario) {
  AsyncStorage.setItem(PREFIXO + userId, JSON.stringify({ encerradas: u.estado.encerradas, guia: u.guia })).catch(
    () => {},
  );
}

function mudar(fn: (atual: DoUsuario) => DoUsuario) {
  const userId = usuarioAtual;
  if (!userId) return;
  const atual = porUsuario.get(userId);
  if (!atual) {
    pendentes.set(userId, [...(pendentes.get(userId) ?? []), fn]);
    return;
  }
  const novo = fn(atual);
  if (novo === atual) return;
  porUsuario.set(userId, novo);
  avisar();
  gravar(userId, novo);
}

/** "Entendi": a dica não volta sozinha, e a tela fica quieta nesta visita. */
export function dispensarDica(id: DicaId, tela: Tela) {
  mudar((u) => ({ ...u, estado: encerrar(u.estado, id, tela) }));
}

/**
 * A pessoa USOU o que a dica ensina (TipKit: a dica some quando o recurso é descoberto). Chamada
 * pelos próprios gestos — o arrasto, a pilha, o gráfico —, em qualquer tela.
 */
export function usarDica(id: DicaId) {
  mudar((u) => {
    if (u.estado.encerradas.includes(id) && u.estado.forcada !== id) return u;
    return { ...u, estado: telasDaDica(id).reduce((e, tela) => encerrar(e, id, tela), u.estado) };
  });
}

/** O "Mostrar" do guia. */
export function reacenderDica(id: DicaId) {
  mudar((u) => ({ ...u, estado: reacender(u.estado, id) }));
}

export function marcarGuiaAberto() {
  mudar((u) => (u.guia ? u : { ...u, guia: true }));
}

function useUsuario() {
  const userId = useSession().session?.user.id;
  useEffect(() => {
    usuarioAtual = userId;
    if (userId) ler(userId);
    avisar();
  }, [userId]);
  return userId;
}

/** Esta dica é a da vez na tela? Registra que o alvo dela está na tela enquanto montada. */
export function useDica(id: DicaId, tela: Tela): boolean {
  const userId = useUsuario();
  useEffect(() => {
    const daTela = montadas.get(tela) ?? new Map<DicaId, number>();
    daTela.set(id, (daTela.get(id) ?? 0) + 1);
    montadas.set(tela, daTela);
    avisar();
    return () => {
      const n = (daTela.get(id) ?? 1) - 1;
      if (n > 0) daTela.set(id, n);
      else daTela.delete(id);
      avisar();
    };
  }, [id, tela]);
  return useSyncExternalStore(assinar, () => {
    const u = userId ? porUsuario.get(userId) : undefined;
    if (!u) return false;
    return dicaDaVez(tela, u.estado, [...(montadas.get(tela)?.keys() ?? [])]) === id;
  });
}

/** O guia já foi aberto por este usuário? `undefined` enquanto o disco não respondeu. */
export function useGuiaAberto(): boolean | undefined {
  const userId = useUsuario();
  return useSyncExternalStore(assinar, () => (userId ? porUsuario.get(userId)?.guia : undefined));
}
