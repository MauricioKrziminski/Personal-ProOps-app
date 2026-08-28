# Patrimônio — `src/app/(tabs)/finance/net-worth.tsx`

Hoje em `src/app/finance/net-worth.tsx` (427 linhas), a tela mais ambiciosa da área e a que mais
esconde de si mesma: quatro queries, **uma** com tratamento de erro (`net-worth.tsx:35`), três
que somem em silêncio (`:36`, `:37`, `:38`). Ela também acumula lista de bens, gráfico de
evolução, score de saúde financeira e o formulário de cadastro no mesmo `ScrollView`, com o form
inline — o mesmo padrão que `contas.md` desfaz.

## A regra que define a tela: histórico é SNAPSHOT

Saldo de conta dá para reconstruir das transações. **Valor de imóvel, de carro, de investimento e
de dívida, não** — não existe histórico deles em lugar nenhum. Por isso o `finance-scheduler` tira
uma foto por dia (`net_worth_snapshots`, `0026_net_worth.sql:81-92`; `_snapshot_net_worth`,
`:156-178`) e `net_worth_series` lê as fotos (`:200-213`). **A série começa quando o usuário
começa a usar, e isso é honesto — reconstruir seria inventar número** (`0026:1-7`).

Duas consequências que a tela precisa assumir, e hoje não assume:

- **O gráfico de um usuário novo tem um ponto.** `net-worth.tsx:136` esconde o bloco inteiro com
  `(serie ?? []).length > 1`, e o texto que explica por quê está **dentro** do card escondido
  (`:161-164`). Quem mais precisa da explicação é exatamente quem nunca a vê. A explicação sai
  do card e vira estado próprio.
- **Valor de bem entra sempre por `update_asset_value`** (`0026:55-79`), que grava em
  `asset_valuations` antes de tocar em `assets.current_value_cents`. Nunca `update` direto na
  coluna. `useSaveAsset` (`use-finance.ts:916-941`) já faz certo — e o comentário na linha 928
  diz o porquê.

## Pergunta que responde

> "Estou ficando mais rico ou mais pobre?"

É a única pergunta do app cuja resposta é uma **tendência**, não um número. O valor de hoje sem a
direção não muda comportamento nenhum.

## Persona

- **Primária: Camila, 34** — organiza tudo, tem investimento e quer ver a curva subir. É quem
  atualiza o valor do Tesouro de vez em quando.
- **Secundária: Jorge, 46** — tem financiamento e cartão. Para ele o número importante é o
  passivo, e o alívio é ver a dívida encolher.
- **Casal** — patrimônio é do workspace: as duas rendas, os dois cartões, a casa. É a tela onde a
  soma compartilhada faz mais sentido.
- **Rafa, 29** — praticamente não usa. Tudo bem: esta tela é de baixa frequência e alto peso.

## Entrada e saída

- **Entrada:** `Financeiro › Gerenciar › Patrimônio`. Baixa frequência, entrada única.
- **Saída:**
  - bem → `push /finance/assets/[id]` (curva do bem) **(tela nova, ver Fora de escopo)**
  - card de saúde → `push /finance/reports`
  - "dívidas" → `push /finance/debts`
  - novo/atualizar bem → `modal /finance/asset-form?id=` **(rota nova)**
- **Back:** pop para Financeiro.

## Anatomia

1. **Header nativo** — large title "Patrimônio". `headerRight`: `plus` → form modal.
   Hoje o botão de criar é um `Pressable` com o glyph `＋` (`net-worth.tsx:325`).
2. **Card de destaque (o único `GlassCard`) — patrimônio líquido**
   Valor grande em `Fonts.rounded`, `tabular-nums`, `danger` se negativo. Abaixo, **a variação**:
   `+ R$ 4.200 em 3 meses`, com seta. Hoje o card mostra só o valor de hoje e a composição
   (`net-worth.tsx:90-134`) — e a composição é a resposta de uma pergunta que ninguém fez.
3. **A curva** — `net_worth_series(12)` em `@shopify/react-native-skia`, com:
   - **linha de zero explícita**. Hoje as barras usam `Math.abs` sobre o máximo
     (`net-worth.tsx:51`, `:142`) e crescem sempre para cima, trocando só a cor
     (`:150`). **Um patrimônio de −R$ 5.000 desenha a mesma barra que +R$ 5.000.** É o gráfico
     dizendo o contrário do dado.
   - **duas séries**: patrimônio líquido e passivo. `net_worth_series` já devolve
     `liabilities_cents` (`0026:201`), a tela busca e joga fora — e é justamente a curva que
     interessa ao Jorge.
   - eixo com o mês e o valor do último ponto.
