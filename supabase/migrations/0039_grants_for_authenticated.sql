-- GRANTs que faltavam para o repo se sustentar sozinho.
--
-- Descoberto aplicando as 38 migrations num banco limpo (`supabase start` + `migration up`):
-- **nenhuma** delas emite `grant`, e as 28 tabelas de `public` ficam inacessíveis para
-- `authenticated`. O primeiro sintoma é `42501 permission denied for table card_invoices` em
-- `cash_flow_forecast` — a tela Hoje inteira cai.
--
-- Em produção passa despercebido porque as tabelas nasceram pelo dashboard e herdaram os default
-- privileges que o Supabase pré-configura. Ou seja: lá isto é no-op; aqui é o que faz um ambiente
-- novo (local, staging, um projeto novo) funcionar.
--
-- **Não afrouxa nada.** No modelo do Supabase o GRANT é só o portão de entrada; quem decide o que
-- cada um enxerga é a RLS, e toda tabela deste schema tem RLS ligada. Tabela de infra (`jobs`,
-- `messages_raw`, `billing_events`) tem RLS **sem policy**, o que nega tudo por definição — o
-- grant nelas continua não dando acesso a linha nenhuma.

grant usage on schema public to anon, authenticated;

-- `anon` só precisa enxergar o schema: sem sessão a RLS não libera linha nenhuma.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Vale para o que vier depois, para não repetir esta migration a cada tabela nova.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
