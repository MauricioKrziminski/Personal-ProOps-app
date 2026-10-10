import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMAIL_SUPORTE, mailtoSuporte } from './suporte.ts';

test('suporte: mailto leva destino, versão, build, plataforma e id', () => {
  const url = mailtoSuporte({ versao: '1.11.0', build: '42', plataforma: 'ios', userId: 'u-123' });
  assert.ok(url.startsWith(`mailto:${EMAIL_SUPORTE}?`));
  assert.equal(EMAIL_SUPORTE, 'gestao@proops.com.br');
  const q = new URLSearchParams(url.split('?')[1]);
  assert.equal(q.get('subject'), 'Suporte ProOps');
  const corpo = q.get('body') ?? '';
  assert.match(corpo, /Versão: 1\.11\.0 \(42\)/);
  assert.match(corpo, /Plataforma: ios/);
  assert.match(corpo, /Id: u-123/);
  assert.doesNotMatch(corpo, /Erro:/);
});

test('suporte: o erro da tela entra no corpo; sem sessão e sem versão dizem isso', () => {
  const corpo = new URLSearchParams(
    mailtoSuporte({ versao: null, build: null, plataforma: 'android', userId: null, detalhe: 'Não deu para carregar' }).split('?')[1],
  ).get('body') ?? '';
  assert.match(corpo, /Erro: Não deu para carregar/);
  assert.match(corpo, /Id: sem sessão/);
  assert.match(corpo, /Versão: desconhecida/);
});
