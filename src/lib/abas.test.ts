import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ROTULO_DA_ABA, tituloDaAba } from './abas.ts';

test('A rota (tabs) tem o título da aba ativa — é o que o "voltar" do iOS lê', () => {
  // Sem título, o sistema caía no nome da ROTA: o VoiceOver lia "(tabs)" no voltar de toda tela
  // empurrada, e o header "(tabs)" aparecia no Financeiro depois de voltar com a busca ativa.
  assert.equal(tituloDaAba(['(tabs)', 'finance']), 'Financeiro');
  assert.equal(tituloDaAba(['(tabs)', 'today']), 'Hoje');
  assert.equal(tituloDaAba(['(tabs)', 'notes', 'x']), 'Notas');
  assert.equal(tituloDaAba(['(tabs)']), 'Hoje');
  assert.equal(tituloDaAba([]), 'Hoje');
});

test('As duas tab bars leem o rótulo da mesma lista', () => {
  for (const arquivo of ['src/components/app-tabs.tsx', 'src/components/app-tabs.android.tsx']) {
    const fonte = readFileSync(arquivo, 'utf8');
    for (const nome of Object.keys(ROTULO_DA_ABA)) {
      assert.match(fonte, new RegExp(`label: ROTULO_DA_ABA\\.${nome}`), `${arquivo}: ${nome}`);
    }
  }
});