4. **"Saúde financeira"** — `Card` opaco. Score grande e as quatro parcelas **como linhas
   separadas com peso**, não como frase corrida:
   `Poupança 18% (40 pts) · Orçamentos 92% (25) · Reserva 2,4 meses (20) · Dívida 31% (15)`.
   Os pesos estão no banco (`0027_annual_reports_and_health.sql:129-134`) e são o que diz ao
   usuário **o que mexer**. Hoje é um parágrafo de uma linha só (`net-worth.tsx:185-189`) que
   informa e não sugere nada — exatamente o tipo de alerta que faz desinstalar.
5. **"Bens e dívidas"** — `Section` de `Row`s opacas, ativos e passivos separados, valor com
   `tabular-nums`, passivo com sinal e em `danger`. Cada `Row` mostra **quando foi a última
   marcação** ("atualizado há 4 meses") — é o que denuncia patrimônio velho, e o dado está em
   `asset_valuations.as_of`.
6. **"Dívidas"** — `Row` de navegação para `/finance/debts`. Elas entram no passivo do cálculo
   (`0028_cash_includes_accountless.sql:69-70`) e hoje não há nenhum link daqui para lá.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Patrimônio de hoje | `useNetWorth()` (`use-finance.ts:891`) | `['net-worth']` | RPC `net_worth` | `transactions`, `assets` |
| Curva | `useNetWorthSeries(12)` (`use-finance.ts:905`) | `['net-worth-series','12']` | RPC `net_worth_series` (snapshots) | — |
| Saúde | `useFinancialHealth()` (`use-finance.ts:981`) | `['financial-health']` | RPC `financial_health` | `transactions` |
| Bens | `useAssets()` (`use-finance.ts:874`) | `['assets']` | tabela `assets` | `assets` |
| Última marcação por bem | `useAssetValuations(assetId)` **(novo)** | `['asset-valuations', assetId]` | tabela `asset_valuations` | — |
| Salvar/atualizar | `useSaveAsset()` (`use-finance.ts:916`) | — | RPC `update_asset_value` / insert | — |
| Arquivar | `useArchiveAsset()` (`use-finance.ts:944`) | — | update `archived=true` | — |

**Quatro queries, quatro estados.** Hoje a tela ignora o erro de três: `useNetWorthSeries`,
`useFinancialHealth` e `useAssets` são destruturados só com `data` (`net-worth.tsx:36-38`). Cada
bloco tem uma condição de render que também é a condição de empty (`:136`, `:168`, `:236`) —
então **falha de rede e "ainda não tem dado" produzem exatamente a mesma tela**: a seção some.
O usuário conclui que o app perdeu os bens dele.

Duas observações sobre invalidação:

- `FINANCE_KEYS` (`use-finance.ts:296-301`) tem `['net-worth']` e `['assets']`, mas **não**
  `['net-worth-series']` — e a invalidação do TanStack é por prefixo de elemento, então
  `['net-worth']` não casa `['net-worth-series', …]`. Na prática é quase inofensivo (a série só
  muda quando o cron tira a foto), mas significa que a barra do mês corrente pode ficar velha
  dentro do mesmo dia. Uma entrada a mais na lista resolve.
- `useNetWorth` recalcula na hora (`0026:181-197`) e **não** espera o cron — é por isso que o card
  de destaque e o último ponto da curva podem discordar em algumas horas. Se discordarem visível,
  o rótulo do último ponto diz "hoje (parcial)".

### Um bug de dado a corrigir junto

`useSaveAsset` com `id` chama **só** `update_asset_value` (`use-finance.ts:927-933`). Nome,
classe e `is_liability` do input são descartados em silêncio. A tela hoje esconde o sintoma
mostrando apenas o campo de valor no modo edição (`net-worth.tsx:251-254`) — ou seja, **não
existe jeito nenhum de renomear um bem ou corrigir a classe**, e um bem cadastrado como ativo por
engano fica ativo para sempre. O form modal precisa dos campos completos, e a mutation de update
precisa de um `update` em `assets` além da RPC de valor.

## Ação primária

**Ler a direção.** Uma tela de leitura: o sucesso é o usuário olhar a curva e saber se está indo
bem, em três segundos.

A segunda ação, muito menos frequente e ainda assim essencial, é **remarcar o valor de um bem** —
sem isso a curva congela e a tela vira mentira. Por isso a `Row` mostra "atualizado há N meses":
é o convite, e é o único lugar do app que sabe que o dado envelheceu.

## Ações secundárias

- Context menu na `Row` (`Link.Menu`): Atualizar valor · Ver histórico · Editar · Arquivar.
  Hoje é `onPress` = form inline e `onLongPress` = `Alert` (`net-worth.tsx:197-216`) — o padrão
  proibido, aqui sem nem a legenda que a tela de Contas ao menos tem.
