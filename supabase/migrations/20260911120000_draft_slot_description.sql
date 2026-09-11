-- O rascunho já pedia a DESCRIÇÃO; o CHECK não deixava gravar.
--
-- `draft_actions.slot` nasceu na 0045 com a lista fechada ('amount', 'account'),
-- e a lista fechada é a decisão certa: slot novo exige código novo para
-- preenchê-lo. O que faltou foi abrir a lista quando o código chegou.
--
-- `app/domain/required.py` devolve o slot 'description' desde que passou a
-- perguntar "não identifiquei o que você comprou. Do que se trata?", e
-- `app/domain/draft.py` sabe completar os dois ('description' e o apelido
-- 'identification' que o classificador devolve). Só o banco não sabia:
--
--     gastei 45 no bradesco
--     -> CheckViolation: draft_actions_slot_check
--
-- O turno morria na hora de GRAVAR a pergunta, então o usuário recebia
-- "não consegui processar essa mensagem" para uma frase que o agente tinha
-- entendido — e perdia o lançamento. Achado em 11/09/2026 por
-- `scripts/probe_pergunta_ou_supoe.py`, que roda o turno inteiro contra o banco
-- de verdade; nenhum teste de unidade pegava porque o repositório é dublê.
alter table public.draft_actions
  drop constraint if exists draft_actions_slot_check;

alter table public.draft_actions
  add constraint draft_actions_slot_check
  check (slot in ('amount', 'account', 'description'));
