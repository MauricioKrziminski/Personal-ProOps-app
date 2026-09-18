# Auditoria de rotas em tablet — 18/09/2026

Branch: `feat/tablet-adaptive` no worktree `/private/tmp/personal-proops-tablet-20260917`.
Esta é uma matriz de implementação e evidência, não um aceite de interação em aparelho físico.
`Reestruturada` significa composição por largura disponível; `contida` significa superfície de
leitura ou tarefa com largura limitada. As URLs e ações compactas continuam sendo as mesmas.

## Navegação

- Android compacto mantém a pílula; Android médio/amplo usa o rail próprio do Android.
- iPhone e iPad usam `NativeTabs`. Por decisão de Gabriel em 18/09, a barra nativa do iPadOS
  permanece no topo. Os cinco SF Symbols estão declarados no `NativeTabs.Trigger.Icon`; na
  captura do iPadOS 26 a apresentação superior mostra só os rótulos.
- Captura local atual: `/private/tmp/proops-ipad-native-restored.png`. Ela comprova renderização
  da barra nativa em retrato, não toque, animação ou acessibilidade.

## Rotas de uso

| Rota | Tratamento | Evidência nesta sessão |
|---|---|---|
| `/today` | Reestruturada | Código; captura incremental anterior |
| `/notes` | Reestruturada | Código e captura iPad atual da barra nativa |
| `/finance` | Reestruturada | Código; captura incremental anterior |
| `/agent` | Reestruturada | Código e captura iPad da lista e painel inicial |
| `/profile` | Reestruturada | Código; captura incremental anterior |
| `/finance/transactions` | Reestruturada | Código; captura incremental anterior |
| `/finance/[txId]` | Reestruturada | Código; captura atual pendente |
| `/finance/transaction-form` | Contida | Código; teclado pendente |
| `/finance/cycle` | Reestruturada | Código; captura incremental anterior |
| `/finance/accounts` | Reestruturada | Código; captura incremental anterior |
| `/finance/cards` | Reestruturada | Código; captura incremental anterior |
| `/finance/wallet` | Reestruturada | Código; captura incremental anterior |
| `/finance/invoices` | Reestruturada | Código; captura incremental anterior |
| `/finance/invoice/[id]` | Contida | Código; captura atual pendente |
| `/finance/installments` | Reestruturada | Código; captura atual pendente |
| `/finance/budgets` | Reestruturada | Código; captura atual pendente |
| `/finance/goals` | Reestruturada | Código; captura atual pendente |
| `/finance/debts` | Reestruturada | Código; captura atual pendente |
| `/finance/recurring` | Reestruturada | Código; captura atual pendente |
| `/finance/forecast` | Reestruturada | Código; captura incremental anterior |
| `/finance/reports` | Reestruturada | Código; captura incremental anterior |
| `/finance/net-worth` | Reestruturada | Código; captura incremental anterior |
| `/finance/rules` | Reestruturada | Código; captura atual pendente |
| `/finance/plan` | Reestruturada | Código; captura atual pendente |
| `/finance/manage` | Contida | Código; captura atual pendente |
| `/notes/[id]` | Contida | Código; captura atual pendente |
| `/notes/folders` | Reestruturada | Código; captura atual pendente |
| `/notes/folder/[id]` | Contida | Código; captura atual pendente |
| `/notes/archived` | Reestruturada | Código; captura atual pendente |
| `/notes/trash` | Reestruturada | Código; captura atual pendente |
| `/agent/[id]` | Reestruturada | Código; captura de thread atual pendente |
| `/agent/new` | Reestruturada | Código e captura iPad do painel de conversa nova |
| `/profile/alerts` | Contida | Código; captura atual pendente |
| `/profile/members` | Reestruturada | Código e captura iPad em retrato |
| `/reminders` | Reestruturada | Código; captura atual pendente |
| `/reminder-form` | Contida | Código; teclado pendente |
| `/search` | Contida | `Screen` limita a leitura a 800 dp; captura atual pendente |
| `/import` | Contida | `Screen` limita a tarefa a 800 dp; revisão de lote pendente |
| `/import-history` | Contida | `Screen` limita a leitura a 800 dp; captura atual pendente |
| `/paywall` | Contida | `ScrollView` próprio limita o corpo a 800 dp; captura atual pendente |
| `/onboarding` | Contida | Conteúdo e progresso limitados a 600 dp; captura atual pendente |
| `/login` | Contida | Formulário de `AuthScreen` limitado a 560 dp; captura incremental anterior |
| `/login-whatsapp` | Contida | Mesmo `AuthScreen`; OTP e teclado pendentes |
| `/signup` | Contida | Mesmo `AuthScreen`; teclado pendente |
| `/forgot-password` | Contida | Mesmo `AuthScreen`; teclado pendente |
| `/link-email` | Contida | Mesmo `AuthScreen`; teclado pendente |
| `/link-phone` | Contida | Mesmo `AuthScreen`; teclado pendente |

`/` apenas redireciona; `/catalog` e `/design-preview` são ferramentas de QA, fora das rotas
normais de uso. O grupo Financeiro soma 21 destinos incluindo a raiz `/finance`.

## Verificação e pendências

- Após as alterações desta etapa: `npm test` passou com **613/613**, `npx tsc --noEmit`,
  `npm run lint` e `git diff --check` saíram com código zero.
- iPad Air 11 (M4), iPadOS 26.5: capturas locais em retrato da barra nativa, Notas, Agente e
  Pessoas. A tela de Pessoas atual está em `/private/tmp/proops-ipad-members-tablet.png`;
  Agente em `/private/tmp/proops-ipad-agent-root.png` e conversa nova em
  `/private/tmp/proops-ipad-agent-new.png`. Os PNGs são evidência local temporária, não foram
  colocados no Git porque mostram dados de staging.
- Não havia emulador Android conectado na checagem de 18/09. Capturas Android anteriores
  ajudam na revisão incremental, mas não provam o último diff.
- Faltam percorrer cada rota no build atual, paisagem, janela estreita, tema escuro, fonte
  ampliada, teclado, estados vazio/erro, toque, Back, gestos e VoiceOver/TalkBack. O simulador
  desta sessão aceita deep links e capturas, mas não ofereceu controle de toque. Nenhum desses
  itens é inferido dos testes de código.
