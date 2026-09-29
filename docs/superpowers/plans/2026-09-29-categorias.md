# Categorias personalizáveis — Implementation Plan (B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Categorias com nome, ícone e cor, editáveis numa tela própria (criar, renomear, juntar, apagar), com "+ Nova" no seletor e a cor aparecendo em toda lista e gráfico onde a categoria aparece.

**Architecture:** Os registros continuam guardando a categoria como TEXTO (sem FK: WhatsApp e agente não mudam). Uma tabela `categories` guarda só a APARÊNCIA (ícone e cor) de um nome, por espaço. Renomear, juntar e apagar são funções do banco que reescrevem o texto em todas as tabelas numa transação. No app, uma função pura `aparenciaDaCategoria` responde "que ícone e que cor este nome tem" (a tabela primeiro, o mapa de ícones de `category-icons.ts` como fallback), e os primitivos `Row`/`LedgerRow`/`Icon` ganham uma tinta de conteúdo.

**Tech Stack:** Supabase Postgres (plpgsql, `extensions.unaccent`), Expo SDK 57 + expo-router, TanStack Query, `node --test` com o harness de `simple-finance-ui.test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-29-formulario-unico-e-categorias-design.md` (Partes 3 e 4). Independente do plano A (`2026-09-29-formulario-unico.md`); os dois se tocam só no `CategoryPicker`, que o A usa sem mudar.

## Global Constraints

- Commits conventional, UMA linha, sem corpo e **sem `Co-Authored-By`**. Sem push, sem tag.
- Banco: só STAGING (`utkqoiigimqzeenxkxdl`; `scripts/supabase-target.sh` antes do `db push`). Produção é do Gabriel.
- Função nova em `public`: `security invoker`, `set search_path = public`, `revoke execute … from public, anon`, `grant … to authenticated`, nome no array de `supabase/tests/anon_sem_execute.sql`. Tabela nova: RLS com a policy `workspace rows` (`private.my_workspace_ids()`), `workspace_id default public.my_default_workspace()`, `user_id` sem default.
- Nome de categoria: minúsculo, sem espaço nas pontas, 1–40 caracteres (`check (name = lower(trim(name)) …)`, a régua de `note_folders`). Duas categorias são a mesma quando o nome sem acento e minúsculo é igual (`foldCategory` no app, `extensions.unaccent(lower(…))` no banco).
- Cor = um dos 8 nomes de `NOTE_COLOR_NAMES` ou `null`. Nunca `tint`, `danger` ou `warning` (design.md §2b: cor de conteúdo do usuário, como a das notas). Ícone = um nome de `ICONES_DE_CATEGORIA` (lista fixa, todos no `MATERIAL` do `icon.tsx`).
- Folha dentro de folha não existe (`Modal` dentro de `Modal` no Android): a grade de cores entra INLINE na folha da categoria.
- Portão antes de cada commit: `npx tsc --noEmit`, `npx expo lint`, `npm test` (código de saída).

## Review Focus

1. **Renomear para um nome que só difere em acento/caixa** ("Roupa" → "roupá") — é juntar, e pergunta antes. → Task 1 (SQL) e Task 4 (tela).
2. **Juntar com orçamento das duas no mesmo mês** — fica o da que recebe, e nenhum unique parcial estoura (`month` null não colide com null no Postgres, os dois índices são parciais). → Task 1.
3. **Categoria que só existe no texto** (nasceu no WhatsApp, sem linha em `categories`) — aparece na tela, se edita e se apaga igual às outras; editar a aparência CRIA a linha. → Tasks 1 e 4.
4. **Registro sem categoria e categoria sem cor** — a lista fica com o disco neutro de hoje, a rosca cai nos cinzas por posição. → Tasks 2 e 6.
5. **APK antigo chamando `categories_used`** — continua recebendo `category` e `uses` (colunas novas só se somam no fim). → Task 1.

---

## File Structure

| arquivo | responsabilidade |
|---|---|
| `supabase/migrations/20260929170000_categorias.sql` | tabela `categories`, `categories_used` estendida, `save_category`, `rename_category`, `delete_category` |
| `supabase/tests/categorias.sql` | criar, renomear, juntar (com conflito de orçamento), apagar, nas seis tabelas |
| `src/lib/categorias.ts` (+ `.test.ts`) | `ICONES_DE_CATEGORIA`, `Categoria`, `aparenciaDaCategoria` |
| `src/hooks/use-finance.ts` | `useCategoriesUsed` passa a trazer ícone e cor; `useSalvarCategoria`, `useRenomearCategoria`, `useApagarCategoria`; `useAparencia` |
| `src/components/ui/icon.tsx`, `row.tsx`, `ledger-row.tsx` | tinta de conteúdo (`tinta?: NoteColorName \| null`) |
| `src/components/notes/color-picker.tsx` | extrai `GradeDeCores` (inline) — `ColorPicker` passa a usá-la |
| `src/components/finance/categoria-sheet.tsx` | a folha de criar/editar (nome, ícone, cor) — usada pela tela e pelo "+ Nova" |
| `src/app/finance/categories.tsx` | a tela Categorias |
| `src/components/finance/category-picker.tsx` | chips com ícone e cor, "+ Nova", "Gerenciar categorias" |
| `spending-donut.tsx`, `donut-math.ts`, `budget-rings.tsx`, `budgets.tsx`, as listas | a cor da categoria |

---

### Task 1: O banco

**Files:**
- Create: `supabase/migrations/20260929170000_categorias.sql`, `supabase/tests/categorias.sql`
- Modify: `supabase/tests/anon_sem_execute.sql`, `src/lib/database.types.ts` (regenerado), `docs/HISTORICO-DE-MIGRATIONS.md`

