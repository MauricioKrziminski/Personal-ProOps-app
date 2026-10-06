-- claim_thread_batch passa a recuperar a linha presa em `processing`.
--
-- O claim só olhava `pending`, e o /worker/sweep já acha a thread cujo
-- `processing` tem mais de 5 minutos: chamava o worker, o claim ignorava a linha
-- e o sweep devolvia `claimed: 0`. A única volta para `pending` era o
-- `mark_retry` do `except Exception` do worker — cancelamento, OOM, redeploy e o
-- timeout de 300 s do Cloud Run não passam por ele, e a mensagem sumia sem
-- resposta e sem alerta.
--
-- A recuperação é uma retentativa como outra qualquer: soma `retry_count`, tem o
-- mesmo teto de 3 (estourou, vira `failed` com o motivo) e, voltando a `pending`
-- com `retry_count > 0`, cai na regra existente de que retentativa não se mistura
-- com mensagem nova. Corpo copiado da 0040; só o bloco "recupera" é novo.

-- Quem estoura o teto DENTRO do claim não passa pelo `except` do worker, que era o único lugar
-- que avisava a pessoa ("Não consegui processar…"). O aviso agora sai de UMA consulta que o
-- worker faz depois de todo claim, e a coluna garante que ele sai uma vez só por mensagem. As
-- falhas antigas nascem avisadas: sem isso, o primeiro turno depois do deploy mandaria um aviso
-- por cada falha do histórico.
alter table public.messages_queue add column if not exists failed_notified_at timestamptz;
update public.messages_queue
set failed_notified_at = coalesce(processed_at, claimed_at, created_at)
where status = 'failed' and failed_notified_at is null;

create or replace function public.claim_thread_batch(p_thread_id text)
returns setof public.messages_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_ocupada boolean;
  v_tem_retry boolean;
begin
  -- Serializa a reivindicação em si. NÃO serializa a execução do grafo: este
  -- lock é transacional e a transação acaba junto com o UPDATE, muito antes do
  -- Gemini responder. Quem impede duas execuções simultâneas na MESMA conversa
  -- é o teste de "processing recente" logo abaixo.
  if not pg_try_advisory_xact_lock(hashtext(p_thread_id)) then
    return;
  end if;

  -- Um worker por conversa. Sem isto, uma segunda task de debounce chegando
  -- enquanto o grafo ainda fala com o Gemini reivindicaria a mesma thread: dois
  -- escritores no mesmo checkpoint e resposta fora de ordem
  -- ("gastei 45" e "apaga o último" invertidos).
  -- Passados 5 minutos consideramos o worker morto e a thread volta a ser livre.
  select exists (
    select 1 from public.messages_queue
    where thread_id = p_thread_id
      and status = 'processing'
      and claimed_at > now() - interval '5 minutes'
  ) into v_ocupada;
  if v_ocupada then
    return;  -- o /worker/sweep pega o resto em no máximo um minuto
  end if;

  -- Recupera o que o worker morto deixou: `processing` com mais de 5 minutos
  -- (nenhum recente, senão a conversa estaria ocupada e já teríamos saído). É
  -- uma tentativa gasta — a execução pode ter chegado a escrever, e é a
  -- idempotência por (wa_message_id, action_index) que impede duplicar. No teto,
  -- `failed`: o mesmo desfecho do mark_retry, para não reprocessar para sempre.
  update public.messages_queue
  set status = case when retry_count + 1 >= 3 then 'failed' else 'pending' end,
      retry_count = retry_count + 1,
      last_error = 'worker não terminou o turno em 5 minutos (processing preso)',
      claimed_at = null
  where thread_id = p_thread_id
    and status = 'processing'
    and claimed_at < now() - interval '5 minutes';

  -- A idempotência de execução é chaveada no wa_message_id da ÚLTIMA mensagem do
  -- lote. Se uma retentativa juntasse mensagens NOVAS ao lote antigo, a chave
  -- mudaria e as ações já executadas rodariam de novo. Por isso: havendo
  -- retentativa pendente, o lote é só ela — as mensagens novas esperam o próximo
  -- ciclo e viram um lote próprio.
  select exists (
    select 1 from public.messages_queue
    where thread_id = p_thread_id and status = 'pending' and retry_count > 0
  ) into v_tem_retry;

  return query
  update public.messages_queue q
  set status = 'processing',
      claimed_at = now(),
      batch_id = v_batch
  where q.id in (
    select id
    from public.messages_queue
    where thread_id = p_thread_id
      and status = 'pending'
      and retry_count < 3
      and (not v_tem_retry or retry_count > 0)
    order by created_at
  )
  returning q.*;
end;
$$;

revoke execute on function public.claim_thread_batch(text) from public, anon, authenticated;
