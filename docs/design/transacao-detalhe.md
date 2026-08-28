# Lançamento (detalhe) — `src/app/(tabs)/finance/transactions/[id].tsx`

**A tela que não existe hoje.** Tocar numa transação abre direto o modal de edição
(`src/app/finance/transactions.tsx:52-55`) — para *ler* um lançamento o usuário precisa entrar no
formulário que pode alterá-lo. É a origem de metade das correções acidentais.

E é onde mora o dado que o app coletou e nunca mostrou: `merchant`, `invoice_id`, `installment_no`
(no select desde `use-finance.ts:122-123`), `recurring_id` (`0014_forecast.sql:32`), `debt_id`
(`0023_debts.sql:39`) e `attachment_path` (`0017_import_and_rules.sql:119-121`). O bucket privado
`receipts` existe com RLS por workspace desde a `0017` (linhas 203-205 e 208-227) e **não há uma única chamada
de `supabase.storage` no app** — nem um write de `attachment_path` em lugar nenhum do repositório.

## Pergunta que responde

> "O que é esse lançamento, de onde ele veio, e ele está certo?"

## Persona

- **Primária: Rafa, 29** — mandou áudio no WhatsApp. Quer ver **o que a IA entendeu** e o
  comprovante, sem precisar confiar.
- **Secundária: Jorge, 46** — "essa compra caiu em qual fatura?" e "isso é parcela de quê?".
- **Terciária: o casal** — "quem lançou?" e "por que ficou nessa categoria?".

## Entrada e saída

- **Entrada:** `push` da lista de lançamentos; da fatura (`/finance/invoice/[id]`); do bloco
  "A IA registrou" da aba Hoje; deep link de push.
- **Saída:**
  - **Editar** → `modal /finance/transaction-form?id=` (o form continua no Stack raiz).
  - Fatura → `push /finance/invoice/[invoice_id]`.
  - Parcelamento → `push /finance/installments/[installment_plan_id]` (ver `parceladas.md`).
  - Série recorrente → `push /finance/recurring` com a série destacada.
  - Dívida → `push /finance/debts` com a dívida aberta.
  - Comprovante → visualizador em tela cheia (`formSheet`, zoom e fechar).
- **Back:** pop. Se a transação foi apagada aqui, o back é automático e a lista já está invalidada
  (`useDeleteTransaction`, `use-finance.ts:1117`).

## Anatomia

1. **Header nativo** — título é a descrição, truncada. `headerRight`: **Editar** (texto, não ícone —
   é a ação mais usada) e menu `ellipsis.circle` com Mudar categoria · Duplicar · Apagar.
2. **Card de destaque (o único `GlassCard`)** — o **valor**, grande, `Fonts.rounded`,
   `tabular-nums`, com sinal e cor semântica (`danger` / `success` / `textSecondary` para
   transferência). Abaixo: `23 de agosto de 2026 · mercado · Nubank`. É o card porque é a única
   coisa que o usuário veio conferir em três segundos.
3. **"Como isso entrou"** — `Section` opaca, uma linha por fato:
   - **Origem**: `via WhatsApp` / `importado` / `recorrente` / `criado no app` (`source`).
   - **Quem lançou**: só aparece em workspace com mais de um membro (ver a ressalva de rótulo em
     `transacoes.md` — sem RPC nova o app só sabe dizer "Eu" / "Outra pessoa").
   - **Estabelecimento** (`merchant`) — coletado no import e no parcelamento, nunca exibido até hoje.
   - **Criado em** (`created_at`), quando difere de `occurred_at`.
4. **"O que a IA entendeu"** — só quando `source = 'whatsapp'`. Mostra a confiança, o modelo, as
   ações daquele parse e **desfazer**, exatamente como a tela de Atividade da IA
   (`src/app/finance/ai-activity.tsx:104-150`) — mas ancorada neste lançamento. É a resposta direta a
   "categorizou errado e eu não sei por quê".
5. **Comprovante** — miniatura (`expo-image`) quando `attachment_path` existe; toque abre em tela
   cheia. Quando não existe, uma linha discreta **"Anexar comprovante"**.
6. **"Faz parte de"** — `Row`s de navegação, uma por vínculo, e só quando existe:
   **Fatura de setembro · Nubank** (`invoice_id`) · **Parcela 3 de 10 — Magalu**
   (`installment_plan_id`, `installment_no`) · **Recorrente: aluguel** (`recurring_id`) ·
   **Dívida: financiamento do carro** (`debt_id`).
   *Vem depois da IA porque é navegação, não verificação.*
7. **Status** — quando `pending`: faixa com `due_at` e o botão **"Paguei"**. Quando `cleared`, nada:
   o normal não precisa de rótulo.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Lançamento | `useTransaction(id)` **(novo)** | `['transactions','item', id]` | tabela `transactions` (`TRANSACTION_COLUMNS` + `user_id`, `recurring_id`, `debt_id`, `attachment_path`) | `transactions` |
