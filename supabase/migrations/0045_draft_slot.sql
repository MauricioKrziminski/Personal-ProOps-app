-- O rascunho passa a saber QUAL parâmetro está esperando.
--
-- Até aqui ele só guardava a pergunta em texto (`missing`), e quem completava
-- assumia que a resposta era sempre um VALOR. Foi por isso que "nubank" — uma
-- resposta perfeitamente sensata para "qual cartão?" — não tinha onde encaixar:
-- o código tentava extrair centavos, não achava, e deixava a mensagem seguir
-- para o roteador global, que a classificava como assunto novo.
--
-- Com o slot, o rascunho vira uma máquina de estados de verdade: pede o valor,
-- recebe, descobre que ainda falta o cartão, pede o cartão, recebe, executa.

alter table public.draft_actions
  add column if not exists slot text not null default 'amount';

-- Lista fechada: slot novo exige código novo para preenchê-lo, e um valor solto
-- aqui viraria rascunho que nunca completa.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'draft_actions_slot_check'
  ) then
    alter table public.draft_actions
      add constraint draft_actions_slot_check check (slot in ('amount', 'account'));
  end if;
end $$;