**Interfaces:**
- Produces:
  - `public.categories(id, workspace_id, user_id, name, icon, color, created_at, updated_at)`.
  - `public.categories_used() returns table (category text, uses bigint, icon text, color text, budgets bigint)`: toda categoria EM USO (em `transactions`) mais toda que tem linha em `categories`, com a contagem de lançamentos e de orçamentos.
  - `public.save_category(p_name text, p_icon text, p_color text) returns void`: upsert da aparência por `(workspace, name)`.
  - `public.rename_category(p_from text, p_to text, p_juntar boolean default false) returns jsonb` → `{juntou boolean, orcamentos_descartados int}`; recusa com `'CATEGORIA_EXISTE'` quando `p_to` (dobrado) já existe e `p_juntar` é falso.
  - `public.delete_category(p_name text) returns jsonb` → `{lancamentos int, orcamentos int}`.

- [ ] **Step 1: Teste SQL (falha)**

`supabase/tests/categorias.sql`, com o cabeçalho de `horizonte_por_conta.sql` (usuário fixo `…c47e`, workspace, `set_config('request.jwt.claim.sub', …)`, `set local role authenticated`, `rollback` no fim). Montagem como postgres: transações com `roupa` (2), `roupas` (1), `lazer` (1); uma recorrente, um plano, uma regra e uma dívida (`payment_category`) com `roupa`; orçamentos `roupa` (padrão, 30000), `roupa` (mês 2026-10, 40000), `roupas` (mês 2026-10, 50000).

```sql
do $$
declare r jsonb; n int;
begin
  -- 1. aparência: cria e atualiza a linha, sem mexer em registro nenhum
  perform public.save_category('lazer', 'gamecontroller', 'oceano');
  perform public.save_category('lazer', 'film', 'musgo');
  if (select icon || '/' || color from public.categories where name = 'lazer') <> 'film/musgo' then raise exception '1. upsert'; end if;

  -- 2. cor fora da paleta é recusada
  begin perform public.save_category('lazer', 'film', 'vermelho'); raise exception '2. aceitou cor'; exception when check_violation then null; end;

  -- 3. renomear para um nome que existe sem "juntar" é recusado, e nada muda
  begin perform public.rename_category('roupa', 'Roupás', false); raise exception '3. não recusou';
  exception when others then if sqlerrm not like '%CATEGORIA_EXISTE%' then raise; end if; end;
  if (select count(*) from public.transactions where category = 'roupa') <> 2 then raise exception '3. mudou algo'; end if;

  -- 4. juntar: tudo que era "roupa" vira "roupas", e o orçamento de outubro da que recebe fica
  r := public.rename_category('roupa', 'roupas', true);
  if not (r->>'juntou')::boolean or (r->>'orcamentos_descartados')::int <> 1 then raise exception '4. retorno %', r; end if;
  if (select count(*) from public.transactions where category = 'roupas') <> 3 then raise exception '4. transações'; end if;
  if exists (select 1 from public.recurring_transactions where category = 'roupa')
     or exists (select 1 from public.installment_plans where category = 'roupa')
     or exists (select 1 from public.categorization_rules where category = 'roupa')
     or exists (select 1 from public.debts where payment_category = 'roupa') then raise exception '4. sobrou roupa'; end if;
  if (select amount_cents from public.budgets where category = 'roupas' and month = date '2026-10-01') <> 50000 then raise exception '4. orçamento de outubro'; end if;
  if (select amount_cents from public.budgets where category = 'roupas' and month is null) <> 30000 then raise exception '4. o padrão veio junto'; end if;

  -- 5. renomear simples (nome novo livre) leva a aparência junto
  perform public.save_category('roupas', 'tshirt', 'terra');
  r := public.rename_category('roupas', 'vestuário');
  if (r->>'juntou')::boolean then raise exception '5. juntou'; end if;
  if (select color from public.categories where name = 'vestuário') <> 'terra' then raise exception '5. aparência'; end if;

  -- 6. apagar: registros sem categoria, orçamentos fora, contagem certa
  r := public.delete_category('vestuário');
  if (r->>'lancamentos')::int <> 3 or (r->>'orcamentos')::int <> 2 then raise exception '6. contagem %', r; end if;
  if exists (select 1 from public.transactions where category = 'vestuário') or exists (select 1 from public.budgets where category = 'vestuário')
     or exists (select 1 from public.categories where name = 'vestuário') then raise exception '6. sobrou'; end if;

  -- 7. categories_used: a que só tem aparência aparece com 0 usos; a do texto aparece sem ícone
  if not exists (select 1 from public.categories_used() where category = 'lazer' and icon = 'film' and uses = 1) then raise exception '7. lazer'; end if;
  perform public.save_category('viagem', 'airplane', null);
  if not exists (select 1 from public.categories_used() where category = 'viagem' and uses = 0) then raise exception '7. viagem'; end if;
  raise notice 'categorias: ok';
end $$;
```

- [ ] **Step 2: Ver falhar** — Run: `docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f - < supabase/tests/categorias.sql` — Expected: FAIL (`function public.save_category … does not exist`).

- [ ] **Step 3: Migration**

