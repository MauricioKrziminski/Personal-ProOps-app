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
  const aceite = tela.slice(tela.indexOf('const concordar'), tela.indexOf('const concordar') + 700);
  assert.match(aceite, /configurarCaptura\(true/);
  // O acesso do sistema só abre pelo aceite: `abrirAjustes` só é usado ali (fora o import).
  assert.equal(tela.match(/abrirAjustes/g)?.length, 2);
  assert.match(aceite, /abrirSistema\(abrirAjustes\)/);
  // A linha de acesso (caso do backup restaurado) reabre o aviso, não o sistema.
  assert.match(tela, /onPress=\{acesso \? undefined : \(\) => setAviso\(true\)\}/);
  // Sem IA, autoriza ali mesmo (como a voz), e a entrada permanente para a lista.
  assert.match(tela, /<AutorizarIa /);
  assert.match(tela, /title="A confirmar"[\s\S]{0,300}\/finance\/capturas/);
});

test('falha ao resolver a captura aparece mesmo com a tela já fechada (onError no hook)', () => {
  const hook = ler('hooks/use-capturas.ts');
  const resolver = hook.slice(hook.indexOf('export function useResolverCaptura'));
  assert.match(resolver.slice(0, 1400), /onError:[\s\S]*Lançado, mas continua em A confirmar/);
  // Desfazer volta ao status anterior (o duplicado não vai para a Hoje).
  assert.match(ler('components/feed/capturas-da-hoje.tsx'), /resolver\.mutate\(\{ id, status \}\)/);
});

test('a Hoje mostra só o que está pendente, nunca o duplicado', () => {
  assert.match(ler('components/feed/capturas-da-hoje.tsx'), /status === 'pending'/);
});

test('o envio da fila é montado uma vez, dentro da sessão', () => {
  assert.match(ler('app/_layout.tsx'), /useEnviarCapturas\(\)/);
});
