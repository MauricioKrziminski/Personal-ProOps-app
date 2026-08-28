# Metas — `src/app/(tabs)/finance/goals.tsx`

Hoje é `src/app/finance/goals.tsx`, 390 linhas. Cada meta é um `GlassCard` (`goals.tsx:61`) que
carrega tudo dentro: barra, botão `＋ Aportar` que troca por um `MoneyInput` inline (`:91-127`), um
link de texto "ver extrato" (`:129-138`) e o extrato em si (`:140-162`), limitado a 8 linhas
(`:147`). Arquivar é `onLongPress` + `Alert` (`:63`). O emoji faz papel de ícone no título
(`🎯`/`🎉`, `:70`) e no empty (`:226`). Três erros são invisíveis: `useGoalContributions` (`:38`,
desestruturado só como `data`), `useArchiveGoal` (`:39`, sem `onError`) e o próprio arquivamento, que
some sem dizer nada se falhar. E `deadline` existe no schema e na leitura, mas **não tem input
nenhum** — o form só preserva o que já estava lá (`:200`).

## Pergunta que responde

> "Quanto falta, e em quanto tempo eu chego?"

A segunda metade da pergunta é a que hoje não tem resposta: sem `deadline` editável e sem ritmo de
aporte, a tela mostra um percentual e para por aí.

## Persona

- **Primária: Camila, 34** — junta para coisa específica (viagem, reserva). Aporta de propósito, todo
  mês, e quer ver que está no ritmo.
- **Secundária: Rafa, 29** — renda irregular, aporta quando sobra. Para ele o número que importa não é
  o percentual, é *"nesse ritmo, dezembro"*.
- **Casal** — a meta é do workspace (`0010`: unique `(workspace_id, name)`), então o aporte do outro
  aparece no extrato. O extrato existe em parte por isso.

## Entrada e saída

- **Entrada:** `push` da seção "Gerenciar" da aba Financeiro.
- **Saída:** nenhuma navegação para fora. Aportar, editar e ver extrato acontecem em `formSheet`
  sobre a tela — meta é assunto curto, não merece uma pilha.
- **Back:** pop. Nada fica pendente de salvar.

## Como o dinheiro entra e sai da meta (a regra que não pode ser quebrada)

`goals.saved_cents` é **derivado**: é a soma de `goal_contributions`, recalculada dentro de
`goal_deposit` (`0022`). O `+=` no cliente que existia antes perdia aporte quando dois dispositivos
lançavam junto — nenhum caminho novo pode voltar a escrever `saved_cents` direto.

**Aporte não vira `transactions`.** É movimento entre contas do próprio usuário; lançar como despesa
inflaria o gasto do mês e faria o orçamento e a projeção mentirem. A tela precisa dizer isso em uma
linha, porque é contraintuitivo: *"Aporte não entra como gasto do mês — o dinheiro só mudou de
lugar."*

`goal_contributions.amount_cents` tem `check (amount_cents <> 0)`: **negativo é retirada** e o banco
já aceita. Não há UI para isso hoje, e a falta dela é o que faz o usuário "corrigir" um aporte errado
apagando a meta inteira.

## Anatomia

1. **Header nativo** — large title "Metas". `headerRight` = `plus` (`Icon`), abre o `formSheet` de
   nova meta. O botão `＋ Nova meta` sai do fim do scroll (`goals.tsx:283`).
2. **Card de destaque (o único `GlassCard`) — "Guardado"**
   Soma de `saved_cents` de todas as metas ativas, grande, `Fonts.rounded` + `tabular-nums`, com
   `de R$ X em 3 metas` embaixo. Soma no cliente sobre a lista já carregada, mesmo critério do
   destaque de Orçamentos.
   *É o destaque porque é o único número da tela que o usuário guarda na cabeça.*
