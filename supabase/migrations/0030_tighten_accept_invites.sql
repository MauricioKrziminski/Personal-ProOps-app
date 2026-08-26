-- Advisors: `accept_pending_invites` estava executavel por `anon`.
-- Ela PRECISA ser security definer (escreve em workspace_members de um workspace
-- que o convidado ainda nao enxerga por RLS), mas so faz sentido para quem esta
-- logado — sem auth.uid() ela ja retornava 0, e agora nem chega la.
revoke execute on function public.accept_pending_invites() from public, anon;
grant execute on function public.accept_pending_invites() to authenticated;
