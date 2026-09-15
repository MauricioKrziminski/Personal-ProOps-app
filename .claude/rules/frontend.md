# Frontend — Expo Router + TanStack Query

Expo SDK 57 (managed), código em `src/`, paths `@/*` → `src/*` e `@/assets/*` → `assets/*`. **Antes de usar qualquer API do Expo, ler a doc versionada: https://docs.expo.dev/versions/v57.0.0/** (o Expo mudou muito; não confiar em memória).

## Rotas

- Telas em `src/app/`. Abas dentro do grupo `(tabs)/` (tab bar = `AppTabs`/NativeTabs); telas de detalhe e forms fora do grupo, registradas no `<Stack>` do `_layout.tsx` raiz. Forms de criação/edição = `presentation: 'modal'`.
- `typedRoutes` está ligado: navegar com `router.push('/rota')` tipado, nunca strings mágicas erradas.
- Auth gate fica no `_layout.tsx` raiz (`Stack.Protected` por `useSession`). Sem sessão existem
  `login` (e-mail e senha), `signup`, `forgot-password` e `login-whatsapp` (Phone OTP); com sessão
  nenhuma delas existe. Não duplicar checagem de sessão em telas.
  ⚠️ **`verifyOtp` de recuperação já devolve SESSÃO** e o portão desmonta a tela no mesmo
  instante: por isso `forgot-password` pede a senha nova ANTES do código, e `verifyOtp` +
  `updateUser` rodam na mesma função assíncrona. Nada de `setState` depois desse `await`.
  As três telas de conta compartilham a moldura `AuthScreen` (`src/components/auth/`).

## Dados (TanStack Query)

- Todo acesso a dados via hooks em `src/hooks/` seguindo o padrão de `src/hooks/use-items.ts`:
  - `queryKey` por recurso (ex.: `['transactions', filtros]`), `useQuery` com select tipado no supabase-js.
  - **Realtime**: usar `useRealtimeInvalidate(tabela, queryKey)` (já existe em `use-items.ts`) para invalidar quando itens chegam via WhatsApp.
  - Mutações com `useMutation` + `invalidateQueries` no `onSuccess`. Inserts/updates diretos via supabase-js — RLS own-rows protege. **Não existe Edge Function neste projeto**; o que precisa de servidor vai para o agente, por `agentFetch` (`src/lib/agent-api.ts`), que manda o JWT e deixa o servidor tirar o usuário do `sub` — nunca do corpo.
- Cliente Supabase único: `src/lib/supabase.ts` (anon key via `EXPO_PUBLIC_SUPABASE_*`). Nunca instanciar outro client, nunca usar service_role no app.

## Forms

- Sempre **react-hook-form + zod** (`zodResolver`). Schema zod colocalizado com o form.
- **Dinheiro**: sempre `amount_cents` inteiro. Input monetário via `MoneyField` (`src/components/ui/field.tsx`), caminho ÚNICO — digita em centavos, caret preso no fim; exibição via `formatBRL` de `use-items.ts`. **Nunca float, nunca `parseFloat` em dinheiro.**
- Datas exibidas com `formatDateBR`; armazenadas ISO. **Uma grafia só: `28/08/2026`** — leitura
  (`formatDateBR`) e formulário (`isoToBR`) escrevem igual, e um teste em `dates.test.ts` compara
  as duas. Hífen (`28-08-2026`) lembra ISO, que é como o dado é ARMAZENADO, não como se lê.
