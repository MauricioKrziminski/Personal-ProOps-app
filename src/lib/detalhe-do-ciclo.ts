/**
 * "Como chego nesse valor" (07/10/2026, *"ter um detalhamento do valor que fecha o ciclo"*).
 *
 * O banco abre o número do ciclo em partes que somam até ele (`cycle_breakdown`); aqui só se lê o
 * JSON e se dá nome às partes. Nenhuma conta de ciclo mora no app: a única soma é a de AGRUPAR as
 * origens nos baldes da tela do ciclo, e o total de cada lado vem pronto do banco.
 */

export type EstadoDoCiclo = 'aberto' | 'previsto' | 'fechado';

export interface ContaDaPartida {
  account_id: string | null;
  nome: string;
  tipo: string | null;
  cents: number;
}

export interface DetalheDoCiclo {
  estado: EstadoDoCiclo;
  ini: string;
  fim: string;
  /** contas: o caixa de hoje (aberto); anterior: o fim do ciclo anterior (previsto); inicio: fechado. */
  partida: { tipo: 'contas' | 'anterior' | 'inicio'; cents: number; contas: ContaDaPartida[] };
  entra: number;
  sai: number;
  porOrigem: { origin: string; in_cents: number; out_cents: number }[];
  resultado: number;
  caixaNoFim: number | null;
  faltouPagar: number | null;
  /** As contas FORA do que dá para gastar (investimento, ou a que a pessoa tirou): fora da soma. */
  fora: ContaDaPartida[];
}

const n = (v: unknown) => Number(v ?? 0);
const nOuNull = (v: unknown) => (v == null ? null : Number(v));

/** O JSON da RPC, com `bigint` (que pode vir como texto) já numérico. */
export function lerDetalheDoCiclo(json: unknown): DetalheDoCiclo {
  const j = (json ?? {}) as Record<string, any>;
  const p = (j.partida ?? {}) as Record<string, any>;
  return {
    estado: j.estado,
    ini: j.ini,
    fim: j.fim,
    partida: {
      tipo: p.tipo,
      cents: n(p.cents),
      contas: ((p.contas ?? []) as Record<string, unknown>[]).map((c) => ({
        account_id: (c.account_id as string | null) ?? null,
        nome: String(c.nome ?? ''),
        tipo: (c.tipo as string | null) ?? null,
        cents: n(c.cents),
      })),
    },
    entra: n(j.entra),
    sai: n(j.sai),
    porOrigem: ((j.por_origem ?? []) as Record<string, unknown>[]).map((o) => ({
      origin: String(o.origin),
      in_cents: n(o.in_cents),
      out_cents: n(o.out_cents),
    })),
    resultado: n(j.resultado),
    fora: ((j.fora ?? []) as Record<string, unknown>[]).map((c) => ({
      account_id: (c.account_id as string | null) ?? null,
      nome: String(c.nome ?? ''),
      tipo: (c.tipo as string | null) ?? null,
      cents: n(c.cents),
    })),
    caixaNoFim: nOuNull(j.caixa_no_fim),
    faltouPagar: nOuNull(j.faltou_pagar),
  };
}

/** Os baldes da tela do ciclo, na ordem em que ela os desenha. */
export const ORDEM_DOS_BALDES = [
  'Hipóteses do rascunho',
  'Faturas de cartão',
  'Boletos, pix e gastos',
  'Parcelas de financiamento',
  'Previstos da recorrência',
  'Guardado e investido',
  'Entradas',
] as const;

/** Em que balde uma origem de `cash_events` cai — a régua da tela do ciclo, num lugar só. */
export function baldeDaOrigem(origin: string, entra: boolean): (typeof ORDEM_DOS_BALDES)[number] {
  if (origin === 'hipotese') return 'Hipóteses do rascunho';
  if (entra) return 'Entradas';
  if (origin === 'invoice' || origin === 'invoice_payment') return 'Faturas de cartão';
  if (origin === 'debt_schedule') return 'Parcelas de financiamento';
  if (origin === 'recurring_projection') return 'Previstos da recorrência';
  // Aplicar no investimento (ou na conta tirada do "Dá para gastar"): sai do que dá para gastar.
  if (origin === 'guardar' || origin === 'guardar_previsto') return 'Guardado e investido';
  return 'Boletos, pix e gastos';
}

/** As saídas por balde, na ordem da tela do ciclo, sem os vazios. Soma `d.sai`. */
export function saidasPorBalde(d: Pick<DetalheDoCiclo, 'porOrigem'>): { titulo: string; cents: number }[] {
  const mapa = new Map<string, number>();
  for (const o of d.porOrigem) {
    if (o.out_cents === 0) continue;
    const k = baldeDaOrigem(o.origin, false);
    mapa.set(k, (mapa.get(k) ?? 0) + o.out_cents);
  }
  return ORDEM_DOS_BALDES.filter((t) => mapa.has(t)).map((titulo) => ({ titulo, cents: mapa.get(titulo)! }));
}

/** Os rótulos da conta, por estado: o aberto fala do que AINDA vai acontecer. */
export function rotulosDoDetalhe(estado: EstadoDoCiclo) {
  if (estado === 'aberto') {
    return { partida: 'Em conta hoje', entra: 'Ainda entra', sai: 'Ainda sai', fim: 'Vou fechar em' };
  }
  if (estado === 'previsto') {
    return { partida: 'Veio do ciclo anterior', entra: 'Entra', sai: 'Sai', fim: 'Devo fechar em' };
  }
  return { partida: 'Comecei com', entra: 'Entrou', sai: 'Saiu', fim: 'Sobrou na conta' };
}
