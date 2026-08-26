/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { anyDate, ofxDate, parseCSV, parseOFX, toCents } from './statement-parser.ts';

test('valor: formato BR e US caem no mesmo inteiro em centavos', () => {
  assert.equal(toCents('1.234,56'), 123456);
  assert.equal(toCents('1,234.56'), 123456);
  assert.equal(toCents('-45,90'), 4590); // sinal vira `kind`, não valor negativo
  assert.equal(toCents('R$ 320,55'), 32055);
  assert.equal(toCents('5.000,00'), 500000);
  assert.equal(toCents('99'), 9900);
  assert.equal(toCents(''), null);
  assert.equal(toCents('abc'), null);
});

test('data: OFX (YYYYMMDD com hora colada) e formatos comuns de CSV', () => {
  assert.equal(ofxDate('20260826'), '2026-08-26');
  assert.equal(ofxDate('20260826120000[-3:BRT]'), '2026-08-26');
  assert.equal(ofxDate('26/08/2026'), null);

  assert.equal(anyDate('26/08/2026'), '2026-08-26');
  assert.equal(anyDate('26-08-2026'), '2026-08-26');
  assert.equal(anyDate('2026-08-26'), '2026-08-26');
  assert.equal(anyDate('agosto'), null);
});

test('OFX: extrai lançamentos e infere entrada/saída pelo sinal e pelo TRNTYPE', () => {
  const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260826120000[-3:BRT]
<TRNAMT>-45.90
<MEMO>IFOOD *RESTAURANTE
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260820
<TRNAMT>5000.00
<NAME>SALARIO
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  const linhas = parseOFX(ofx);
  assert.equal(linhas.length, 2);
  assert.deepEqual(linhas[0], {
    kind: 'expense',
    amount_cents: 4590,
    occurred_at: '2026-08-26',
    description: 'IFOOD *RESTAURANTE',
  });
  assert.equal(linhas[1].kind, 'income');
  assert.equal(linhas[1].amount_cents, 500000);
  // sem MEMO, cai para NAME
  assert.equal(linhas[1].description, 'SALARIO');
});

test('CSV: acha as colunas pelo cabeçalho, com ; ou ,', () => {
  const csv = [
    'Data;Descricao;Valor',
    '26/08/2026;IFOOD *RESTAURANTE SP;-45,90',
    '20/08/2026;SALARIO EMPRESA;5.000,00',
  ].join('\n');

  const linhas = parseCSV(csv);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].kind, 'expense');
  assert.equal(linhas[0].amount_cents, 4590);
  assert.equal(linhas[0].occurred_at, '2026-08-26');
  assert.equal(linhas[1].kind, 'income');
});

test('CSV: colunas fora de ordem são resolvidas pelo nome do cabeçalho', () => {
  const csv = ['Valor,Historico,Data', '-19.90,NETFLIX,2026-08-15'].join('\n');
  const linhas = parseCSV(csv);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].amount_cents, 1990);
  assert.equal(linhas[0].description, 'NETFLIX');
  assert.equal(linhas[0].occurred_at, '2026-08-15');
});

test('CSV sem cabeçalho cai para posicional data,descrição,valor', () => {
  const csv = '26/08/2026;PADARIA;-12,00';
  const linhas = parseCSV(csv);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].description, 'PADARIA');
  assert.equal(linhas[0].amount_cents, 1200);
});

test('CSV: aspas protegem o separador dentro da descrição', () => {
  const csv = ['Data,Descricao,Valor', '2026-08-10,"MERCADO, LTDA",-99,00'].join('\n');
  const linhas = parseCSV(csv);
  assert.equal(linhas[0].description, 'MERCADO, LTDA');
});

test('linha inválida é ignorada em vez de virar lançamento errado', () => {
  const csv = [
    'Data;Descricao;Valor',
    'saldo anterior;;',
    '26/08/2026;COMPRA;-10,00',
    ';SEM DATA;-5,00',
  ].join('\n');
  const linhas = parseCSV(csv);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].description, 'COMPRA');
});
