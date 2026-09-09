-- Passo 2 do corte Strangler: o PADRÃO do roteador passa a ser o agente Python.
--
-- A `0041` fez `coalesce(bool_or(...), false)`: telefone sem linha em `agent_routing` ia para o
-- fluxo Deno. Isso é o certo para um CANÁRIO — o defeito custa uma conversa, não todas —, e é
-- errado como estado permanente, por dois motivos que só crescem:
--
--   1. **Cada usuário novo precisaria de uma linha escrita à mão.** Uma hora alguém entra e
--      ninguém lembra de cadastrar; o sintoma é o agente "não saber" o que já sabe no app.
--   2. **Mantém as DUAS implementações do produto vivas.** Em 09/09/2026 a resposta de saldo do
--      WhatsApp estava errada e teve que ser corrigida em Python E em Deno, linha a linha —
--      duas cópias da mesma aritmética é exatamente o que este projeto luta para não ter.
--
-- Agora a tabela inverte de papel: deixa de ser lista de ENTRADA e vira lista de EXCEÇÃO.
-- Telefone sem linha vai para o Python; linha com `use_python_agent = false` fica no Deno.
-- Mesma tabela, mesma RPC, mesmo rollback de uma linha — o que muda é só o default.
--
-- ⚠️ **Ordem importa: aplique isto DEPOIS de o canário passar.** A partir daqui, o Cloud Run
-- fora do ar afeta todo mundo, não só o número do canário. O caminho de volta é uma migration
-- que restaura o `false` (ou, para um número só, `insert ... (phone, false)`).
--
-- ⚠️ **`supabase/functions/` só é apagado quando não houver mais linha `false` aqui.** É o
-- gatilho que o CLAUDE.md define, e é o prêmio real deste passo: some a segunda cópia.

create or replace function public.routes_to_python(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with d as (
    select regexp_replace(p_phone, '\D', '', 'g') as digits
  ),
  candidatos as (
    select digits from d
    union
    -- tem o 9º dígito -> tenta sem
    select substr(digits, 1, 4) || substr(digits, 6)
      from d where digits ~ '^55\d{2}9\d{8}$'
    union
    -- não tem -> tenta com
    select substr(digits, 1, 4) || '9' || substr(digits, 5)
      from d where digits ~ '^55\d{10}$'
  )
  -- O `true` do coalesce é a inversão. `bool_or` continua devolvendo NULL quando nenhuma das
  -- formas do telefone tem linha — e é justamente esse NULL que agora significa "vai de Python".
  -- Uma linha explícita com `false` continua vencendo, que é como a exceção funciona.
  select coalesce(bool_or(r.use_python_agent), true)
  from public.agent_routing r
  where r.phone in (select digits from candidatos);
$$;

-- `create or replace` não recria o grant; o revoke da 0041 sobrevive. Reemitido por garantia,
-- porque a função é `security definer` e um dia isto pode virar `drop`+`create`.
revoke execute on function public.routes_to_python(text) from public, anon, authenticated;
