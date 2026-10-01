import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import ts from 'typescript';

// O recorte segue o calendário exibido pela pessoa; estas fixtures usam Brasília.
process.env.TZ = 'America/Sao_Paulo';

type Filters = Record<string, unknown>;
type Query = {
  queryKey: unknown[];
  queryFn: (context: { pageParam: number }) => Promise<{ id: string }[]>;
  getNextPageParam: (last: { id: string }[], all: { id: string }[][]) => number | undefined;
};
/** Hooks e construtor PostgREST reais. Só o transporte remoto e o ciclo React/Query são dublês. */
function harness() {
  const requests: URL[] = [];
  const replies: { data: unknown; status: number }[] = [];
  const supabase = createClient('https://filters.test.supabase.co', 'test-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      requests.push(new URL(String(input)));
      const reply = replies.shift() ?? { data: [], status: 200 };
      return new Response(JSON.stringify(reply.data), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const cache = new Map<string, unknown>();
  function load(file: string): unknown {
    const path = resolve(file);
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    cache.set(path, module.exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(code, { module, exports: module.exports, Date, Map, WeakMap, Set,
      require: (name: string) => {
        if (name === 'react') return { useEffect: () => {} };
        if (name === '@tanstack/react-query') return { useQueryClient: () => ({}), useInfiniteQuery: (query: Query) => query };
        if (name === '@/lib/supabase') return { supabase };
        if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
        if (name.startsWith('.')) return load(resolve(path, '..', name));
        return {};
      },
    }, { filename: path });
    return module.exports;
  }
  return {
    requests,
    reply(data: unknown, status = 200) { replies.push({ data, status }); },
    notes(filters: Filters = {}) { return (load('src/hooks/use-notes.ts') as { useNotesList: (f: Filters) => Query }).useNotesList(filters); },
    reminders(filters: Filters = {}) { return (load('src/hooks/use-items.ts') as { useReminders: (f: Filters) => Query }).useReminders(filters); },
  };
}
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));

test('lixeira ordena pela exclusão no servidor antes de paginar, sem misturar fixação da lista ativa', async () => {
  const h = harness(); h.reply([]);
  await h.notes({ trash: true }).queryFn({ pageParam: 30 });
  const params = h.requests[0].searchParams;
  assert.equal(params.get('order'), 'deleted_at.desc,id.desc');
  assert.equal(params.get('offset'), '30');
});

test('lembretes sem filtros conservam a chave de cache da vitrine e do retrato inicial', () => {
  const h = harness();
  assert.deepEqual(wire(h.reminders().queryKey), ['reminders']);
  assert.deepEqual(wire(h.reminders({ from: undefined, active: undefined }).queryKey), ['reminders']);
});

test('lembretes combinam título, canal e estado antes da paginação e incluem o último instante do dia BRT', async () => {
  const h = harness();
  const filters = { q: 'aluguel', active: false, channel: 'whatsapp', from: '2026-12-31', to: '2026-12-31' };
  const query = h.reminders(filters);
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}` }));
  h.reply(rows);
  const first = await query.queryFn({ pageParam: 0 });
  assert.deepEqual(first, rows);
  const params = h.requests[0].searchParams;
  assert.deepEqual(params.getAll('next_run_at'), ['gte.2026-12-31T03:00:00.000Z', 'lt.2027-01-01T03:00:00.000Z']);
  assert.equal(params.get('active'), 'eq.false');
  assert.equal(params.get('channel'), 'eq.whatsapp');
  assert.equal(params.get('title'), 'ilike.%aluguel%');
  assert.equal(params.get('or'), '(parent_reminder_id.is.null,active.eq.true)');
  assert.deepEqual(wire(query.queryKey), ['reminders', filters]);
  const next = query.getNextPageParam(first, [first]);
  assert.equal(next, 20);
  h.reply([{ id: 'r20' }]);
  assert.deepEqual(await query.queryFn({ pageParam: next! }), [{ id: 'r20' }]);
  assert.equal(h.requests[1].searchParams.get('offset'), '20');
  assert.equal(h.requests[1].searchParams.get('limit'), '20');
  assert.deepEqual(h.requests[1].searchParams.getAll('next_run_at'), params.getAll('next_run_at'));
  assert.equal(query.getNextPageParam([{ id: 'r20' }], [first, [{ id: 'r20' }]]), undefined);
});

test('notas mantêm pasta/tag/busca/ordem no intervalo de atualização antes das páginas seguintes', async () => {
  const h = harness();
  const filters = { folderId: null, tag: 'casa', q: 'mercado', sort: 'recentes', from: '2026-09-30', to: '2026-09-30' };
  const query = h.notes(filters);
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}` }));
  h.reply(rows);
  const first = await query.queryFn({ pageParam: 0 });
  const params = h.requests[0].searchParams;
  assert.deepEqual(params.getAll('updated_at'), ['gte.2026-09-30T03:00:00.000Z', 'lt.2026-10-01T03:00:00.000Z']);
  assert.equal(params.get('folder_id'), 'is.null');
  assert.equal(params.get('tags'), 'cs.{casa}');
  assert.equal(params.get('search_tsv'), 'fts(pt_unaccent).mercado:*');
  assert.equal(params.get('order'), 'pinned.desc,updated_at.desc,id.asc');
  assert.deepEqual(wire(query.queryKey), ['notes', 'list', filters]);
  const next = query.getNextPageParam(first, [first]);
  assert.equal(next, 30);
  h.reply([{ id: 'n30' }]);
  assert.deepEqual(await query.queryFn({ pageParam: next! }), [{ id: 'n30' }]);
  assert.equal(h.requests[1].searchParams.get('offset'), '30');
  assert.equal(h.requests[1].searchParams.get('limit'), '30');
  assert.deepEqual(h.requests[1].searchParams.getAll('updated_at'), params.getAll('updated_at'));
});

for (const kind of ['notes', 'reminders'] as const) {
  test(`${kind}: datas abertas, fevereiro bissexto e limpeza não reutilizam o recorte anterior`, async () => {
    const h = harness();
    const column = kind === 'notes' ? 'updated_at' : 'next_run_at';
    for (const [filters, expected] of [
      [{ from: '2028-02-29' }, ['gte.2028-02-29T03:00:00.000Z']],
      [{ to: '2028-02-29' }, ['lt.2028-03-01T03:00:00.000Z']],
      [{}, []],
    ] as [Filters, string[]][]) {
      const query = h[kind](filters);
      await query.queryFn({ pageParam: 0 });
      assert.deepEqual(h.requests.at(-1)!.searchParams.getAll(column), expected);
    }
  });
  test(`${kind}: erro remoto é propagado e retry conserva filtros`, async () => {
    const h = harness();
    const query = h[kind]({ from: '2026-09-30', q: 'mercado' });
    h.reply({ code: 'XX000', message: 'falha transitória', details: null, hint: null }, 500);
    await assert.rejects(query.queryFn({ pageParam: 0 }), (error) => Boolean(error && typeof error === 'object' && 'message' in error && error.message === 'falha transitória'));
    h.reply([{ id: 'encontrado' }]);
    assert.deepEqual(await query.queryFn({ pageParam: 0 }), [{ id: 'encontrado' }]);
    assert.equal(h.requests[0].search, h.requests[1].search);
  });
}