- **Arquivar** com action sheet. `useArchiveAsset` (`use-finance.ts:944-953`) não tem `onError` e
  `net-worth.tsx:213` chama `mutate` sem callback: falha silenciosa, item continua na tela, e o
  usuário toca de novo.
- Novo bem → `modal`.

## Estados

- **Loading** — `Skeleton` com a forma: bloco alto, bloco de gráfico, três linhas.
- **Empty absoluto (sem bem, sem conta, sem dívida)** — `EmptyState` ícone `chart.line.uptrend.xyaxis`,
  título "Seu patrimônio começa aqui", dica: *"Cadastre o que você tem — investimento, imóvel,
  carro. O dinheiro em conta e as faturas já entram sozinhos."*
- **Empty diferente: tem dinheiro em conta, nenhum bem cadastrado** — o card de destaque
  **aparece** com o caixa, e só a seção de bens tem empty. O de hoje (`net-worth.tsx:236-244`)
  fala como se não houvesse patrimônio nenhum, quando o caixa já conta.
- **Empty diferente: sem histórico (0 ou 1 snapshot)** — no lugar da curva, um bloco com o texto
  que hoje está escondido: *"A foto do seu patrimônio é tirada todo dia. A curva aparece a partir
  do segundo mês — não dá para reconstruir o valor de um bem no passado sem inventar número."*
  **Este é o estado mais importante da tela**, porque é o de todo usuário novo.
- **Error, por bloco:** curva, saúde e bens cada um com sua faixa inline e "Tentar de novo". Uma
  seção que falha **diz que falhou** — não some.
- **Conteúdo longo** — nome de bem trunca em uma linha; valor nunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Valor do patrimônio | mudança de estado | conta de/para em `Motion.base` (~250 ms), `tabular-nums` |
| Curva | mudança de estado | path de Skia interpola em `Motion.slow` (~400 ms), `Motion.easing.out` |
| Ponto selecionado na curva | feedback | halo aparece em 120 ms; haptic `selectionAsync` ao passar de mês |
| Score de saúde | mudança de estado | anel/barra com `withSpring(Motion.spring.settle)` |
| Entrada dos blocos | continuidade | `FadeInDown`, stagger 60 ms, cap 400 ms (já existe, `net-worth.tsx:196`) |
| Press em `Row` | feedback | highlight de fundo, 120 ms |
| Valor remarcado | mudança de estado | a `Row` conta de/para em `Motion.base`; haptic `notificationAsync(Success)` |

Hoje as barras são `View` com `height` em `%` (`net-worth.tsx:144-153`): trocar de período
redesenha instantaneamente, sem transição. Valor que salta é bug visual.

## Acessibilidade

- **A curva não é a única leitura.** Ela é `accessibilityRole="image"` com resumo
  ("patrimônio de 38 mil a 52 mil reais nos últimos 12 meses, subindo"), e o card de destaque já
  traz valor e variação em texto.
- Patrimônio negativo **nunca** só por cor (`net-worth.tsx:98` hoje só troca a cor): o valor sai
  com sinal e a label diz "negativo".
- Passivo idem: a label diz "dívida", não confia no `−` e no vermelho (`:228`).
- Score com `accessibilityValue={{ min: 0, max: 100, now }}` e as quatro parcelas em `Row`s
  próprias, cada uma legível sozinha.
- `tabular-nums` e `selectable` em todo valor.
- Dynamic Type XL: a composição do card vira lista vertical; a curva mantém altura mínima e o
  rótulo do eixo cai para dois meses em vez de encolher a fonte.

## Fora de escopo

- **Cotação ao vivo de investimento.** `assets` é marcação manual; puxar preço de mercado seria
  outro produto e outra conta de custo. O que a tela faz é lembrar de remarcar.
- **Reconstruir histórico anterior ao primeiro snapshot.** É a decisão do domínio, e é o motivo
  de a série existir. Não negociar.
- **Curva de cada bem** — `asset_valuations` guarda a marcação de cada bem com data
  (`0026:36-47`) e **nenhuma tela mostra**. É uma tela própria (`/finance/assets/[id]`), pequena:
  uma curva e a lista de marcações. Fica registrada aqui como a próxima lacuna óbvia, e é por
  isso que a `Row` já leva para lá.
- **Metas de patrimônio** ("chegar a 100 mil") — `goals` já resolve metas com aporte; misturar as
  duas coisas confunde ledger com marcação.
- **Projeção futura do patrimônio.** Projeção é de caixa (`cash_flow_forecast`) e tem base em
  compromisso real. Extrapolar a curva do patrimônio seria adivinhação com cara de dado.