- **Ordem dos campos, uma régua para o app inteiro** (09/09/2026 — a queixa foi literal, "a
  ordem dos campos está toda bagunçada"):
  - **Form de EVENTO** (lançamento, recorrente): tipo → valor → descrição/estabelecimento →
    categoria → conta → como se divide (parcelas, juros do Pix) → quando → extras.
  - **Form de ENTIDADE** (conta, dívida, meta, bem): nome → tipo → valores → cronograma → conta.
  - **Controle que muda QUAIS campos existem vem antes dos que ele muda.** "Tipo" troca
    "Categoria" por "Para a conta"; "Parcelas" troca o rótulo de "Data" por "Data da primeira
    parcela". Vindo depois, a tela se remonta debaixo do dedo.
  - Campo longo (uma lista de contas) não parte um grupo curto ao meio.
  O lançamento era o fora-da-curva: descrição e estabelecimento ficavam no FIM, depois da data.
- Decimal em texto (percentual, taxa, meses) só por `formatNumberBR` — vírgula, nunca ponto.
  Havia três cópias disso e uma tela sem nenhuma, escrevendo `90.4%` ao lado de `90,4%`.

### Campo obrigatório é campo que BLOQUEIA — e "obrigatório" não é `NOT NULL`

⚠️ **A régua não é o banco, é o registro sair USÁVEL** (15/09/2026). A queixa foi literal —
*"tem campos que teoricamente são obrigatórios preencher mas me deixa eu salvar normalmente?
Isso acontece em mais telas? Esse é um problema sério"* — e auditar por `NOT NULL sem default`
respondia a pergunta errada: a compra parcelada que sumiu do app **salvou limpa no banco**, e era
justamente esse o defeito. O que faltava não era uma coluna, era o NOME.

- **Todo registro que a lista mostra por um nome exige o campo que É esse nome.** Onde a tela cai
  num fallback (`description ?? merchant ?? 'Sem descrição'`, `name || 'Financiamento'`), o
  formulário tem que impedir que se chegue nele. No lançamento **nenhum dos dois** é obrigatório
  sozinho — às vezes só se sabe o estabelecimento, às vezes só o motivo —, mas UM é: o `refine` é
  sobre o par, com o erro embaixo da Descrição.
- **Valor que o registro existe para carregar entra na mesma régua.** Um bem em R$ 0,00 não soma
  no patrimônio nem informa nada na lista — `net-worth` só olhava o nome.
- **Campo com default mostra o default no `placeholder`**, nunca um exemplo diferente dele. O nome
  da dívida sugeria "Financiamento do carro" e gravava "Financiamento": o campo parecia vazio,
  salvava, e a dívida nascia com outro nome.
- **Botão desabilitado sem dizer por quê é o defeito espelho** (§7b do design: erro abaixo do
  campo). Um "Salvar" cinza que não explica é a mesma frustração com outra cara.

**Auditado tela a tela em 15/09/2026, e o resto do app já estava certo:** contas, orçamentos,
metas, recorrentes, regras e membros bloqueiam por `disabled`; lembrete e as quatro telas de conta
bloqueiam por zod com a mensagem; pasta e nota rápida retornam cedo com erro inline. **Não
converter as ~8 telas que guardam à mão para zod** — elas guardam certo, e reescrever é o escopo
que ninguém pediu. O que prende a classe é TESTE: `simple-finance-ui.test.ts` renderiza a tela e
aperta Salvar, e o caso que vale é o formulário incompleto com `writes.length === 0`.

## Plataforma — a decisão mora no primitivo, nunca na tela

**iOS e Android não têm que ficar iguais.** Tela é onde o produto acontece; ela declara *o quê*
(as ações, o destino, o rótulo). *Como* aquilo vira interface em cada sistema é responsabilidade
do primitivo — e é ali que a diferença entre as duas plataformas é decidida de propósito, uma vez
só, com o motivo escrito.

### Os três mecanismos, na ordem de preferência

1. **Arquivo por plataforma** (`foo.tsx` + `foo.ios.tsx` / `foo.android.tsx`) — quando a
   IMPLEMENTAÇÃO diverge: componentes diferentes, árvore diferente, gesto diferente. O Metro
   resolve sozinho e o código da outra plataforma nem entra no bundle.
   - `foo.types.ts` carrega o **contrato** (as props) e os três importam dele. O TypeScript
     resolve `./foo` pelo **arquivo-base**, então sem o tipo compartilhado uma das implementações
     poderia divergir de props sem ninguém perceber até rodar no device.
   - O arquivo-base é a implementação PADRÃO (a que vale onde não houver override), não um
     esqueleto vazio.
   - Exemplos: `search.tsx` + `search.ios.tsx`, `item-link.tsx` + `item-link.ios.tsx`.
2. **`Platform.select` / `Platform.OS` dentro do primitivo** — quando o que muda é um VALOR
   (uma cor, um `behavior` de teclado, um inset) e a árvore é a mesma. Ex.: `app-tabs.tsx`,
   `header-actions.tsx`, `theme.ts`.
3. **`Platform.OS` na tela** — só para regra de NEGÓCIO, não de layout. Ex.: `paywall.tsx`, onde a
   loja não existe na web.

### Por que a regra existe

O app tinha `Platform.OS === 'ios'` em **seis telas**, cinco delas com o mesmo comentário
copiado — `Link.Menu` é iOS-only, então cada tela remendava o Android por conta. E as ações eram
declaradas **duas vezes** por tela: como `<Link.MenuAction>` para o iOS e como array para o
`showItemActions`. Duas sintaxes para o mesmo conteúdo é duas coisas que divergem, e uma tela nova
copia a de antes ou esquece e nasce sem ação no Android.

Hoje isso é `<ItemLink href actions title>`: a tela declara `ItemAction[]` **uma vez** e o
primitivo escolhe o desenho — context menu nativo no iOS, toque longo + sheet no Android.
`ItemAction` carrega `icon`, `destructive`, `disabled`, `selected` e `actions` (submenu), que é o
vocabulário comum das duas plataformas.

**Sintoma de que a regra foi violada:** `Platform.OS` dentro de `src/app/`. Se apareceu ali e não
é regra de negócio, o lugar certo é um primitivo em `src/components/ui/`.

## Estado local

- Preferir estado de servidor (Query) + `useState`. Zustand só se estado global de UI real aparecer (hoje não há nenhum) — não criar store "por via das dúvidas".

## Qualidade

- `npx tsc --noEmit` e `npx expo lint` limpos antes de commitar.
- Componentes reutilizáveis em `src/components/` (subpasta por domínio, ex.: `finance/`); componente usado por uma tela só pode viver inline na tela.
