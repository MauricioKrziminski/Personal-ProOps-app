# F19 — marcos e identidade visual das metas

Estado: contrato do incremento, antes do código. Staging `utkqoiigimqzeenxkxdl`. Não declara
implementação nem testes. Base: `goals`, `goal_contributions` (ledger), F10/F11.

## Comportamento

- No formulário da meta (os MESMOS campos ao criar e editar): **Ícone** (grade do kit, ícones de
  `category-icons`) e **Cor** (a paleta pareada claro/escuro das notas). Sem escolha: ícone
  padrão e sem cor, como hoje.
- **Marcos**: lista editável, em **valor** ou **percentual** do alvo (`Cada um | %` como o
  `UnidadeDoValor`). Sugestão ao criar a meta: 25%, 50% e 75% (a pessoa apaga ou muda). 100% é o
  próprio alvo, nunca marco.
- O card da meta mostra o progresso com o anel do kit (`RingGauge`, ícone ao centro) e a linha
  **"Próximo marco: R$ X · faltam R$ Y"**; passados todos, "Faltam R$ Y para o alvo".
- **Celebração**: quando um aporte/alocação CONFIRMADO faz o guardado atravessar um marco, a
  ficha mostra um momento curto e localizado no anel (escala + háptico de sucesso; com Reduzir
  movimento, só fade e háptico), uma vez. Não bloqueia leitura nem ação, sem som, sem push.

## Domínio

- `goals.icon text null`, `goals.color text null` (check contra a lista de cores aceitas).
- `public.goal_milestones(id, workspace_id, goal_id → goals on delete cascade, amount_cents
  bigint > 0, created_at)`, `unique (goal_id, amount_cents)`, RLS por workspace como `goals`.
  Percentual digitado vira centavos AO SALVAR (arredondado ao centavo); a tela mostra os dois.
- **Alvo mudou**: marcos ≥ novo alvo ficam guardados mas não aparecem ("acima do alvo", na edição,
  com Apagar); percentuais mostrados recalculam do valor. Nada do histórico muda.
- **Etapa é derivada**, nunca gravada: `atingidos = marcos com amount ≤ saved_cents` (saved do
  ledger). Retirada que desce abaixo de um marco o devolve a "a seguir".
- **Celebrar uma vez**: memória por usuário no aparelho (`usePreferencia`), chave
  `meta:<goal_id>` → maior marco já celebrado. Celebra só quando o maior marco atingido AGORA é
  maior que o gravado; descer abaixo baixa a memória (subir de novo celebra de novo, porque é uma
  nova travessia real). Abrir a tela, pull-to-refresh e Realtime não celebram sozinhos.
- Escrita direta via supabase-js com RLS (padrão `use-items`); `useSaveGoal` grava ícone/cor e
  sincroniza a lista de marcos (insere/apaga a diferença). Linha nova em
  `AGENTE-PARIDADE-COM-O-APP.md` (o agente não edita marcos/ícone).

## Aceite (matriz)

Aporte que cruza vários marcos de uma vez (uma celebração, do maior); retirada que desfaz;
alvo reduzido e aumentado; marco duplicado recusado; percentual 33,3% em alvo ímpar; reabrir a
tela e Realtime sem celebrar de novo; meta concluída; meta sem marcos (sem linha de próximo);
ocultar valores (linha do próximo marco oculta); fonte grande; Reduzir movimento; claro/escuro.
Teste unitário da etapa derivada e da regra de "celebrar"; teste SQL de RLS/unique/cascade e
`anon_sem_execute` se houver função. Nativo nos dois sistemas.
