# Lembrete (detalhe) — `src/app/reminder-form.tsx`

305 linhas, `presentation: 'modal'` registrado no Stack raiz (`src/app/_layout.tsx:41`) — e é onde
ela continua, junto de `transaction-form` e `import`: form de atenção total não fica dentro da
pilha de uma aba. Criar e editar são a mesma tela; `?id=` decide.

Três defeitos estruturais, todos verificáveis no arquivo:

1. **Ela garimpa o cache para achar o que está editando** (`:59`,
   `reminders?.find((r) => r.id === params.id)`). Cache frio — deep link de push, app reaberto,
   `useReminders` ainda em voo — e `editing` sai `undefined`: o modal de edição vira, em silêncio,
   modal de criação. O usuário salva achando que corrigiu e ganha um lembrete duplicado.
2. **Validação manual** (`:84` `dateError`, `:88` `canSave`) num projeto que já tem
   `react-hook-form@7.81` e `zod@4.4` no `package.json`. Não é dívida por falta de ferramenta.
3. **Quatro `GlassCard` empilhados** (`:119`, `:131`, `:186`, `:205`), header desenhado à mão
   (`ScreenHeader`, `:117`) e emoji em chip (`🔔 Push`, `💬 WhatsApp`, `:39-43`). A contagem
   anti-slop reprova em quatro linhas diferentes.

E um silêncio de produto: `reminders` tem `send_attempts` e `last_error` (migration
`0007_delivery_attempts.sql`), o `send-reminders` desativa a série ao chegar em
`MAX_SEND_ATTEMPTS = 5` (`supabase/functions/send-reminders/index.ts:25,116`) — e **nenhuma tela do
app mostra isso**. O lembrete simplesmente para de chegar.

## Pergunta que responde

> "Me avisa disso — e me avisa mesmo?"

A segunda metade é a que ninguém está respondendo hoje.

## Persona

- **Primária: Jorge, 46** — lembrete é conta a pagar. Lembrete que falhou em silêncio é multa.
- **Secundária: Marina, 26** — cria lembrete a partir de nota ("criar lembrete" no menu do
  detalhe da nota já pré-preenche o título).
- **Transversal:** a maioria dos lembretes **nasce no WhatsApp** com RRULE que a IA montou. Esta
  tela é o lugar de conferir e corrigir o que a IA entendeu — não pode desentender no caminho.

## Entrada e saída

- **Entrada:** `modal /reminder-form?id=<uuid>` (linha da aba Hoje, bloco "Lembretes de hoje"),
  `modal /reminder-form` sem id (criação), deep link de push do próprio lembrete, e "Criar
  lembrete" no menu do detalhe de nota (`?title=`).
- **Saída:** Cancelar → `router.back()` sem salvar. Salvar → `useSaveReminder` e `back()`.
  "Repetir" abre `formSheet /reminder-recurrence` por cima e volta para cá com a RRULE.
- **Back:** modal fecha; nunca bloqueia. **Sem autosave** — ao contrário da nota, aqui o usuário
  agendou um disparo, e salvar meia edição agendaria um disparo errado. Com campo alterado, o
  back pede confirmação em action sheet nativo ("Descartar alterações?").
- **O que o back faz:** `update` já reativa a série e zera o contador (`use-items.ts:142`:
  `active: true, send_attempts: 0, last_error: null`) — salvar **é** o botão de "tentar de novo"
  de um lembrete que morreu. A tela precisa dizer isso, não deixar como efeito colateral.

## Anatomia

Ordem vertical, e o porquê:

1. **Header nativo do modal** — `<Stack.Title>` "Novo lembrete" / "Editar lembrete", `Cancelar` à
   esquerda e `Salvar` à direita. Modal de formulário tem os dois botões no header; o `Pressable`
   roxo no fim do scroll (`:222`) some.
2. **Faixa de falha** — só existe quando `last_error` não é null. Primeiro item da tela, em
   `danger`, com texto humano e um botão: *"Este lembrete falhou 5 vezes e foi desativado.
   Último erro: template não aprovado. **Reativar**"*. Vem **antes** do título porque é a única
   informação da tela que explica por que o produto não fez o que prometeu.
3. **Título** — `TextInput` sem card, largura total, `autoFocus` só na criação (o `:126` já acerta
   isso). Placeholder *"Ex.: pagar o aluguel"*.
4. **Quando** — `Card` opaco: chips "Hoje" · "Amanhã" · "Semana que vem" + data, e a linha de
   horários (`HOURS`, `:45`). O aviso de horário passado (`:179`) continua, sem o emoji.
5. **Repetir** — uma `Row` que mostra a recorrência **em português** via `describeRRule`
   (`src/lib/rrule-text.ts:54`) e abre o `formSheet` de recorrência. Não são mais quatro chips:
   ver `docs/design/lembrete-recorrencia.md`.
6. **Onde avisar** — segmented `Push · WhatsApp · Os dois`, com ícone SF (`bell`,
   `bubble.left.and.bubble.right`), nunca emoji. Abaixo, a frase que já existe (`:218`) — *"Push é
   grátis; WhatsApp usa um template pago"* — agora com consequência: **push desligado no aparelho
   → aviso e atalho para ativar**, porque sem `expo_push_token` o canal "push" não entrega nada.
