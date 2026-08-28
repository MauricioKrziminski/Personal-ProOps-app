# Recorrência — `src/app/reminder-recurrence.tsx` *(tela nova)*

Hoje a recorrência é uma fileira de cinco chips dentro do form (`src/app/reminder-form.tsx:31-37`):
`Não repete · Todo dia · Toda semana · Todo mês · Todo ano`, cada um gravando literalmente
`FREQ=DAILY`, `FREQ=WEEKLY`, `FREQ=MONTHLY`, `FREQ=YEARLY`.

O problema não é a pobreza da lista — é o que ela faz com o que **já existe no banco**. A IA cria
séries a partir de frases como "todo dia 5" e grava `FREQ=MONTHLY;BYMONTHDAY=5`
(`supabase/functions/_shared/gemini.ts`). Esse valor não bate com nenhum dos cinco chips, então
abrir o lembrete no app mostra **nenhum chip marcado** — e o primeiro toque em qualquer chip
**destrói** a regra que a IA acertou. O caminho mais rápido de estragar um lembrete bom é abrir
ele no app.

`describeRRule` (`src/lib/rrule-text.ts:54`) já sabe ler `INTERVAL`, `BYDAY` e `BYMONTHDAY` e
devolver "todo dia 5", "toda segunda, quarta e sexta", "a cada 2 meses". A leitura está pronta há
tempo; falta a **escrita**.

## Pergunta que responde

> "Repete quando, exatamente?"

E a pergunta silenciosa, que é a que decide se a tela presta: **"o que eu montei aqui quer dizer
o quê?"** — respondida em português, sempre visível, nunca em RRULE cru.

## Persona

- **Primária: Jorge, 46** — "todo dia 5" é o aluguel, "todo dia 10" é a fatura. Dia do mês não é
  refinamento, é o caso mais comum dele.
- **Secundária: Camila, 34** — "toda segunda e quinta" (academia), "a cada 15 dias" (freela).
- **Transversal: qualquer um corrigindo a IA.** A regra veio do WhatsApp; abrir e fechar sem
  mexer tem que devolver a regra **idêntica**.

## Entrada e saída

- **Entrada:** `formSheet /reminder-recurrence`, empilhado no Stack raiz, aberto pela `Row`
  "Repetir" do `reminder-form`. Params de entrada: `rrule` (a regra atual, ou vazio) e `dtstart`
  (a data/hora escolhida no form — é a âncora que decide o dia da semana e o dia do mês padrão).
- **Detents:** `[0.6, 0.95]`. Abre no médio; só cresce quando o usuário abre "Termina em".
- **Saída:** `router.navigate({ pathname: '/reminder-form', params: { …, rrule } })`. A doc do
  expo-router é explícita: `navigate` *"either pushes a new page onto the stack or unwinds to an
  existing route on the stack"* — ou seja, ele volta para a **instância que já está na pilha** do
  form, com a param nova, em vez de empilhar um segundo form. Cancelar = `router.back()` sem
  tocar em nada.
- **O que o back faz:** nada é gravado no banco daqui. Esta tela só monta uma string. Quem salva
  é o `Salvar` do form.

## Anatomia

1. **Grabber e título nativos do `formSheet`** — "Repetir". Sem header desenhado à mão.
2. **Frase de resultado, fixa no topo, sempre visível** — o único `GlassCard` da tela.
   `describeRRule(rrule)` em corpo grande: *"todo dia 5"*, *"a cada 2 semanas, segunda e quinta"*.
   Fica no topo e **não rola junto**: é o feedback de tudo que está embaixo, e feedback que sai da
   tela não é feedback. Quando `describeRRule` não sabe interpretar, ela devolve o RRULE cru
   (`rrule-text.ts:59`) — e nesse caso a frase aparece em `textSecondary` com o rótulo
   *"regra avançada"*, nunca fingindo que entendeu.
3. **Frequência** — segmented: `Não repete · Dia · Semana · Mês · Ano`. Trocar aqui **preserva**
   o que der para preservar (o `INTERVAL` sobrevive; `BYDAY` e `BYMONTHDAY` são descartados com
   a frequência à qual pertencem).
4. **"A cada N"** — stepper com `INTERVAL`, de 1 a 30, rótulo dinâmico ("a cada 2 semanas").
   Escondido quando a frequência é "Não repete". `INTERVAL=1` **não é escrito** na string: `FREQ=WEEKLY`
   e `FREQ=WEEKLY;INTERVAL=1` são a mesma coisa, e a forma curta é a que a IA produz — escrever a
   longa faria a mesma regra parecer diferente dependendo de quem criou.
5. **Detalhe da frequência** — muda com o item 3, é a mesma faixa vertical, nunca duas:
   - **Semana → `BYDAY`**: sete botões redondos `S T Q Q S S D`, multisseleção, com o dia do
     `dtstart` já marcado. Nenhum dia marcado = `BYDAY` omitido (semanal simples).
   - **Mês → `BYMONTHDAY`**: grade de 1 a 31, multisseleção, com o dia do `dtstart` marcado.
     Escolher **31** mostra a nota: *"Em mês que não tem dia 31, cai no último dia."* — é o
     comportamento de `private.day_in_month`, e o usuário precisa saber antes, não em fevereiro.
   - **Dia / Ano** — nada. A faixa some, não vira um bloco vazio.
