# Decisões pendentes

Levantadas durante a escrita dos 35 documentos de tela. **Cada uma muda o que vai ser construído**
e nenhuma pode ser resolvida lendo o código — dependem do Gabriel.

Nada aqui está bloqueando a fase 1 (tokens e primitivos). A maioria bloqueia a fase 4.

---

## 1. Produto — semântica que já está no ar e pode estar errada

### 1.1 Dar baixa move a data do lançamento
`useMarkPaid` (`src/hooks/use-finance.ts:464`) faz `occurred_at = paidAt`. Boleto de **agosto**
pago em **setembro** migra de mês em todo relatório anual e em toda soma por categoria.
Pode ser proposital (modelo de caixa puro). Se não for, é distorção silenciosa.
**Opções:** manter (caixa) · manter `occurred_at` e usar só `status`+`due_at` (competência) ·
guardar as duas datas.

### 1.2 `ai_events` não é visível para o parceiro no workspace compartilhado
A policy é `user_id = auth.uid()` **sem `workspace_id`** (`0020_ai_events_visibility.sql:16`).
No workspace de casal, o que o parceiro mandou pelo WhatsApp cria dado compartilhado mas
**não aparece** na tela de Atividade da IA dele. `atividade-ia.md` documenta a recomendação de
deixar como está, com uma faixa dizendo "só as suas mensagens" — **isso é recomendação, não
decisão sua.**
**Opções:** deixar + faixa · adicionar `workspace_id` e trocar a policy (migration).

### 1.3 Criar recorrente pelo app
`recorrentes.md` propõe criar/editar dentro do app. Isso **contraria** o que a tela diz hoje
("criar é exclusivo do WhatsApp"). É uma mudança de posicionamento do produto, não de UI.

### 1.4 Papel `viewer` não faz nada
Nenhuma policy usa `role` (`0010_workspaces.sql:172`). Hoje um `viewer` **escreve igual a um
membro**. `membros.md` deixou o papel fora da UI por isso.
**Opções:** implementar no banco · remover o papel · expor sabendo que é decorativo (ruim).

### 1.5 Tocar numa transação passa a abrir o detalhe, não o form
Muda o hábito de quem já usa: hoje o toque vai direto para edição.

---

## 2. Escopo — bibliotecas fora das duas aprovadas

Aprovadas no plano: `@shopify/flash-list` e `react-native-keyboard-controller`.

| Lib | Para quê | Decisão |
|---|---|---|
| `expo-image-picker` | anexar foto de comprovante numa transação | ⬜ |
| `expo-sharing` | compartilhar comprovante / exportar | ⬜ |
| `react-native-purchases` | paywall (RevenueCat) — já previsto em `docs/IN-APP-PURCHASE.md` | ⬜ |

O bucket `receipts` existe com RLS pronta e `attachment_path` está **sempre null** — não há uma
única chamada de `supabase.storage` no repo. Sem picker, a tela de comprovante não sai do papel.

---

## 3. Backend — mudanças que as telas assumem e ainda não existem

Cada item aqui é migration ou Edge Function, não tela.

| # | O quê | Sem isso |
|---|---|---|
| 3.1 | `ai_events.created_refs jsonb` (ids de qualquer entidade, não só transação) | **Não existe desfazer** para nota, lembrete, meta e parcelada — só `create_expense/income/transfer` registram id hoje |
| 3.2 | O webhook do WhatsApp passar a escrever `profiles.whatsapp_verified` | A coluna existe desde a `0001` e **nada escreve nela** |
| 3.3 | `profiles.onboarded_at` | Onboarding não sabe se já rodou |
| 3.4 | `EXPO_PUBLIC_WA_NUMBER` | Nenhum lugar do app sabe o número para montar `wa.me` |
| 3.5 | `card_summary()` ganhar `status` | A tela não distingue fatura aberta de fechada; o rótulo "fatura aberta" pode mentir |
| 3.6 | RPC `invoice_total(p_invoice_id)` | Total da fatura é somado no cliente sobre lista **sem limit** (`invoice/[id].tsx:39`) — num caminho de dinheiro pode encolher em silêncio |
| 3.7 | RPC `card_invoice_history(account_id, months)` | Não existe caminho para fatura passada |
| 3.8 | RPCs `save_recurring` e `delete_recurring(p_keep_future)` | Delete simples **orfana até 90 dias** de `pending` na projeção; editar não alcança o já materializado |
| 3.9 | RPC `workspace_members_list()` (definer, expõe telefone) | `profiles` é own-row: não dá para listar quem está no workspace |
| 3.10 | RPC `import_batches_list()` + realtime em `import_batches` | Não existe "meus imports" |
| 3.11 | `handle_new_user` (`0029`) checar limite de plano ao aceitar convite | Aceita convite no cadastro **sem checar o limite** — `accept_pending_invites` checa; o caminho do cadastro não |
| 3.12 | Persistir mídia do WhatsApp em `receipts` no `process-jobs` | Comprovante mandado por WhatsApp nunca é guardado |

