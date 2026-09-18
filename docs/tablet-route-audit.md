# Auditoria de rotas em tablet — 18/09/2026

Branch: `feat/tablet-adaptive` no worktree `/private/tmp/personal-proops-tablet-20260917`.
Esta é uma matriz de implementação e evidência, não um aceite de interação em aparelho físico.
`Reestruturada` significa composição por largura disponível; `contida` significa superfície de
leitura ou tarefa com largura limitada. As URLs e ações compactas continuam sendo as mesmas.

## Navegação

- Android compacto, médio e amplo usam a mesma `PillTabBar` inferior. A tentativa de rail no
  tablet foi rejeitada por Gabriel em 18/09 e removida; a seleção continua ligada à rota.
- iPhone e iPad usam `NativeTabs`. Por decisão de Gabriel em 18/09, a barra nativa do iPadOS
  permanece no topo. Os cinco SF Symbols estão declarados no `NativeTabs.Trigger.Icon`; na
  captura do iPadOS 26 a apresentação superior mostra só os rótulos.
- Capturas locais atuais: `/private/tmp/proops-ipad-notes-library.png` e
  `/private/tmp/proops-android-tablet-final.png`. Elas comprovam a posição das barras e a
  composição de Notas/Hoje em retrato, não acessibilidade ou tato em aparelho físico.

## Rotas de uso

| Rota | Tratamento | Evidência nesta sessão |
|---|---|---|
| `/today` | Reestruturada | Código; captura incremental anterior |
| `/notes` | Reestruturada | Código e captura iPad atual com quatro pastas na mesma linha e lista de notas; sem painel vazio de prévia |
| `/finance` | Reestruturada | Código; captura incremental anterior |
| `/agent` | Reestruturada | Código e capturas iPad/Android da lista e painel inicial |
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

- Após as alterações desta etapa: `npm test` passou com **609/609**, `npx tsc --noEmit`,
  `npm run lint` e `git diff --check` saíram com código zero.
- iPad Air 11 (M4), iPadOS 26.5: capturas locais em retrato da barra nativa, Notas, Agente e
  Pessoas. A tela de Pessoas atual está em `/private/tmp/proops-ipad-members-tablet.png`;
  Agente em `/private/tmp/proops-ipad-agent-root.png` e conversa nova em
  `/private/tmp/proops-ipad-agent-new.png`. Os PNGs são evidência local temporária, não foram
  colocados no Git porque mostram dados de staging.
- Na raiz de Notas do iPad, a biblioteca ocupa a largura disponível em vez de reservar um painel
  de prévia que não era editável. As pastas ficam em quatro colunas nessa largura e a nota abre
  pela rota existente. No Android tablet, a composição em duas áreas continua.
- O AVD Android tablet (1280×800 dp) foi apontado explicitamente para o Metro local
  `10.0.2.2:8083`. Capturas anteriores à troca vinham da porta 8081 e foram descartadas. A
  captura após o bundle atual, com Hoje em duas áreas e a pílula inferior, está em
  `/private/tmp/proops-android-tablet-final.png`; a tela de Notas com a barra inferior está em
  `/private/tmp/proops-android-notes-final.png`. As três escalas de animação do AVD estavam em
  `0`; foram ativadas em `1` só nesse emulador. Com a barra inferior montada, a posição da mola
  progrediu por valores intermediários de 0 a 1 e passou ligeiramente do destino antes de voltar.
  Isso prova a transição no emulador com movimento habilitado; com movimento reduzido o sistema
  elimina a transição, como documentado pelo Reanimated.
- O AVD Android celular `s26` iniciou. Reinstalei o APK de desenvolvimento local e confirmei no
  manifesto e no gerenciador de pacotes a Activity principal, mas o launcher e `am start` ainda
  retornaram que ela não estava disponível. A preservação do fluxo compacto foi verificada pelo
  código e testes; falta captura atual em um celular Android funcional.
- Faltam percorrer cada rota no build atual, paisagem, janela estreita, tema escuro, fonte
  ampliada, teclado, estados vazio/erro, toque, Back, gestos e VoiceOver/TalkBack. O simulador
  desta sessão aceita deep links e capturas, mas não ofereceu controle de toque. Nenhum desses
  itens é inferido dos testes de código.
