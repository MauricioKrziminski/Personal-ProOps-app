# Mês — `src/app/finance/month.tsx`

Tela nova (09/09/2026). Nasceu de um caso real: o dono do produto mantém o financeiro numa
planilha com **uma aba por mês** e disse que não conseguia essa visão no app — *"Está tudo muito
separado… o carro só consigo ver entrando em dívida, e outras coisas parece que só assim também.
Meu objetivo é que o usuário tenha toda essa visão facilitada na cara dele, sem precisar entrar em
telas específicas para ver cada coisa (isso deve ter também), mas poder ter a visão geral do mês,
projeção dos próximos meses, meses anteriores."*

A planilha organiza cada mês em cinco blocos — Entradas, Fixos (com ✔/✖), Parcelamentos (com
`Carro · 9 · 48 · Itaú · 1.485`), Gastos do Mês e Saídas por meio de pagamento — e fecha com
`Saldo = Entradas − Saídas`. O app tinha todas as peças, organizadas por OBJETO: o financiamento
em Dívidas, a fatura em Cartões, o salário em Recorrentes. **Nenhuma tela dizia "setembro".**

## Pergunta que responde

> "Para onde foi o dinheiro deste mês, e como ele fechou?"

E o corolário que a planilha entrega e o app não entregava: **"quanto do meu mês já estava
comprometido antes de eu gastar qualquer coisa?"**

## Persona

- **Primária: Gabriel (o dono do produto)** — quer a página do mês, com o financiamento como uma
  LINHA e não como uma tela, e quer andar para trás e para frente entre meses.
- **Secundária: Camila, 34** — domingo à noite, quer saber onde furou. A Projeção responde "posso
  gastar?"; esta responde "o que aconteceu".
- **Não é para o Rafa.** Ele quer o veredito; o veredito continua na Projeção.

## Entrada e saída

- **Entrada:** cartão **"O mês inteiro"** na raiz do Financeiro (bloco 2, logo abaixo do painel de
  destaque), levando o mês que o `MonthPicker` daquela tela está mostrando; e
  Gerenciar › Panorama › "O mês inteiro".
- **Saída:** linha de lançamento → `/finance/[txId]`; linha de financiamento **projetada** →
  `/finance/debts` (o `ref_id` ali é id de DÍVIDA, não de lançamento — a mesma lição registrada em
  `20260908235000` para `kind='debt'`); "Ver a projeção de caixa" → `/finance/forecast`.
- **Back:** pop. O mês escolhido não é preservado entre visitas.

## Anatomia

1. **Header nativo** — large title "Mês". Tela empurrada, registrada no `<Stack>` raiz.
2. **`MonthPicker`** — ‹ › de ±1 mês e grade de 12 meses com salto de ano sem trava. É ele que
   entrega "projeção dos próximos meses / meses anteriores" do pedido: qualquer mês renderiza a
   visão inteira.
3. **`HeroPanel` — o único destaque.**
   - `label`: `Terminei agosto com` (passado) · `Tenho hoje` (corrente) · `Resultado previsto de
     novembro` (futuro).
   - `value`: o **caixa** (`month_summary.closing_cash_cents`). Num mês inteiramente futuro o
     caixa não existe — caixa se apura de linha paga, não se projeta — e o destaque passa a ser o
     resultado, com o rótulo dizendo isso. A decisão mora em `heroFigure`, testada.
   - `secondary`: `entrou X · saiu Y`.
   - `trend` (a faixa que sangra): **o número da planilha** — `resultado do mês`.
4. **"A conta do mês"** — a equação da planilha em cinco linhas: *Comecei setembro com · Entrou ·
   Saiu · Resultado · Tenho hoje*. Em mês futuro a última linha vira **"Ver a projeção de caixa"**.
   Abaixo, quando `Comecei + Resultado ≠ Terminei`, uma frase **nomeia a diferença**.
5–8. **Os quatro blocos da planilha**, na mesma ordem, cada um com o subtotal no cabeçalho e
   `falta pagar X` embaixo quando há pendente:
   **Entradas** · **Contas fixas** · **Parcelas e financiamentos** · **Gastos do mês**.
   Subtítulo da linha: `parcela 9 de 48 · dia 23 · Itaú` — cada pedaço some sozinho quando não
   existe, e nunca sobra um `·` solto (`lineSubtitle`, testado).
9. **"Para onde o dinheiro foi"** — `Segmented` com **Tipo · Meio · Categoria** e **uma lista só**
   abaixo: rótulo, valor, `ProgressBar tone="data"` e `N% do que saiu`. Trocar de aba troca os
   dados, não o desenho. **Tipo é o padrão** porque é a leitura mais forte da planilha.

> **A ordem não é o acaso da implementação.** Ela desce do fechamento (o que a pessoa veio saber)
> para a decomposição (por que fechou assim) e termina na análise (para onde foi). Inverter
> colocaria seis barras antes do número que responde a pergunta.

## Dados

| Bloco | Hook | RPC | Realtime |
|---|---|---|---|
| Herói, "A conta do mês", subtotais, avisos | `useMonthSummary(mês)` | `month_summary` | `transactions`, `debts`, `recurring_transactions`, `accounts` |
| Os quatro blocos | `useMonthLines(mês)` | `month_lines` | idem |
| Para onde foi | `useMonthBreakdown(mês, corte)` | `month_breakdown` | idem |

`accounts` está na lista porque **o rótulo do meio de pagamento É `accounts.name`**: renomear uma
conta muda o que a tela escreve.

**`month_breakdown` sai de `month_lines`**, com `grouping` sobre a mesma base. Lista e total não
podem discordar — que é o defeito clássico de calcular as duas coisas em queries separadas. E os
**três cortes somam exatamente o mesmo total**, o que é a invariante anti-duplicata da tela.