```sql
-- Categorias personalizáveis (spec 2026-09-29, Parte 3). Os registros continuam com TEXTO; esta
-- tabela guarda só a aparência de um nome. Renomear/juntar/apagar reescrevem o texto em tudo.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_default_workspace()
    references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (name = lower(trim(name)) and char_length(name) between 1 and 40),
  -- nome de SF Symbol da lista fixa do app (ICONES_DE_CATEGORIA); nunca emoji
  icon text check (icon is null or char_length(icon) between 1 and 60),
  color text check (color is null or color in ('grafite','oceano','violeta','magenta','terra','mostarda','musgo','turquesa')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
alter table public.categories enable row level security;
create policy "workspace rows" on public.categories
  for all using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
create trigger set_updated_at before update on public.categories
  for each row execute function extensions.moddatetime(updated_at);

create function private.fold(p text) returns text language sql stable
  as $$ select extensions.unaccent(lower(trim(p))) $$;

-- O tipo de retorno muda (colunas NOVAS no fim: o APK antigo lê category e uses por nome).
drop function public.categories_used();
create function public.categories_used()
returns table (category text, uses bigint, icon text, color text, budgets bigint)
language sql stable security invoker set search_path = public
as $$
  with usadas as (
    select t.category, count(*)::bigint as uses from public.transactions t
     where t.workspace_id in (select private.my_workspace_ids()) and coalesce(t.category, '') <> ''
     group by t.category
  ), nomes as (
    select category from usadas
    union select c.name from public.categories c where c.workspace_id in (select private.my_workspace_ids())
  )
  select n.category, coalesce(u.uses, 0), c.icon, c.color,
         (select count(*) from public.budgets b where b.category = n.category
            and b.workspace_id in (select private.my_workspace_ids()))
    from nomes n
    left join usadas u using (category)
    left join public.categories c on c.name = n.category and c.workspace_id in (select private.my_workspace_ids())
   order by coalesce(u.uses, 0) desc, n.category;
$$;

create function public.save_category(p_name text, p_icon text, p_color text)
returns void language plpgsql security invoker set search_path = public
as $$
begin
  insert into public.categories (user_id, name, icon, color)
  values (auth.uid(), lower(trim(p_name)), p_icon, p_color)
  on conflict (workspace_id, name) do update set icon = excluded.icon, color = excluded.color;
end $$;

create function public.rename_category(p_from text, p_to text, p_juntar boolean default false)
returns jsonb language plpgsql security invoker set search_path = public
as $$
declare
  v_from text := lower(trim(p_from));
  v_to text := lower(trim(p_to));
  v_ws uuid[] := array(select private.my_workspace_ids());
  v_existe text;
  v_desc int := 0;
begin
  if v_to = '' then raise exception 'Dê um nome à categoria.'; end if;
  if v_from = v_to then return jsonb_build_object('juntou', false, 'orcamentos_descartados', 0); end if;
  select c into v_existe from (
    select category c from public.transactions where workspace_id = any(v_ws) and category is not null
    union select name from public.categories where workspace_id = any(v_ws)
    union select category from public.budgets where workspace_id = any(v_ws)
  ) x where private.fold(c) = private.fold(v_to) and c <> v_from limit 1;
  if v_existe is not null and not p_juntar then
    raise exception 'CATEGORIA_EXISTE: %', v_existe;
  end if;
  -- juntando, grava com a grafia da que RECEBE
  v_to := coalesce(v_existe, v_to);

  -- orçamento das duas no mesmo alcance: fica o da que recebe
  with fora as (
    delete from public.budgets b where b.workspace_id = any(v_ws) and b.category = v_from
      and exists (select 1 from public.budgets o where o.workspace_id = b.workspace_id and o.category = v_to
                   and o.month is not distinct from b.month)
    returning 1)
  select count(*) into v_desc from fora;

  update public.transactions set category = v_to where workspace_id = any(v_ws) and category = v_from;
  update public.recurring_transactions set category = v_to where workspace_id = any(v_ws) and category = v_from;
  update public.installment_plans set category = v_to where workspace_id = any(v_ws) and category = v_from;
  update public.budgets set category = v_to where workspace_id = any(v_ws) and category = v_from;
  update public.categorization_rules set category = v_to where workspace_id = any(v_ws) and category = v_from;
  update public.debts set payment_category = v_to where workspace_id = any(v_ws) and payment_category = v_from;
  update private.recurring_history_versions set category = v_to where workspace_id = any(v_ws) and category = v_from;

  -- a aparência vai junto; juntando, fica a da que recebe (se ela tiver)
  if exists (select 1 from public.categories where workspace_id = any(v_ws) and name = v_to) then
    delete from public.categories where workspace_id = any(v_ws) and name = v_from;
  else
    update public.categories set name = v_to where workspace_id = any(v_ws) and name = v_from;
  end if;
  return jsonb_build_object('juntou', v_existe is not null, 'orcamentos_descartados', v_desc);
end $$;

create function public.delete_category(p_name text)
returns jsonb language plpgsql security invoker set search_path = public
as $$
declare
  v text := lower(trim(p_name));
  v_ws uuid[] := array(select private.my_workspace_ids());
  v_tx int; v_orc int;
begin
  update public.transactions set category = null where workspace_id = any(v_ws) and category = v;
  get diagnostics v_tx = row_count;
  delete from public.budgets where workspace_id = any(v_ws) and category = v;
  get diagnostics v_orc = row_count;
  update public.recurring_transactions set category = null where workspace_id = any(v_ws) and category = v;
  update public.installment_plans set category = null where workspace_id = any(v_ws) and category = v;
  update public.categorization_rules set category = null where workspace_id = any(v_ws) and category = v;
  update public.debts set payment_category = null where workspace_id = any(v_ws) and payment_category = v;
  update private.recurring_history_versions set category = null where workspace_id = any(v_ws) and category = v;
  delete from public.categories where workspace_id = any(v_ws) and name = v;
  return jsonb_build_object('lancamentos', v_tx, 'orcamentos', v_orc);
end $$;

revoke execute on function public.categories_used() from public, anon;
revoke execute on function public.save_category(text, text, text) from public, anon;
revoke execute on function public.rename_category(text, text, boolean) from public, anon;
revoke execute on function public.delete_category(text) from public, anon;
grant execute on function public.categories_used() to authenticated;
grant execute on function public.save_category(text, text, text) to authenticated;
grant execute on function public.rename_category(text, text, boolean) to authenticated;
grant execute on function public.delete_category(text) to authenticated;
```

