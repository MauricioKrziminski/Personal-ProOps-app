import assert from 'node:assert/strict';
import { test } from 'node:test';

import { environmentLabel } from './environment.ts';

/**
 * O rótulo sai do REF do Supabase, não de uma variável à parte — é o que garante que ele não
 * possa discordar do banco em que o app está escrevendo.
 *
 * O caso que importa é o do meio: um ref DESCONHECIDO não pode cair em "produção" por descuido.
 * Um app que diz "produção" enquanto escreve em outro lugar é pior que um app que não diz nada.
 */
test('produção não mostra rótulo; qualquer outro ambiente mostra', () => {
  assert.equal(environmentLabel('https://kwriuifcwyvdrxtspjiz.supabase.co'), null);
  assert.equal(environmentLabel('https://utkqoiigimqzeenxkxdl.supabase.co'), 'staging');
  assert.equal(environmentLabel('http://127.0.0.1:54321'), 'local');
  assert.equal(environmentLabel('http://10.0.2.2:54321'), 'local');
  assert.equal(environmentLabel(''), 'sem banco');
  assert.equal(environmentLabel('   '), 'sem banco');
});

test('ref desconhecido se identifica em vez de se passar por produção', () => {
  const rotulo = environmentLabel('https://abcdefghijklmnopqrst.supabase.co');
  assert.equal(rotulo, 'outro (abcdef…)');
});

test('o ref é lido sem depender de caixa nem do sufixo do domínio', () => {
  assert.equal(environmentLabel('https://KWRIUIFCWYVDRXTSPJIZ.supabase.co'), null);
  assert.equal(environmentLabel('https://utkqoiigimqzeenxkxdl.supabase.in'), 'staging');
});
