# Verificação integrada final — 22 pontos

Estado: **concluída no staging** em 05/10/2026. Branch `gabriel/financas-22-melhorias` (HEAD do
F22: `4e78aeb6`), staging `utkqoiigimqzeenxkxdl`. Produção, push e tag: **não feitos** — dependem
de pedido próprio.

## Aceites

Os 22 pontos têm registro individual: `fNN/registro-nativo.md` (F01–F05) e `fNN/aceite.md`
(F06–F22), com contrato, evidência nativa nos dois sistemas e limites. Uma revisão só de leitura
confrontou cada ponto com a spec e achou a entrada real no app de todos (nenhuma rota órfã).

## Gates globais (HEAD do F22)

| gate | resultado |
|---|---|
| `npx tsc --noEmit` / `npx expo lint` | exit 0 |
| `npm test` | 2345 pass, 0 fail |
| `ruff check app --select F,E9` / `pytest` (agent) | limpo / 1258 pass |
| suíte SQL inteira (`scripts/sql-test.py`, rollback, staging) | 111/113; as duas de fora são ambientais: `agent_migrations` (banco vazio) e `expected_recurring_occurrences` (data fixa) |
| `anon_sem_execute`, `transaction_templates` depois do último push | PASSOU |

**Cliente anterior:** as migrations do programa são aditivas (colunas, tabelas e funções novas,
argumentos com default), com uma exceção: o F17 trocou o tipo de retorno de `financial_health()`
(drop + create), e só o app chama essa função (`f17/aceite.md`); o agente continua aceitando o
contrato anterior. Migrations do programa só no staging, em ordem; o registro de produção continua em
`docs/HISTORICO-DE-MIGRATIONS.md` quando houver pedido.

## Jornada nos dois sistemas (só leitura, nada gravado)

Início → lançar → pagamento/consulta → orçamento → meta/reserva → investimento → cenário →
captura/duplicação, com o bundle atual provado por um marcador do F22 antes de começar.

| aparelho | resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 | 23 passos passam; não vistos: fileira Favoritos (o dev@ não tem favorito — criar seria gravar) e aplicar/resgatar/reavaliar investimento (o dev@ não tem conta de investimento). [Resultado e capturas](evidence/ios/) |
| Android 16 `emulator-5574` | passam F01–F12, F14–F22 nos pontos abertos; não vistos: fileira Favoritos, detalhe de investimento (F13) e Reabrir (nenhuma série encerrada). [Resultado e capturas](evidence/android/) |

F12/F13 e o Reabrir do F18 estão provados nos aceites próprios (com dado criado e apagado por ID).

## Paridade app/agente

`docs/AGENTE-PARIDADE-COM-O-APP.md` tem linha para os 22: as que faltavam (F01, F03–F06, F08–F10,
F20, F21) entraram nesta verificação, com o que o agente faz de fato. Nenhum ponto mudou tool,
prompt ou `FinanceAction`. **Lacunas declaradas do agente** (o app faz, a conversa não): forma de
pagamento e filtro por ela (F01/F05), classificar (F06), subcategoria além da regra (F09), plano e
prazo de meta (F08/F10), reserva (F07), guardar/retirar com origem (F11), aplicar/resgatar e
reavaliar investimento (F12/F13), plano percentual (F14), por que mudou (F15), transferência
recorrente e encerrar série (F18), marcos (F19), favoritos e duplicar (F22).

## Pendências reais

- `QA-ANDROID-20261003-ANR` (F07): causa em aberto.
- F08: tablet, fonte ampliada, temas e build sem Metro não executados.
- F01/F02: offline nativo do iOS sem execução.
- F04: a suíte antiga de recorrência segue como falha conhecida.
- F22: favorito com conta/categoria arquivada e editar favorito não vistos no aparelho.
- Resíduos de QA de fases anteriores no dev@: séries "QA F02 IOS serie 20261002" e "QA F06
  android série" seguem ativas e geram ocorrências (vistas hoje: +R$ 32,10 e +R$ 0,13). Não foram
  apagadas porque não são desta sessão; apagar exige confirmar os IDs da fase delas.
- **Instruções de domínio não atualizadas para F18–F22** (`.claude/rules/finance.md` e
  `frontend.md` não citam encerrar série/transferência recorrente, marcos, acumulação, primeiro
  cadastro nem `transaction_templates`); a regra de cada um está no contrato e no aceite.
  Catálogo de ajuda (`explicacoes.ts`): F20–F22 não têm indicador a explicar.
- **Comparação visual de composição** do programa (spec §8) não feita; houve conferência visual
  por ponto nos aceites.
- Worktrees dos agentes em `.claude/worktrees/` ficaram (os commits já estão integrados).
- Integrar por patch com o Metro de pé deixou módulos velhos nos aparelhos (F22): o QA só vale
  depois de `touch` nos arquivos e de provar a tela nova.