7. **Card de destaque (o único `GlassCard`) — "Próximo disparo"**
   Data e hora por extenso, em `Fonts.rounded` com `tabular-nums`, mais a recorrência em
   português. É o resultado do formulário inteiro numa frase: *"Sexta, 5 de setembro, 09:00 · todo
   dia 5"*. Fica no fim porque é confirmação, não entrada — o usuário lê antes de tocar em Salvar.
8. **Pausar / Apagar** — só em edição, no fim, com action sheet nativo no apagar.

**O campo de fuso não aparece.** `timezone` vai do aparelho (`deviceTimezone()`, `:47`), e é isso
que o cron usa. Expor um seletor aqui só criaria uma forma de o lembrete disparar na hora errada.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Lembrete em edição | `useReminder(id)` **(novo)** | `['reminders','item',id]` | `reminders` (`.eq('id',id).maybeSingle()`) | `reminders` |
| Salvar | `useSaveReminder` (existe, `use-items.ts:134`) | — | `reminders` insert/update | — |
| Pausar / retomar | `useToggleReminder` (existe, `:157`) | — | `reminders` update | — |
| Apagar | `useDeleteReminder` (existe, `:169`) | — | `reminders` delete | — |
| Push ligado? | `usePushRegistration()` **(novo, compartilhado com Perfil)** | `['profile','push']` | `profiles.expo_push_token` | — |

`useReminder(id)` é a correção do bug: query própria, `enabled: !!id`, com **loading e erro
próprios**. Enquanto ela não resolve, a tela não decide se é criação ou edição — e nunca cai em
criação por omissão.

`useReminders()` continua devolvendo `id, title, recurrence, next_run_at, channel, active`
(`use-items.ts:72`). O detalhe precisa de mais: **`send_attempts`, `last_error` e `timezone`
entram no select de `useReminder`** — não no da lista, que não os usa.

## Ação primária

**Salvar um lembrete que vai disparar.** Não "preencher o formulário": o sucesso é o card
"Próximo disparo" mostrando uma data que o usuário reconhece como certa.

## Ações secundárias

- Pausar / retomar (`useToggleReminder` — retomar já limpa `last_error`, `use-items.ts:161`).
- Reativar depois de falha — mesma mutation, rótulo diferente e explicação junto.
- Apagar — action sheet nativo, nunca `Alert` de dois botões improvisado.
- Abrir a recorrência avançada.

## Estados

- **Loading (edição)** — `Skeleton` com a forma final: linha de título, dois blocos de chips, um
  card alto no fim. **Nunca** renderizar o form vazio "enquanto carrega": é exatamente esse atalho
  que hoje produz o bug de `:59`.
- **Empty** — não existe. Modo criação **é** a tela vazia.
- **Erro de carregamento** — lembrete não encontrado (apagado em outro aparelho): estado próprio,
  ícone `bell.slash`, *"Esse lembrete não existe mais."* + "Voltar". Não cair em modo criação.
- **Erro de salvamento** — o texto de hoje (`:236`, *"Não deu para salvar. Tenta de novo."*) vira
  toast persistente **e os campos ficam preenchidos**. Nada digitado se perde.
- **Estado de falha de entrega** — a faixa do item 2. Com `send_attempts > 0` e `active`, texto
  mais leve: *"Tentamos avisar 2 vezes e não deu. Vamos tentar de novo."*
- **Canal impossível** — canal `push`/`both` com `expo_push_token` null: aviso inline
  *"Notificação está desligada neste aparelho — esse lembrete só chega pelo WhatsApp."* com atalho
  para Perfil › Notificações. É um erro de configuração, e o lugar de mostrar é aqui, na hora.
- **Conteúdo longo** — título quebra em até duas linhas no card de destaque; data nunca trunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Abertura do modal | continuidade espacial | apresentação nativa do `Stack`, `Motion.spring.sheet`. Nada custom |
| Card "Próximo disparo" ao mudar data/hora | mudança de estado | cross-fade do texto em `Motion.fast` (120 ms); `tabular-nums` evita salto de largura |
| Chip selecionado | feedback | fundo em `Motion.fast`, haptic `selectionAsync` |
| Faixa de falha ao reativar | mudança de estado | sai com `LinearTransition` em `Motion.base`; haptic `notificationAsync(Success)` |
| Salvar | feedback | botão do header vira spinner in-place; haptic `notificationAsync(Success)` no fechamento (já existe em `:103`) |
| Teclado | continuidade | `react-native-keyboard-controller` — sem `KeyboardAvoidingView` com `behavior` chutado por plataforma (`:113`) |

## Acessibilidade

- Cada chip com `accessibilityRole="button"` e `accessibilityState={{ selected }}`.
- Segmented de canal anuncia a opção **e** o custo ("WhatsApp, usa template pago").
- Faixa de falha com `accessibilityRole="alert"` — quem usa VoiceOver não pode depender de ver
  vermelho para saber que o lembrete morreu.
- Data e hora com `accessibilityLabel` por extenso ("cinco de setembro, nove horas"), não
  "05/09 09:00".
- Alvos ≥ 44pt em todo chip; o chip de hora é pequeno demais hoje.
- Dynamic Type XL: os chips quebram para várias linhas em vez de encolher a fonte.

## Fora de escopo

Snooze com duração customizada (adiar 1h / amanhã mora na linha da aba Hoje) · anexar nota ou
transação ao lembrete (não existe FK e não serve a nenhuma persona) · lembrete por localização ·
lembrete compartilhado com o workspace (`reminders` é own-rows por `user_id`, e mudar isso é
decisão de produto, não de tela) · seletor de fuso · escolher o template de WhatsApp.
