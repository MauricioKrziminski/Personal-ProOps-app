-- Strangler Fig: a Edge Function whatsapp-webhook vira roteador fino durante a
-- migração. Ela lê esta tabela pelo telefone e decide se a mensagem vai para o
-- serviço Python (Cloud Run) ou para o fluxo Deno antigo.
--
-- Rollback de produção = um update numa linha.

create table if not exists public.agent_routing (
  phone            text primary key,
  use_python_agent boolean not null default false,
  note             text,
  updated_at       timestamptz not null default now()
);

alter table public.agent_routing enable row level security;
-- sem policies: só service_role (a Edge Function e o worker)

-- Consulta do roteador. Casa o telefone com e sem o 9º dígito brasileiro: a Meta
-- às vezes manda 55 51 92553295 enquanto o cadastro tem 55 51 992553295. É o
-- mesmo problema que o phoneCandidates() do process-jobs resolve no TS — aqui
-- ele vive no banco porque quem pergunta é o roteador Deno.
create or replace function public.routes_to_python(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with d as (
    select regexp_replace(p_phone, '\D', '', 'g') as digits
  ),
  candidatos as (
    select digits from d
    union
    -- tem o 9º dígito -> tenta sem
    select substr(digits, 1, 4) || substr(digits, 6)
      from d where digits ~ '^55\d{2}9\d{8}$'
    union
    -- não tem -> tenta com
    select substr(digits, 1, 4) || '9' || substr(digits, 5)
      from d where digits ~ '^55\d{10}$'
  )
  select coalesce(bool_or(r.use_python_agent), false)
  from public.agent_routing r
  where r.phone in (select digits from candidatos);
$$;

revoke execute on function public.routes_to_python(text) from public, anon, authenticated;
