# Hoje — "o dia", não um segundo Financeiro (28/09/2026)

Pedido do dono do produto:

> *"Eu to sentindo a tela de hoje parecida muito com a financeiro, tente pesquisar as melhores
> telas hoje nesse nicho de app, olhar para as features existentes dentro do app, pensar como um
> usuário no que ele gostaria de ver como tela principal, e pense de forma criativa, nada de
> repetir ou algo assim. Se for preciso trocar componentes de tela, me avise e faça."*

"Me avise e faça" autoriza trocar os componentes sem esperar aprovação. Esta spec registra o que
mudou, por quê, e o que NÃO pode se perder.

## O diagnóstico (medido, não impressão)

Conta do staging em 28/09/2026, Android claro e iPhone escuro:

| | Hoje (antes) | Financeiro |
|---|---|---|
| topo | bloco de tinta, "Livre até 10/10/2026" **R$ 32.477,69** | bloco de tinta, "Vou fechar em" **R$ 32.477,69** |
| logo abaixo | ladrilhos **Saiu hoje / Entrou hoje** | ladrilhos **Entra / Sai** |
| orçamento | anéis "No limite" | anéis "Passando do limite" |

- **O número do herói era o MESMO nas duas telas.** Sem `proxima_entrada`, `ateQuando` cai no fim
  do ciclo e `livre = caixa − comprometido_ate_entrada` vira exatamente o resultado do ciclo.
  Não é coincidência de dado: vale para todo mundo sem receita prevista.
- **A Pista desenhava dois retângulos vazios** (primeiro degrau pequeno, o resto chapado) — nas
  duas plataformas. Não respondia pergunta nenhuma.
- **Sete faturas atrasadas viravam sete cards vermelhos** empilhados no topo, antes de qualquer
  coisa do dia.
- **"3 Lembretes · Para hoje" listava lembretes de qui, 3 set** (25 dias antes). Causa:
  `useTodayReminders` só tem teto (`lte` fim de hoje), nenhum piso. No staging o cron de lembretes
  não roda e tudo fica "vencido"; em produção isso só acontece com entrega falhando.
- **O badge da aba contava receita prevista** como pendência (`upcoming_bills` inteiro), contra a
  regra escrita na própria Hoje ("o contador e o badge são SÓ de despesa").
- **Notas não existiam na Hoje.** O app é notas + lembretes + finanças; a tela inicial era 100%
  finanças com os lembretes no 7º bloco.

## A pesquisa (resumo — as fontes estão no fim)

Things 3, Structured, Fantastical, Todoist, Sunsama, Tiimo, At a Glance, Nubank, Copilot, Monarch,
YNAB, Simplifi, PocketGuard, Emma, Cleo, Olivia, Mobills.

1. **Tela "Hoje" boa ancora o topo no TEMPO** — a agenda do dia (Things), a linha do tempo
   (Structured), não uma quantia. Os apps de finanças que falam em "por dia" ainda abrem com
   dinheiro no topo, que é exatamente o que torna a Hoje um segundo Financeiro.
2. **O dia tem faixas**: "dia todo" (o que não tem hora) e o que tem hora, com o AGORA marcado. O
   que passou fica cinza, não some.
3. **Atrasado é UMA linha recolhida com a contagem** (Todoist) — nunca um card vermelho por item.
   Vermelho só no número.
4. **Dinheiro na escala do DIA** (PocketGuard, Simplifi, Emma): "por dia", com o total do período
   como contexto, não como manchete.
5. **Ação do momento que some quando resolvida** (Nubank, At a Glance).
6. **Evitar**: bloco escuro com valor grande (é a assinatura do Financeiro), número de outra janela
   no topo, anéis de orçamento repetidos, painel de widgets.

## Decisões

