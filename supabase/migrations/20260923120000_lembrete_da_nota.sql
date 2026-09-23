-- O lembrete que nasceu de uma nota lembra DE QUAL nota ele é (23/09/2026).
--
-- "Criar lembrete" no menu da nota só passava o título para o formulário: o lembrete nascia
-- solto, e a nota continuava oferecendo "Criar lembrete" para sempre — a queixa foi *"uma vez
-- que eu criei o lembrete da nota, a opção tem que mudar... e sim ver lembrete ou editar
-- lembrete"*. Sem o vínculo não há o que mudar: a nota não sabe que tem lembrete.

create unique index if not exists notes_id_workspace_key on public.notes (id, workspace_id);

alter table public.reminders add column if not exists note_id uuid;

-- ⚠️ **A FK é COMPOSTA: o lembrete mora no espaço da nota.** Com `references notes (id)` sozinho
-- a checagem ignora a RLS e aceita a nota de QUALQUER espaço — e, somada ao unique de baixo, um
-- membro convidado criando o lembrete de uma nota compartilhada (o `default` de
-- `workspace_id` é o espaço DELE) trancava o "um lembrete por nota" para o dono, que não enxerga
-- a linha que bloqueia e recebe 23505 para sempre. Diferente de `notes.folder_id`, que não tem
-- unique: lá uma referência alheia não trava ninguém.
--
-- `on delete set null (note_id)`, com a coluna nomeada (Postgres 15+; staging e produção em 17):
-- sem a lista, a FK composta zeraria também `workspace_id`, que é `not null`, e o purge da
-- lixeira abortaria inteiro. Apagar a nota DE VEZ não apaga o lembrete — ele tem título próprio.
-- Mandar para a lixeira não mexe em nada (é `update deleted_at`).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reminders'::regclass and conname = 'reminders_note_fk'
  ) then
    alter table public.reminders
      add constraint reminders_note_fk
      foreign key (note_id, workspace_id) references public.notes (id, workspace_id)
      on delete set null (note_id);
  end if;
end $$;

-- UM lembrete por nota. É o que faz o menu trocar para "Editar lembrete", e o que impede dois
-- toques rápidos em "Criar lembrete" (ou dois aparelhos) de criarem dois. O app grava com
-- `insert` puro — nunca `.upsert()` —, então o unique PARCIAL não cai no 42P10 do PostgREST
-- (`supabase.md`). O segundo insert volta 23505, que a tela mostra como erro. Ele também é o
-- índice de `reminders where note_id = <nota>`.
create unique index if not exists reminders_note_id_key
  on public.reminders (note_id)
  where note_id is not null;
