/**
 * Encerrar uma série (assinatura cancelada), F18: o que a confirmação diz e a data que ela propõe.
 * A conta mora no banco (`end_recurring_series_preview`): aqui só a frase e o padrão da data.
 */
import { isoToBR } from './dates.ts';

export type PreviaDoEncerramento = {
  removed_count: number;
  removed_cents: number;
  kept_locked_count: number;
  kept_paid_count: number;
  kept_overdue_count: number;
  kept_upcoming_count: number;
  end_date: string;
};

const n = (qtd: number, um: string, varios: string) => `${qtd} ${qtd === 1 ? um : varios}`;

/**
 * "Ficam 3 pagas e 1 atrasada. Saem 2 cobranças futuras (R$ 100,00). A série vai para Encerradas."
 * O dinheiro é formatado por quem chama (`useBRL`): esconder saldo vale na confirmação também.
 */
export function fraseDoEncerramento(p: PreviaDoEncerramento, brl: (cents: number) => string): string {
  const fica = `Ficam ${n(p.kept_paid_count, 'paga', 'pagas')} e ${n(p.kept_overdue_count, 'atrasada', 'atrasadas')}.`;
  const sai = p.removed_count > 0
    ? `Saem ${n(p.removed_count, 'cobrança futura', 'cobranças futuras')} (${brl(Number(p.removed_cents))}).`
    : 'Nenhuma cobrança futura sai.';
  const travada = p.kept_locked_count > 0
    ? ` ${n(p.kept_locked_count, 'cobrança fica', 'cobranças ficam')} porque a fatura ${p.kept_locked_count === 1 ? 'dela' : 'delas'} já foi paga, adiada ou paga em parte.`
    : '';
  const ate = p.kept_upcoming_count > 0
    ? ` ${n(p.kept_upcoming_count, 'ainda vence', 'ainda vencem')} até ${isoToBR(p.end_date)}.`
    : '';
  return `${fica} ${sai}${travada}${ate} A série vai para Encerradas.`;
}

/**
 * A última cobrança proposta: a mais recente que JÁ VENCEU. Sem nenhuma (série nova), hoje — mas
 * nunca antes do início da série (o banco recusa).
 */
export function ultimaCobrancaPadrao(datasISO: readonly string[], hoje: string, inicioISO: string | null): string {
  const jaVenceu = datasISO.filter((d) => d <= hoje).sort().at(-1);
  const padrao = jaVenceu ?? hoje;
  return inicioISO && padrao < inicioISO ? inicioISO : padrao;
}
