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

## Depois do aceite (05/10/2026, tarde)

Correções do teste do Gabriel em produção, conferidas no staging nos dois sistemas
(`evidence/correcoes-ios/`, `evidence/correcoes-android/`):

- valor da linha minúsculo depois de buscar (`row.tsx`);
- trava do app por baixo do formulário modal e das folhas (iOS: `FullWindowOverlay`; Android:
  `Modal`, e Voltar na trava não fecha a folha por baixo);
- financiamento: parcela vencida não desliza para o mês seguinte (fica "atrasada" na data do
  contrato, na ficha e no ciclo; no ciclo fechado soma em "faltou pagar"); parcela paga dentro do
  ciclo atual pergunta "já saiu da conta X?" e vira lançamento pago; a prévia "Ao salvar" mostra
  esse débito; sem conta que paga, não pergunta;
- abertura sem rede com token vencido mostra "Sem conexão", nunca o login, e erro de rede não faz
  `signOut` (`evidence/sessao-offline/`);
- Metas com Reduzir Movimento no iOS: cartão fora do lugar cobrindo "Simular juntas" (D1 do
  `f08/evidence/ipad/`), corrigido no ponto único `transicao.ts`.

Paridade do agente: lotes A–D publicados no staging (`agente-staging-00219`), cada um com revisão
independente e os achados corrigidos; o que fica só no app está em
`docs/AGENTE-PARIDADE-COM-O-APP.md`. Roteiro de teste: `../ROTEIRO-STAGING.md`.

## Pendências reais

- Avaliação com o Gemini real dos lotes A–D (`agent/scripts/evaluate_answer_forms.py --secao lote
  --barato`, depois sem flag) e a sonda do lote C (`agent/scripts/probe_atributos_lote_c.py`): a cota
  gratuita do staging acabou em 05/10; o pytest (dublês) está verde, o Gemini real não foi medido.
- `QA-ANDROID-20261003-ANR` (F07): sem causa de código provada (`f07/anr-causa.md`); falta medir a
  alternância de "ocultar valores" num build release.
- F08 iPad em paisagem: o simulador ligado por linha de comando não gira no Xcode 27; a rotação com
  rascunho foi conferida no Android tablet.
- F01/F02 offline no iOS: o simulador não tem modo avião; offline conferido no Android.
- Observação O1 do iPad (arrastar a folha para baixo fechou e descartou o rascunho): não reproduzida
  pela leitura do código (`Modal` do RN 0.86 nasce com `modalInPresentation`); precisa de reprodução.
- Comparação visual de composição do programa (spec §8) não feita; houve conferência por ponto.
- Integrar por patch com o Metro de pé deixa módulos velhos nos aparelhos: o QA só vale depois de
  `touch` nos arquivos e de provar a tela nova.
