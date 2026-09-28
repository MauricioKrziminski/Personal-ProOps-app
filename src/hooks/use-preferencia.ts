import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useSyncExternalStore } from 'react';

import { useSession } from '@/hooks/use-session';

/**
 * Uma escolha de VISUALIZAÇÃO da tela, gravada — Mês ou Ciclo, o horizonte da Projeção, o período
 * do gráfico. Fechou o app e abriu de novo, a tela volta como a pessoa deixou (28/09/2026, *"se eu
 * deixei ciclo, ele tem que abrir sempre no ciclo, essas micro configurações têm que salvar
 * sempre"*).
 *
 * **Filtro não entra aqui.** Tipo, status, categoria e conta de Lançamentos continuam da visita:
 * um filtro que volta sozinho esconde lançamento sem avisar, e os atalhos da Hoje abrem aquelas
 * telas JÁ filtradas pelo link.
 *
 * O desenho é o da loja do cartão da frente (`use-cartao-escolhido.ts`) e das dicas:
 *
 * - **Memória de módulo é a leitura SÍNCRONA.** Lendo do disco a cada montagem, a tela nasceria no
 *   padrão e trocaria um quadro depois — com a régua isso é buscar o mês civil, trocar para o
 *   ciclo e buscar de novo. `carregarPreferencias` roda quando a sessão chega (`_layout`), antes
 *   de qualquer tela que as use.
 * - **Um JSON por usuário** (`prefs:<userId>`): outra conta no mesmo aparelho não herda a régua
 *   de ninguém.
 * - **Toque antes do disco vale mais que o disco**, e não apaga o resto do que estava gravado.
 * - Valor gravado que a tela não aceita mais (versão antiga, disco corrompido) cai no padrão.
 */
type Valor = string | number;
type Gravado = Record<string, Valor>;

const PREFIXO = 'prefs:';

const porUsuario = new Map<string, Gravado>();
const lidos = new Set<string>();
/** Toques que chegaram antes de o disco responder. */
const antesDoDisco = new Map<string, Gravado>();
const ouvintes = new Set<() => void>();

function avisar() {
  ouvintes.forEach((ouvinte) => ouvinte());
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function gravar(userId: string, g: Gravado) {
  AsyncStorage.setItem(PREFIXO + userId, JSON.stringify(g)).catch(() => {});
}

/** Lê do aparelho UMA vez por usuário e por processo. */
export function carregarPreferencias(userId: string) {
  if (lidos.has(userId)) return;
  lidos.add(userId);
  const guardar = (texto: string | null) => {
    let lido: Gravado = {};
    try {
      const salvo: unknown = texto ? JSON.parse(texto) : null;
      if (salvo && typeof salvo === 'object' && !Array.isArray(salvo)) lido = salvo as Gravado;
    } catch {
      // Corrompido: começa do padrão, nunca trava a tela.
    }
    const toques = antesDoDisco.get(userId);
    antesDoDisco.delete(userId);
    const atual = toques ? { ...lido, ...toques } : lido;
    porUsuario.set(userId, atual);
    if (toques) gravar(userId, atual);
    avisar();
  };
  AsyncStorage.getItem(PREFIXO + userId)
    .then(guardar)
    .catch(() => guardar(null));
}

function ler(userId: string | undefined, nome: string): Valor | undefined {
  if (!userId) return undefined;
  return antesDoDisco.get(userId)?.[nome] ?? porUsuario.get(userId)?.[nome];
}

function escrever(userId: string | undefined, nome: string, valor: Valor) {
  if (!userId || ler(userId, nome) === valor) return;
  const lido = porUsuario.get(userId);
  if (!lido) {
    antesDoDisco.set(userId, { ...antesDoDisco.get(userId), [nome]: valor });
  } else {
    const novo = { ...lido, [nome]: valor };
    porUsuario.set(userId, novo);
    gravar(userId, novo);
  }
  avisar();
}

/**
 * A escolha `nome` de quem está na sessão. `aceita` diz se o valor gravado ainda é uma opção da
 * tela; o que não for vira `padrao`.
 */
export function usePreferencia<T extends Valor>(
  nome: string,
  padrao: T,
  aceita: (v: Valor) => v is T,
): [T, (v: T) => void] {
  const userId = useSession().session?.user.id;
  const assinarUsuario = useCallback(
    (ouvinte: () => void) => {
      if (userId) carregarPreferencias(userId);
      return assinar(ouvinte);
    },
    [userId],
  );
  const bruto = useSyncExternalStore(assinarUsuario, () => ler(userId, nome));
  const valor = bruto !== undefined && aceita(bruto) ? bruto : padrao;
  const mudar = useCallback((v: T) => escrever(userId, nome, v), [userId, nome]);
  return [valor, mudar];
}

/** `aceita` para uma lista fechada de opções. */
export function umDe<T extends Valor>(opcoes: readonly T[]) {
  return (v: Valor): v is T => (opcoes as readonly Valor[]).includes(v);
}