| pergunta | decisão | por quê |
|---|---|---|
| o que é o topo | **o dia**: saudação + data, e logo abaixo **Seu dia** — atrasado recolhido, "dia todo" e os lembretes com hora e o AGORA | pesquisa (1)(2); é o que só a Hoje sabe mostrar |
| o herói de tinta | **sai da Hoje**; fica só no Financeiro | as duas telas abriam no mesmo bloco com o mesmo número |
| o dinheiro | card claro **"Dá para gastar por dia"** + o livre total na legenda; linhas: saiu hoje (ritmo), em conta (abre as contas), no limite | pesquisa (4); junta herói, ladrilhos, "Nas contas" e "No limite" num card só |
| a Pista (`RunwayBar`) | **removida** (componente, `lib/runway.ts`, `useSpendablePath`) | desenhava dois retângulos; o saldo dia a dia já é a curva arrastável do Financeiro |
| os contadores (`TodaySignals`) | **removidos** | com o atrasado recolhido e os lembretes no Seu dia, repetiam a lista logo abaixo (eco) |
| anéis de orçamento | **saem da Hoje** (o Financeiro tem) e viram uma linha "No limite" no card do dinheiro | eram o mesmo bloco nas duas telas |
| Próximos dias | um card agrupado por dia, **linhas sem botão** — tocar abre | "Ver fatura" em toda compra de cartão era ruído; o "Paguei" antecipado mora no detalhe |
| notas | faixa horizontal das **fixadas** (ou das mais recentes, sem fixada) | notas são metade do produto e não apareciam; só conteúdo real, SEM card "Nova nota" (o FAB já tem "Nota" — seria eco, o motivo pelo qual o "Diga ao agente" saiu em 17/09) |
| a ordem | saudação → passos (só quem começa) → **Seu dia** → **dinheiro** → próximos dias → notas | muda a ordem de 17/09 (dinheiro primeiro); o dinheiro continua no primeiro viewport num dia comum |

**A ordem de 17/09 era "urgência: quanto dá para gastar, o que exige ação…".** Ela muda de
propósito: o que exige ação (atrasado, o que vence hoje) sobe para o topo junto do dia, e o
dinheiro vem logo depois. Num dia comum (atrasado recolhido, 1–2 contas, 2–3 lembretes) o card do
dinheiro começa antes da metade da tela.

## Regra 0 — nenhuma função perde acesso

| antes | depois |
|---|---|
| saudação + data | igual |
| herói "Livre até": número | legenda do card do dinheiro ("R$ X livre até dd/mm"); em "total" (livre ≤ 0 ou por dia < R$ 1) é o próprio número |
| veredito "R$ X atrasado" / "vence hoje" / "≈ R$ X por dia" | atrasado e "vence hoje" viram linhas do Seu dia; "por dia" é o número do card. O widget continua com o veredito (`vereditoDoDia`) |
| Pista (arrastar o dia e o livre depois dele) | removida — o saldo de cada dia é o gráfico arrastável do Financeiro |
| rodapé "Compromissos · R$ X" | removido da Hoje — é número do CICLO (Financeiro, "Ver o que fecha o ciclo") |
| menu do herói: Ver o que fecha o ciclo, Projeção, Patrimônio, Metas | tocar no número do card do dinheiro abre o MESMO menu, com `mes`/`view` do `cycle_now` |
| olho de esconder saldo | no card do dinheiro |
| contadores Vencendo / Lembretes / No limite | Seu dia (atrasado + vence hoje + lembretes); "No limite" → linha do card do dinheiro → `/finance/budgets`; "Todos" os lembretes → `/reminders` no cabeçalho do Seu dia |
| Saiu hoje (ritmo) / Entrou hoje | linha "Saiu hoje" do card, com o ritmo e o que entrou na legenda → `/finance/transactions` |
| Agora: atrasado com Paguei / Recebi / Pagar fatura / Ver dívida; tocar abre o lançamento | Seu dia: com 2+ atrasados, UMA linha recolhida ("7 contas atrasadas · R$ X") que abre no lugar; com 1, a linha dele. Mesmas ações, mesmo destino |
| vence hoje / chega hoje | "dia todo" do Seu dia, mesmas ações |
| Nas contas: total + linha por conta → extrato dela | linha "Em conta" do card abre as contas no lugar; cada conta → extrato dela |
| Lembretes (linha do tempo) → `/reminder-form?id&ocorrencia=1` | lembretes com hora dentro do Seu dia, mesmo destino; o de outro dia diz a data |
| Próximos dias: Paguei / Pagar fatura / Ver dívida / Ver fatura / Recebi nos botões | tocar abre o destino do item (lançamento, fatura, dívida; compra de cartão → a fatura). "Paguei"/"Recebi" antecipado: no detalhe do lançamento, que já tem o botão |
| No limite (anéis) → orçamentos | linha "No limite" → orçamentos |
| Primeiros passos / Próximo passo | iguais, logo abaixo da saudação |
| "Nada vence hoje · entra dinheiro dd/mm" | o Seu dia vazio diz "Nada para hoje" e o próximo compromisso |
| FAB Lançar (gasto/receita, lembrete, nota) | igual |
| busca em tudo no cabeçalho | igual |
| dicas `hoje-painel` e `conta-extrato` | `hoje-painel` presa ao número do card ("Toque no valor…"); `conta-extrato` embaixo das contas abertas |
| — | **novo**: notas fixadas/recentes → `/notes/[id]`; "Todas" → `/notes` |

