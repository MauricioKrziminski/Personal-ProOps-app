# Relatórios — `src/app/(tabs)/finance/reports.tsx`

Hoje são 272 linhas com **quatro `GlassCard` empilhados** (`reports.tsx:88`, `:125`, `:152`,
`:166`) e emoji fazendo papel de ícone (💰 `:92`, 💸 `:100`, 🏦/📈 `:174`, 📊 `:199`). Os três
RPCs vêm de `useAnnualReport` (`use-finance.ts:956`) num `Promise.all` (`:964-967`), então **um
erro em qualquer um deles apaga a tela inteira** — o `ErrorCard`/`LoadingCard` da linha 83-84
cobre os três de uma vez. E o card que justifica a tela existir, "Saldos em 31/12"
(`year_end_balances`), está em **quarto** lugar, abaixo de duas listas de categoria.

A tela migra para dentro do `<Stack>` da aba Financeiro (ganha large title e mantém a tab bar).

## Pergunta que responde

> "Quanto entrou e saiu no ano — e o que eu escrevo na declaração?"

São duas perguntas, mas a segunda é a que faz alguém abrir esta tela em março com o programa da
Receita aberto do lado.

## Persona

- **Primária: Rafa, 29** — autônomo, faz o IR sozinho. Ele não quer um gráfico bonito: quer os
  números da ficha **Bens e Direitos** para copiar linha por linha.
- **Secundária: Camila, 34** — retrospectiva do ano, "gastei mais com o quê?".
- **Terciária: Jorge, 46** — só conferir se o ano fechou no positivo.

## Entrada e saída

- **Entrada:** Financeiro › Gerenciar › Relatórios. Sazonal: pico em março/abril e no fim de ano.
- **Saída:**
  - categoria → `push /finance/transactions` com ano e categoria pré-filtrados
  - exportar → share sheet do sistema (fora do app)
- **Back:** `pop` normal, para o Financeiro.

## Anatomia

Ordem vertical, e o porquê de cada posição:

1. **Header nativo** — large title "Relatórios". `headerRight`: ícone `square.and.arrow.up`
   (exportar). *Exportar é ação de tela inteira, e ação de tela inteira mora no header — não num
   botão azul no fim do scroll (`reports.tsx:184-195`), onde só chega quem rolou tudo.*
2. **Seletor de ano** — segmented no topo, três anos (`reports.tsx:52-55`). Trocar de ano é a
   única navegação da tela; fica antes de qualquer número para o usuário saber o que está lendo.
3. **Card de destaque (o único `GlassCard`) — "O ano em três números"**
   Recebido · Gasto · **Sobrou** (o valor grande, `Fonts.rounded`, `tabular-nums`), com a taxa de
   poupança e a contagem de lançamentos como linha secundária.
   Fonte: `annual_summary`. É o card porque responde a pergunta em um olhar.
4. **"Bens e Direitos em 31/12"** — **sobe de quarto para segundo lugar.** `Row` por conta e por
   bem, valor à direita, cada linha com **copiar** no context menu (a declaração é preenchida
   campo a campo, não em bloco). Fonte: `year_end_balances`.
   Abaixo do título, uma linha explicando o recorte, porque o que **não** está aqui também
   importa na hora de declarar: *"Contas e bens. Dívidas e financiamentos entram em outra ficha e
   não aparecem aqui."* — `year_end_balances` exclui `is_liability` (`0027:84`), e cartão de
   crédito aparece como conta com saldo negativo.
5. **"Para onde foi"** — despesas por categoria, barra + valor. Hoje corta em 12 categorias sem
   avisar (`reports.tsx:127`); passa a mostrar 8 com **"Ver todas as N"** no fim.
6. **"De onde veio"** — receitas por origem. Lista simples, sem barra: quem tem duas fontes de
   renda não precisa de gráfico.
7. **Rodapé de método**, uma linha de texto secundário: *"Só lançamentos confirmados, sem
   transferências entre suas contas."* Hoje essa regra existe só no SQL (`0027:17-19`,
   `status='cleared'` e `kind <> 'transfer'`) e o usuário não tem como saber por que o total não
   bate com o extrato.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Três números | `useAnnualReport(ano)` | `['annual-report', ano]` | RPC `annual_summary` | — |
| Bens e Direitos | idem | idem | RPC `year_end_balances` | — |
| Para onde foi | idem | idem | RPC `annual_by_category` | — |
| De onde veio | idem | idem | RPC `annual_by_category` (`kind='income'`) | — |