6. **Termina em** — `Row` que expande: `Nunca` (padrão) · `Em uma data` (`UNTIL`) · `Depois de N
   vezes` (`COUNT`). Fechado por padrão, porque a esmagadora maioria dos lembretes é "nunca".
   `UNTIL` e `COUNT` são mutuamente exclusivos na RRULE — aqui são um segmented de três, então o
   estado impossível não existe na UI.
7. **Botão "Usar esta repetição"**, colado no rodapé do sheet.

**A ordem é a da frase em português**: "a cada 2 · semanas · na segunda e quinta · até 31/12". Quem
lê de cima para baixo lê a frase que está no topo.

## Dados

Zero rede. Tela puramente local — é um editor de string.

| Bloco | Origem | Observação |
|---|---|---|
| RRULE de entrada | param `rrule` do `formSheet` | vem do `useReminder(id)` do form |
| Âncora | param `dtstart` | decide o dia da semana e o dia do mês pré-marcados |
| Leitura → português | `describeRRule` (`src/lib/rrule-text.ts:54`) | já existe e já é testada |
| Estado → RRULE | `buildRRule(state)` **(novo, `src/lib/rrule-text.ts`)** | mesmo arquivo da leitura: a ida e a volta têm que morar juntas |
| RRULE → estado | `parseRRule(rrule)` **(novo, mesmo arquivo)** | é isto que conserta o bug de "nenhum chip marcado" |

`parseRRule` e `buildRRule` entram no `src/lib/rrule-text.test.ts` que já existe, com **o teste que
importa: round-trip**. Para cada regra que a IA sabe produzir — `FREQ=MONTHLY;BYMONTHDAY=5`,
`FREQ=WEEKLY;BYDAY=MO,WE,FR`, `FREQ=DAILY;INTERVAL=2`, `FREQ=MONTHLY;BYMONTHDAY=5;COUNT=12` —
`buildRRule(parseRRule(x)) === x`. Abrir e fechar o sheet sem tocar em nada não pode mudar um
caractere.

Regra que o parser **não** souber ler não vira estado editável: a tela mostra a frase crua, a
faixa *"regra avançada — criada pelo WhatsApp"* e um botão "Substituir" que exige um toque
consciente. Mentir para o usuário editando pela metade é pior que admitir o limite.

## Ação primária

**Montar a regra e ver a frase mudar.** A frase do topo é o produto desta tela; os controles são o
meio.

## Ações secundárias

- "Não repete" — apaga a regra e devolve `null` para o form.
- "Substituir" na regra avançada — troca para o editor, com confirmação.
- Cancelar.

## Estados

- **Loading** — não existe. Nenhuma query.
- **Empty** — "Não repete" selecionado: os blocos 4, 5 e 6 somem e a frase diz *"não repete"*
  (é literalmente o retorno de `describeRRule(null)`, `rrule-text.ts:55`). Um sheet com um controle
  só, não um formulário com quatro seções desabilitadas.
- **Error** — sem rede, sem erro possível. O que existe é **regra não interpretável**, tratada
  como estado próprio no item 2 (`describeRRule` já devolve a string crua nesse caso).
- **Combinação inútil** — `BYMONTHDAY` com dias demais (mais de 4) ganha aviso: *"Isso vai
  disparar 8 vezes por mês."* Não bloqueia; avisa.
- **Conteúdo longo** — a frase do topo quebra em até três linhas e nunca trunca. Ela é o conteúdo.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Abertura do sheet | continuidade espacial | `formSheet` nativo, detents `[0.6, 0.95]`. Zero animação custom |
| Frase do topo mudando | mudança de estado | cross-fade em `Motion.fast` (120 ms). Nunca slide: o texto está sendo lido |
| Troca de frequência | continuidade | a faixa de detalhe entra com `FadeIn` + `LinearTransition` em `Motion.base`; a antiga sai mais rápido |
| Dia da semana / do mês | feedback | fundo em 120 ms, haptic `selectionAsync` — um por toque, nunca em arrasto sobre a grade |
| Stepper do INTERVAL | feedback | número com `tabular-nums`, haptic `selectionAsync` a cada passo |
| "Termina em" expandindo | explicação | `LinearTransition` em `Motion.base`; o sheet cresce para o detent grande |

Nada pisca, nada pula. Tela de precisão: quem está aqui está escolhendo um número.

## Acessibilidade

- A frase do topo é `accessibilityLiveRegion="polite"` / `accessibilityRole="header"` — quem usa
  leitor de tela ouve o resultado a cada mudança, que é justamente o ponto da tela.
- Botão de dia da semana com label por extenso ("segunda-feira"), nunca a letra solta — sete
  botões chamados "S", "T", "Q", "Q", "S", "S", "D" são ilegíveis no VoiceOver.
- Grade de dia do mês com `accessibilityState={{ selected }}` e alvos ≥ 44pt (a grade de 31
  números é o lugar clássico onde o alvo encolhe para 30pt).
- Nota do dia 31 é texto, não tooltip.
- Dynamic Type XL: a grade cai de 7 para 4 colunas em vez de encolher a fonte.

## Fora de escopo

`BYSETPOS` ("toda primeira segunda do mês") · `BYMONTH` · `BYWEEKNO` · `EXDATE` · `RDATE` ·
múltiplas RRULEs · fuso por regra (o fuso é do lembrete, `reminders.timezone`) · editar recorrência
de **lançamento recorrente** — `recurring_transactions` usa o mesmo formato RRULE e deveria reusar
esta tela, mas a integração é outra entrega (`docs/design/` da área financeira).
