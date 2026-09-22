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
 *
 * **Versão 2 (22/09/2026): menos texto.** A v1 listava toda conta atrasada numa linha vermelha
 * com "venceu dd/mm" embaixo — seis linhas vermelhas iguais eram o widget inteiro, e a queixa foi
 * *"quero algo bem bonito, organizado e não esse monte de texto"*. Agora o atrasado é UM resumo
 * (quantas e quanto) e a lista é só o que ainda vai vencer, cada uma com um selo de data.
 */

import { diasAte, formatBRL, isoToBR, mesCurto } from './dates.ts';

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

/** Uma conta que ainda vai vencer, pronta para o selo de data: `23` + `set`. */
export interface ContaDoRetrato {
  titulo: string;
  dia: string;
  mes: string;
  valor: string;
  /** Vence hoje — o único destaque que uma conta em dia recebe. */
  hoje: boolean;
}

export interface Retrato {
  /** Quem desenha confere a versão: retrato de formato velho vira "abra o app", nunca lixo. */
  versao: 2;
  estado: 'ok' | 'sem-sessao';
  rotulo: string;
  livre: string;
  livreNegativo: boolean;
  veredito: Veredito;
  /** Os compromissos do ciclo, a faixa de baixo do herói: `até 10/10` + o valor. */
  compromissos: { ate: string; valor: string } | null;
  /** O atrasado como UM resumo — nunca uma linha por conta. */
  atrasado: { qtd: number; valor: string } | null;
  /** O que ainda vai vencer, por data. */
  proximas: ContaDoRetrato[];
  /** Quantas contas a vencer há além das mostradas. */
  maisProximas: number;
  /** Tudo que sai na janela (atrasado + a vencer). */
  totalContas: string;
  qtdContas: number;
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

const ddmm = (iso: string) => isoToBR(iso).slice(0, 5);

export function montarRetrato(e: EntradaDoRetrato): Retrato {
  const brl = (cents: number) => (e.oculto ? MASCARA : formatBRL(cents));
  const caixa = Number(e.spendable.caixa ?? 0);
  const comprometido = Number(e.spendable.comprometido_ate_entrada ?? 0);
  const livre = caixa - comprometido;
  const ate = e.spendable.proxima_entrada ?? e.cicloAte ?? null;
  const diasLivres = Math.max(1, ate ? diasAte(ate, e.hoje) : 1);

  const saidas = e.contas.filter((c) => c.kind !== 'income');
  const atrasadas = saidas.filter((c) => c.overdue);
  const proximas = saidas
    .filter((c) => !c.overdue)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || b.amount_cents - a.amount_cents);
  const soma = (l: typeof saidas) => l.reduce((s, c) => s + c.amount_cents, 0);
  const venceHoje = soma(proximas.filter((c) => c.due_date === e.hoje));
  const limite = e.limiteContas ?? 8;
  const comprometidoNoCiclo = Number(e.spendable.comprometido_no_ciclo ?? 0);

  return {
    versao: 2,
    estado: 'ok',
    rotulo: ate ? `Livre até ${ddmm(ate)}` : 'Livre',
    livre: brl(livre),
    livreNegativo: livre < 0,
    veredito: vereditoDoDia({ atrasadoCents: soma(atrasadas), venceHojeCents: venceHoje, livreCents: livre, diasLivres, brl }),
    compromissos: e.cicloAte && comprometidoNoCiclo > 0
      ? { ate: `até ${ddmm(e.cicloAte)}`, valor: brl(comprometidoNoCiclo) }
      : null,
    atrasado: atrasadas.length > 0 ? { qtd: atrasadas.length, valor: brl(soma(atrasadas)) } : null,
    proximas: proximas.slice(0, limite).map((c) => ({
      titulo: c.title,
      dia: String(Number(c.due_date.slice(8, 10))),
      mes: mesCurto(c.due_date),
      valor: brl(c.amount_cents),
      hoje: c.due_date === e.hoje,
    })),
    maisProximas: Math.max(0, proximas.length - limite),
    totalContas: brl(soma(saidas)),
    qtdContas: saidas.length,
    atualizado: e.agora,
  };
}

/** Sem sessão (saiu da conta): o widget não pode seguir mostrando o dinheiro de quem saiu. */
export function retratoSemSessao(agora: string): Retrato {
  return {
    versao: 2,
    estado: 'sem-sessao',
    rotulo: 'ProOps',
    livre: '',
    livreNegativo: false,
    veredito: { tom: 'neutro', icone: 'checkmark.circle', texto: 'Entre no app para ver o seu dia' },
    compromissos: null,
    atrasado: null,
    proximas: [],
    maisProximas: 0,
    totalContas: '',
    qtdContas: 0,
    atualizado: agora,
  };
}
