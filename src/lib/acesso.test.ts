import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

import { aoFalharEscrita, decisaoDeAcesso, estadoDoPlano, estaSemAssinatura } from './acesso.ts';
import { diasDeTeste, opcoesDaLoja, periodoEscrito } from './oferta.ts';

const pronto = (access: string) => ({ isPending: false, isError: false, data: { access } });

test('portão: nunca assinou só tem a tela de assinar; lapsed entra em leitura; erro falha aberto', () => {
  assert.equal(decisaoDeAcesso(false, false, { isPending: true, isError: false }), 'conta');
  assert.equal(decisaoDeAcesso(true, false, { isPending: true, isError: false }), 'onboarding');
  assert.equal(decisaoDeAcesso(true, true, { isPending: true, isError: false }), 'aguarda', 'não pisca');
  assert.equal(decisaoDeAcesso(true, true, pronto('never')), 'assinar');
  assert.equal(decisaoDeAcesso(true, true, pronto('lapsed')), 'app');
  assert.equal(decisaoDeAcesso(true, true, pronto('subscriber')), 'app');
  assert.equal(decisaoDeAcesso(true, true, { isPending: true, isError: true }), 'app', 'plano falhou: o banco protege');
});

test('modo leitura: lapsed ou plano free; plano ausente (erro) não bloqueia', () => {
  assert.equal(estaSemAssinatura({ access: 'lapsed', plan: 'free' }), true);
  assert.equal(estaSemAssinatura({ access: 'subscriber', plan: 'pro' }), false);
  assert.equal(estaSemAssinatura(undefined), false);
});

test('PT402 abre o paywall de leitura; outro erro passa', () => {
  const abertas: string[] = [];
  assert.equal(aoFalharEscrita({ code: 'PT402' }, (r) => abertas.push(r)), true);
  assert.deepEqual(abertas, ['/paywall?from=lapsed']);
  assert.equal(aoFalharEscrita({ code: '23505' }, (r) => abertas.push(r)), false);
  assert.equal(aoFalharEscrita(null, (r) => abertas.push(r)), false);
  assert.equal(abertas.length, 1);
});

test('cartão do plano em palavras, nunca "free"', () => {
  const base = { members: 1, max_members: 5 };
  assert.deepEqual(estadoDoPlano({ ...base, access: 'subscriber', plan: 'family' }, null),
    { titulo: 'Família', detalhe: '1 de 5 pessoas', selo: 'ATIVO' });
  assert.deepEqual(estadoDoPlano({ ...base, access: 'subscriber', plan: 'pro', is_trial: true }, '16/10/2026'),
    { titulo: 'Pro', detalhe: 'Teste até 16/10/2026', selo: 'TESTE' });
  assert.equal(estadoDoPlano({ ...base, access: 'lapsed', plan: 'free' }, null).titulo, 'Assinatura encerrada');
});

test('oferta: período e teste lidos do que a loja devolveu', () => {
  assert.equal(periodoEscrito('P1M'), 'por mês');
  assert.equal(periodoEscrito('P1Y'), 'por ano');
  assert.equal(periodoEscrito('P3M'), 'a cada 3 meses');
  assert.equal(periodoEscrito(null), null);
  const p = (intro: any, livre?: any) => ({ identifier: 'x', product: { identifier: 'proops.personal.pro.monthly', priceString: 'R$ 1', subscriptionPeriod: 'P1M', introPrice: intro, defaultOption: livre ? { freePhase: { billingPeriod: livre } } : null } });
  assert.equal(diasDeTeste(p({ price: 0, periodUnit: 'WEEK', periodNumberOfUnits: 1 })), 7);
  assert.equal(diasDeTeste(p({ price: 9, periodUnit: 'DAY', periodNumberOfUnits: 7 })), null, 'intro paga não é teste grátis');
  assert.equal(diasDeTeste(p(null, { unit: 'DAY', value: 7 })), 7, 'Android: fase grátis da oferta');
  assert.equal(opcoesDaLoja([p(null, { unit: 'DAY', value: 7 })], false)[0].diasDeTeste, null);
});

/** Apagar a conta: confirma, chama a RPC, e só então limpa o aparelho (erro de sessão inexistente é esperado). */
function apagarConta(rpc: () => Promise<{ error: unknown }>) {
  const chamadas: string[] = [];
  let confirmar: (() => Promise<void>) | undefined;
  const modulo = { exports: {} as any };
  const codigo = ts.transpileModule(readFileSync('src/hooks/use-apagar-conta.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', codigo)((nome: string) => {
    switch (nome) {
      case 'react': return { useState: (v: unknown) => [v, () => {}] };
      case '@/components/motion/session-curtain': return { useCortina: () => ({ preparar() {}, cobrir: async () => { chamadas.push('cortina'); } }) };
      case '@/components/ui/toast': return { useToast: () => (t: any) => chamadas.push(`toast:${t.tone}`) };
      case '@/lib/compras': return { identificar: async (id: unknown) => { chamadas.push(`revenuecat:${id}`); } };
      case '@/lib/item-actions': return { confirmDestructive: (_t: string, _l: string, ok: () => Promise<void>, msg: string) => { chamadas.push(`confirma:${msg}`); confirmar = ok; } };
      case '@/lib/session-gate': return { ondaDaTroca: () => ({}) };
      case '@/lib/supabase': return { supabase: {
        rpc: async (n: string) => { chamadas.push(`rpc:${n}`); return rpc(); },
        auth: { signOut: async () => { chamadas.push('signOut'); throw new Error('Auth session missing'); } } } };
      default: throw new Error(nome);
    }
  }, modulo, modulo.exports);
  const { apagar } = modulo.exports.useApagarConta();
  return { apagar, chamadas, confirmar: () => confirmar!() };
}

test('apagar conta: nada roda antes de confirmar; depois chama delete_my_account, sai do RevenueCat e do aparelho', async () => {
  const c = apagarConta(async () => ({ error: null }));
  c.apagar();
  assert.deepEqual(c.chamadas.map((x) => x.split(':')[0]), ['confirma'], 'só a pergunta, nenhuma escrita');
  assert.match(c.chamadas[0], /NÃO é cancelada automaticamente/);
  await c.confirmar();
  assert.deepEqual(c.chamadas.slice(1), ['rpc:delete_my_account', 'cortina', 'revenuecat:null', 'signOut']);
});

test('apagar conta: se o servidor recusa, a sessão fica e a pessoa é avisada', async () => {
  const c = apagarConta(async () => ({ error: { message: 'boom' } }));
  c.apagar();
  await c.confirmar();
  assert.deepEqual(c.chamadas.slice(1), ['rpc:delete_my_account', 'toast:error']);
});
