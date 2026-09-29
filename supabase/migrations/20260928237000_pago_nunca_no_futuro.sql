-- Nada foi pago num dia que ainda não chegou (28/09/2026).
--
-- Achado pela diferença de R$ 250,00 entre a Projeção e o detalhe do ciclo no staging: o "Fone"
-- tinha data 24/12 e `paid_at` 01/12, os dois no futuro. O saldo (e a Projeção, que parte dele)
-- conta tudo o que está `cleared`, então hoje já tinha R$ 250 a menos; o ciclo põe o realizado no
-- dia do PAGAMENTO, então setembro não tinha essa saída. As duas leituras estavam certas pela
-- régua delas — o estado é que não existe na vida real.
--
-- O conserto é na fonte, no gatilho por onde passa toda escrita (`set_paid_at`, `0046`): o dia do
-- pagamento nunca passa de HOJE **no que mexe no caixa** — conta corrente, dinheiro, poupança,
-- investimento e o lançamento sem conta. A linha de CARTÃO fica de fora de propósito: nela o
-- `paid_at` não é dinheiro saindo, é a marca de que a fatura se liquidou (paga, adiada), e as
-- regras que desfazem isso casam por ela (`linhas_da_fatura_liquidada` pelo vencimento,
-- `unsettle_invoice` pelo dia da quitação) — uma fatura adiada antes de vencer tem as linhas
-- "pagas" no vencimento dela, no futuro, e está certo. O dinheiro da fatura sai pela
-- TRANSFERÊNCIA do pagamento, que é da conta corrente e cai nesta régua. Sem data informada continua sendo o dia do lançamento, só que
-- limitado a hoje — "paguei" um lançamento futuro é pagar AGORA, adiantado. Data futura informada
-- (na folha do "Paguei", no pagamento da fatura) vira hoje, sem erro: é o que "já paguei" quer
-- dizer (frontend.md, "automático em vez de erro").
--
-- O "hoje" é o do Brasil, não o do UTC do banco (finance.md, "O hoje do banco não é o hoje do
-- usuário"): das 21h à meia-noite o `current_date` do servidor já é amanhã.
create or replace function private.set_paid_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  hoje constant date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if new.status = 'cleared' then
    -- sem data explícita, o dinheiro saiu quando a despesa aconteceu
    new.paid_at := coalesce(new.paid_at, new.occurred_at);
    -- …e nunca depois de hoje, no que é dinheiro (o cartão fica de fora — ver o cabeçalho)
    if new.paid_at > hoje and not exists (
      select 1 from public.accounts a where a.id = new.account_id and a.type = 'credit_card'
    ) then
      new.paid_at := hoje;
    end if;
  elsif new.status = 'pending' then
    -- voltar para previsto apaga a data: lançamento que ainda vai acontecer não
    -- tem quando o dinheiro saiu
    new.paid_at := null;
  end if;
  return new;
end;
$$;

-- O que já está assim (no staging, um lançamento; em produção, nenhum em 28/09/2026): o gatilho
-- acima traz o pagamento para hoje.
update public.transactions t
   set paid_at = (now() at time zone 'America/Sao_Paulo')::date
 where t.status = 'cleared'
   and t.paid_at > (now() at time zone 'America/Sao_Paulo')::date
   and not exists (select 1 from public.accounts a where a.id = t.account_id and a.type = 'credit_card');
