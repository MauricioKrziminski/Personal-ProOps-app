/**
 * A trilha da abertura: cada passo da cortina, da trava e da sessão, gravado no APARELHO.
 *
 * Existe porque a cortina presa só aparece no iPhone de verdade, num build Release (onde o
 * `console` não sai), e cinco correções foram feitas por leitura de código sem uma prova do que
 * aconteceu (08/10/2026). O Perfil mostra e compartilha a trilha (`/profile/diagnostico`).
 *
 * ponytail: diagnóstico temporário — sai quando a causa da cortina presa estiver provada.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

const CHAVE = 'trilha-da-abertura';
/** As últimas linhas, de algumas aberturas: o bastante para ver a que travou e a anterior. */
const MAXIMO = 600;

export interface LinhaDaTrilha {
  /** Hora (ms) */
  t: number;
  /** `AppState.currentState` no instante */
  s: string;
  /** O passo, com os dados dele */
  e: string;
}

let memoria: LinhaDaTrilha[] | null = null;
let fila: Promise<void> = Promise.resolve();

async function carregar(): Promise<LinhaDaTrilha[]> {
  if (memoria) return memoria;
  try {
    const bruto = await AsyncStorage.getItem(CHAVE);
    memoria = bruto ? (JSON.parse(bruto) as LinhaDaTrilha[]) : [];
  } catch {
    memoria = [];
  }
  return memoria;
}

/** Grava um passo. Nunca lança e nunca espera: o diagnóstico não pode mudar o que observa. */
export function marcar(evento: string, dados?: Record<string, unknown>): void {
  const linha: LinhaDaTrilha = {
    t: Date.now(),
    s: AppState.currentState ?? '?',
    e: dados ? `${evento} ${JSON.stringify(dados)}` : evento,
  };
  fila = fila
    .then(async () => {
      const lista = await carregar();
      lista.push(linha);
      if (lista.length > MAXIMO) lista.splice(0, lista.length - MAXIMO);
      await AsyncStorage.setItem(CHAVE, JSON.stringify(lista));
    })
    .catch(() => {});
}

export async function lerTrilha(): Promise<LinhaDaTrilha[]> {
  await fila;
  return [...(await carregar())];
}

export async function limparTrilha(): Promise<void> {
  memoria = [];
  fila = fila.then(() => AsyncStorage.removeItem(CHAVE)).catch(() => {});
  await fila;
}

/** Uma linha legível: hora, Δ desde a anterior, estado do app e o passo. */
export function formatarTrilha(linhas: readonly LinhaDaTrilha[]): string {
  return linhas
    .map((l, i) => {
      const d = new Date(l.t);
      const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
      const delta = i === 0 ? 0 : l.t - linhas[i - 1].t;
      return `${hora} +${delta}ms [${l.s}] ${l.e}`;
    })
    .join('\n');
}

/*
  Reprodução no simulador (só `__DEV__`): com `diag-congelar-timers` = "1" no AsyncStorage,
  `setTimeout`, `setInterval` e `requestAnimationFrame` viram no-ops no instante em que a trava
  destrava — o estado que a trilha do iPhone mostrou. A cortina tem que abrir assim mesmo.
*/
let congelarNaDestrava = false;
if (__DEV__) {
  AsyncStorage.getItem('diag-congelar-timers')
    .then((v) => {
      congelarNaDestrava = v === '1';
    })
    .catch(() => {});
}

export function congelarTimersSeDiagnostico(): void {
  if (!__DEV__ || !congelarNaDestrava) return;
  marcar('diag:timers-congelados');
  const g = globalThis as unknown as Record<string, unknown>;
  g.setTimeout = () => 0;
  g.setInterval = () => 0;
  g.requestAnimationFrame = () => 0;
}

marcar('boot');
