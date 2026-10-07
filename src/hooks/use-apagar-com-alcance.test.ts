import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);

function carregar(path: string, fakes: Record<string, any>): any {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  new Function('module', 'exports', 'require', code)(module, module.exports, (name: string) => {
    if (name in fakes) return fakes[name];
    if (name.startsWith('./')) return carregar(`src/lib/${name.slice(2).replace(/\.ts$/, '')}.ts`, fakes);
    if (name === '@/lib/apagar-com-alcance' || name === '@/lib/finance-form') return carregar(`src/lib/${name.split('/').at(-1)}.ts`, fakes);
    return nodeRequire(name);
  });
  return module.exports;
}

const PREVIA = { apagadas: 1, pagas_apagadas: 0, soma_pagas_cents: '0', contas: [], desde: null, apaga_contrato: false, vira_avista: false };
const ALVO = { tipo: 'occurrence', id: 't', nome: 'Conta' } as const;

/** O hook de verdade, com rpc/mutação/pergunta/confirmação de mentira que registram a ORDEM. */
function montar({ previa = PREVIA, previaErro, escritaErro }: { previa?: any; previaErro?: any; escritaErro?: any } = {}) {
  const chamadas: string[] = [];
  const toasts: any[] = [];
  const confirmacoes: (() => void)[] = [];
  const perguntas: ((alcance: string) => void)[] = [];
  const sucessos: any[] = [];
  const fakes = {
    react: { useRef: (v: any) => ({ current: v }) },
    '@tanstack/react-query': {
      useQueryClient: () => ({}),
      useMutation: ({ mutationFn, onSuccess }: any) => ({
        isPending: false,
        mutate: (vars: any, opts: any) => { void mutationFn(vars).then((r: any) => { onSuccess?.(r); opts?.onSuccess?.(r); }, (e: any) => opts?.onError?.(e)); },
      }),
    },
    '@/components/ui/toast': { useToast: () => (t: any) => toasts.push(t) },
    '@/hooks/use-items': { formatBRL: (c: number) => `R$ ${c}` },
    '@/lib/agent-chat': { newClientMessageId: () => 'req' },
    '@/lib/edit-scope': { askDeleteScope: (_tipo: string, aoEscolher: (a: string) => void) => perguntas.push(aoEscolher) },
    '@/lib/item-actions': { confirmDestructive: (_t: string, _l: string, cb: () => void) => confirmacoes.push(cb) },
    '@/lib/query-invalidation': { invalidateFinance: () => {}, invalidateKeys: () => {} },
    '@/lib/supabase': { supabase: { rpc: async (nome: string) => {
      chamadas.push(nome);
      const erro = nome === 'delete_scoped_preview' ? previaErro : escritaErro;
      return erro ? { data: null, error: erro } : { data: previa, error: null };
    } } },
  };
  const modulo = carregar('src/hooks/use-apagar-com-alcance.ts', fakes);
  const hook = modulo['useApagarComAlcance']((p: any) => sucessos.push(p));
  const solta = () => new Promise((r) => setTimeout(r, 0));
  return { hook, chamadas, toasts, confirmacoes, perguntas, sucessos, solta };
}

test('Apagar com pagas: a confirmação vem ANTES de qualquer escrita, e confirmar escreve uma vez', async () => {
  const m = montar({ previa: { ...PREVIA, pagas_apagadas: 2, soma_pagas_cents: '1000', contas: ['Nubank'] } });
  m.hook.apagar(ALVO);
  assert.equal(m.perguntas.length, 1);
  assert.deepEqual(m.chamadas, [], 'a pergunta não escreve nem lê');
  m.perguntas[0]('all');
  await m.solta();
  assert.equal(m.confirmacoes.length, 1);
  assert.deepEqual(m.chamadas, ['delete_scoped_preview'], 'só a prévia, nenhum delete_scoped antes do sim');
  m.confirmacoes[0]();
  await m.solta();
  assert.deepEqual(m.chamadas, ['delete_scoped_preview', 'delete_scoped']);
  assert.equal(m.sucessos.length, 1);
});

test('Apagar: cancelar a pergunta de alcance não lê nem escreve nada', async () => {
  const m = montar();
  m.hook.apagar(ALVO);
  await m.solta();
  assert.deepEqual(m.chamadas, []);
  assert.equal(m.confirmacoes.length, 0);
});

test('Apagar: cancelar a confirmação do estrago não escreve', async () => {
  const m = montar({ previa: { ...PREVIA, pagas_apagadas: 1, soma_pagas_cents: '500' } });
  m.hook.apagar(ALVO);
  m.perguntas[0]('one');
  await m.solta();
  assert.equal(m.confirmacoes.length, 1, 'a confirmação foi mostrada e não aceita');
  await m.solta();
  assert.ok(!m.chamadas.includes('delete_scoped'));
  assert.equal(m.sucessos.length, 0);
});

test('Apagar sem pagas: vai direto à escrita, sem confirmação', async () => {
  const m = montar();
  m.hook.apagar(ALVO);
  m.perguntas[0]('one');
  await m.solta();
  assert.equal(m.confirmacoes.length, 0);
  assert.deepEqual(m.chamadas, ['delete_scoped_preview', 'delete_scoped']);
});

test('Apagar: a recusa do banco aparece com a frase dele; falha de rede segue genérica', async () => {
  const GENERICO = 'Não deu para apagar. Tenta de novo.';
  const casos = [
    [{ code: 'P0001', message: 'Apague primeiro o pagamento mais recente desta dívida' }, 'Apague primeiro o pagamento mais recente desta dívida'],
    [{ code: 'PGRST301', message: 'JWT expired' }, GENERICO],
    [new Error('Network request failed'), GENERICO],
  ] as const;
  for (const [erro, esperado] of casos) {
    // na prévia
    const a = montar({ previaErro: erro });
    a.hook.apagar(ALVO);
    a.perguntas[0]('all');
    await a.solta();
    assert.equal(a.toasts.at(-1)?.message, esperado, 'prévia');
    assert.ok(!a.chamadas.includes('delete_scoped'), 'prévia falhou: nada escrito');
    // na escrita
    const b = montar({ escritaErro: erro });
    b.hook.apagar(ALVO);
    b.perguntas[0]('all');
    await b.solta();
    await b.solta();
    assert.equal(b.toasts.at(-1)?.message, esperado, 'escrita');
    assert.equal(b.sucessos.length, 0);
  }
});