## Anatomia

```
Boa tarde, Gabriel
seg, 28 set

[Primeiros passos | Próximo passo]           só para quem está começando

(◎) Seu dia                                         Lembretes ›
┌───────────────────────────────────────────────────────────┐
│ (!)  7 contas atrasadas                    R$ 9.847,30  ⌄ │
│      a mais antiga venceu 10/07                           │
│ (▦)  Aluguel                                  R$ 650,00   │  dia todo
│      vence hoje                               [✓ Paguei]  │
│ 06:00  Renovar o seguro do carro                          │  (passou: cinza)
│ ●─────────────────── 12:54 ────────────────────────────── │  agora
│ 15:30  Comprar filtro de água                             │
│ em 2 h WhatsApp ↻                                          │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│ Dá para gastar por dia                              (👁)  │
│ R$ 2.706,00                                               │  tocar → menu
│ R$ 32.477,69 livre até 10/10                              │
│ Saiu hoje                             R$ 1.166,67      ›  │
│ acima da sua média de R$ 26,06/dia                        │
│ Em conta                              R$ 45.154,99     ⌄  │
│ No limite                             mercado, lazer   ›  │
└───────────────────────────────────────────────────────────┘

Próximos dias
┌───────────────────────────────────────────────────────────┐
│ qua, 30 set                                               │
│ (▦) Aluguel · conta                        R$ 650,00   ›  │
│ [▭] pc gamer (6/8) · Nubank                R$ 900,00   ›  │
│ qui, 1 out …                                              │
└───────────────────────────────────────────────────────────┘

Fixadas                                              Todas ›
[ nota ][ nota ][ no… ]  →
```

## Regras (o que prende o desenho)

- **O dia é uma leitura pura** (`lib/today-sections.ts`, com teste): `separarLembretes` (hoje ×
  de outro dia, pela DATA LOCAL do `next_run_at`), `linhasDoDia` (atrasado recolhido quando há 2+,
  "dia todo", lembretes com o AGORA entre o que passou e o que vem) e `resumoDoAtrasado`. A tela
  só desenha.
- **"Por dia" tem UMA conta**, `porDiaLivre` em `lib/widget-snapshot.ts` — a mesma do veredito do
  widget. A Hoje e o widget nunca dizem dois "por dia" no mesmo dia. `painelDoDia` decide o
  rótulo: por dia (≥ R$ 1,00) ou o livre total.
