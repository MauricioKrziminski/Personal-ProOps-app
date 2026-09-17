/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type CycleFlowLike, describeCycle, describeRealizado } from './cycle-label.ts';

test('ciclo fechado devendo lidera com a DÍVIDA, e o caixa vai para o rodapé', () => {
  // O caso real de setembro/2026: R$ 0,72 na conta e R$ 371,64 de fatura não paga. Liderar com
  // os 72 centavos em verde fazia o mês ler como positivo — a queixa do dono do produto.
  const d = describeCycle(
    { estado: 'fechado', resultado: 72, caixa_no_fim: 72, faltou_pagar: 37164 },
    'setembro',
  );
  assert.equal(d.label, 'Fechei setembro devendo');
  assert.equal(d.cents, -37164, 'a dívida vem negativa: vermelho sozinho não diz o sinal');
  assert.equal(d.ruim, true);
  assert.deepEqual(d.rodape, { label: 'Sobrou na conta', cents: 72 });
});

test('fatura ADIADA continua sendo "faltou pagar"', () => {
  // `rolled` quer dizer que o dinheiro NÃO saiu: o principal foi para a fatura seguinte, com
  // juros. O `faltou_pagar` do banco já inclui `rolled` (migration 20260913160000) — aqui só se
  // garante que a tela não invente uma terceira leitura para o mesmo número.
  const d = describeCycle(
    { estado: 'fechado', resultado: 72, caixa_no_fim: 72, faltou_pagar: 37164 },
    'setembro',
  );
  assert.notEqual(d.label, 'Sobrou em setembro');
});

test('ciclo fechado sem dívida lidera com o caixa', () => {
  const d = describeCycle(
    { estado: 'fechado', resultado: 50000, caixa_no_fim: 50000, faltou_pagar: 0 },
    'agosto',
  );
  assert.equal(d.label, 'Sobrou em agosto');
  assert.equal(d.cents, 50000);
  assert.equal(d.ruim, false);
  assert.equal(d.rodape, undefined);
});

test('ciclo aberto e previsto falam no futuro e usam o resultado', () => {
  const aberto = describeCycle(
    { estado: 'aberto', resultado: -62930, caixa_no_fim: null, faltou_pagar: null },
    'outubro',
  );
  assert.equal(aberto.label, 'Vou fechar em');
  assert.equal(aberto.cents, -62930);
  assert.equal(aberto.ruim, true);

  const previsto = describeCycle(
    { estado: 'previsto', resultado: 9206, caixa_no_fim: null, faltou_pagar: null },
    'novembro',
  );
  assert.equal(previsto.label, 'Devo fechar em');
  assert.equal(previsto.ruim, false);
});

test('os campos chegam como string do PostgREST e continuam somando', () => {
  // `bigint` vira string no JSON. Sem o `Number`, `faltou > 0` compararia texto.
  const d = describeCycle(
    { estado: 'fechado', resultado: '72', caixa_no_fim: '72', faltou_pagar: '37164' },
    'setembro',
  );
  assert.equal(d.cents, -37164);
  assert.equal(d.ruim, true);
});

/* ───────── a sub-linha "já caiu / já saiu" ───────── */

const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
const ciclo = (over: Partial<CycleFlowLike>): CycleFlowLike => ({
  estado: 'aberto', entrou: 756652, saiu: 827253, entrou_realizado: 0, saiu_realizado: 0, ...over,
});

test('a sub-linha escreve a LENTE — "na conta" / "da conta", nunca só "já saiu"', () => {
  // Sem a lente escrita, esta linha (CAIXA, dia do pagamento) e o card de Lançamentos
  // (COMPETÊNCIA, dia da compra) viram dois números com a mesma cara. Medido em 14/09/2026: as 5
  // despesas de 11–14/09 são todas no cartão, então Lançamentos diz "já aconteceu R$ 355,54" e
  // esta linha diz "nada saiu da conta ainda" — as duas certas.
  const r = describeRealizado(ciclo({ entrou_realizado: 400000, saiu_realizado: 148500 }), brl);
  assert.equal(r.entra, 'já caiu na conta R$ 4000,00');
  assert.equal(r.sai, 'já saiu da conta R$ 1485,00');
});

test('zero realizado num ciclo ABERTO diz "nada ainda" — é informação, não ausência', () => {
  // O caso do ciclo corrente em 14/09/2026: R$ 8.272,53 de saída e nada pago ainda. Sem a
  // sub-linha, a tela não conta que os oito mil INTEIROS estão à frente.
  const r = describeRealizado(ciclo({}), brl);
  assert.equal(r.entra, 'nada caiu na conta ainda');
  assert.equal(r.sai, 'nada saiu da conta ainda');
});

test('realizado == total some: repetir o <Money> ao lado é eco (§1)', () => {
  // Setembro/2026 fechado e quitado: 6.330,62 de 6.330,62. "já caiu na conta R$ 6.330,62"
  // debaixo de "R$ 6.330,62" foi visto na tela antes de virar regra.
  const r = describeRealizado(
    ciclo({ estado: 'fechado', entrou: 633062, entrou_realizado: 633062, saiu: 719787, saiu_realizado: 719787 }),
    brl,
  );
  assert.equal(r.entra, '');
  assert.equal(r.sai, '');
});

test('ciclo PREVISTO fica sem subtítulo', () => {
  // Lá o realizado é zero por definição: "nada ainda" diria só que o futuro não aconteceu.
  const r = describeRealizado(ciclo({ estado: 'previsto' }), brl);
  assert.equal(r.entra, '');
  assert.equal(r.sai, '');
});

test('sem série (primeiro frame) não inventa sub-linha', () => {
  const r = describeRealizado(null, brl);
  assert.equal(r.entra, '');
  assert.equal(r.sai, '');
});

test('o valor passa pelo brl recebido — é o useBRL, que obedece ao esconder saldo', () => {
  // Chamar `formatBRL` dentro do helper vazaria o número com o olho fechado.
  const r = describeRealizado(ciclo({ saiu_realizado: 148500 }), () => '••••••');
  assert.equal(r.sai, 'já saiu da conta ••••••');
});
