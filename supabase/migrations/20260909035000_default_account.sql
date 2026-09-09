-- A conta padrão do workspace.
--
-- Lançamento vindo do WhatsApp quase nunca cita a conta ("gastei 45 no mercado"), e
-- `resolve_account` devolve null de propósito: perder o registro do gasto é pior que registrá-lo
-- sem conta. O preço aparece na hora de perguntar PARA ONDE o dinheiro foi — hoje, em produção,
-- 100% dos lançamentos estão sem conta, e o corte por meio de pagamento nasceria com um balde só.
--
-- A conta padrão resolve isso sem custo de conversa: quem não disser a conta cai nela, e o
-- caminho de valor alto já para em confirmação, onde a pessoa lê a conta e corrige se for outra.
--
-- Mora no WORKSPACE e não no `profiles` porque a conta é do workspace: dois membros do mesmo
-- espaço lançam nas mesmas contas. `on delete set null` porque apagar a conta não pode derrubar
-- o workspace.
alter table public.workspaces
  add column if not exists default_account_id uuid references public.accounts(id) on delete set null;

comment on column public.workspaces.default_account_id is
  'Conta onde cai o lançamento que não cita conta nenhuma. Null = continua sem conta.';

-- A conta padrão tem que ser do PRÓPRIO workspace e guardar dinheiro. Um cartão de crédito como
-- padrão faria toda compra do WhatsApp virar dívida de fatura, em silêncio.
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
  return new;
end;
$$;

drop trigger if exists workspaces_default_account on public.workspaces;
create trigger workspaces_default_account
  before insert or update of default_account_id on public.workspaces
  for each row execute function public.tg_workspaces_default_account();