Notas:
- `private.recurring_history_versions` tem só policy de LEITURA: se o `update` dela falhar como `authenticated`, trocar essas duas linhas por uma função `private.renomear_no_historico(ws uuid[], de text, para text)` `security definer` chamada daqui (e anotar no ledger).
- `debts.payment_category` e o histórico de recorrentes não estão na lista da spec; entram porque, fora deles, o pagamento da dívida e a ocorrência prevista voltariam com o nome antigo.
- Array de `anon_sem_execute.sql`: `'delete_category'`, `'rename_category'`, `'save_category'` nas posições alfabéticas.

- [ ] **Step 4: Rodar local** — Run: aplicar a migration e rodar `categorias.sql`, `anon_sem_execute.sql` e `agent_migrations.sql` (este toca `categorization_rules`) pelo `docker exec … psql`. Expected: `categorias: ok`, os outros sem erro.

- [ ] **Step 5: Staging, tipos, commit** — `scripts/supabase-target.sh && npx supabase db push`; `npx supabase gen types typescript --project-id utkqoiigimqzeenxkxdl > src/lib/database.types.ts`; linha em `HISTORICO-DE-MIGRATIONS.md`.

```bash
git add supabase/migrations/20260929170000_categorias.sql supabase/tests/categorias.sql supabase/tests/anon_sem_execute.sql src/lib/database.types.ts docs/HISTORICO-DE-MIGRATIONS.md
git commit -m "feat(categorias): aparência por categoria e renomear, juntar e apagar no banco"
```

---

### Task 2: A régua do app (`src/lib/categorias.ts` e os hooks)

**Files:**
- Create: `src/lib/categorias.ts`, `src/lib/categorias.test.ts`
- Modify: `src/hooks/use-finance.ts`, `src/lib/simple-finance-ui.test.ts` (mocks: `useSalvarCategoria`, `useRenomearCategoria`, `useApagarCategoria`; `@/lib/categorias` na lista de módulos reais, linha ~348)

**Interfaces:**
- Produces:
```ts
export type Categoria = { category: string; uses: number; icon: IconName | null; color: NoteColorName | null; budgets: number };
export const ICONES_DE_CATEGORIA: readonly IconName[]; // 30, na ordem da grade
export function aparenciaDaCategoria(nome: string | null | undefined, categorias: readonly Categoria[], kind?: string | null): { icon: IconName; cor: NoteColorName | null };
// hooks
useCategoriesUsed(): UseQueryResult<Categoria[]>
useAparencia(): (nome: string | null | undefined, kind?: string | null) => { icon: IconName; cor: NoteColorName | null }
useSalvarCategoria(): mutation<void, { name: string; icon: IconName | null; color: NoteColorName | null; renomearDe?: string; juntar?: boolean }>
useApagarCategoria(): mutation<{ lancamentos: number; orcamentos: number }, string>
```
`useSalvarCategoria` faz, nesta ordem, `rename_category(renomearDe, name, juntar)` quando `renomearDe` difere de `name`, e depois `save_category(name, icon, color)`. O erro `CATEGORIA_EXISTE` sobe como `Error` com `code = 'CATEGORIA_EXISTE'` e `existente = <nome>` (a tela pergunta e chama de novo com `juntar: true`).

- [ ] **Step 1: Teste (falha)**

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { aparenciaDaCategoria, ICONES_DE_CATEGORIA } from './categorias.ts';

const cats = [
  { category: 'mercado', uses: 9, icon: 'cart', color: 'musgo', budgets: 1 },
  { category: 'lazer', uses: 3, icon: null, color: null, budgets: 0 },
] as const;

test('a linha da tabela manda; sem ela, o ícone adivinhado pelo nome e sem cor', () => {
  assert.deepEqual(aparenciaDaCategoria('Mercado', cats as any), { icon: 'cart', cor: 'musgo' }, 'caixa e acento não importam');
  assert.equal(aparenciaDaCategoria('lazer', cats as any).cor, null);
  assert.equal(aparenciaDaCategoria(null, cats as any, 'income').cor, null);
});

