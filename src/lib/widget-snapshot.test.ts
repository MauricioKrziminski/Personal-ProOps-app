/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MASCARA, montarRetrato, retratoSemSessao, semNulos, vereditoDoDia } from './widget-snapshot.ts';

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
  assert.deepEqual({ ...r.compromissos, valor: n(r.compromissos!.valor) }, { ate: 'até 10/10', valor: 'R$ 3.000,00' });
});

test('o atrasado é UM resumo; a lista é só o que vai vencer, com o selo de data', () => {
  const r = montarRetrato(base);
  assert.deepEqual({ ...r.atrasado, valor: n(r.atrasado!.valor) }, { qtd: 1, valor: 'R$ 1.800,00' });
  assert.deepEqual(r.proximas.map((c) => [c.titulo, c.dia, c.mes, c.hoje]), [
    ['Internet', '22', 'set', true],
    ['Energia', '23', 'set', false],
  ]);
  assert.equal(n(r.totalContas), 'R$ 2.049,90', 'o total é tudo que sai: atrasado + a vencer; receita fora');
  assert.equal(r.qtdContas, 3);
});

test('a lista tem teto e conta o que sobrou', () => {
  const muitas = Array.from({ length: 11 }, (_, k) => ({
    title: `Conta ${k}`, due_date: `2026-10-${String(k + 1).padStart(2, '0')}`, amount_cents: 1000, kind: 'expense', overdue: false,
  }));
  const r = montarRetrato({ ...base, contas: muitas });
  assert.equal(r.proximas.length, 8);
  assert.equal(r.maisProximas, 3);
  assert.equal(r.atrasado, null);
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
  assert.equal(r.proximas.length, 0);
  assert.equal(r.atrasado, null);
  assert.equal(r.livre, '');
});

test('veredito sem obrigação: por dia só a partir de R$ 1,00', () => {
  const brl = (c: number) => `R$ ${c / 100}`;
  assert.equal(vereditoDoDia({ atrasadoCents: 0, venceHojeCents: 0, livreCents: 3000, diasLivres: 3, brl }).texto,
    '≈ R$ 10 por dia · 3 dias');
  assert.equal(vereditoDoDia({ atrasadoCents: 0, venceHojeCents: 0, livreCents: 50, diasLivres: 3, brl }).texto,
    'Nada vence hoje · 3 dias até entrar');
});

test('o que vai para o widget do iOS não leva null em nível nenhum', () => {
  // as preferências do App Group recusam o retrato inteiro por um null só
  const temNulo = (x: unknown): boolean =>
    x === null || (typeof x === 'object' && Object.values(x as object).some(temNulo));
  const semAtraso = montarRetrato({ ...base, contas: base.contas.filter((c) => !c.overdue), cicloAte: null });
  assert.ok(temNulo(semAtraso), 'o retrato cru tem null (atrasado, compromissos)');
  assert.ok(!temNulo(semNulos(semAtraso)));
  assert.ok(!temNulo(semNulos(retratoSemSessao('13:05'))));
  assert.equal(semNulos(semAtraso).atrasado, undefined);
  assert.equal(semNulos(semAtraso).livre, semAtraso.livre, 'o resto fica igual');
  assert.ok(!temNulo(semNulos({ proximas: [{ titulo: null, valor: 'R$ 1' }] })));
});
