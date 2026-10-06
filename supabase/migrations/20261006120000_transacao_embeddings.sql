-- Busca semântica de lançamento (auditoria 8.2): "apaga o almoço de ontem" acha "Restaurante Fulano".
--
-- Só o SERVIÇO do agente lê e escreve aqui (RLS ligada sem policy, sem grant ao cliente): o vetor
-- é derivado do texto do lançamento e nunca é mostrado. Quem o mantém é o job do agente
-- (`app/jobs/embeddings.py`), que cobre também o que o app grava por supabase-js.
--
-- 768 dimensões (gemini-embedding-001 com output_dimensionality=768, normalizado no agente):
-- cosseno com vetor unitário. `model` e `content_hash` existem para o job saber o que está velho:
-- texto mudou (hash) ou modelo trocou — nunca um vetor de modelo antigo misturado com a consulta
-- do novo.

create extension if not exists vector with schema extensions;

-- O texto do documento mora UMA vez, aqui: o job pede `texto` e `md5(texto)` ao banco, e a Python
-- não reconstrói nada (duas cópias da montagem divergem em silêncio e o hash passa a mentir).
-- Valor e data ficam FORA: são filtros estruturais e só poluem o cosseno.
create or replace function private.texto_de_busca(p_description text, p_merchant text, p_category text)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(' · ',
    nullif(btrim(p_description), ''), nullif(btrim(p_merchant), ''), nullif(btrim(p_category), ''));
$$;
revoke execute on function private.texto_de_busca(text, text, text) from public, anon, authenticated;

create table public.transaction_embeddings (
  transaction_id uuid primary key references public.transactions(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  embedding      extensions.vector(768) not null,
  model          text not null,
  content_hash   text not null,
  updated_at     timestamptz not null default now()
);

alter table public.transaction_embeddings enable row level security;
revoke all on public.transaction_embeddings from public, anon, authenticated;

create index transaction_embeddings_workspace_idx on public.transaction_embeddings (workspace_id);
create index transaction_embeddings_hnsw_idx
  on public.transaction_embeddings using hnsw (embedding extensions.vector_cosine_ops);

-- Os mais parecidos DENTRO de um workspace e de uma janela de datas.
--
-- ⚠️ Índice HNSW + filtro (`where workspace_id = ...`) é o caso que a doc do pgvector avisa: o
-- índice devolve os `ef_search` vizinhos mais próximos de TODOS os workspaces e o filtro roda
-- depois — pode sobrar menos que `p_limite`, ou nada. Duas defesas, as duas aqui no cabeçalho:
-- `hnsw.iterative_scan = relaxed_order` (pgvector >= 0.8: continua varrendo o índice até achar
-- linhas suficientes depois do filtro; o staging tem 0.8.2) e `ef_search` maior que o padrão.
-- `relaxed_order` não garante a ordem, por isso o `order by` de fora sobre um CTE materializado.
-- E o volume por workspace é pequeno (centenas a poucos milhares): se o planner preferir o scan
-- exato, o resultado é o mesmo, só mais lento que o índice — aceitável.
--
-- O workspace é argumento OBRIGATÓRIO e filtra a tabela dos vetores E a das transações: o chamador
-- passa o do contexto, nunca um id que veio do modelo (`agent.md`, IDOR).
create or replace function private.transacoes_semelhantes(
  p_workspace uuid, p_query extensions.vector, p_limite int, p_de date, p_ate date
) returns table (transaction_id uuid, similaridade double precision)
language sql
stable
set search_path = ''
set timezone to 'America/Sao_Paulo'
set hnsw.iterative_scan = 'relaxed_order'
set hnsw.ef_search = '100'
as $$
  with perto as materialized (
    select e.transaction_id,
           e.embedding operator(extensions.<=>) p_query as distancia
      from public.transaction_embeddings e
      join public.transactions t on t.id = e.transaction_id
     where e.workspace_id = p_workspace
       and t.workspace_id = p_workspace
       and (p_de is null or t.occurred_at >= p_de)
       and (p_ate is null or t.occurred_at <= p_ate)
     order by e.embedding operator(extensions.<=>) p_query
     limit greatest(p_limite, 1)
  )
  select transaction_id, 1 - distancia from perto order by distancia;
$$;
revoke execute on function private.transacoes_semelhantes(uuid, extensions.vector, int, date, date)
  from public, anon, authenticated;