test('todo ícone da grade existe no Android (MATERIAL)', () => {
  const fonte = readFileSync('src/components/ui/icon.tsx', 'utf8');
  for (const i of ICONES_DE_CATEGORIA) assert.match(fonte, new RegExp(`'${i.replace(/\./g, '\\.')}':`), i);
  assert.ok(ICONES_DE_CATEGORIA.length >= 24 && ICONES_DE_CATEGORIA.length <= 36);
  assert.equal(new Set(ICONES_DE_CATEGORIA).size, ICONES_DE_CATEGORIA.length);
});
```

- [ ] **Step 2: Ver falhar** — Run: `node --test src/lib/categorias.test.ts` — Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
/**
 * A aparência de uma categoria (spec 2026-09-29, Parte 3). O registro guarda o NOME; ícone e cor
 * moram na tabela `categories`, e sem linha lá vale o ícone adivinhado pelo nome, sem cor.
 */
import type { IconName } from '@/components/ui/icon';
import type { NoteColorName } from '@/constants/theme';
import { categoryIcon } from '@/design/category-icons';
import { foldCategory } from '@/lib/categories-merge';

export type Categoria = { category: string; uses: number; icon: IconName | null; color: NoteColorName | null; budgets: number };

/** A grade da folha de categoria, na ordem em que aparece. Todos existem no MATERIAL (teste). */
export const ICONES_DE_CATEGORIA: readonly IconName[] = [
  'cart', 'fork.knife', 'cup.and.saucer', 'car', 'fuelpump', 'bus', 'airplane', 'house',
  'bolt', 'drop', 'wifi', 'phone', 'heart', 'cross.case', 'pills', 'graduationcap',
  'book', 'tshirt', 'bag', 'gift', 'gamecontroller', 'film', 'music.note', 'pawprint',
  'figure.run', 'wrench.and.screwdriver', 'briefcase', 'banknote', 'creditcard', 'tag',
];

export function aparenciaDaCategoria(nome: string | null | undefined, categorias: readonly Categoria[], kind?: string | null) {
  const alvo = nome ? foldCategory(nome) : null;
  const linha = alvo ? categorias.find((c) => foldCategory(c.category) === alvo) : undefined;
  return { icon: linha?.icon ?? categoryIcon(nome, kind), cor: linha?.color ?? null };
}
```

Se algum ícone da lista não estiver no `MATERIAL`, trocar pelo vizinho que estiver (o teste diz qual) — nunca acrescentar ao `MATERIAL` sem conferir o nome no Material Symbols.

Hooks em `use-finance.ts`: `useCategoriesUsed` passa a mapear `icon`, `color`, `budgets` (e ganha `useRealtimeInvalidate('categories', ['categories-used'])`); `useAparencia` lê `useCategoriesUsed().data ?? []` e devolve `(nome, kind) => aparenciaDaCategoria(nome, data, kind)`; as mutações invalidam `['categories-used']` e `useInvalidateFinance()` (o nome muda em lançamentos, orçamentos e gráficos).

- [ ] **Step 4: Ver passar + portão** — Run: `node --test src/lib/categorias.test.ts && npx tsc --noEmit && npm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/lib/categorias.ts src/lib/categorias.test.ts src/hooks/use-finance.ts src/lib/simple-finance-ui.test.ts && git commit -m "feat(categorias): aparência da categoria e os hooks de salvar, renomear e apagar"`

---

### Task 3: A tinta nos primitivos

**Files:**
- Modify: `src/components/ui/icon.tsx` (prop `tint?: string`), `src/components/ui/row.tsx` e `src/components/ui/ledger-row.tsx` (prop `tinta?: NoteColorName | null`), `src/components/notes/color-picker.tsx` (extrair `GradeDeCores`)
- Test: `src/lib/anti-slop.test.ts`

**Interfaces:**
- Produces: `<Icon tint>` (cor crua que vence `color`); `<Row tinta>`/`<LedgerRow tinta>`: com tinta, o disco é `superficieDaNota(noteInk(tinta, scheme)!, scheme, { surface: theme.backgroundElement, text: theme.text }).fundo` e o ícone `noteInk(tinta, scheme)`; sem, o de hoje. `GradeDeCores({ value, onPick }: { value: NoteColorName | null; onPick: (c: NoteColorName | null) => void })` — a grade INLINE que o `ColorPicker` já desenha.

- [ ] **Step 1: Teste (falha)**

```ts
test('A tinta da categoria é cor de CONTEÚDO: sai da paleta das notas, nunca de tint/danger/warning', () => {
  for (const f of ['components/ui/row.tsx', 'components/ui/ledger-row.tsx']) {
    const t = readFileSync(join(SRC, f), 'utf8');
    assert.match(t, /tinta\?: NoteColorName \| null/, f);
    assert.match(t, /superficieDaNota\(/, f);
    assert.match(t, /noteInk\(tinta, scheme\)/, f);
  }
  assert.match(readFileSync(join(SRC, 'components/notes/color-picker.tsx'), 'utf8'), /export function GradeDeCores\(/);
});
```

- [ ] **Step 2: Ver falhar** — Run: `node --test --test-name-pattern="cor de CONTEÚDO" src/lib/anti-slop.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar** — `icon.tsx`: `tint?: string` em `IconProps` e `tintColor={tint ?? theme[color]}` nos DOIS ramos (SF Symbol e Material). `row.tsx`/`ledger-row.tsx`:

```tsx
const scheme = useScheme();
const tintaCheia = tinta ? noteInk(tinta, scheme) : null;
const disco = tintaCheia ? superficieDaNota(tintaCheia, scheme, { surface: theme.backgroundElement, text: theme.text }).fundo : null;
// …
<View style={[styles.iconChip, { backgroundColor: destructive ? theme.dangerSoft : disco ?? theme.backgroundElement }]}>
  <Icon name={icon} size="md" color={destructive ? 'danger' : 'text'} tint={destructive ? undefined : tintaCheia ?? undefined} />