- **O badge da aba e a Hoje contam a MESMA coisa**, por `pendentesDaHoje` (pura) atrás de
  `usePendentesDaHoje` (as duas tab bars): conta a vencer sem receita + lembrete de HOJE +
  orçamento estourado. Lembrete de outro dia aparece no Seu dia com a data, mas não conta.
- **O AGORA anda.** `useAgora` troca a cada minuto (e vira o dia à meia-noite, que é quando a
  chave dos lembretes de hoje muda). Um `Date.now()` congelado na montagem deixava "em 2 h" errado
  a tarde inteira numa aba que fica montada.
- **Linha de lista é highlight, não escala** (§5): a linha da agenda deixou de ser card com
  `PressableScale` e virou linha de grupo.
- **Nada aqui é dinheiro em peças**: frase com valor usa `brl()` (obedece ao esconder saldo).

## Estados

- **Carregando**: esqueleto na forma nova — saudação, um grupo de linhas (Seu dia), o card do
  dinheiro (número + linhas). Sem texto.
- **Erro**: por bloco — contas (`upcoming_bills`) e lembretes no Seu dia, cada um com o seu
  "Tentar de novo"; `spendable` no card do dinheiro; saldos na linha "Em conta" (card de erro no
  lugar das contas). A tela nunca afirma "Nada para hoje" sem as duas respostas.
- **Vazio**: o Seu dia nunca some — sem nada, diz "Nada para hoje" e o próximo compromisso (ou
  a próxima entrada). Próximos dias e notas somem sem conteúdo.
- **Conteúdo longo**: 384dp × fonte 1,3; título nunca trunca; a prévia da nota corta em palavra
  (`notePreview(texto, 80)`).

## Fases

1. **Leituras puras + testes** — `separarLembretes`, `resumoDoAtrasado`, `linhasDoDia`,
   `porDiaLivre`/`painelDoDia`, `pendentesDaHoje`.
2. **Peças** — `GrupoDoDia`, `AgendaItem` como linha, `LinhaDeLembrete`/`AgoraLinha`,
   `DinheiroDoDia`, `NotasDaHoje`, `useAgora`, `usePendentesDaHoje`, tablet.
3. **A tela** — reescrita; sai `RunwayBar`, `runway.ts`, `useSpendablePath`, `TodaySignals`,
   `CashAccounts`, `DayRail`, `ReminderTimeline`; badge nas duas tab bars; dicas; vitrine; testes
   de tela (`simple-finance-ui`, `refresh-consistency`).
4. **Verificação** — `tsc`, `lint`, `npm test`; Android claro e iPhone escuro, 384dp × 1,3,
   estados de erro e vazio; `ui-polisher`.
5. **Registro** — `design.md` (§1, §8 badge, §12), `docs/design/hoje.md`, "Como ficou" aqui.

Sem migration, sem agente, sem produção, sem tag.

## Fontes da pesquisa

Copilot (help.copilot.money/…/6045480-dashboard-tab-overview), Monarch
(monarch.com/customizable-dashboard-manual-transactions), YNAB
(ynab.com/whats-new/the-great-ynab-remodel), Simplifi
(support.simplifi.quicken.com/…/3620741-using-the-spending-plan-on-the-mobile-app), PocketGuard
(help.pocketguard.com/…/360002167320-Leftover), Emma (help.emma-app.com), Nubank
(nu.com/pt/sala-de-imprensa/…/nubank-lanca-recomendacoes-personalizadas-na-home-do-aplicativo),
Mobills (mobills.com.br/blog/mobills/como-utilizar-o-mobills), Things
(culturedcode.com/things/support/articles/4001304), Structured (help.structured.app/en/articles/380546),
Todoist (todoist.com/help/articles/plan-your-day-with-the-today-view-UVUXaiSs), Sunsama
(help.sunsama.com/docs/usage-guides/daily-planning), Fantastical
(macstories.net/reviews/the-new-fantastical-review), Tiimo (tiimoapp.com), At a Glance
(androidpolice.com/pixel-at-a-glance-finance-sports-rollout-slowly).
