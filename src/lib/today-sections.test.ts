import assert from 'node:assert/strict';
import { test } from 'node:test';

import { agendaDoDia, iconeDoItem, metaDoItem, type ContaPrevista } from './today-sections.ts';

const HOJE = '2026-09-17';
const conta = (o: Partial<ContaPrevista>): ContaPrevista => ({
  ref_id: 'x', title: 'Conta', due_date: HOJE, amount_cents: 1000, kind: 'transaction', overdue: false, ...o,
});

test('Agora tem o atrasado, o que vence hoje e o que chega hoje; atrasado primeiro', () => {
  const { agora } = agendaDoDia(
    [
      conta({ ref_id: 'luz', title: 'Luz', due_date: HOJE }),
      conta({ ref_id: 'fatura', kind: 'invoice', title: 'Fatura', due_date: '2026-09-10', overdue: true }),
      conta({ ref_id: 'pix', kind: 'income', title: 'Pix', due_date: HOJE }),
      conta({ ref_id: 'agua', title: 'Água', due_date: '2026-09-19' }),
    ],
    [],
    HOJE
  );
  assert.deepEqual(agora.map((i) => i.ref_id), ['fatura', 'luz', 'pix']);
});

test('Próximos dias agrupa por dia, respeita a janela e nunca repete o que está em Agora', () => {
  const { proximos } = agendaDoDia(
    [
      conta({ ref_id: 'agua', title: 'Água', due_date: '2026-09-19' }),
      conta({ ref_id: 'salario', kind: 'income', title: 'Salário', due_date: '2026-09-19', amount_cents: 500000 }),
      conta({ ref_id: 'longe', due_date: '2026-10-30' }),
      conta({ ref_id: 'luz', due_date: HOJE }),
    ],
    [{ id: 'c1', title: 'DAS', occurred_at: '2026-09-18', amount_cents: 7000, card: 'Nubank', invoice_id: 'f1' }],
    HOJE
  );
  assert.deepEqual(proximos.map((g) => g.day), ['2026-09-18', '2026-09-19']);
  assert.deepEqual(proximos[1].itens.map((i) => i.ref_id), ['agua', 'salario']);
  assert.equal(proximos[0].itens[0].kind, 'card');
  assert.equal(proximos[0].itens[0].faturaId, 'f1');
});

test('compra no cartão de hoje não vira pendência', () => {
  const { agora, proximos } = agendaDoDia(
    [],
    [{ id: 'c1', title: 'Uber', occurred_at: HOJE, amount_cents: 2000, card: 'Inter', invoice_id: 'f2' }],
    HOJE
  );
  assert.equal(agora.length, 0);
  assert.equal(proximos[0].day, HOJE);
});

test('o texto e o tom de cada item dizem o que aconteceu', () => {
  const [atrasada] = agendaDoDia([conta({ kind: 'invoice', due_date: '2026-09-10', overdue: true })], [], HOJE).agora;
  assert.deepEqual(metaDoItem(atrasada, 'agora'), { texto: 'venceu 10/09', tom: 'danger' });
  const [pix] = agendaDoDia([conta({ kind: 'income', due_date: '2026-09-15', overdue: true })], [], HOJE).agora;
  assert.deepEqual(metaDoItem(pix, 'agora'), { texto: 'não caiu 15/09', tom: 'warning' });
  const [hoje] = agendaDoDia([conta({})], [], HOJE).agora;
  assert.deepEqual(metaDoItem(hoje, 'agora'), { texto: 'vence hoje', tom: 'neutral' });
  assert.equal(iconeDoItem(atrasada), 'creditcard');
  assert.equal(iconeDoItem(pix), 'arrow.down.left');
});
