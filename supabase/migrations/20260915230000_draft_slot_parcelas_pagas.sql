-- O quarto slot: o CHECK ficou para trás pela SEGUNDA vez.
--
-- A `20260911120000` abriu a lista para 'description' quando o código passou a
-- perguntar "do que se trata?". O mesmo esquecimento estava de pé para
-- 'already_paid_count', que `app/domain/required.py` devolve desde que a compra
-- parcelada RETROATIVA passou a perguntar quantas parcelas já foram pagas:
--
--     comprei uma geladeira em 10x de 300, estou na 4a parcela
--     -> faltando() = ('already_paid_count', 'Quantas parcelas anteriores...')
--     -> save_draft(slot='already_paid_count')
--     -> CheckViolation: draft_actions_slot_check
--
-- O turno morre ao GRAVAR a pergunta, ou seja, DEPOIS de o agente ter entendido
-- a frase: o usuário recebe "não consegui processar essa mensagem" e perde a
-- compra. Conferido na fonte em 15/09/2026 — o CHECK do staging listava três
-- valores e `faltando()` devolve o quarto.
--
-- ⚠️ **A lista continua FECHADA, e isso é o desenho.** Slot novo exige código
-- que saiba preenchê-lo; o que não pode é o código chegar e o banco não saber.
-- Quem escrever um slot novo em `required.py` escreve a migration junto — e
-- `tests/test_draft_slots.py` quebra o build se os dois divergirem.
alter table public.draft_actions
  drop constraint if exists draft_actions_slot_check;

alter table public.draft_actions
  add constraint draft_actions_slot_check
  check (slot in ('amount', 'account', 'description', 'already_paid_count'));