</View>
```

`color-picker.tsx`: o bloco `<View style={styles.grade}>…</View>` vira `GradeDeCores` (exportada) e `ColorPicker` passa a renderizá-la com `onPick={escolher}`.

- [ ] **Step 4: Ver passar + portão** — Run: `npx tsc --noEmit && npx expo lint && npm test` — Expected: PASS (os testes das notas seguem verdes).

- [ ] **Step 5: Commit** — `git commit -am "feat(categorias): linhas e ícones aceitam a cor de conteúdo da categoria"`

---

### Task 4: A tela Categorias e a folha de categoria

**Files:**
- Create: `src/components/finance/categoria-sheet.tsx`, `src/app/finance/categories.tsx`
- Modify: `src/app/_layout.tsx` (registrar `finance/categories`), `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `useCategoriesUsed`, `useSalvarCategoria`, `useApagarCategoria`, `ICONES_DE_CATEGORIA`, `aparenciaDaCategoria` (Task 2); `GradeDeCores`, `Row tinta` (Task 3); `Deslizavel` (`components/ui/deslizavel.tsx`), `confirmDestructive` (`lib/item-actions.ts`).
- Produces: `CategoriaSheet({ visible, categoria, onClose, onSalva }: { visible: boolean; categoria: Categoria | null /* null = nova */; onClose: () => void; onSalva: (nome: string) => void })`; a rota `/finance/categories`.

- [ ] **Step 1: Testes (falham)**

```ts
const categoriasFile = 'src/app/finance/categories.tsx';
const CATS = [
  { category: 'mercado', uses: 9, icon: 'cart', color: 'musgo', budgets: 1 },
  { category: 'roupa', uses: 2, icon: null, color: null, budgets: 0 },
  { category: 'roupas', uses: 1, icon: null, color: null, budgets: 1 },
];

test('Categorias: lista com o uso, cria pelo "+" e edita tocando', async () => {
  const ui = screen(categoriasFile, { categoriesUsed: CATS, segurarMutacoes: true });
  const linha = ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'mercado');
  assert.equal(linha.props.subtitle, '9 lançamentos');
  assert.equal(linha.props.tinta, 'musgo');
  ui.interact(() => linha.props.onPress());
  const folha = () => ui.nodes().find((n: any) => n.type === 'CategoriaSheet');
  assert.equal(folha().props.categoria.category, 'mercado');
});

test('Folha de categoria: renomear para um nome que existe pergunta antes de juntar', async () => {
  const ui = screen('src/components/finance/categoria-sheet.tsx', { componente: 'CategoriaSheet', categoriesUsed: CATS, segurarMutacoes: true,
    props: { visible: true, categoria: CATS[1], onClose: () => {}, onSalva: () => {} } });
  ui.fill('Nome', 'Roupas');
  ui.interact(() => ui.nodes().find((n: any) => n.props?.label === 'Salvar' || n.props?.actionLabel === 'Salvar').props.onPress?.() ?? ui.nodes().find((n: any) => n.type === 'TaskHeader').props.onAction());
  (ui.pedidos.at(-1) as any).rejeitar(Object.assign(new Error('CATEGORIA_EXISTE: roupas'), { code: 'CATEGORIA_EXISTE', existente: 'roupas' }));
  await new Promise((r) => setTimeout(r, 0));
  assert.match(ui.confirms.at(-1).title, /Juntar «roupa» com «roupas»\?/);
  assert.match(ui.confirms.at(-1).message, /orçamento/, 'avisa o orçamento que fica');
  ui.interact(() => ui.confirms.at(-1).onConfirm());
  assert.equal(ui.writes.at(-1).value.juntar, true);
});

test('Categorias: apagar diz quantos lançamentos e orçamentos', () => {
  const ui = screen(categoriasFile, { categoriesUsed: CATS });
  const d = ui.nodes().find((n: any) => n.type === 'Deslizavel' && n.props.titulo === 'mercado');
  ui.interact(() => d.props.acoes.find((a: any) => a.destructive).onPress());
  assert.match(ui.confirms.at(-1).message, /9 lançamentos ficam sem categoria e 1 orçamento sai/);
});
```

(Os nomes do harness — `categoriesUsed`, `confirms`, `pedidos.rejeitar`, `TaskHeader.onAction` — são os que ele já expõe; onde o nome local for outro, usar o local e anotar no ledger.)

- [ ] **Step 2: Ver falhar** — Run: `node --test --test-name-pattern="Categorias:|Folha de categoria" src/lib/simple-finance-ui.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar**

`categoria-sheet.tsx`: `Sheet` + `TaskHeader` ("Nova categoria"/"Editar categoria", ação "Salvar", desligada sem nome) + `SheetScroll` com: `TextField` "Nome" (`autoFocus` na criação, `autoCapitalize="none"`); "Ícone" — grade de `ICONES_DE_CATEGORIA` (`Pressable` 48×48, disco `backgroundElement`, a escolhida com borda `text` e `accessibilityState={{ selected }}`, `accessibilityLabel` = nome do ícone em português de uma tabela local de 30 rótulos); "Cor" — `GradeDeCores`. O salvar:

```ts
const salvar = (juntar = false) =>
  salvarCategoria.mutateAsync({ name: nome.trim().toLowerCase(), icon, color: cor, renomearDe: categoria?.category, juntar }).then(
    () => { onSalva(nome.trim().toLowerCase()); onClose(); },
    (e) => {
      if (e?.code === 'CATEGORIA_EXISTE') {
        const alvo = e.existente as string;
        const temOrcamento = (categoria?.budgets ?? 0) > 0 && (usadas.find((c) => c.category === alvo)?.budgets ?? 0) > 0;
        confirmDestructive(
          `Juntar «${categoria?.category ?? nome}» com «${alvo}»?`,
          'Juntar',
          () => void salvar(true),
          `Tudo que está em «${categoria?.category ?? nome}» passa para «${alvo}».${temOrcamento ? ' No mês em que as duas têm orçamento, fica o de «' + alvo + '».' : ''}`,
        );
      } else toast({ message: financeErrorMessage(e, 'Não deu para salvar a categoria.'), tone: 'error' });
    });
