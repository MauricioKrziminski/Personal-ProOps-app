import assert from 'node:assert/strict';
import test from 'node:test';

import { BANCOS, PACOTE_TESTE, bancosDisponiveis, capturaAindaAberta, ehCapturaResolvida, CAPTURA_RESOLVIDA, enviarFila, hrefDaCaptura, paraEnvio } from './captura.ts';

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
    dono: 'u1',
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
    dono: 'u1',
    pendentes: () => [n('id-000001')],
    remover: (ids) => { removidos.push(...ids); },
    enviar: async () => { throw new Error('403'); },
  }));
  assert.deepEqual(removidos, []);
});

test('item que o agente julgou inválido volta em aceitos e sai da fila: um item ruim não prende o resto', async () => {
  const fila = [n('id-000001'), { ...n('id-000002'), text: '' }, n('id-000003')];
  const restante = new Set(fila.map((c) => c.id));
  const total = await enviarFila({
    dono: 'u1',
    pendentes: () => fila.filter((c) => restante.has(c.id)),
    remover: (ids) => { ids.forEach((id) => restante.delete(id)); },
    // o servidor valida item a item: o vazio é aceito sem gravar e os outros seguem
    enviar: async (itens) => ({ aceitos: itens.map((i) => i.external_id) }),
  });
  assert.equal(total, 3);
  assert.equal(restante.size, 0);
});

test('lote que falha depois de outro que passou: o aceito sai e o resto fica para a próxima abertura', async () => {
  const fila = Array.from({ length: 25 }, (_, i) => n(`id-${String(i).padStart(6, '0')}`));
  const restante = new Set(fila.map((c) => c.id));
  let chamada = 0;
  await assert.rejects(enviarFila({
    dono: 'u1',
    pendentes: () => fila.filter((c) => restante.has(c.id)),
    remover: (ids) => { ids.forEach((id) => restante.delete(id)); },
    enviar: async (itens) => {
      if (++chamada === 2) throw new Error('503');
      return { aceitos: itens.map((i) => i.external_id) };
    },
  }));
  assert.equal(restante.size, 5);
});

test('hrefDaCaptura leva o id da captura ao formulário', () => {
  const href = hrefDaCaptura({ id: 'c1', draft: { tipo: 'uma', params: { kind: 'expense', amount: '4590' }, perguntas: [], entendido: 'x' } });
  assert.equal(href.pathname, '/finance/lancar');
  assert.equal(href.params.captura, 'c1');
  assert.equal(href.params.amount, '4590');
});

test('fila de outra conta: o que tem OUTRO dono é apagado sem enviar; sem dono (versão antiga) é do usuário atual', async () => {
  const fila = [
    { ...n('id-000001'), dono: 'u1' },
    { ...n('id-000002'), dono: 'u2' },   // de outra conta, ficou na fila
    { ...n('id-000003') },               // gravada por uma versão sem dono: não se perde
    { ...n('id-000004'), dono: null },
  ];
  const restante = new Set(fila.map((c) => c.id));
  const enviados: string[] = [];
  const total = await enviarFila({
    dono: 'u1',
    pendentes: () => fila.filter((c) => restante.has(c.id)),
    remover: (ids) => { ids.forEach((id) => restante.delete(id)); },
    enviar: async (itens) => { enviados.push(...itens.map((i) => i.external_id)); return { aceitos: itens.map((i) => i.external_id) }; },
  });
  assert.deepEqual(enviados, ['id-000001', 'id-000003', 'id-000004']);
  assert.ok(!enviados.includes('id-000002'));
  assert.equal(total, 3);
  assert.equal(restante.size, 0);
});

test('fila só de outra conta: apaga tudo e nem chama o servidor', async () => {
  const fila = [{ ...n('id-000001'), dono: 'u2' }];
  const restante = new Set(['id-000001']);
  let chamou = false;
  const total = await enviarFila({
    dono: 'u1',
    pendentes: () => fila.filter((c) => restante.has(c.id)),
    remover: (ids) => { ids.forEach((id) => restante.delete(id)); },
    enviar: async () => { chamou = true; return { aceitos: [] }; },
  });
  assert.equal(chamou, false);
  assert.equal(total, 0);
  assert.equal(restante.size, 0);
});

test('"Confirmar" só abre a captura que ainda espera decisão', () => {
  const ok = (status: string, transaction_id: string | null = null) => capturaAindaAberta({ data: { status, transaction_id }, error: null });
  assert.equal(ok('pending'), true);
  assert.equal(ok('duplicate'), true);
  assert.equal(ok('confirmed', 'tx-1'), false);
  assert.equal(ok('confirmed'), false);
  assert.equal(ok('discarded'), false);
  assert.equal(ok('pending', 'tx-1'), false);
  assert.equal(capturaAindaAberta({ data: null, error: null }), false);       // resolvida, apagada ou de outra pessoa
  assert.equal(capturaAindaAberta({ data: null, error: new Error('rede') }), true); // offline: o servidor segura a repetição
});

test('PT409 do servidor vira "captura já resolvida", nunca erro genérico', () => {
  assert.equal(ehCapturaResolvida(Object.assign(new Error('x'), { code: CAPTURA_RESOLVIDA })), true);
  assert.equal(ehCapturaResolvida({ code: 'PT409' }), false); // o código cru só é traduzido em lancarDaCaptura
  assert.equal(ehCapturaResolvida(new Error('rede')), false);
  assert.equal(ehCapturaResolvida(null), false);
});
