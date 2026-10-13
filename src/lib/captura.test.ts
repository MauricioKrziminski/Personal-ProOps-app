import assert from 'node:assert/strict';
import test from 'node:test';

import { BANCOS, PACOTE_TESTE, bancosDisponiveis, enviarFila, hrefDaCaptura, paraEnvio } from './captura.ts';

const n = (id: string) => ({ id, package: 'com.nu.production', title: 'Compra', text: 'R$ 1,00', posted_at: Date.UTC(2026, 9, 12, 15, 30) });

test('a lista de bancos é a mesma do agente (12 pacotes) e o de teste só em dev', () => {
  assert.equal(BANCOS.length, 12);
  assert.ok(BANCOS.some((b) => b.pacote === 'com.nu.production' && b.nome === 'Nubank'));
  assert.ok(!bancosDisponiveis(false).some((b) => b.pacote === PACOTE_TESTE));
  assert.ok(bancosDisponiveis(true).some((b) => b.pacote === PACOTE_TESTE));
});

test('a lista do app é IGUAL à do agente', async () => {
  const fs = await import('node:fs');
  const py = fs.readFileSync(new URL('../../agent/app/routes/captures.py', import.meta.url), 'utf8');
  for (const b of BANCOS) assert.ok(py.includes(`"${b.pacote}": "${b.nome}"`), `${b.pacote} divergiu`);
});

test('paraEnvio troca o id pelo external_id e a data por ISO', () => {
  const [x] = paraEnvio([n('a'.repeat(64))]);
  assert.equal(x.external_id, 'a'.repeat(64));
  assert.equal(x.posted_at, '2026-10-12T15:30:00.000Z');
});

test('enviarFila manda em lotes de 20 e remove só o aceito', async () => {
  const fila = Array.from({ length: 25 }, (_, i) => n(`id-${String(i).padStart(6, '0')}`));
  const removidos: string[] = [];
  const lotes: number[] = [];
  const total = await enviarFila({
    pendentes: () => fila,
    remover: (ids) => { removidos.push(...ids); },
    enviar: async (itens) => { lotes.push(itens.length); return { aceitos: itens.slice(1).map((i) => i.external_id) }; },
  });
  assert.deepEqual(lotes, [20, 5]);
  assert.equal(total, 23);
  assert.ok(!removidos.includes('id-000000'));
});

test('enviarFila para no primeiro erro sem apagar nada daquele lote', async () => {
  const removidos: string[] = [];
  await assert.rejects(enviarFila({
    pendentes: () => [n('id-000001')],
    remover: (ids) => { removidos.push(...ids); },
    enviar: async () => { throw new Error('403'); },
  }));
  assert.deepEqual(removidos, []);
});

test('hrefDaCaptura leva o id da captura ao formulário', () => {
  const href = hrefDaCaptura({ id: 'c1', draft: { tipo: 'uma', params: { kind: 'expense', amount: '4590' }, perguntas: [], entendido: 'x' } });
  assert.equal(href.pathname, '/finance/lancar');
  assert.equal(href.params.captura, 'c1');
  assert.equal(href.params.amount, '4590');
});
