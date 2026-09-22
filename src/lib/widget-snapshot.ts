/**
 * O RETRATO que os widgets desenham — puro, já formatado, sem React.
 *
 * Widget não roda o app: no iOS o componente é SwiftUI e não pode importar nada nem fazer
 * conta (`expo-widgets`: "cannot import other modules"); no Android ele renderiza de um JSON
 * guardado, às vezes com o app fechado. Por isso tudo que ele mostra chega PRONTO aqui: texto,
 * valor formatado, tom. Uma fonte, dois desenhos — e a Hoje e os widgets não têm como dizer
 * números diferentes, porque saem da mesma leitura (`spendable` + `upcoming_bills`).
 *
 * ⚠️ **"Esconder saldo" vale na tela de início também.** Widget fica à vista de quem pega o
 * celular; com o olho fechado no app, o retrato leva a máscara no lugar dos valores.
 */

import { diasAte, formatBRL, isoToBR, rotuloDoDia } from './dates.ts';

export const MASCARA = 'R$ ••••';

export interface Veredito {
  tom: 'perigo' | 'neutro';
  texto: string;
  icone: 'exclamationmark.triangle' | 'clock' | 'calendar' | 'checkmark.circle';
}

/**
 * A segunda linha do herói da Hoje: obrigação (devo alguma coisa?) ganha de permissão (posso
 * gastar?). "Por dia" some abaixo de R$ 1,00 — um número ridículo no lugar mais nobre da tela
 * ensina a pessoa a não ler a linha. Mora aqui para a Hoje e os widgets dizerem a MESMA frase.
 */
export function vereditoDoDia(v: {
  atrasadoCents: number;
  venceHojeCents: number;
  livreCents: number;
  diasLivres: number;
  brl: (cents: number) => string;
}): Veredito {
  const dias = `${v.diasLivres} ${v.diasLivres === 1 ? 'dia' : 'dias'}`;
  const porDia = v.livreCents > 0 ? Math.floor(v.livreCents / v.diasLivres) : 0;
  if (v.atrasadoCents > 0) {
    return { tom: 'perigo', icone: 'exclamationmark.triangle', texto: `${v.brl(v.atrasadoCents)} atrasado` };
  }
  if (v.venceHojeCents > 0) {
    return { tom: 'perigo', icone: 'clock', texto: `${v.brl(v.venceHojeCents)} vence hoje` };
  }
  if (porDia >= 100) {
    return { tom: 'neutro', icone: 'calendar', texto: `≈ ${v.brl(porDia)} por dia · ${dias}` };
  }
  return { tom: 'neutro', icone: 'checkmark.circle', texto: `Nada vence hoje · ${dias} até entrar` };
}

export interface ContaDoRetrato {
  titulo: string;
  quando: string;
  valor: string;
  atrasada: boolean;
}

export interface Retrato {
  /** Quem desenha confere a versão: retrato de formato velho vira "abra o app", nunca lixo. */
  versao: 1;
  estado: 'ok' | 'sem-sessao';
  rotulo: string;
  livre: string;
  livreNegativo: boolean;
  veredito: Veredito;
  /** "até 10/10 · R$ 12.333,20" — os compromissos do ciclo, a faixa de baixo do herói. */
  compromissos: string | null;
  contas: ContaDoRetrato[];
  /** Quantas contas há além das mostradas. */
  maisContas: number;
  totalContas: string;
  atualizado: string;
}

export interface EntradaDoRetrato {
  spendable: {
    caixa: number | string;
    comprometido_ate_entrada: number | string;
    comprometido_no_ciclo?: number | string | null;
    proxima_entrada: string | null;
  };
  cicloAte: string | null;
  /** `upcoming_bills` — só as saídas contam. */
  contas: { title: string; due_date: string; amount_cents: number; kind: string; overdue: boolean }[];
  hoje: string;
  /** `HH:MM` de quando o retrato foi tirado. */
  agora: string;
  oculto: boolean;
  limiteContas?: number;
}

export function montarRetrato(e: EntradaDoRetrato): Retrato {
  const brl = (cents: number) => (e.oculto ? MASCARA : formatBRL(cents));
  const caixa = Number(e.spendable.caixa ?? 0);
  const comprometido = Number(e.spendable.comprometido_ate_entrada ?? 0);
  const livre = caixa - comprometido;
  const ate = e.spendable.proxima_entrada ?? e.cicloAte ?? null;
  const diasLivres = Math.max(1, ate ? diasAte(ate, e.hoje) : 1);

  const saidas = e.contas
    .filter((c) => c.kind !== 'income')
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.due_date.localeCompare(b.due_date));
  const atrasado = saidas.filter((c) => c.overdue).reduce((s, c) => s + c.amount_cents, 0);
  const venceHoje = saidas.filter((c) => !c.overdue && c.due_date === e.hoje).reduce((s, c) => s + c.amount_cents, 0);
  const limite = e.limiteContas ?? 4;
  const comprometidoNoCiclo = Number(e.spendable.comprometido_no_ciclo ?? 0);

  return {
    versao: 1,
    estado: 'ok',
    rotulo: ate ? `Livre até ${isoToBR(ate).slice(0, 5)}` : 'Livre',
    livre: brl(livre),
    livreNegativo: livre < 0,
    veredito: vereditoDoDia({ atrasadoCents: atrasado, venceHojeCents: venceHoje, livreCents: livre, diasLivres, brl }),
    compromissos: e.cicloAte && comprometidoNoCiclo > 0
      ? `Compromissos até ${isoToBR(e.cicloAte).slice(0, 5)} · ${brl(comprometidoNoCiclo)}`
      : null,
    contas: saidas.slice(0, limite).map((c) => ({
      titulo: c.title,
      quando: c.overdue ? `venceu ${isoToBR(c.due_date).slice(0, 5)}` : rotuloDoDia(c.due_date, e.hoje),
      valor: brl(c.amount_cents),
      atrasada: c.overdue,
    })),
    maisContas: Math.max(0, saidas.length - limite),
    totalContas: brl(saidas.reduce((s, c) => s + c.amount_cents, 0)),
    atualizado: e.agora,
  };
}

/** Sem sessão (saiu da conta): o widget não pode seguir mostrando o dinheiro de quem saiu. */
export function retratoSemSessao(agora: string): Retrato {
  return {
    versao: 1,
    estado: 'sem-sessao',
    rotulo: 'ProOps',
    livre: '',
    livreNegativo: false,
    veredito: { tom: 'neutro', icone: 'checkmark.circle', texto: 'Entre no app para ver o seu dia' },
    compromissos: null,
    contas: [],
    maisContas: 0,
    totalContas: '',
    atualizado: agora,
  };
}