3. **Lista de metas** — `Card` **opaco**, uma por meta:
   - Nome + `Icon` (`target`, ou `checkmark.seal.fill` quando concluída — emoji nunca).
   - Barra de progresso + percentual.
   - `R$ 1.200 de R$ 3.000 · faltam R$ 1.800`. O "faltam" é o que move, e hoje não existe: a linha
     mostra guardado e alvo e deixa a subtração para o usuário (`goals.tsx:86`).
   - **Ritmo (novo, só cálculo de exibição):** com `deadline` e a data do primeiro aporte, `no ritmo
     de R$ 300/mês, você chega em novembro` ou `precisa de R$ 450/mês para chegar em dezembro`.
     É soma sobre `goal_contributions` já carregado — não é agregação de banco e não precisa de RPC.
   - Ação `Aportar` na própria linha (é a ação primária, tem que ser um toque).
4. **Concluídas** — seção separada no fim, colapsada. Meta batida que continua no meio da lista rouba
   atenção de quem ainda tem meta aberta.

### Aportar — `formSheet` com detent pequeno

`MoneyInput`, uma nota opcional (`goal_contributions.note` existe e ninguém preenche), e dois botões
de intenção: **Guardar** e **Retirar**. Retirar manda o mesmo `goal_deposit` com valor negativo — é
a UI que falta para uma capacidade que o banco já tem. Data é hoje (`localISODate`), sem seletor:
aporte retroativo é caso raro e cabe no extrato depois.

Confirmação: haptic `notificationAsync(Success)`, a barra anda, o sheet fecha. Se cruzar 100%, o
ícone da meta troca para `checkmark.seal.fill` — uma vez, com haptic — e a meta migra para
"Concluídas" na próxima renderização.

### Extrato — `formSheet`, não acordeão dentro do card

Hoje o extrato expande dentro do `GlassCard` e empurra tudo abaixo (`goals.tsx:140`). Vira sheet
próprio, lista completa (sem o `.slice(0, 8)` de `:147`), agrupada por mês, com o total do mês em
cada cabeçalho. Cada linha: data, nota, valor com sinal. Context menu na linha: **Desfazer aporte**
(que é um `goal_deposit` de valor oposto, mantendo o ledger íntegro) · Copiar valor.

A query continua **lazy** — `useGoalContributions(goalId)` só dispara com o sheet aberto
(`enabled: Boolean(goalId)`, `use-finance.ts:1231`). Meta fechada não gasta request, e com 8 metas na
tela isso é a diferença entre 1 e 9 chamadas.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Destaque + lista | `useGoals()` | `['goals']` | tabela `goals` (`archived = false`) | `goals` |
| Extrato (lazy) | `useGoalContributions(goalId)` | `['goal-contributions', goalId]` | tabela `goal_contributions` | `goal_contributions` (na publicação desde a `0022`) — hoje o hook **não** assina; passa a assinar **(novo)** |
| Aportar / retirar | `useGoalDeposit()` | — | RPC `goal_deposit` | invalida `['goal-contributions']` + as chaves de finanças |
| Criar / editar | `useSaveGoal()` | — | `insert`/`update` em `goals` | — |
| Arquivar | `useArchiveGoal()` | — | `update goals set archived = true` | — |

`useSaveGoal` precisa aceitar `deadline` vindo do form **(novo)** — a assinatura já tem o campo
(`use-finance.ts:1180`), quem não manda é a tela.

## Ação primária

**Aportar.** Um toque abre o sheet, um valor, Guardar. É a única ação que muda o número do destaque, e
é o motivo de a meta existir no app em vez de virar uma nota.

## Ações secundárias

- **Context menu nativo** na meta: Aportar · Editar · Ver extrato · Arquivar. Substitui o
  `onLongPress` + `Alert` de `goals.tsx:63`.
- **Arquivar é action sheet nativo**, com o texto certo: *"A meta sai da lista. Os aportes ficam no
  histórico."* — arquivar não apaga `goal_contributions`.
- Editar: nome, alvo e **prazo** (o `deadline` que hoje não tem input).
- Retirar: dentro do sheet de aporte, não escondido em menu.

