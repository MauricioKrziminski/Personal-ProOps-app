# F09 — implementação de subcategorias opcionais

> Workers: executar por tarefas com `executing-plans`; delegar somente fronteiras independentes,
> com propriedade de arquivos explícita. O agente principal integra e aceita cada resultado.

**Objetivo:** detalhar uma categoria opcionalmente, mantendo clientes e históricos compatíveis.
**Arquitetura:** UUID do filho por espaço/namespace textual do pai, metadata nullable em registros
e snapshots, comandos estruturais atômicos com recibo selado; componentes existentes.
**Stack:** PostgreSQL/Supabase, TypeScript/React Native/Expo 57, React Query, kit ProOps.

Restrições: branch `gabriel/financas-22-melhorias`; staging `utkqoiigimqzeenxkxdl` somente;
`scripts/supabase-target.sh` antes de escrita; `EXPO_NO_DOTENV=1` em Expo; nenhuma API Expo nova
sem docs versionadas. Preservar texto livre, null legado, caixa/ledger, defaults F06 e escopos.
F10 só após código/banco/nativo F09. [Contrato](../../qa/2026-10-02-evolucao-financeira/f09/contrato.md).

## 1. Domínio e RED/GREEN

Criar `src/lib/subcategories.ts` e `.test.ts`, sem dependências nativas.
Interfaces:

```ts
type Subcategory = { id: string; workspace_id: string; parent_category: string;
  name: string; edit_revision: number; uses: number };
type SubcategoryState = { workspace_id: string; items: Subcategory[] };
type SubcategoryWriteInput = {
  action: 'save'; workspace_id: string; subcategory_id: string | null;
  expected_revision: number | null; parent_category: string; name: string;
  merge_into_id: string | null; expected_merge_revision: number | null;
} | { action: 'delete'; workspace_id: string; subcategory_id: string; expected_revision: number };
type SubcategoryWriteResult = { workspace_id: string; subcategory_id: string;
  edit_revision: number | null; merged: boolean; deleted: boolean; affected_records: number };
```

- [x] RED `subcategoryAfterParentChange(id,'alimentação','saúde') === null`; alias equivalente
  preserva UUID; null nunca inventa filho. Decoder recusa campo extra, namespace duplicado,
  workspace misturado, UUID/revisão/count inválidos e nome sem trim.
- [x] Implementar `decodeSubcategoryState`, `subcategoryAfterParentChange`,
  `subcategoryForParent`, `subcategoryWriteInput`, `decodeSubcategoryWriteResult`.
- [x] `subcategoryForParent(state,id,parent,workspace)` retorna filho atual ou null para id null;
  referência não encontrada/incompatível ou estado de outro espaço é erro de conferência.
- [x] RED/GREEN soma por filho + Sem detalhe com centavos exatos; sem arredondamento/overflow.
- [x] Comando focado: `node --test src/lib/subcategories.test.ts`; registrar logs RED/GREEN.

## 2. Estrutura, comandos e prova SQL

Criar migrations `subcategories`/`subcategory_writes`/`subcategory_reads`, fixtures em
`supabase/tests/subcategories.sql`. Root define timestamps e integra schema.

- [x] Table/keys/revisão/RLS, referência nullable nas fontes/snapshots; trigger valida pai/ws
  e limpa filho incompatível quando cliente legado troca categoria sem detalhe explícito.
- [x] `subcategory_state(p_workspace_id uuid)` retorna exatamente `SubcategoryState`.
- [x] `write_subcategory(p_input jsonb,p_request_id uuid)` recebe union acima; cria/renomeia/move/
  junta/remove com revisão e membership. `resolve_subcategory_attempt` confirma commit ou
  cancela terminalmente a mesma intenção. Não usar recibo genérico caller-writable como prova.
- [x] Extender rename/merge/delete de pai preservando regra de orçamento e ordenação F06;
  filhos/referências de outros espaços nunca afetados por operação local de filho.
