import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ler = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('salvar no formulário confirma a captura que o abriu', () => {
  const lancar = ler('app/finance/lancar.tsx');
  assert.match(lancar, /p\.captura/);
  assert.match(lancar, /status: 'confirmed'/);
});

test('confirmar é UMA transação no servidor: o lançamento comum vai por lancar_da_captura, sem confirmar depois', () => {
  const hook = ler('hooks/use-finance.ts');
  const salvar = hook.slice(hook.indexOf('export function useSaveTransaction'), hook.indexOf('export function useApplyAnticipation'));
  assert.match(salvar, /lancarDaCaptura\(capturaId, 'lancamento'/);
    // a tentativa repetida tem a MESMA chave de requisição enquanto o pedido não muda
  assert.match(salvar, /attempt\.current\?\.key !== key/);
  // o formulário passa a captura que o abriu; o hospedeiro só confirma depois quando o servidor não confirmou
  const form = ler('components/finance/formulario-do-lancamento.tsx');
  assert.match(form, /const capturaId = !editing \? props\.captura : undefined/);
  assert.match(form, /props\.onSalvo\(criarOutro, Boolean\(capturaId\)\)/);
  assert.match(ler('app/finance/lancar.tsx'), /p\.captura && doAplicar && !capturaResolvida/);
  // o vínculo não vai no corpo do lançamento (o RPC de salvar recusa campo desconhecido)
  assert.match(salvar, /\{ capturaId, \.\.\.input \}/);
});

test('os quatro tipos (lançamento, parcelada, série, financiamento) criam e confirmam a captura numa transação só', () => {
  const hook = ler('hooks/use-finance.ts');
  for (const [nome, tipo] of [['useCreateInstallmentPlan', 'parcelada'], ['useCreateRecurring', 'recorrente'], ['useSaveDebt', 'financiamento']]) {
    const corpo = hook.slice(hook.indexOf(`export function ${nome}(`), hook.indexOf(`export function ${nome}(`) + 2600);
    assert.match(corpo, new RegExp(`capturaId`), nome);
    assert.match(corpo, new RegExp(`lancarDaCaptura\\(capturaId, '${tipo}'`), nome);
  }
  assert.match(hook, /lancarDaCaptura\(capturaId, 'lancamento'/);
  assert.match(ler('components/finance/formulario-do-lancamento.tsx'), /createPlan\.mutateAsync\(\{ \.\.\.entradaParcelada, capturaId \}\)/);
  assert.match(ler('components/finance/formulario-da-serie.tsx'), /create\.mutateAsync\(\{ \.\.\.entrada, capturaId: props\.captura \}\)/);
  assert.match(ler('components/finance/formulario-da-divida.tsx'), /capturaId: props\.captura \}\)/);
  for (const corpo of ['formulario-da-serie', 'formulario-da-divida']) {
    assert.match(ler(`components/finance/${corpo}.tsx`), /onSalvo\(criarOutro, Boolean\(props\.captura\)\)/);
  }
});

test('abrir a captura confere o servidor antes: não abre a que já virou lançamento', () => {
  const hook = ler('hooks/use-capturas.ts');
  assert.match(hook, /export function useAbrirCaptura/);
  assert.match(hook, /select\('status, transaction_id'\)[\s\S]{0,80}maybeSingle/);
  const hoje = ler('components/feed/capturas-da-hoje.tsx');
  assert.doesNotMatch(hoje, /router\.push\(hrefDaCaptura/);
  assert.equal(hoje.match(/void abrir\(c\)/g)?.length, 2); // a ação "Lançar" e o toque na linha
});

test('o dono da fila acompanha a configuração: ligar, cada banco e o envio levam o usuário logado', () => {
  const tela = ler('app/captura-notificacoes.tsx');
  assert.match(tela, /configurarCaptura\(ativa, pacotes, dono\)/);
  assert.match(tela, /configurarCaptura\(true, pacotes, dono\)/);
  assert.match(ler('hooks/use-capturas.ts'), /dono: userId/);
  // captura ligada por OUTRA conta (sessão caiu com o app fechado) é desligada, nunca religada para esta
  assert.match(ler('hooks/use-capturas.ts'), /ligada\.dono && ligada\.dono !== userId\) configurarCaptura\(false, \[\], null\)/);
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

test('captura já resolvida (PT409): os quatro corpos fecham o formulário e a lista atualiza, sem erro genérico', () => {
  const hook = ler('hooks/use-finance.ts');
  assert.match(hook, /error\?\.code === 'PT409'\) throw Object\.assign\(new Error\(FRASE_CAPTURA_RESOLVIDA\), \{ code: CAPTURA_RESOLVIDA \}\)/);
  for (const f of ['formulario-do-lancamento', 'formulario-da-serie', 'formulario-da-divida']) {
    assert.match(ler(`components/finance/${f}.tsx`), /ehCapturaResolvida\(error\)\) return props\.aoCapturaResolvida\?\.\(\)/, f);
  }
  // o formulário do lançamento trata nos DOIS caminhos (à vista e parcelada)
  assert.equal(ler('components/finance/formulario-do-lancamento.tsx').match(/ehCapturaResolvida\(error\)/g)?.length, 2);
  const lancar = ler('app/finance/lancar.tsx');
  assert.match(lancar, /aoCapturaResolvida: \(\) => \{[\s\S]{0,260}invalidateQueries\(\{ queryKey: \['captured_notifications'\] \}\)[\s\S]{0,60}router\.back\(\)/);
});