```

Criando com um nome que já existe (sem `renomearDe`): o `save_category` só atualiza a aparência dela — a folha diz "Essa categoria já existe" no `hint` do campo enquanto o nome dobrado casar com uma da lista.

`categories.tsx`: `Screen grouped` com `onRefresh`, `useTelaPronta(categorias)`, `ErrorCard` no erro, `EmptyState` sem nenhuma; `Stack.Screen` com o "+" do header (`HeaderActions`, o mesmo das outras listas) abrindo `CategoriaSheet` com `categoria=null`. Cada linha: `Deslizavel titulo={c.category} acoes={[{ label: 'Apagar', destructive: true, onPress }]}` envolvendo `<Row icon tinta title subtitle={`${c.uses} ${c.uses === 1 ? 'lançamento' : 'lançamentos'}`} onPress={editar} />` — a ordem é a do `categories_used` (mais usada primeiro), e a lista desenha 20 por vez com `useAosPoucos` + `VerMais`. Apagar:

```ts
confirmDestructive(`Apagar «${c.category}»?`, 'Apagar', () => void apagar.mutateAsync(c.category),
  `${c.uses} ${c.uses === 1 ? 'lançamento fica' : 'lançamentos ficam'} sem categoria${c.budgets ? ` e ${c.budgets} ${c.budgets === 1 ? 'orçamento sai' : 'orçamentos saem'}` : ''}.`);
```

Registrar `<Stack.Screen name="finance/categories" options={{ title: 'Categorias' }} />` junto das outras telas de Finanças.

- [ ] **Step 4: Ver passar + portão** — Run: `npx tsc --noEmit && npx expo lint && npm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/components/finance/categoria-sheet.tsx src/app/finance/categories.tsx src/app/_layout.tsx src/lib/simple-finance-ui.test.ts && git commit -m "feat(categorias): tela Categorias para criar, personalizar, renomear, juntar e apagar"`

---

### Task 5: O seletor — chips com cor, "+ Nova" e "Gerenciar categorias"

**Files:**
- Modify: `src/components/finance/category-picker.tsx`, `src/app/finance/[txId].tsx` (a folha "Mudar categoria" usa o `CategoryPicker` em vez da lista de `SUGGESTED_CATEGORIES`)
- Test: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `CategoriaSheet` (Task 4), `useAparencia` (Task 2).
- Produces: `CategoryPicker` com a MESMA assinatura (`{ value, onChange }`) — nenhum dos seis usos muda.

- [ ] **Step 1: Teste (falha)**

```ts
test('Seletor de categoria: chips com ícone e cor, "+ Nova" cria e já escolhe, "Gerenciar categorias" leva à tela', () => {
  const escolhidas: (string | null)[] = [];
  const ui = screen('src/components/finance/category-picker.tsx', { componente: 'CategoryPicker', categoriesUsed: CATS,
    props: { value: null, onChange: (c: string | null) => escolhidas.push(c) } });
  const chip = ui.nodes().find((n: any) => n.type === 'Chip' && n.props.label === 'mercado');
  assert.equal(chip.props.icon, 'cart');
  assert.equal(chip.props.tinta, 'musgo');
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Chip' && n.props.label === 'Nova').props.onPress());
  const folha = ui.nodes().find((n: any) => n.type === 'CategoriaSheet');
  assert.equal(folha.props.categoria, null);
  ui.interact(() => folha.props.onSalva('viagem'));
  assert.deepEqual(escolhidas, ['viagem']);
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Chip' && n.props.label === 'Todas…').props.onPress());
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Gerenciar categorias').props.onPress());
  assert.equal(ui.navigations.at(-1).pathname ?? ui.navigations.at(-1), '/finance/categories');
});
```

- [ ] **Step 2: Ver falhar** — Run: `node --test --test-name-pattern="Seletor de categoria" src/lib/simple-finance-ui.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar** — no `CategoryPicker`: cada chip ganha `icon` e `tinta` de `useAparencia()(nome)` (o `Chip` recebe `tinta?: NoteColorName | null` pelo mesmo caminho da Task 3: selecionado mantém o preenchimento de hoje; não selecionado usa o disco da tinta no ícone); depois dos 5, o chip "Nova" (`icon="plus"`) abre `CategoriaSheet` com `categoria={null}` e `onSalva={(n) => onChange(n)}`; na folha "Todas…", depois da lista, `<Row icon="slider.horizontal.3" title="Gerenciar categorias" onPress={() => { fechar(); router.push('/finance/categories'); }} />`. Em `[txId].tsx`, a folha "Mudar categoria" passa a desenhar `<CategoryPicker value={tx.category} onChange={mudarCategoria} />` no lugar do `map` de `SUGGESTED_CATEGORIES` (as categorias do usuário não apareciam ali).

- [ ] **Step 4: Ver passar + portão** — Run: `npx tsc --noEmit && npx expo lint && npm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(categorias): seletor com cor, + Nova e Gerenciar categorias"`

---

### Task 6: A cor onde a categoria aparece

