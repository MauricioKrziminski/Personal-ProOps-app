-- O apelido de conta guarda também a forma como a pessoa ESCREVEU.
--
-- `alias` é a chave de casamento (minúscula, sem acento) e continua sendo o único que o agente
-- compara. Exibir a chave na tela de edição da conta mostrava "Cartao da familia" para quem
-- escreveu "cartão da família"; `dito` é só exibição. Nulo nos apelidos aprendidos antes desta
-- migration: a tela cai na chave capitalizada.
alter table public.account_aliases add column if not exists dito text;
comment on column public.account_aliases.dito is
  'O apelido como a pessoa escreveu (só exibição); a chave de casamento é `alias`.';