**Nada é somado no cliente.** A tela só filtra por bloco para montar as listas; todo total vem do
SQL (`finance.md` §Agregações).

### O que NUNCA entra

- `kind = 'transfer'` — tira, de uma vez, transferência entre contas próprias **e** pagamento de
  fatura. A compra no cartão já contou no dia em que foi feita; somar o total da fatura por cima
  seria o mesmo dinheiro duas vezes.
- Total de fatura como linha. Quem tem a visão por fatura é a tela de Cartões.
- Aporte de meta. Não é `transactions` por decisão de `finance.md`, e lançar como despesa
  inflaria o gasto do mês.
- A prestação de financiamento **duas vezes**: ela vira `transactions` só quando é paga, e o
  cronograma pula o mês em que já existe pagamento registrado.

## Ação primária

**Entender onde o mês foi.** A ação concreta é tocar numa linha e cair no item. Dar baixa numa
conta fixa pendente é secundária, por toque longo (`showItemActions` + `settleLabel(kind)`) — é o
✖ → ✔ da planilha sem sair da tela.

## Estados

- **Loading** — `Skeleton` no herói com a forma final; `SkeletonRow` nos blocos. Cada query tem o
  seu: resumo, linhas e cortes falham e recarregam separados.
- **Empty** — `EmptyState` "Nada registrado em setembro", com a dica do agente. Bloco sem linha
  simplesmente não desenha (quatro cabeçalhos vazios seriam quatro perguntas sem resposta).
- **Error** — `ErrorCard` por seção, com retry.
- **Incompleto** — duas faixas de aviso, abaixo do cabeçalho da seção afetada. Ver abaixo.
- **Conteúdo longo** — nenhum `numberOfLines`: título de lançamento é identificador e não trunca.

## Os dois avisos — a tela declara em vez de mentir

1. **O precipício do 4º mês.** Recorrentes são materializadas 90 dias à frente
   (`agent/app/jobs/scheduler.py:28`) e o cron **nunca faz backfill**; já o cronograma de
   financiamento não tem horizonte nenhum. Sem aviso, o mês +4 mostraria a parcela do carro e
   **zero** contas fixas, e o resultado daquele mês ficaria lindo e falso. `month_summary` devolve
   `beyond_recurring_horizon` — verdadeiro também quando uma série ativa **nunca** gerou linha, que
   é o pior caso e o que dava `false` na primeira versão.
2. **Parcela declarada sem lançamento.** Quem cadastra "estou na nona" declara oito pagamentos que
   não existem como `transactions`. Em mês passado a seção diz quantos são e manda para Dívidas.
   Inventar a linha seria pôr num total de dinheiro a estimativa que na tela de Dívidas está
   rotulada como estimativa.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Blocos entrando | continuidade | `FadeInDown`, stagger 60 ms, teto 400 ms |
| Troca de mês | continuidade espacial | o conteúdo refaz; o `MonthPicker` já dá `selectionAsync` |
| Barras dos cortes | mudança de estado | `ProgressBar` anima o valor |
| Press em linha | feedback | realce de fundo do `Row` |

## Visual

- **Hierarquia por bloco.** Protagonista: o `HeroPanel` — é o único bloco com superfície escura e
  gradiente, e o número dele é o maior da tela por 3×. Secundário: "A conta do mês", que é
  `Section` opaca com cinco linhas de peso igual, porque é uma EQUAÇÃO — destacar uma linha dela
  quebraria a leitura de cima para baixo. Ruído tolerado: os quatro blocos, que são lista.
- **Peso tipográfico.** Número herói `heroMoney`; rótulo `caption` caixa alta; título de linha
  `default`; subtítulo `footnote` + `textSecondary` (o degrau que separa "Vivo" de "dia 8 ·
  Nubank"); dinheiro na linha `headline` + tabular — num app de dinheiro o valor ganha a linha
  **por peso, não por cor**. O subtotal no cabeçalho de seção é `ticker`: é dado, não título.
- **Densidade.** `Space.sm` dentro do bloco (cabeçalho colado na sua lista), `Space.xl` entre
  seções pelo `Screen`. Gastos do mês mostra tudo — a tela é a página do mês, não um resumo; quem
  quer filtrar vai para Lançamentos.
- **Tratamento de superfície.** Um `HeroPanel` (escuro nos dois temas, com os tokens `onHero`) e o
  resto opaco sobre `groupedBackground`. Cor só semântica: `success` no que entra, `danger` no que
  sai e no resultado negativo, `warning` só nas duas faixas de aviso. As barras dos cortes são
  `tone="data"` e não `tint` — é comparação entre fatias, não estado a resolver.

## Acessibilidade

Cada linha tem `accessibilityLabel` completo ("Parcela carro, R$ 1.470,00, previsto para
10/10/2026"), porque `previsto` está em `footnote` cinza e não pode ser a única forma de saber.
`Segmented` já anuncia a seleção. Alvos de 44pt pelo `Row`.

## Fora de escopo

- **Editar lançamento, criar dívida, abrir fatura.** A tela lê, dá baixa e linka.
- **Faixa comparando vários meses lado a lado.** O `MonthPicker` já entrega "próximos meses, meses
  anteriores" com a tela inteira; comparação lado a lado é outra pergunta e pede outro RPC.
- **"Fechamento de mês" com ✔️.** Na planilha a marca é manual; aqui, mês passado é simplesmente um
  mês cujo resultado já não muda.
- **Trazer a planilha para dentro do app.** Decisão do dono em 09/09/2026: só a tela por enquanto.