**Files:**
- Modify: `src/app/(tabs)/finance/index.tsx:538`, `src/app/finance/transactions.tsx:995`, `src/components/finance/expected-ledger-lines.tsx:149`, `src/app/profile/alerts.tsx:180`, `src/app/finance/invoice/[id].tsx` (linhas da fatura), `src/app/finance/budgets.tsx` (cards), `src/components/finance/spending-donut.tsx`, `src/components/finance/donut-math.ts`, `src/components/finance/budget-rings.tsx`, e as linhas de lançamento da Hoje (`src/components/today/*`, onde houver linha de lançamento com categoria)
- Test: `src/lib/anti-slop.test.ts`, `src/components/finance/donut-math.test.ts` (ou o teste existente de `fatias`)

**Interfaces:**
- Consumes: `useAparencia` (Task 2), `Row/LedgerRow tinta` (Task 3), `noteInk`.
- Produces: `fatias(itens, cores?: (string | null)[])` — com cor, a fatia usa a cor; sem, o cinza por posição de hoje.

- [ ] **Step 1: Testes (falham)**

```ts
// donut-math.test.ts
test('a fatia com cor de categoria usa a cor; sem, o cinza por posição', () => {
  const f = fatias([{ valor: 60 }, { valor: 40 }] as any, ['#00639C', null]);
  assert.equal(f[0].cor, '#00639C');
  assert.equal(f[1].cor, undefined, 'cai no tom por posição');
});

// anti-slop.test.ts
test('Toda lista que desenha o ícone da categoria desenha a cor dela', () => {
  const arquivos = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => /\.tsx$/.test(f));
  const semCor = arquivos.filter((f) => {
    const t = readFileSync(join(SRC, f), 'utf8');
    return /categoryIcon\(/.test(t) && !/design\/category-icons/.test(f) && !f.endsWith('lib/categorias.ts');
  });
  assert.deepEqual(semCor, [], 'use useAparencia (ícone + cor), não categoryIcon direto');
});
```

- [ ] **Step 2: Ver falhar** — Run: `node --test src/components/finance/donut-math.test.ts src/lib/anti-slop.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar**
- Os quatro chamadores de `categoryIcon` trocam por `const aparencia = useAparencia();` e passam `icon={a.icon} tinta={a.cor}` (`const a = aparencia(tx.category, tx.kind)`); a fatura e as linhas de lançamento da Hoje ganham o mesmo ícone com tinta; os cards de `budgets.tsx` ganham o disco com a tinta ao lado do nome.
- `donut-math.ts`: `fatias(itens, cores = [])` — `cor: cores[i] ?? undefined` em cada fatia; `SpendingDonut` resolve `cores = itens.map((i) => { const c = aparencia(i.categoria).cor; return c ? noteInk(c, scheme) : null; })` e a legenda usa o mesmo valor no ponto.
- `budget-rings.tsx`: o anel no estado normal usa a tinta da categoria (`noteInk`) no lugar do tom de hoje; `warning`/`danger` continuam semânticos (estado vence decoração, design.md §2b).

- [ ] **Step 4: Ver passar + portão** — Run: `npx tsc --noEmit && npx expo lint && npm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(categorias): a cor da categoria nas listas, na rosca e nos orçamentos"`

---

### Task 7: Entradas, documentação e aparelho

**Files:**
- Modify: `src/app/(tabs)/finance/manage.tsx` (GROUPS, "Entrada de dados", ao lado de Regras), `src/app/(tabs)/profile/index.tsx` (seção "Dados"), o menu das Finanças (`(tabs)/finance/index.tsx`, o mesmo menu que tem Recorrentes/Dívidas), `.claude/rules/finance.md` (seção Categorias), `.claude/rules/design.md` (§2b: a cor da categoria é conteúdo), `docs/AGENTE-PARIDADE-COM-O-APP.md`
- Test: `src/lib/simple-finance-ui.test.ts`

- [ ] **Step 1: Teste (falha)**

```ts
test('Categorias se alcança pelo Gerenciar, pelo Perfil e pelo menu das Finanças', () => {
  for (const f of ['src/app/(tabs)/finance/manage.tsx', 'src/app/(tabs)/profile/index.tsx', 'src/app/(tabs)/finance/index.tsx']) {
    assert.match(readFileSync(f, 'utf8'), /'\/finance\/categories'/, f);
  }
});
```

- [ ] **Step 2: Ver falhar** — Run: `node --test --test-name-pattern="se alcança" src/lib/simple-finance-ui.test.ts` — Expected: FAIL.

- [ ] **Step 3: Entradas e docs** — `manage.tsx`: item `{ title: 'Categorias', icon: 'tag', href: '/finance/categories' }` no grupo de Regras; Perfil: `Row` "Categorias" em "Dados"; menu das Finanças: ação "Categorias" (`icon: 'tag'`). `finance.md` → *Categorias*: a tabela `categories` guarda a aparência, os registros o texto; renomear/juntar/apagar pelas três funções, e as sete colunas que elas reescrevem. `AGENTE-PARIDADE`: "Categorias (criar, personalizar, renomear, juntar, apagar): só no app; o agente grava o nome".

- [ ] **Step 4: Aparelho** — iPhone (padrão e `accessibility-large`) e Android (padrão e 384dp × 1,3), claro e escuro: criar pelo "+ Nova" num lançamento (fica escolhida), personalizar ícone e cor na tela Categorias, renomear, juntar duas (com orçamento nas duas), apagar uma; conferir a cor nas listas, na rosca de "Para onde foi" e nos anéis; a grade de ícones não corta com fonte grande. Anotar os nomes/ids criados no staging e apagar por eles no fim.

- [ ] **Step 5: Portão e commit** — Run: `npx tsc --noEmit && npx expo lint && npm test` — Expected: PASS. `git commit -am "feat(categorias): Categorias no Gerenciar, no Perfil e no menu das Finanças"`
