-- Cartão padrão do espaço: o cartão que o formulário sugere quando a forma de pagamento é crédito.
alter table public.workspaces
  add column if not exists default_card_id uuid references public.accounts(id) on delete set null;

comment on column public.workspaces.default_card_id is
  'Cartão de crédito sugerido ao lançar no crédito. Null = nenhum.';

-- Mantém a regra de default_account_id (20260909035000) e acrescenta a do cartão.
create or replace function public.tg_workspaces_default_account()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.default_account_id is not null and not exists (
    select 1 from public.accounts a
    where a.id = new.default_account_id
      and a.workspace_id = new.id
      and a.type <> 'credit_card'
      and not a.archived
  ) then
    raise exception 'A conta padrão precisa ser uma conta ativa deste espaço que guarde dinheiro';
  end if;
  if new.default_card_id is not null and not exists (
    select 1 from public.accounts a
    where a.id = new.default_card_id
      and a.workspace_id = new.id
      and a.type = 'credit_card'
      and not a.archived
  ) then
    raise exception 'O cartão padrão precisa ser um cartão de crédito ativo deste espaço';
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_default_account on public.workspaces;
create trigger workspaces_default_account
  before insert or update of default_account_id, default_card_id on public.workspaces
  for each row execute function public.tg_workspaces_default_account();
