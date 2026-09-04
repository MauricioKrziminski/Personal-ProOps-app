-- Fase 4: vincular ou trocar o telefone de uma conta já autenticada.
--
-- O Auth só muda `auth.users.phone` DEPOIS do OTP `phone_change`. Este arquivo usa esse instante
-- confirmado como fonte da verdade para:
--   1. sincronizar `profiles.phone`;
--   2. marcar o WhatsApp como verificado;
--   3. invalidar toda a conversa ligada ao número anterior.
--
-- Há ainda uma trava para um defeito documentado do GoTrue: `verifyOtp(phone_change)` procura o
-- usuário pelo valor de `phone_change`, coluna que não é unique. Duas tentativas pendentes iguais
-- poderiam confirmar a conta errada. O advisory lock serializa o alvo e uma tentativa fresca
-- bloqueia a outra; depois de uma hora, a tentativa abandonada é limpa.

-- A UI desta fase ainda não existia antes desta migration. Portanto, qualquer phone_change já
-- gravado veio de teste/manual e não tem um fluxo ativo que possamos retomar. Invalidá-lo uma vez
-- evita levar uma ambiguidade antiga para a nova trava; basta pedir um código novo.
update auth.users
set phone_change = '', phone_change_token = '', phone_change_sent_at = null
where coalesce(phone_change, '') <> '';

create or replace function public.guard_auth_phone_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conflito uuid;
begin
  if nullif(new.phone_change, '') is null
     or new.phone_change is not distinct from old.phone_change then
    return new;
  end if;

  -- O lock vive até o commit. Duas requisições concorrentes para o mesmo número não conseguem
  -- passar pelo SELECT ao mesmo tempo, mesmo sem alterar o schema interno do Auth com um índice.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.phone_change, 0)
  );

  -- O OTP de telefone expira em até uma hora no contrato usado pelo projeto. Limpar também a
  -- tentativa sem timestamp é mais seguro que deixá-la reservando um número para sempre.
  update auth.users
  set phone_change = '', phone_change_token = '', phone_change_sent_at = null
  where id <> new.id
    and phone_change = new.phone_change
    and (phone_change_sent_at is null
         or phone_change_sent_at < pg_catalog.now() - interval '1 hour');

  select u.id into conflito
  from auth.users u
  where u.id <> new.id and u.phone_change = new.phone_change
  limit 1;

  if conflito is not null then
    raise exception using
      errcode = '23505',
      message = 'phone change already pending for another user',
      constraint = 'auth_users_phone_change_pending_key';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_auth_phone_change() from public, anon, authenticated;

drop trigger if exists before_auth_phone_change_guard on auth.users;
create trigger before_auth_phone_change_guard
before update of phone_change on auth.users
for each row execute function public.guard_auth_phone_change();

-- Mesma canonicalização usada pelo agente Python: o WhatsApp pode entregar um celular BR sem o
-- nono dígito. A função fica no schema privado porque é detalhe interno de identidade.
create or replace function private.canonical_whatsapp_phone(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with normalized as (
    select pg_catalog.regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits
  )
  select case
    when digits ~ '^55[0-9]{10}$'
      then pg_catalog.substr(digits, 1, 4) || '9' || pg_catalog.substr(digits, 5)
    else digits
  end
  from normalized;
$$;

revoke execute on function private.canonical_whatsapp_phone(text)
from public, anon, authenticated;

create or replace function public.handle_auth_phone_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  telefone_anterior text;
  telefone_novo text := nullif(new.phone, '');
  sessao record;
  tabela text;
begin
  if tg_op = 'UPDATE' then
    if new.phone is not distinct from old.phone then
      return new;
    end if;
    telefone_anterior := nullif(old.phone, '');
  elsif telefone_novo is null then
    return new;
  end if;

  update public.profiles
  set phone = telefone_novo,
      whatsapp_verified = (telefone_novo is not null)
  where id = new.id;

  -- Inclui três origens: sessão já anexada ao user_id, número anterior e número novo. A última
  -- remove uma sessão órfã criada quando a pessoa escreveu antes de terminar a vinculação e
  -- impede que um telefone reciclado herde o checkpoint do dono anterior.
  for sessao in
    select s.thread_id
    from public.user_sessions s
    where s.user_id = new.id
       or (
         telefone_anterior is not null
         and private.canonical_whatsapp_phone(s.phone)
             = private.canonical_whatsapp_phone(telefone_anterior)
       )
       or (
         telefone_novo is not null
         and private.canonical_whatsapp_phone(s.phone)
             = private.canonical_whatsapp_phone(telefone_novo)
       )
  loop
    -- Uma mensagem ainda não processada não pode acordar a conversa que acabamos de aposentar.
    delete from public.messages_queue
    where thread_id = sessao.thread_id and status in ('pending', 'processing');

    -- As tabelas são criadas no startup do agente. `to_regclass` mantém signup e testes válidos
    -- antes desse primeiro startup. Todos os epochs compartilham `hash:` como prefixo.
    foreach tabela in array array['checkpoints', 'checkpoint_blobs', 'checkpoint_writes']
    loop
      if pg_catalog.to_regclass('langgraph.' || tabela) is not null then
        execute pg_catalog.format(
          'delete from langgraph.%I where thread_id = $1 or '
          'pg_catalog.left(thread_id, pg_catalog.length($1) + 1) = $1 || '':''',
          tabela
        ) using sessao.thread_id;
      end if;
    end loop;
  end loop;

  -- `pending_actions` e `draft_actions` têm FK com ON DELETE CASCADE para esta linha.
  delete from public.user_sessions s
  where s.user_id = new.id
     or (
       telefone_anterior is not null
       and private.canonical_whatsapp_phone(s.phone)
           = private.canonical_whatsapp_phone(telefone_anterior)
     )
     or (
       telefone_novo is not null
       and private.canonical_whatsapp_phone(s.phone)
           = private.canonical_whatsapp_phone(telefone_novo)
     );

  return new;
end;
$$;

revoke execute on function public.handle_auth_phone_link() from public, anon, authenticated;

drop trigger if exists on_auth_user_phone_synced on auth.users;
-- `on_auth_user_created` roda antes por ordem alfabética e cria o profile no INSERT.
create trigger on_auth_user_phone_synced
after insert or update of phone on auth.users
for each row execute function public.handle_auth_phone_link();

-- Contas de telefone anteriores à Fase 4 já eram verificadas pelo OTP, mas a coluna histórica
-- nunca era atualizada. O backfill alinha o espelho ao Auth sem inventar telefone para e-mail.
update public.profiles p
set phone = nullif(u.phone, ''),
    whatsapp_verified = (nullif(u.phone, '') is not null)
from auth.users u
where u.id = p.id
  and (p.phone is distinct from nullif(u.phone, '')
       or p.whatsapp_verified is distinct from (nullif(u.phone, '') is not null));

comment on column public.profiles.whatsapp_verified is
  'True somente quando auth.users.phone foi confirmado pelo OTP; sincronizado no trigger on_auth_user_phone_synced.';
