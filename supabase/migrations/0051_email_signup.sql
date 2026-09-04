-- Conta por e-mail e senha: o telefone deixa de ser obrigatório.
--
-- Até aqui a única porta era o Phone OTP, e `profiles.phone` era `not null`. Com cadastro por
-- e-mail, `new.phone` chega NULO no trigger — e o `coalesce(new.phone, '')` da 0029 gravava ''.
-- O PRIMEIRO cadastro por e-mail passava; o SEGUNDO colidia no `unique (phone)` com 23505 e o
-- signup falhava. Tudo desta migration existe junto porque um pedaço sem o outro quebra.
--
-- `unique` aceita vários NULL no Postgres, então tirar o `not null` basta — sem índice parcial.
-- Quem não tem telefone simplesmente não é alcançável pelo WhatsApp (`agent/app/db.py` procura
-- por `profiles.phone = any(...)`; `reminders.py` e `alerts.py` já pulam telefone vazio).

alter table public.profiles alter column phone drop not null;

-- O contrato passa a ser "sem telefone = NULL". A linha que a 0029 gravou com '' (o único
-- cadastro por e-mail que passou) entra no contrato novo aqui, senão `accept_pending_invites`
-- (0029:163) a trataria como telefone válido.
update public.profiles set phone = null where phone = '';

comment on column public.profiles.display_name is
  'Nome de exibição. Nulo para quem entrou por Phone OTP e nunca preencheu; nunca string vazia.';

-- Nunca ''. A Fase 1 (Perfil) já gravava null para campo vazio; a partir daqui o TRIGGER também
-- escreve, com metadata que pode vir vazia — a trava tem que estar no banco, não em cada escritor.
-- Teto de 80: a partir daqui `display_name` chega da metadata do signup, escrita por `anon`.
update public.profiles set display_name = null where btrim(display_name) = '';
do $$
begin
  alter table public.profiles
    add constraint profiles_display_name_nao_vazio
    check (display_name is null or (btrim(display_name) <> '' and length(display_name) <= 80));
exception when duplicate_object then null;
end $$;

-- Corpo copiado da 0029 (a definição vigente), com DUAS mudanças:
--   1. `telefone := new.phone` — sem o coalesce para ''.
--   2. o insert em profiles leva `display_name` da metadata do signup (`options.data`).
-- O casamento de convites (`where i.phone = telefone`) vira no-op com NULL, que é o certo:
-- convite é por telefone, e quem não informou telefone não tem convite para aceitar ainda.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ws_id uuid;
  telefone text;
begin
  telefone := new.phone;

  insert into public.profiles (id, phone, display_name)
  values (new.id, telefone, nullif(btrim(new.raw_user_meta_data->>'display_name'), ''))
  on conflict (id) do nothing;

  select w.id into ws_id from public.workspaces w where w.owner_id = new.id
  order by w.created_at limit 1;

  if ws_id is null then
    insert into public.workspaces (name, owner_id) values ('Pessoal', new.id)
    returning id into ws_id;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.subscriptions (workspace_id)
  values (ws_id)
  on conflict (workspace_id) do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  select i.workspace_id, new.id, i.role
  from public.workspace_invites i
  where i.phone = telefone and i.status = 'pending'
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invites
  set status = 'accepted', accepted_at = now()
  where phone = telefone and status = 'pending';

  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