## Estados

- **Loading** — `Skeleton` com a forma: bloco alto + três cards com barra.
- **Empty (nenhuma meta)** — `EmptyState`, ícone `target`, título *"Nenhuma meta ainda"*, dica:
  *"Manda no WhatsApp: `quero juntar 3000 pra viagem até dezembro` — ou toca em + para criar aqui."*
- **Empty do extrato (meta sem aporte)** — causa diferente, texto diferente: *"Nenhum aporte ainda.
  O primeiro pode ser agora."* + botão Aportar dentro do próprio sheet.
- **Erro da lista** — inline, com "Tentar de novo".
- **Erro do extrato** — dentro do sheet, inline, com retry. Hoje some (`goals.tsx:38`) e o sheet
  aparece como se a meta não tivesse aporte nenhum — o pior erro possível numa tela de dinheiro:
  falha que se parece com dado.
- **Falha ao aportar** — toast persistente + o valor **continua no input**, sheet aberto. Nunca
  fechar o sheet numa falha.
- **Falha ao arquivar** — toast e a meta volta para a lista. Hoje `useArchiveGoal` não tem `onError`
  (`goals.tsx:39`) e a meta simplesmente continua lá, sem explicação.
- **Falha ao salvar** — a mensagem atual ("nome repetido?", `:269`) está certa na intuição: o unique
  é `(workspace_id, name)` (`0010:150`). Manter o texto específico, não trocar por genérico.
- **Conteúdo longo** — nome da meta trunca em uma linha; valores nunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Barra de progresso | mudança de estado | `withSpring(Motion.spring.settle)` no `width`; hoje é `View` com `%` fixo (`goals.tsx:81`) |
| Valor guardado (card e destaque) | mudança de estado | conta de/para em `Motion.base`, `tabular-nums` |
| Meta concluída | mudança de estado | ícone troca com `scale 1 → 1.15 → 1` em `Motion.fast` + `notificationAsync(Success)`. Uma vez, na transição — nunca em cada render |
| Sheet de aporte | continuidade | `Motion.spring.sheet`; teclado por `react-native-keyboard-controller` |
| Meta migrando para "Concluídas" | continuidade espacial | `LinearTransition` em `Motion.base` |
| Arquivar | feedback | card sai com `LinearTransition`; toast "Meta arquivada" com Desfazer |
| Entrada dos cards | continuidade | `FadeInDown`, stagger 60 ms, cap 400 ms |

Sem confete. Delight em momento raro é uma coisa; um efeito de partícula numa tela de dinheiro é
outra.

## Acessibilidade

- Card com `accessibilityRole="button"` e label completo: *"Viagem, mil e duzentos de três mil reais,
  40 por cento, faltam mil e oitocentos"*.
- Progresso com `accessibilityValue={{ min: 0, max: 100, now: pct }}`.
- Concluída não é comunicada só pelo ícone verde: o label diz "concluída".
- Botão só-ícone do header com `accessibilityLabel="Nova meta"`.
- No sheet de aporte, Guardar e Retirar são dois botões distintos com labels explícitos — nunca um
  toggle de sinal, que leitor de tela não consegue anunciar sem ambiguidade.
- Dynamic Type XL: o card quebra em duas linhas; a barra mantém a altura.
- Valores `selectable` e `tabular-nums`.

## Fora de escopo

- **Aporte automático / débito programado.** Exigiria mexer em `transactions`, e aporte não é
  transação — a regra do domínio cai por terra.
- **Vincular meta a uma conta específica.** `goals` não tem `account_id` e criar um saldo espelho de
  conta seria outra fonte de verdade para o mesmo dinheiro.
- **Rendimento sobre o guardado.** Isso é `assets` + `asset_valuations`, na tela de Patrimônio.
- **Meta compartilhada com divisão por membro.** O workspace já é a unidade; dividir aporte por
  pessoa é relatório, não meta.
- Reordenar metas manualmente — a ordem é `created_at` e ninguém reclamou.
