-- O rascunho é único por TELEFONE, não por thread.
--
-- A 0043 chaveou por `thread_id`, e isso estava errado por um motivo que só
-- aparece depois de uma noite: o thread efetivo carrega o epoch da sessão
-- (`thread:epoch`), e o epoch gira depois de SESSION_IDLE_HOURS=6 de silêncio.
-- Só `pending_actions` em 'awaiting' trava essa rotação — rascunho não trava, e
-- nem deveria, porque ele existe justamente para a vida seguir enquanto espera.
--
-- Como o rascunho vive 24h e o epoch gira em 6h, um único silêncio deixaria o
-- rascunho antigo órfão num thread morto E permitiria um segundo nascer para a
-- mesma pessoa — que é exatamente a ambiguidade de "foi 5000" que o índice
-- existe para impedir.
--
-- `phone` é a chave estável deste sistema: é o alvo da FK e o mesmo árbitro que
-- a 0040 escolheu para `user_sessions` (a análise completa está lá).
--
-- `thread_id` continua na tabela, mas passa a ser INFORMATIVO: quem consome o
-- rascunho deriva o thread efetivo na hora, porque o gravado pode estar num
-- epoch já morto.

-- Não pode haver dois rascunhos do mesmo telefone quando o unique nascer.
delete from public.draft_actions a
using public.draft_actions b
where a.phone = b.phone and a.created_at < b.created_at;

drop index if exists public.draft_actions_one_per_thread;
drop index if exists public.draft_actions_by_phone;

create unique index if not exists draft_actions_one_per_phone
  on public.draft_actions (phone);
