-- A trava do adiantamento (20261010130000) segurava em silêncio TUDO que mudasse, e duas coisas
-- não podem ser seguradas assim:
--   1. a conta apagada: a FK `on delete set null` escreve null e a trava devolvia a conta velha,
--      então apagar uma conta com adiantamento falhava por FK. O null passa.
--   2. a ESTRUTURA (tipo, compra, série, dívida): `convert_transaction_to_installments` sobre o
--      lançamento de um adiantamento de dívida ou série criava o plano com as parcelas 2..N e a
--      1ª ficava de fora — um plano órfão, sem erro. Mudar a estrutura agora é recusa com caminho.
-- O resto do corpo é o da 20261010130000.
create or replace function private.adiantamento_fica()
returns trigger language plpgsql set search_path = '' as $$
declare
  liberado text := coalesce(current_setting('proops.editando_adiantamento', true), '');
begin
  if liberado = '*' or liberado = new.id::text then return new; end if;
  if tg_op = 'INSERT' then
    if new.adiantamento is not null then
      raise exception using errcode = '42501', message = 'O adiantamento só nasce pelo "Aplicar" do E se…';
    end if;
    return new;
  end if;
  if old.adiantamento is null then
    if new.adiantamento is not null then
      raise exception using errcode = '42501', message = 'O adiantamento só nasce pelo "Aplicar" do E se…';
    end if;
    return new;
  end if;
  if new.kind is distinct from old.kind
     or new.installment_plan_id is distinct from old.installment_plan_id
     or new.recurring_id is distinct from old.recurring_id
     or new.debt_id is distinct from old.debt_id then
    raise exception using errcode = 'P0001',
      message = 'Esse lançamento é um adiantamento de parcelas: para mudar o tipo dele, apague o adiantamento (as parcelas voltam) e lance de novo';
  end if;
  new.adiantamento := old.adiantamento;
  new.amount_cents := old.amount_cents;
  new.expected_amount_cents := old.expected_amount_cents;
  new.occurred_at := old.occurred_at;
  new.due_at := old.due_at;
  if new.account_id is not null then new.account_id := old.account_id; end if;
  new.description := old.description;
  new.installment_no := old.installment_no;
  return new;
end $$;
revoke execute on function private.adiantamento_fica() from public, anon, authenticated;