Sem realtime de propósito: ano fechado não muda enquanto a tela está aberta, e o ano corrente
reconsulta no focus. É a mesma escolha de `useAiEvents`.

**A correção obrigatória é o `Promise.all` (`use-finance.ts:964`) virar `Promise.allSettled`.**
Com `all`, `year_end_balances` cair leva junto os dois blocos que funcionaram — e é justamente o
bloco que o Rafa veio buscar. Com `allSettled`, cada seção renderiza ou mostra o próprio erro,
que é o que a regra de estados por seção exige. Um hook, uma `queryKey`, três resultados.

## Ação primária

**Exportar o ano.** É o único jeito de o número sair daqui e virar declaração ou planilha.

Hoje `Share.share({ message: montaCsv(...) })` (`reports.tsx:65`) manda o CSV como **texto**: quem
recebe cola num WhatsApp, não abre no Excel. O certo é escrever um arquivo `.csv` e compartilhar o
arquivo (`expo-file-system` + `expo-sharing`) **(novo)**, com nome `relatorio-2026.csv`.

E o separador decimal: `reais()` (`reports.tsx:19`) escreve `1234.56` com ponto, num CSV de
`;` — o Excel em pt-BR lê isso como texto e não soma. Com `;` de separador, o decimal tem que ser
**vírgula**.

## Ações secundárias

- Trocar de ano (segmented).
- Context menu na linha de Bens e Direitos: **Copiar valor** · Copiar nome e valor.
- Toque numa categoria → extrato filtrado por ano e categoria.
- Context menu do header: Exportar CSV · Copiar resumo do ano como texto.

## Estados

- **Loading** — `Skeleton` com a forma final: um bloco alto + duas listas curtas. Cada seção
  resolve sozinha (ver `allSettled` acima).
- **Empty (ano sem lançamento)** — `EmptyState` ícone `calendar`, título "Nada lançado em 2026",
  dica acionável: *"Escolha outro ano aí em cima — ou manda `gastei 45 no mercado` no WhatsApp
  para o ano que vem já nascer pronto."*
- **Empty parcial** — tem despesa e nenhuma conta cadastrada: a seção Bens e Direitos aparece
  mesmo assim, dizendo *"Nenhuma conta cadastrada — cadastre para o saldo de 31/12 sair aqui"*,
  com atalho para Contas. Sumir seria pior: o usuário procuraria a informação e acharia que o app
  não faz.
- **Error** — por seção, com "Tentar de novo".
- **Conteúdo longo** — nome de conta e categoria truncam em uma linha; valor nunca trunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Troca de ano | continuidade espacial | cross-fade do conteúdo em `Motion.fast`; os três números contam de/para |
| Barras de categoria | mudança de estado | `withSpring(Motion.spring.settle)`, stagger 40 ms, cap 400 ms |
| Entrada dos blocos | continuidade | `FadeInDown`, stagger 60 ms (hoje já é assim em `reports.tsx:87`) |
| Copiar valor | feedback | haptic `notificationAsync(Success)` + toast "Copiado" |
| Exportar | feedback | haptic `impactAsync(Light)` antes do share sheet (`reports.tsx:63`, manter) |

## Acessibilidade

- Cada linha de Bens e Direitos anuncia nome e valor por extenso ("Nubank, dois mil e trezentos
  reais em 31 de dezembro").
- Barra de categoria nunca comunica sozinha: a linha diz valor e percentual.
- Valores `selectable` **e** com copiar no context menu — copiar número para o programa da Receita
  é o uso real da tela.
- `accessibilityLabel` no botão de exportar (ícone só).
- Dynamic Type XL: linha de valor quebra para baixo em vez de truncar.
- Seletor de ano anuncia "2026, selecionado".

## Fora de escopo

- **Comparar dois anos lado a lado.** Vira uma tela de BI; quem quer isso exporta os dois CSVs.
- Derivar a lista de anos dos dados (hoje é uma janela fixa de três, `reports.tsx:52`). Só faz
  sentido depois que existir alguém com quatro anos de histórico.
- Gerar PDF ou preencher a declaração. Somos a origem do número, não o programa da Receita.
- Relatório mensal: já existe na aba Financeiro; esta tela é anual de propósito.
- Incluir dívidas nos "Bens e Direitos": `year_end_balances` exclui `is_liability` por decisão de
  domínio (`0027:84`) — juntar as duas fichas induziria ao erro na declaração.
