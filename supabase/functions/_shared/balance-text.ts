/**
 * A resposta de "qual meu saldo?" no WhatsApp.
 *
 * Extraída de `process-jobs/index.ts` em 09/09/2026 para poder ser TESTADA: a versão anterior
 * vivia inline num arquivo de mil linhas que exige Supabase para rodar, e por isso três defeitos
 * conviveram ali por meses — todos produzindo um número que parecia certo.
 *
 * 1. **Somava `balance_cents`**, que inclui `pending`: dizia que o Pix que o terceiro ainda não
 *    mandou já estava na conta.
 * 2. **Somava o CARTÃO dentro do total**, misturando o que a pessoa tem com o que ela deve. Com
 *    uma fatura aberta de R$ 21.360,00 o "Saldo total" respondia **−R$ 16.070,00** — um número
 *    que não é o saldo de nada.
 * 3. **Não avisava do previsto**, que é justamente a diferença entre os dois primeiros.
 *
 * A aritmética é a MESMA da tela Contas (`src/app/finance/accounts.tsx`) e a mesma do agente
 * Python (`agent/app/tools/queries.py::query_balance`). Três superfícies, um número — divergir
 * aqui é como o usuário deixa de confiar nos dois.
 *
 * TS puro, sem nada de Deno, para o `node --test` conseguir importar (mesma regra de
 * `money-text.ts`).
 */

/** As contas que GUARDAM dinheiro. Cópia literal de `GUARDA_DINHEIRO` em `accounts.tsx:63`. */
const GUARDA_DINHEIRO = ['checking', 'savings', 'cash'];

export interface AccountBalanceRow {
  account_id: string | null;
  name: string;
  type: string;
  balance_cents: number;
  /**
   * As três abaixo são da `20260909140000` e podem NÃO existir: o código sobe por deploy e a
   * coluna por migration, e nada garante a ordem. Ausentes, a resposta cai no comportamento
   * antigo (o total) em vez de imprimir `R$ NaN` numa mensagem de dinheiro.
   */
  cleared_cents?: number | null;
  pending_in_cents?: number | null;
  pending_out_cents?: number | null;
}

type Coluna = 'cleared_cents' | 'pending_in_cents' | 'pending_out_cents';

function col(r: AccountBalanceRow, campo: Coluna): number {
  const v = r[campo];
  if (v === undefined || v === null) {
    return campo === 'cleared_cents' ? Number(r.balance_cents) : 0;
  }
  return Number(v);
}

export function balanceMessage(
  rows: AccountBalanceRow[],
  brl: (cents: number) => string
): string {
  if (!rows.length) {
    return '💼 Você ainda não tem contas nem lançamentos. Cadastre contas no app!';
  }

  const dinheiro = rows.filter((r) => GUARDA_DINHEIRO.includes(r.type) || r.account_id === null);
  const investimentos = rows.filter((r) => r.type === 'investment');
  const cartoes = rows.filter((r) => r.type === 'credit_card');
  const soma = (rs: AccountBalanceRow[], campo: Coluna) =>
    rs.reduce((s, r) => s + col(r, campo), 0);

  const caixa = soma(dinheiro, 'cleared_cents');
  const investido = soma(investimentos, 'cleared_cents');
  // `Math.min(0, ...)` como na tela: cartão com crédito a favor não vira dívida negativa.
  const divida = cartoes.reduce((s, r) => s + Math.min(0, Number(r.balance_cents)), 0);
  const aReceber = soma(dinheiro, 'pending_in_cents');
  const aPagar = soma(dinheiro, 'pending_out_cents');
  const parcelasFuturas = soma(cartoes, 'pending_out_cents');

  const partes = [`💼 Dinheiro disponível: *${brl(caixa)}*`];
  for (const r of dinheiro) {
    if (col(r, 'cleared_cents') !== 0 || col(r, 'pending_in_cents') !== 0) {
      partes.push(`  • ${r.name}: ${brl(col(r, 'cleared_cents'))}`);
    }
  }
  if (investido) partes.push(`\n📈 Investido: ${brl(investido)}`);
  if (divida) {
    partes.push(`\n💳 Dívida de cartão: ${brl(divida)}`);
    for (const r of cartoes) {
      if (Number(r.balance_cents) < 0) partes.push(`  • ${r.name}: ${brl(Number(r.balance_cents))}`);
    }
    if (parcelasFuturas) partes.push(`  (${brl(parcelasFuturas)} são parcelas de meses à frente)`);
  }
  // Os avisos ficam DEPOIS e FORA do total: somá-los repetiria o defeito de origem. Cada um diz
  // o que fazer — alerta que só informa é o que faz o usuário parar de ler.
  if (aReceber) {
    partes.push(
      `\n⏳ A receber: ${brl(aReceber)} previstos e ainda não confirmados.` +
        `\n   Conta na projeção, não no saldo. Quando cair, me manda "recebi".`
    );
  }
  if (aPagar) {
    partes.push(`\n📅 A pagar: ${brl(aPagar)} de contas previstas que ainda não saíram.`);
  }
  return partes.join('\n');
}
