import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ler = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('salvar no formulário confirma a captura que o abriu', () => {
  const lancar = ler('app/finance/lancar.tsx');
  assert.match(lancar, /p\.captura/);
  assert.match(lancar, /status: 'confirmed'/);
});

test('o Perfil só mostra a captura onde o módulo existe (sem Platform.OS na tela)', () => {
  const perfil = ler('app/(tabs)/profile/index.tsx');
  assert.match(perfil, /capturaDisponivel\(\)/);
  assert.match(perfil, /Lançar pelas notificações/);
});

test('a tela de ajustes explica o que é lido antes de pedir o acesso (prominent disclosure)', () => {
  const tela = ler('app/captura-notificacoes.tsx');
  assert.match(tela, /nunca saem do aparelho/);
  assert.match(tela, /Anthropic/);
  assert.match(tela, /Concordo e ativar/);
  assert.match(tela, /Agora não/);
  assert.match(tela, /Permitir configurações restritas/);
  assert.match(tela, /abrirAjustes/);
  // Ligar só no aceite: uma chamada com `true`, dentro do handler do "Concordo e ativar".
  assert.equal(tela.match(/configurarCaptura\(true/g)?.length, 1);
  const aceite = tela.slice(tela.indexOf('const concordar'), tela.indexOf('const concordar') + 600);
  assert.match(aceite, /configurarCaptura\(true/);
});

test('a Hoje mostra só o que está pendente, nunca o duplicado', () => {
  assert.match(ler('components/feed/capturas-da-hoje.tsx'), /status === 'pending'/);
});

test('o envio da fila é montado uma vez, dentro da sessão', () => {
  assert.match(ler('app/_layout.tsx'), /useEnviarCapturas\(\)/);
});
