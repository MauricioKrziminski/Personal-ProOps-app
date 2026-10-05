# F17 — explicações verificáveis e avisos que abrem o item

Estado: contrato do incremento, antes do código. Staging `utkqoiigimqzeenxkxdl`. Não declara
implementação nem testes.

## Parte A — "Como é calculado"

**Primitivo novo, um só:** `Explica` (`src/components/ui/explica.tsx`): botão (i) com alvo de
44pt e rótulo acessível "Como é calculado: <indicador>", ao lado do TÍTULO do bloco (nunca uma
legenda permanente embaixo). Abre um `Sheet` de leitura com quatro linhas curtas e fixas:

| linha | conteúdo |
|---|---|
| **O que conta** | a regra, em uma frase (ex.: "Gastos efetivados e parcelas de cartão desta categoria") |
| **Período** | as datas REAIS da resposta (`11/09 a 10/10/2026`), não "este mês" |
| **Fonte** | de onde vem ("seus lançamentos", "o que você informou", "a regra da recorrente") |
| **Qualidade** | só quando a resposta marca estimativa/dado insuficiente ("estimado: 2 meses de histórico") |

e um botão **Ver os itens** quando há uma tela que lista exatamente o que foi somado (a mesma
lente e janela; "Um resumo resume o que está logo abaixo dele", `finance.md`).

**Catálogo** `src/lib/explicacoes.ts` (+ teste): uma função por indicador que recebe o PAYLOAD
já carregado na tela e devolve as linhas. Nenhum número, período ou janela é escrito à mão:
sai do mesmo objeto que desenhou o valor. Se o payload não trouxer a base (ex.: janela do score),
a RPC passa a devolvê-la (coluna nova no FIM, sem mudar as existentes) — nunca um texto fixo.

Indicadores cobertos (os já entregues que mostram total com período ou estimativa): saúde
financeira (`financial_health`: cada componente e sua janela), reserva de emergência (F07, base
`manual|observed`), orçamento por categoria (gasto × comprometido), "comprometido no ciclo" do
painel, projeção (saldo inicial, horizonte, o que entra), investimentos (F13, qualidade do
resultado), "Por que mudou" (F15) e plano de orçamento (F14).

Valores dentro do sheet respeitam ocultar valores; fonte grande rola; tablet com largura de
leitura (sheet do kit).

## Parte B — aviso abre o ITEM, e o item apagado não quebra

Hoje todo aviso abre uma lista (`push-routes.ts` `ALLOWED`, `push.py` `TARGETS`). Novos alvos,
nos DOIS lados do contrato (`push-targets-contract.test.ts` prende):

| alvo | `ref` | destino |
|---|---|---|
| `invoice` | uuid | `/finance/invoice/[id]` |
| `transaction` | uuid | `/finance/[txId]` |

`invoice_due` passa a mandar `invoice`; `bill_due` manda `transaction`. `ref` que não é uuid →
cai no alvo de lista de antes (nunca rota montada com texto cru). A lista de alertas do Perfil
(`profile/alerts.tsx`) usa o mesmo `routeFor`.

**Item ausente** (apagado, de outro espaço, sem permissão): as duas telas de destino mostram um
estado "Isto não existe mais" com o caminho para a lista (Faturas / Lançamentos) — nunca
skeleton infinito, nunca erro genérico, nunca recriar nada. Item arquivado abre normalmente.
Canais, dedupe (`alerts_sent`) e limite de 4 por dia não mudam.

## Aceite (matriz)

Cada indicador: período e regra da explicação batem com o número exibido (teste unitário por
função do catálogo usando o payload real do tipo); estado vazio/erro/dados insuficientes (o (i)
some quando não há número); estimado; ocultar valores; fonte grande; Reduzir movimento. Avisos:
deep link frio (app fechado) e quente para fatura e lançamento; `ref` inválido; item apagado;
item de outro workspace; contrato Python × TS. Nativo nos dois sistemas.
