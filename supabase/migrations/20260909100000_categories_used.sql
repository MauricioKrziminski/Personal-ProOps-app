-- As categorias que o usuário REALMENTE usa.
--
-- O seletor do app oferecia as 13 sugestões de `src/lib/categories.ts` e mais nada. Em
-- produção existem 25 categorias distintas, e só 8 estão entre as sugeridas: "despesas
-- eventuais" (14 lançamentos), "roupa" (10), "eletrônicos" (10), "impostos", "presentes",
-- "estudo", "financiamento", "telefone" e outras nasceram pelo WhatsApp, onde categoria é
-- texto livre — e nenhuma delas dava para escolher no app. A tela mostrava treze opções
-- que ele não usa e escondia as que usa.
--
-- Fica só o wrapper `security invoker`: quem chama é o app, sob RLS. O par interna/wrapper
-- de `supabase.md` existe para o que o AGENTE também consulta, e o agente não precisa desta
-- lista (o prompt já carrega as sugestões e categoria é texto livre lá).

create or replace function public.categories_used()
returns table (category text, uses bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select t.category, count(*)::bigint as uses
    from public.transactions t
   where t.workspace_id in (select private.my_workspace_ids())
     and t.category is not null
     and t.category <> ''
   group by t.category
   order by count(*) desc, t.category;
$$;

-- `from public`, não só `from anon`: o Postgres concede EXECUTE a PUBLIC na criação, e revogar
-- de `anon` não tira a herança — ele continuaria podendo chamar. Padrão da `0010_workspaces.sql`.
revoke execute on function public.categories_used() from public, anon;
grant execute on function public.categories_used() to authenticated;
