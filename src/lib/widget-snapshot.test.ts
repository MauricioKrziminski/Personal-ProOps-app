/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MASCARA, montarRetrato, retratoSemSessao, vereditoDoDia } from './widget-snapshot.ts';

/** `formatBRL` escreve "R$" + espaço NÃO separável (Intl): compara sem depender disso. */
const n = (s: string | null) => (s ?? '').replace(/\u00a0/g, ' ');

const base = {
  spendable: { caixa: 500000, comprometido_ate_entrada: 120000, comprometido_no_ciclo: 300000, proxima_entrada: '2026-10-05' },
  cicloAte: '2026-10-10',
  contas: [
    { title: 'Salário', due_date: '2026-10-05', amount_cents: 400000, kind: 'income', overdue: false },
    { title: 'Energia', due_date: '2026-09-23', amount_cents: 12000, kind: 'expense', overdue: false },
    { title: 'Aluguel', due_date: '2026-09-01', amount_cents: 180000, kind: 'expense', overdue: true },
    { title: 'Internet', due_date: '2026-09-22', amount_cents: 12990, kind: 'expense', overdue: false },
  ],
  hoje: '2026-09-22',
  agora: '13:05',
  oculto: false,
};

test('o livre é caixa menos o que vence antes da próxima entrada — o número da Hoje', () => {
  const r = montarRetrato(base);
  assert.equal(n(r.livre), 'R$ 3.800,00');
  assert.equal(r.rotulo, 'Livre até 05/10');
  assert.equal(n(r.compromissos), 'Compromissos até 10/10 · R$ 3.000,00');
});

test('as contas: só saídas, atrasadas primeiro, depois por data; receita não vence', () => {
  const r = montarRetrato(base);
  assert.deepEqual(r.contas.map((c) => c.titulo), ['Aluguel', 'Internet', 'Energia']);
  assert.deepEqual(r.contas.map((c) => c.quando), ['venceu 01/09', 'hoje', 'amanhã']);
  assert.equal(n(r.totalContas), 'R$ 2.049,90');
});

test('o veredito é o da Hoje: atrasado ganha de tudo', () => {
  assert.equal(n(montarRetrato(base).veredito.texto), 'R$ 1.800,00 atrasado');
  const semAtraso = { ...base, contas: base.contas.filter((c) => !c.overdue) };
  assert.equal(n(montarRetrato(semAtraso).veredito.texto), 'R$ 129,90 vence hoje');
});

test('esconder saldo vale no widget: nenhum valor sai no retrato', () => {
  const r = montarRetrato({ ...base, oculto: true });
  const texto = JSON.stringify(r);
  assert.ok(!/R\$\s*\d/u.test(n(texto)), texto);
  assert.equal(r.livre, MASCARA);
});

test('saiu da conta: o widget para de mostrar o dinheiro', () => {
  const r = retratoSemSessao('13:05');
  assert.equal(r.estado, 'sem-sessao');
  assert.equal(r.contas.length, 0);
  assert.equal(r.livre, '');
});

test('veredito sem obrigação: por dia só a partir de R$ 1,00', () => {
  const brl = (c: number) => `R$ ${c / 100}`;
  assert.equal(vereditoDoDia({ atrasadoCents: 0, venceHojeCents: 0, livreCents: 3000, diasLivres: 3, brl }).texto,
    '≈ R$ 10 por dia · 3 dias');
  assert.equal(vereditoDoDia({ atrasadoCents: 0, venceHojeCents: 0, livreCents: 50, diasLivres: 3, brl }).texto,
    'Nada vence hoje · 3 dias até entrar');
});
