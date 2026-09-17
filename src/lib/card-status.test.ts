import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diasAte, estadoDaFatura, prazoLabel } from './card-status.ts';

const hoje = new Date(2026, 8, 16, 22, 30);

test('prazo lê a data pura, sem a hora de agora', () => {
  assert.equal(diasAte('2026-09-16', hoje), 0);
  assert.equal(prazoLabel('2026-09-17', 'vence', hoje), 'vence amanhã');
  assert.equal(prazoLabel('2026-09-20', 'fecha', hoje), 'fecha em 4 dias');
  assert.equal(prazoLabel('2026-09-10', 'vence', hoje), 'venceu há 6 dias');
});

test('estado sai das datas: atrasada vence antes de fechada', () => {
  const base = { invoice_id: 'i', closing_date: '2026-09-03', due_date: '2026-09-10' };
  assert.equal(estadoDaFatura(base, hoje), 'Atrasada');
  assert.equal(estadoDaFatura({ ...base, due_date: '2026-09-20' }, hoje), 'Fechada');
  assert.equal(estadoDaFatura({ ...base, closing_date: '2026-10-03', due_date: '2026-10-10' }, hoje), 'Aberta');
  assert.equal(estadoDaFatura({ ...base, invoice_id: null }, hoje), null);
});