---

## 4. Convenção a unificar antes da fase 4

- **O que fica no Stack raiz.** `import` foi documentado como `/import`, mas `transaction-form`
  ficou em `finance/`. Escolher uma regra: ou todo fluxo de atenção total sobe para a raiz, ou
  nenhum.
- **Plano é alcançado do Perfil mas mora em `(tabs)/finance/plan`** — o toque troca de aba.
  Alternativa: mover para a pilha do Perfil.
- **`functions.invoke` engole o corpo de 402/422** (`FunctionsHttpError`). Corrigir
  `useImportStatement` é pré-requisito do paywall disparado por importação.

---

## 4b. Resolvido durante a implementação

- **Menu de item no Android.** `Link.Menu` do expo-router é **iOS-only**; usar só ele deixava a
  linha sem ação nenhuma no Android. Resolvido com `showItemActions`/`confirmDestructive`
  (`src/lib/item-actions.ts`): `ActionSheetIOS` no iOS, diálogo de opções no Android. A regra de
  design foi atualizada para dizer isso explicitamente.
- **`ai_events.created_refs` continua pendente e agora tem consequência medida:** o undo do app faz
  `from('transactions').delete().in('id', ids)`, então gravar id de nota ali **inflaria a contagem
  e não apagaria nada, em silêncio**. Por isso `create_note`/`create_reminder` seguem sem desfazer
  — decisão consciente, não esquecimento.
- **Push virou `src/hooks/use-push.ts`** com uma mensagem por causa (simulador, permissão negada,
  EAS não vinculado). O hook antigo engolia o erro do fetch: falha de rede virava "push desativado".

## 4c. Auditoria de segurança (fase 6) — resultado

**Nenhum achado HIGH ou MEDIUM.** A superfície de backend nova é uma migration e quatro Edge
Functions; o resto é cliente, onde a fronteira de confiança é a RLS, não o app.

Verificado e correto: RLS + policy de workspace em `note_folders`; as duas RPCs novas são
`security invoker` com `private.my_workspace_ids()` inline; `toTsQuery` não consegue injetar
operador de `tsquery` (o split só deixa passar letra, dígito e `_`); `query_notes` usa
`plainto_tsquery`, que escapa a entrada; `ensureFolder` grava `workspace_id` e `user_id`
explícitos (correto sob `service_role`, onde `auth.uid()` é null); o deep link de push é
allowlist fechada e o payload não carrega dado do usuário.

Corrigido durante a auditoria:
- `toIlikeTerm` (allowlist testada) no filtro `or=` do PostgREST. **Não era brecha** —
  `URLSearchParams` percent-encoda e a RLS limita ao workspace — mas `compra (mercado)` quebrava
  a busca com 400.
- `Object.hasOwn` no lugar de `in` na allowlist de deep link: `'toString' in ALLOWED` é `true` e
  devolveria uma **função** ao `router.push`, crashando ao tocar na notificação.

**Ficou aberto, com decisão sua:**
1. `dev@proops.local` / `devtest123` no bundle (gate é de UI, não de servidor) — **a conta não
   pode existir no Supabase de produção**.
2. `notes.folder_id` não tem FK composta com `workspace_id`: um usuário poderia apontar a própria
   nota para um UUID de pasta de outro workspace e ver o nome dela (40 caracteres) na resposta do
   WhatsApp. Exige adivinhar um UUID v4 — não explorável. Fechar exigiria unique
   `(workspace_id, id)` em `note_folders` + FK composta.

## 5. Bugs confirmados no código (não são decisão, são conserto)

Estão detalhados no plano; ficam aqui só para não se perderem.

1. `useSaveAsset` (`use-finance.ts:927`) descarta `name`, `class` e `is_liability` no edit —
   não existe como renomear ou reclassificar um bem.
2. `debts.tsx:134` manda `principal_cents == remaining_cents` e sem `id` — **barra de progresso
   sempre 0%** e **editar dívida é impossível**.
3. `_account_balances` não filtra `status` e inclui `credit_card`; `private.cash_total` filtra
   `cleared` e exclui cartão — **Contas e Patrimônio mostram caixas diferentes**.
4. `transaction-form.tsx:96` e `reminder-form.tsx`: com cache frio, **edição vira criação** em
   silêncio.
5. `accounts.tsx:95` manda `payment_account_id: null` fixo — cartão nunca sabe qual conta o paga.
6. Empty state da projeção é inalcançável (`generate_series` sempre retorna linhas).
7. 15 mutations falham em silêncio total (delete, toggle, arquivar, pagar, desfazer).
