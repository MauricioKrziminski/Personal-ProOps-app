import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { IA_PADRAO, TERMOS_VERSAO } from './termos.ts';

const brasileira = (iso: string) => iso.split('-').reverse().join('/');

for (const doc of ['termos', 'privacidade']) {
  test(`termos: a vigência de docs/legal/${doc}.md é a de TERMOS_VERSAO`, () => {
    const texto = readFileSync(`docs/legal/${doc}.md`, 'utf8');
    assert.match(texto, new RegExp(`Vigência: ${brasileira(TERMOS_VERSAO)}`));
  });
}

test('termos: a IA nasce desligada', () => {
  assert.equal(IA_PADRAO, false);
});

test('termos: accept_terms leva a versão vigente e IA desligada por padrão', async () => {
  const { argumentosDoAceite } = await import('./termos.ts');
  assert.deepEqual(argumentosDoAceite(), { p_version: TERMOS_VERSAO, p_ai_consent: false });
  assert.deepEqual(argumentosDoAceite(true), { p_version: TERMOS_VERSAO, p_ai_consent: true });
});
