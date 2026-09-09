-- Apagar uma série recorrente leva junto as ocorrências FUTURAS que ela gerou.
--
-- A FK `transactions.recurring_id` é `on delete set null`, então até hoje apagar a série
-- deixava para trás toda ocorrência já materializada — inclusive as dos próximos 90 dias,
-- que continuavam pesando na projeção de caixa como se a conta ainda existisse. A tela
-- avisava ("Para tirá-los, apague em Lançamentos"), o que é pedir ao usuário que limpe
-- na mão o que o app sujou.
--
-- Foi assim que nasceu o salário fantasma: a série única de R$ 2.632,00 foi apagada quando
-- o salário virou dois pagamentos (dia 5 e dia 20), e as três ocorrências de out/nov/dez
-- ficaram no banco sem dono, somando um terceiro salário que nunca existiu.
--
-- A regra é a MESMA de `update_transaction_scoped`: futuro = ainda `pending` E daqui para
-- a frente. Ocorrência passada é histórico (e ocorrência atrasada é uma conta que a pessoa
-- ainda deve) — nenhuma das duas some porque a série parou de existir.

create or replace function private.recurring_drop_future()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.transactions
   where recurring_id = old.id
     and status = 'pending'
     and occurred_at >= current_date;
  return old;
end;
$$;

revoke execute on function private.recurring_drop_future() from public, anon, authenticated;

drop trigger if exists recurring_drop_future on public.recurring_transactions;
create trigger recurring_drop_future
  before delete on public.recurring_transactions
  for each row execute function private.recurring_drop_future();

-- Entulho já existente: mesma regra, aplicada uma vez. `source='recurring'` só é escrito
-- pelo materializador (`agent/app/jobs/scheduler.py`), que sempre grava `recurring_id`
-- junto — a linha sem série é órfã por construção, não um lançamento que alguém digitou.
delete from public.transactions
 where source = 'recurring'
   and recurring_id is null
   and status = 'pending'
   and occurred_at >= current_date;