- [x] RED: fonte/filho novo perde categoria em materialização sem coluna; pai≠filho recusa;
  merge receptor/orçamento fica íntegro; delete preserva categoria/transação e caixa.
- [x] Provar role authenticated, replay igual/diferente, CAS/refusal, criação concorrente e
  dois writers reais; fixtures rollback, limpeza UUID limitada, advisors delta sem regressão.

## 3. Propagação financeira e clientes

Arquivos: migrations atuais somente como referência (não editar aplicadas); nova migration
estende pontos de entrada do mapa SQL. `lancamento-write.ts`, `serie.ts`, `compra.ts`, formulário
da dívida, previews/conversões, `use-finance.ts`, tipos gerados, scheduler/importer/schema do agente.

- [x] Full intent inclui UUID opcional; cores financeiros recebem apenas campos conhecidos;
  metadata e recibo são finalizados na mesma transação. Evitar camadas de replace textual de SQL.
- [x] Templates/histórico/materializações preservam filho nos escopos uma/futuras/todas;
  escolha explícita null limpa somente o alcance confirmado. Versões pagas fora do alcance ficam.
- [x] Regeneração/conversão copia filho compatível; pai novo limpa incompatível, tarifa técnica
  e fatura não herdam compra por acidente. Editar metadata invalida revisões dos editores abertos.
- [x] Regra/importação/agente aceitam UUID opcional, payloads antigos omitidos mantêm seu contrato;
  resultado inválido não recebe filho de outro pai/espaço.
- [x] Read API versionada para linhas previstas inclui detalhe sem mudar retorno antigo;
  filtros/readbacks mostram nome e Sem detalhe, nunca UUID cru.

## 4. Hooks e UI

Criar `src/hooks/use-subcategories.ts`, `src/components/finance/subcategory-field.tsx` e
controle de gerenciamento de filhos. Integrar categorias/formulários com propriedade de
sessão acima de ramos adaptativos; extrair só controles comuns necessários.

- [x] Query key inclui espaço; DTO fechado, realtime e invalidações dos fontes/reports; Save
  preserva UUID/payload no retry com controller compartilhado, sem trocar intenção ambígua.
- [x] Pai muda → filho incompatível limpa no draft; readonly/loading/erro não mostra estado velho;
  resposta atrasada de criação só seleciona dentro da mesma visita/pai/espaço.
- [x] Detalhe opcional colapsado, Sem detalhe primeiro, busca/criação inline, lista progressiva;
  gerenciamento com impacto antes de mover/juntar/remover; padrões de categoria preservados.
- [x] Breakdown por período/workspace/tipo/pai usa os mesmos critérios dos totais existentes,
  pai = filhos + Sem detalhe; filtros por UUID preservam vínculo ao namespace mostrado.
- [x] Testes do JSX real para draft/cancelamento, late response, erro/refusa/ambiguidade,
  ocultação visual/acessível e preservação da sessão em mudança de largura.

## 5. Aceite e avanço

- [x] `node --test`, `tsc --noEmit`, `EXPO_NO_DOTENV=1 expo lint`, React Doctor base HEAD/untracked.
- [x] Matriz iOS/Android: criar/usar/reabrir, trocar pai, null legado, cancelamento, rename/move/
  merge/delete iOS com leituras Android, filtro obsoleto, soma, privacidade iOS e persistência cruzada.
- [x] Escopos/importação/budget/rollup e demais corridas provados em SQL/Node/Python; cobertura
  nativa adicional/tablet/Reduce Motion/VoiceOver/TalkBack não declarada. Limites no aceite.
- [x] Conferir capturas e oráculos do banco, restaurar somente fixtures novas, registrar limites
  e monitorar ANR F07 com captura contemporânea se houver recorrência.
- [x] Documentação de aceite e master plan atualizados; F10 liberado. Commit local F09, sem
  push/produção, concluído antes da implementação F10.
