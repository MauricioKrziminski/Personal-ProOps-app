# Hoje — `src/app/(tabs)/today/index.tsx`

Aba 1, a tela que abre o app. Desenho vigente: **"o dia"** (28/09/2026), spec
`docs/superpowers/specs/2026-09-28-hoje-o-dia-design.md`.

## Estrutura de rota

```
(tabs)/today/_layout.tsx    → <Stack>
(tabs)/today/index.tsx      → /today
src/app/index.tsx           → <Redirect href="/today" />
```

O redirect na raiz mantém o deep link para `/` (sem ele: "Unmatched Route — appproops:///").

## Pergunta que responde

> "O que é o meu dia?"

O que ficou para trás, o que vence ou chega hoje, os lembretes com hora, quanto cabe por dia até
entrar dinheiro, o que vem na semana e as notas que a pessoa deixou à mão.

**Ela NÃO é um segundo Financeiro.** O Financeiro responde "como o ciclo fecha" num herói de
tinta; a Hoje não tem herói de tinta, ladrilhos Entra/Sai nem anéis de orçamento — os três eram
iguais nas duas raízes, e o número do herói era o MESMO (sem receita prevista, o livre até o fim
do ciclo é o resultado do ciclo).

## Personas

- **Jorge, 46** — medo de fatura: o atrasado e o que vence hoje estão no topo, no Seu dia.
- **Rafa, 29** — renda irregular: "posso gastar?" é o card do dinheiro, logo abaixo, por dia.
- **Qualquer um** — confere o dia: lembretes com hora e o AGORA, e as notas fixadas.

## Anatomia (celular)

| # | bloco | o que é | toque |
|---|---|---|---|
| 1 | saudação | "Boa tarde, Gabriel" + a data | — |
| 2 | Primeiros passos / Próximo passo | só para quem está começando | o passo |
| 2b | **Sua semana** (`SemanaDoDia`) | três dias para trás (barra do que saiu, `daily_spending`) e três para a frente (marcas do que vence ou entra), com a régua tracejada do "por dia" e hoje no círculo de tinta | o dia escolhido troca a frase de cima; "Lançamentos" → `/finance/transactions` |
| 3 | **Seu dia** (`GrupoDoDia`) | 2+ atrasados = UMA linha recolhida (`LinhaDoAtrasado`); vence/chega hoje (`AgendaItem` com Paguei/Recebi/Pagar fatura/Ver dívida); lembretes com hora (`LinhaDeLembrete`) e o AGORA (`AgoraLinha`) | a linha abre o item; a ação resolve; "Lembretes" → `/reminders` |
| 4 | **dinheiro do dia** (`DinheiroDoDia`) | "Dá para gastar por dia" (ou o livre total, quando por dia não informa) + legenda com o livre; Em conta (abre as contas no lugar); No limite | valor → menu (ciclo, projeção, patrimônio, metas); conta → extrato dela; No limite → Orçamentos |
| 5 | Próximos dias | 7 dias agrupados, uma linha por compromisso, sem botão | lançamento, fatura (a compra de cartão abre a fatura em que vai cair) ou dívida |
| 6 | Fixadas / Notas recentes (`NotasDaHoje`) | as fixadas; sem nenhuma, as mexidas por último (até 8), com a cor da nota ou da pasta | a nota; "Todas" → `/notes` |

FAB **Lançar**: gasto ou receita, lembrete, nota. Cabeçalho: busca em tudo (`/search`).

No tablet (`TodayTabletCanvas`): o dia à esquerda (saudação, passos, Seu dia, próximos), o
dinheiro e as notas à direita; em uma coluna, a ordem do celular.

## Regras que moram fora da tela

- `lib/today-sections.ts` (puro, com teste): `agendaDoDia`, `separarLembretes` (hoje × de outro
  dia pela data LOCAL), `resumoDoAtrasado`, `linhasDoDia` (a ordem do Seu dia e onde cai o AGORA),
  `pendentesDaHoje` (o badge).
- `lib/today-spend.ts`: `porDiaLivre` (a MESMA conta do widget) e `painelDoDia`.
- `lib/today-sections.ts`: também `semanaDoDia` (os sete dias, o teto e a régua) e `legendaDoDia`.
- `daily_spending(de, até)` (`20260928220000`): o gasto e a entrada de cada dia, a régua de
  `transactions_summary`; janela de até 62 dias, recusada acima disso.
- `useAgora`: o relógio vira a cada minuto e na volta ao primeiro plano — o AGORA e o "em 2 h" não
  ficam presos na hora em que a aba abriu.
- `usePendentesDaHoje`: o badge das duas tab bars.

## Estados

- **Carregando**: esqueleto na forma nova (saudação, grupo de linhas, card do dinheiro, grupo).
- **Erro**: por bloco — contas e lembretes no Seu dia, `spendable` no lugar do card do dinheiro,
  saldos embaixo dele, cartão nos próximos dias, notas na faixa. Cada um com o seu "Tentar de novo".
- **Vazio**: o Seu dia diz "Nada para hoje" e o próximo compromisso — só com as duas respostas
  (contas e lembretes) na mão. Próximos dias e notas somem sem conteúdo.
- **Conteúdo longo**: 384dp × fonte 1,3 conferido; título nunca trunca; valor desce para baixo do
  título; a prévia da nota corta em palavra.

## Movimento

- Linha de lista: realce de fundo, nunca escala. Cartão de nota: `PressableScale`.
- Abrir o atrasado e as contas: háptico de seleção; as linhas entram e saem com o `Bloco`
  (`transicaoDeLayout`, nunca `LinearTransition`).
- O número do dinheiro conta (`CountUpMoney`) quando muda — dar baixa mexe nele.