| O que a IA entendeu | `useAiEventForTransaction(id)` **(novo)** | `['ai-events','tx', id]` | RPC `ai_event_for_transaction` **(nova migration)** | — |
| Comprovante | `useReceiptUrl(path)` **(novo)** | `['receipt', path]` | `supabase.storage.from('receipts').createSignedUrl(path, 3600)` | — |
| Fatura | `useInvoice(invoice_id)` | `['invoice', id]` | RPC/tabela já existentes (`use-finance.ts:332`) | `transactions` |
| Desfazer | `useUndoAiEvent()` | — | delete em `transactions` (`use-finance.ts:701`) | — |
| Baixa | `useMarkPaid()` | — | update `status='cleared'` (`use-finance.ts:460`) | — |

Três coisas que **não dá para fazer só no app** e precisam de decisão de backend:

- **Achar o `ai_event` de uma transação** é `created_transaction_ids @> array[id]`
  (`0020_ai_events_visibility.sql:8-9`). Sem índice GIN nessa coluna vira *seq scan*; e a RLS de
  `ai_events` é **own rows** (`0020:15-16`), não workspace — num casal, o parceiro não vê o parse.
  Ou a policy passa a ser por workspace, ou a seção some para quem não escreveu a mensagem. **Não
  inventar um meio-termo silencioso: se não dá para mostrar, a seção não aparece.**
- **Comprovante do WhatsApp não é persistido.** A foto do cupom entra na `parseMessage` e some;
  `attachment_path` continua `null` para sempre. Guardar exige mudança no `process-jobs`
  (baixar a mídia da Meta e subir em `receipts/<workspace_id>/<arquivo>`).
- **Anexar pelo app** exige `expo-image-picker` (hoje só `expo-document-picker` está instalado) e a
  convenção de caminho é obrigatória: **`<workspace_id>/<arquivo>`**, porque a primeira pasta é a
  chave do RLS (`0017:207-227`). Caminho fora do padrão = upload aceito pelo cliente e invisível
  para todo mundo.

## Ação primária

**Conferir e corrigir.** O caminho feliz é: olhar o valor, olhar a categoria, tocar em **Editar** ou
em **Mudar categoria**. Corrigir nunca cria lançamento novo — é `update`, a mesma regra que o prompt
do Gemini segue (`.claude/rules/ai-gemini.md`).

## Ações secundárias

Mudar categoria (menu nativo com `SUGGESTED_CATEGORIES`, sem abrir o form) · Duplicar · Anexar ou
trocar comprovante · Desfazer o parse da IA · **Apagar** (action sheet nativo, texto que diz o que
some: *"Apagar este lançamento? R$ 218,40 em mercado."*) · "Paguei" quando `pending`.

## Estados

- **Loading** — `Skeleton` com a forma: bloco alto do valor + três linhas + um retângulo de
  miniatura. As seções resolvem independentes; o valor aparece antes da IA e do comprovante.
- **Empty** — não existe empty de tela. Existem **seções ausentes**: sem `invoice_id` não há bloco
  de fatura, sem `attachment_path` a área do comprovante vira a linha "Anexar comprovante", sem
  `source='whatsapp'` não há bloco de IA. Nada de cabeçalho vazio para parecer completo.
- **Error** — três sabores, separados: (a) lançamento não encontrado (apagado em outro device via
  realtime) → estado próprio com *"Esse lançamento não existe mais"* e botão "Voltar";
  (b) falha do comprovante (URL assinada expirada, 404 no bucket) → *"Não deu para carregar o
  comprovante"* + "Tentar de novo", sem derrubar o resto; (c) falha da IA → a seção diz que falhou.
- **Conteúdo longo** — descrição de 200 caracteres quebra em até três linhas e depois trunca;
  o valor nunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Entrada da tela | continuidade espacial | push nativo, sem transição custom |
| Blocos | continuidade | `FadeInDown`, stagger 60 ms, cap 300 ms |
| Abrir comprovante | continuidade espacial | miniatura → tela cheia com `sharedTransitionTag`; fechar arrasta para baixo com `Motion.spring.sheet` |
| Mudar categoria | mudança de estado | chip novo faz cross-fade em `Motion.fast`; haptic `selectionAsync` |
| "Paguei" | feedback | faixa de `pending` colapsa em `Motion.fast`; haptic `notificationAsync(Success)` |
| Apagar | feedback | sem animação de saída — o `router.back()` já é a transição; haptic `notificationAsync(Warning)` |

## Acessibilidade

- O valor é o primeiro elemento na ordem de leitura, com label completo: *"Despesa de 218 reais e
  40 centavos"*.
- Miniatura do comprovante com `accessibilityLabel="Comprovante anexado, toque para ampliar"` —
  imagem sem label é o erro clássico aqui.
- Confiança da IA nunca é só uma cor: mostra o número e a palavra ("alta", "média", "baixa").
- `Row`s de vínculo com `accessibilityRole="button"` e destino no label ("Ver fatura de setembro").
- Valores `selectable`; `tabular-nums` em valor, data e "3/10".
- Dynamic Type XL: o valor quebra em duas linhas em vez de encolher.

## Fora de escopo

- Editar dentro do detalhe. Edição é o modal — uma intenção, uma tela.
- Histórico de alterações do lançamento (quem mudou o quê e quando): não existe tabela de auditoria
  e inventar uma para uma tela de leitura é caro demais para o valor.
- Comentário/nota do casal no lançamento. Boa ideia, outra fase.
- Split de despesa entre membros. Muda o modelo de dados inteiro.
