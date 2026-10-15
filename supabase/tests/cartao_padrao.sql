-- Cartão padrão: só cartão ativo do próprio espaço; a regra da conta padrão não muda.
\set ON_ERROR_STOP on
begin;

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000c101';
  w uuid := '00000000-0000-0000-0000-00000000c102';
  u2 uuid := '00000000-0000-0000-0000-00000000c103';
  w2 uuid := '00000000-0000-0000-0000-00000000c104';
  chk uuid := '00000000-0000-0000-0000-00000000c105';
  card uuid := '00000000-0000-0000-0000-00000000c106';
  card_old uuid := '00000000-0000-0000-0000-00000000c107';
  card_other uuid := '00000000-0000-0000-0000-00000000c108';
  falhou boolean;
begin
  insert into auth.users (id, email) values
    (u, 'cartao-padrao@example.invalid'), (u2, 'cartao-padrao-2@example.invalid');
  insert into public.profiles (id) values (u), (u2) on conflict do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'cp'), (w2, u2, 'cp2');
  insert into public.workspace_members (workspace_id, user_id, role)
    values (w, u, 'owner'), (w2, u2, 'owner');
  insert into public.accounts (id, user_id, workspace_id, name, type) values
    (chk, u, w, 'Corrente', 'checking');
  insert into public.accounts (id, user_id, workspace_id, name, type, closing_day, due_day) values
    (card, u, w, 'Cartao', 'credit_card', 3, 10),
    (card_old, u, w, 'Cartao velho', 'credit_card', 3, 10),
    (card_other, u2, w2, 'Cartao alheio', 'credit_card', 3, 10);
  update public.accounts set archived = true where id = card_old;

  update public.workspaces set default_card_id = card where id = w;

  falhou := false;
  begin update public.workspaces set default_card_id = chk where id = w;
  exception when others then falhou := true; end;
  assert falhou, 'conta corrente não pode ser cartão padrão';

  falhou := false;
  begin update public.workspaces set default_card_id = card_other where id = w;
  exception when others then falhou := true; end;
  assert falhou, 'cartão de outro espaço não pode ser padrão';

  falhou := false;
  begin update public.workspaces set default_card_id = card_old where id = w;
  exception when others then falhou := true; end;
  assert falhou, 'cartão arquivado não pode ser padrão';

  update public.workspaces set default_account_id = chk where id = w;
  falhou := false;
  begin update public.workspaces set default_account_id = card where id = w;
  exception when others then falhou := true; end;
  assert falhou, 'cartão continua recusado como conta padrão';

  delete from public.accounts where id = card;
  assert (select default_card_id from public.workspaces where id = w) is null,
    'apagar o cartão zera default_card_id';
end $$;

select 'cartao_padrao: ok' as resultado;
rollback;
