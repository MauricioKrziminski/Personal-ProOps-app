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
  -- `workspace_id` não é redundante: a FK amarra à série, mas quem garante que a ocorrência
  -- nasce no workspace DELA são os escritores (`scheduler.py`), não o banco. Função `definer`
  -- não confia em convenção de chamador — é a mesma correção da `20260909071000`.
  delete from public.transactions
   where recurring_id = old.id
     and workspace_id = old.workspace_id
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

-- ⚠️ Teto conhecido, herdado e NÃO fechado aqui: se uma dessas ocorrências estiver numa fatura
-- com pagamento PARCIAL (`paid_cents > 0`), removê-la derruba a soma da fatura abaixo do que já
-- foi pago e `pay_invoice` passa a recusar ("fatura sem lançamentos"). `useDeleteTransaction` já
-- produz o mesmo estado hoje para qualquer linha — a correção de raiz é um guard no delete de
-- `transactions`, não aqui, e filtrar por fatura paga neste ponto só recriaria a órfã.
-- ponytail: teto aceito; fechar junto com o guard geral de delete se aparecer em campo.

-- Cópia do que vai sair, antes de sair. São linhas de DINHEIRO e não há undo — e a tela ANTIGA
-- prometia que as ocorrências sobreviviam à exclusão da série, então alguém pode ter deixado uma
-- de propósito, como conta avulsa.
create table if not exists private.recurring_orphans_20260909 as
select * from public.transactions
 where source = 'recurring'
   and recurring_id is null
   and status = 'pending'
   and occurred_at >= current_date;

alter table private.recurring_orphans_20260909 enable row level security;

-- Entulho já existente: mesma regra, aplicada uma vez. `source='recurring'` só é escrito
-- pelo materializador (`agent/app/jobs/scheduler.py`), que sempre grava `recurring_id`
-- junto — a linha sem série é órfã por construção, não um lançamento que alguém digitou.
delete from public.transactions
 where source = 'recurring'
   and recurring_id is null
   and status = 'pending'
   and occurred_at >= current_date;
