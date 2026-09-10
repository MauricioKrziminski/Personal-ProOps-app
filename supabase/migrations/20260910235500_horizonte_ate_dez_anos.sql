-- Horizonte da projeção: 3 anos → 10 anos (10/09/2026)
--
-- ## Por que sobe
--
-- O teto de 3 anos, posto hoje mesmo na `20260910220000`, veio com o argumento "a regra
-- envelhece: projetar 10 anos é fingir precisão". O argumento estava errado, e o mercado é
-- explícito: PocketSmith projeta **30 anos** de saldo diário; Monarch faz horizonte multi-ano.
-- A resposta da indústria à decadência da regra não é encurtar o alcance — é dar ALAVANCA ao
-- usuário para ajustar a hipótese. Essa alavanca já existe aqui: é o "E se…?".
--
-- ## Por que só agora dava
--
-- Até a `20260910234500`, somar uma suposição custava `draft_effect` por DIA da série. Medido
-- em produção com 2 hipóteses: 3 anos = **1.769 ms**, e o crescimento era linear nos dias
-- MULTIPLICADO pelas hipóteses — 10 anos passaria de 6 s. Com a expansão feita uma vez só, 3
-- anos caiu para 44 ms e o custo do rascunho virou o mesmo da projeção sem rascunho. Subir o
-- teto antes daquilo teria entregue uma opção que trava a tela.
--
-- ## O que NÃO muda
--
-- ⚠️ **Armazenamento continua zero.** O materializador (`HORIZON_DAYS = 365` em
-- `agent/app/jobs/scheduler.py`) segue gravando UM ano de ocorrências — 184 linhas em produção
-- hoje. Tudo além disso é calculado na leitura: recorrente por `private.recurring_projection_for`
-- (expandida da regra), dívida por `private.debt_schedule_for`, parcelamento por linhas que já
-- existem. Teto de LEITURA e janela de ESCRITA são coisas diferentes e não se confundem aqui.
--
-- ⚠️ **O teto continua num lugar só.** É o motivo desta função existir: antes da
-- `20260910220000` o 365 estava cravado dentro de `cash_flow_forecast` E de
-- `_cash_flow_forecast`, e a tela parava em "6 meses" sem ninguém entender por quê.

create or replace function private.clamp_forecast_days(days integer)
returns integer
language sql immutable
as $$
  -- piso 1 (uma projeção de zero dia não existe), teto 3650 (10 anos), default 90
  select least(greatest(coalesce(days, 90), 1), 3650);
$$;
