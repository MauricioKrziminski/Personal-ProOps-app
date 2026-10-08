# Frontend — Expo Router + TanStack Query

Expo SDK 57 (managed), código em `src/`, paths `@/*` → `src/*` e `@/assets/*` → `assets/*`. **Antes de usar qualquer API do Expo, ler a doc versionada: https://docs.expo.dev/versions/v57.0.0/** (o Expo mudou muito; não confiar em memória).

## Rotas

- Telas em `src/app/`. Abas dentro do grupo `(tabs)/` (tab bar = `AppTabs`/NativeTabs); telas de detalhe e forms fora do grupo, registradas no `<Stack>` do `_layout.tsx` raiz. Forms de criação/edição = `presentation: 'modal'`.
- `typedRoutes` está ligado: navegar com `router.push('/rota')` tipado, nunca strings mágicas erradas.
- Auth gate fica no `_layout.tsx` raiz (`Stack.Protected` por `useSession`). Sem sessão existem
  `login` (e-mail e senha), `signup`, `forgot-password` e `login-whatsapp` (Phone OTP); com sessão
  nenhuma delas existe. Não duplicar checagem de sessão em telas.
  **`verifyOtp` de recuperação já devolve SESSÃO**, e no cliente principal o portão
  desmontaria a tela com a senha ainda por escolher. Por isso `forgot-password` (e-mail →
  código → senha nova) roda `verifyOtp` e `updateUser` num cliente DESCARTÁVEL
  (`criarClienteDeRecuperacao`, só memória) e só depois da troca entrega a sessão ao principal
  com `setSession` — daí é um `SIGNED_IN` comum. "Cancelar" revoga a sessão de recuperação; a
  entregue nunca é revogada. Nada de `setState` depois do `setSession` que deu certo: a tela já
  está saindo.
  As três telas de conta compartilham a moldura `AuthScreen` (`src/components/auth/`).

## Dados (TanStack Query)

- Todo acesso a dados via hooks em `src/hooks/` seguindo o padrão de `src/hooks/use-items.ts`:
  - **`useQuery`/`useInfiniteQuery` vêm de `src/lib/consulta-em-foco.ts`, nunca do pacote**
    (06/10/2026): fora de foco a consulta não assina o cache (`subscribed`), então realtime e
    invalidação só a marcam velha e ela refaz ao voltar ao foco. Antes, cada evento refazia as
    consultas de todas as telas montadas por baixo. `consulta-em-foco.test.ts` prende o import.
  - `queryKey` por recurso (ex.: `['transactions', filtros]`), `useQuery` com select tipado no supabase-js.
  - **Realtime**: usar `useRealtimeInvalidate(tabela, queryKey)` (já existe em `use-items.ts`) para invalidar quando itens chegam via WhatsApp.
  - Mutações com `useMutation` + `invalidateQueries` no `onSuccess`. Inserts/updates diretos via supabase-js — RLS own-rows protege. **Não existe Edge Function neste projeto**; o que precisa de servidor vai para o agente, por `agentFetch` (`src/lib/agent-api.ts`), que manda o JWT e deixa o servidor tirar o usuário do `sub` — nunca do corpo.
- Cliente Supabase único: `src/lib/supabase.ts` (anon key via `EXPO_PUBLIC_SUPABASE_*`). Nunca instanciar outro client, nunca usar service_role no app.

### O portão da tela só aceita CONSULTA

**`useTelaPronta` recebia `Consulta | boolean`, e o booleano prendia a tela no skeleton para
sempre** (16/09/2026). Financeiro e Lançamentos passavam `range.pronto`, que é
`Boolean(cycle_range.data)`: com o `cycle_range` falhando ele ficava `false` e a tela não saía do
esqueleto — sem card de erro, sem "Tentar de novo", sem log. Reproduzido no emulador injetando a
falha. Um booleano não diz a única coisa que o portão precisa saber: **se ainda tem alguém
tentando**. Uma consulta diz — pendente buscando segura, com erro libera, desligada libera.

- **Condição derivada entra pela CONSULTA de onde ela deriva.** `useMonthRange` devolve uma
  `Consulta` por isso, com `isError`, `refetch` e as bordas. A assinatura só aceita consulta, e
  `anti-slop.test.ts` quebra se alguma tela voltar a passar `.pronto`, `true`, `false` ou `!x`.
- **`range.pronto` tem UM trabalho: ligar a consulta que usa as bordas** (`enabled`).
  `useTransactions` e `useTransactionsSummary` só buscam com ele; buscar com o palpite civil dava
  o número de outro período sob o rótulo do ciclo, e para sempre se as bordas falhassem.
- **Consulta desligada fica `isPending` para sempre.** Quem desenha skeleton por `isPending`
  testa a falha do que a desliga ANTES — senão o bloco fica em esqueleto com o portão já aberto.
- **`refetch()` do TanStack ignora `enabled`.** O "Tentar de novo" refaz as bordas quando elas
  falharam e só refaz o que depende delas quando elas já chegaram (`refazerPeriodo`).
- **Afirmar vazio exige `isSuccess`**, não `!isLoading`: com a consulta desligada ou com erro o
  `!isLoading` é verdadeiro e a tela dizia "sem movimento" embaixo de um herói que falhou.

`simple-finance-ui.test.ts` renderiza as três telas com o `cycle_range` falhando e prende o
card de erro e a recuperação.

## Forms

- Sempre **react-hook-form + zod** (`zodResolver`). Schema zod colocalizado com o form.
- **Dinheiro**: sempre `amount_cents` inteiro. Input monetário via `MoneyField` (`src/components/ui/field.tsx`), caminho ÚNICO — digita em centavos, caret preso no fim; exibição via `formatBRL` de `use-items.ts`. **Nunca float, nunca `parseFloat` em dinheiro.**
- Datas exibidas com `formatDateBR`; armazenadas ISO. **Uma grafia só: `28/08/2026`** — leitura
  (`formatDateBR`) e formulário (`isoToBR`) escrevem igual, e um teste em `dates.test.ts` compara
  as duas. Hífen (`28-08-2026`) lembra ISO, que é como o dado é ARMAZENADO, não como se lê.
- **Ordem dos campos, uma régua para o app inteiro** (09/09/2026 — a queixa foi literal, "a
  ordem dos campos está toda bagunçada"):
  - **Form de EVENTO** (lançamento, recorrente): tipo → **título → estabelecimento → valor** →
    categoria → conta → como se divide (parcelas, juros do Pix) → quando → extras.
  - **Form de ENTIDADE** (conta, dívida, meta, bem): nome → tipo → valores → cronograma → conta.
  - **O campo que NOMEIA o registro vem primeiro e leva o `autoFocus`** — a régua de
    entidade, generalizada em 15/09/2026. Ela já valia em 4 das 6 telas (`accounts`, `goals`,
    `debts`, `net-worth` abrem no "Nome", com o foco nele); só os dois formulários de EVENTO
    abriam pelo valor, e a linha acima dizia que estava certo. Eram duas decisões do mesmo repo
    se contradizendo, e a pergunta foi literal: *"nao era melhor ser titulo, estabelecimento e
    valor? Esse nao seria o padrao?"* Era.
  - **Controle que muda QUAIS campos existem vem antes dos que ele muda.** "Tipo" troca
    "Categoria" por "Para a conta"; "Parcelas" troca o rótulo de "Data" por "Data da primeira
    parcela". Vindo depois, a tela se remonta debaixo do dedo.
  - Campo longo (uma lista de contas) não parte um grupo curto ao meio.
- **Campo obrigatório se vê ANTES de salvar** (06/10/2026, *"o usuário só descobre quando clica
  em salvar"*): `Field obrigatorio` desenha um ` *` cinza no rótulo (e ", obrigatório" no leitor
  de tela). A régua é o GUARDA do salvar (zod, `podeSalvar`, `disabled`), nunca o `NOT NULL`;
  campo com default válido (data de hoje, seletor) não leva; o condicional recebe a MESMA
  condição do guarda. Campo novo que bloqueia o salvar nasce com a prop.
- **O lado do dinheiro fica à vista** (06/10/2026, hipótese criada como "Entra" sem a pessoa ver):
  o Tipo é `Segmented` no topo (lançamento, série, hipótese) e o `MoneyField` repete o lado no
  número — `sinal="entra"` é `+ R$` verde, `"sai"` é `− R$` vermelho (pedido do dono do produto,
  exceção declarada ao "vermelho é erro"); transferência sem sinal.
- Decimal em texto (percentual, taxa, meses) só por `formatNumberBR` — vírgula, nunca ponto.
  Havia três cópias disso e uma tela sem nenhuma, escrevendo `90.4%` ao lado de `90,4%`.

### Tudo que se cria se edita (26/09/2026)

*"tudo que ele conseguir criar ele deve poder editar (que realmente fizer sentido)"* — regra do
dono do produto para o app inteiro.

- **Editar abre os MESMOS campos da criação**, do mesmo componente (`CamposDaSerie`,
  `CamposDaCompra`): duas cópias divergem, e foi assim que editar ficou sem metade dos campos.
- **Trava no banco é decisão nossa, não lei.** Onde a edição faz sentido, a trava sai e o banco
  recalcula. A que fica tem motivo LÓGICO (a parcela paga numa fatura quitada não muda de fatura)
  e a frase diz o motivo e o caminho ("desfaça o pagamento da fatura").
- **O que tem ação tem desfazer**: pagar, quitar à mão, adiar, dar baixa — cada um se desfaz pelo
  próprio registro (apagar/editar o pagamento) ou por uma ação "Desfazer…"/"Desmarcar…".
- **Todo arquivável tem "Arquivadas · N" com Desarquivar no fim da própria lista** (28/09/2026):
  contas, cartões, metas e bens se arquivavam e SUMIAM — nenhuma tela os listava, e o único
  caminho de volta era o "Desfazer" do aviso. O caminho único é `SecaoDeArquivados`
  (`components/ui/`, com `useArquivados`/`useDesarquivar`); dívidas e notas já tinham o seu.
- **Registro que o app não sabe desenhar** (regra de repetição do WhatsApp) aparece por extenso e
  se troca num toque consciente ("Substituir"), nunca num formulário que mente o valor.
- Botão novo de editar = linha nova em `docs/AGENTE-PARIDADE-COM-O-APP.md`.
- **A pergunta de alcance depende do que a pessoa ABRIU** (28/09/2026, *"faz sentido ele ter as
  3 perguntas já que eu não estou dentro de uma parcela em específico?"*). Uma ocorrência aberta
  (o lançamento de uma parcela, ocorrência ou pagamento; o lembrete aberto pela Hoje) pergunta
  "Só esta / Esta e as próximas / Todas". O contrato ou a série (ficha da dívida, Recorrentes,
  "Editar a compra", o lembrete pela lista) pergunta só "Das próximas em diante / Todas"
  (`askEditScope(..., { contrato: true })`). E não pergunta quando a escolha não muda nada:
  nada alterado, nenhum passado (dívida sem pagamento, compra sem parcela antes da próxima) ou
  campo que é sempre do contrato inteiro (nº de parcelas, pagas).

### Painel de número abre o DETALHE dele, e só isso (08/10/2026)

*"Tem lugar que você clica que vê o detalhe e tem lugar que mostra as opções… o usuário tem que
adivinhar onde clica"* e *"se eu clico no gráfico eu tenho um objetivo de ver sobre aqueles
valores… não ver categorias"*. O painel (`HeroPanel` em Finanças, `DinheiroDoDia` na Hoje) faz UMA
coisa ao toque — em qualquer ponto, número ou gráfico: abre "Como chego nesse valor", a conta do
número. Sem "…" e sem "i" no painel: a explicação do cálculo vai no fim da folha, e os atalhos dela
são só sobre esses números (o ciclo, o que entra, o que sai, a Projeção). Destino sem relação com o
número (Patrimônio, Metas, Categorias) mora nos Atalhos/Gerenciar. O "›" ao lado do número é o
sinal de que ele abre.

### Lista que se ABRE dentro de outra coisa: a linha do tempo (08/10/2026)

*"Quando abrir uma lista de algo que eu expandi ele tem que ficar bonito e padronizado"*. As partes
de um contrato ou de um grupo — parcelas de financiamento e de compra parcelada, compras da fatura
no ciclo — usam `LinhaDoTempo` (`components/finance/linha-do-tempo.tsx`): trilho à esquerda, nó do
estado (paga, próxima com fundo, futura, `item`), título e apoio em letra de corpo, valor à direita.
"A seguir" e "Já pagas" com `SectionHead`. Lista nova desse tipo nasce nela, não num `Row` solto.

### Lista: do mais recente para o mais antigo, e aos poucos (24/09/2026)

*"em tudo tem que ser do mais recente para o mais antigo… sempre preze pelo lazy loading,
carregando de pouco em pouco e clicando para ver mais"* — do ciclo, que vinha do mais antigo e
inteiro de uma vez.

- **Ordem.** Lista de HISTÓRICO ou de PERÍODO (ciclo, fatura, pagamentos, importação, alertas,
  lançamentos, contas, metas, membros) vem do mais recente para o mais antigo. Contrato com passado
  e futuro (financiamento, parcelas de uma compra) se divide em **"A seguir"** (a próxima primeiro)
  e **"Já pagas"/"Pagas"** (a mais recente primeiro). AGENDA do que vem (O que vence, Próximos
  dias, lembretes, recorrentes, meses da Projeção) mostra o mais próximo primeiro — ali "mais
  recente" poria o mais distante no topo. Exceção confirmada pelo dono do produto (24/09/2026):
  *"as telas que realmente não fizerem sentido, pode manter a ordem normal"*.
- **Aos poucos.** Lista que chega inteira de uma RPC desenha `PASSO` (20) por vez com `VerMais`
  (`components/ui/ver-mais.tsx`, `hooks/use-aos-poucos.ts`: `useAosPoucos` e `useJanelasPorGrupo`);
  lista que cresce sem fim pagina no servidor (`useInfiniteQuery` ou o limite que cresce pelo
  "Ver mais", com `keepPreviousData`). **Teto fixo em silêncio (`limit(100)`) é defeito**: o 101º
  some da tela sem aviso. Total e agregado (soma do mês, "Comprometido") contam a lista INTEIRA,
  nunca só o que está visível.
- Um rótulo: **"Ver mais"** (com a contagem quando se sabe).

### Quantidade é campo ABERTO, nunca lista de atalhos (22/09/2026)

*"essas coisas assim nunca devem ser fixadas, deve ser totalmente aberta"* — do "Adiantar"
que ia do 3 direto para o 6. Havia a mesma lista em mais cinco lugares: parcelas do lançamento
(sem 5x, 7x, 8x), do editor da compra e do "E se…", e "a cada N" / "quantas vezes" do lembrete.
O caminho único é `QuantityField` (`src/components/ui/quantity-field.tsx`): digita qualquer
número, − / + para o ajuste, `min`/`max` da régua real (`faixaDeParcelas`: 1..72, mínimo 2 com
parcela travada).

**O limite que MUDA por causa de outro campo ajusta o valor sozinho — nunca vira erro**
(22/09/2026, segunda decisão do mesmo dia). Escolher 8 parcelas e mudar o mês do pagamento para
um em que restam 5 primeiro virou erro que travava a hipótese; o dono do produto pediu o
contrário: *"sempre que for possível ser automático, fazer automático ao invés de mostrar erro"*.
O que NÃO pode voltar é o defeito original: o campo dizer 8 e a hipótese gravar 5. Por isso o
número assentado é UM só e todos leem dele:

- `QuantityField` devolve por `onChange` o valor assentado quando `min`/`max` mudam — vale para
  toda quantidade do app, sem a tela lembrar.
- No Adiantar, `quantasQueCabem` (`lib/anticipation.ts`) alimenta campo, valor e hipótese; a
  escolha original fica guardada e voltar o mês devolve as 8.
  **A régua do que dá para adiantar é o MÊS, não o dia** (`adiantaveisNoMes`, no `select` de
  `useAnticipationCandidates`). O pagamento cai no dia 1º do mês escolhido, e com a régua do dia
  a parcela de 10/10 seguia "adiantável" pagando em outubro — a tv mostrava 9 em setembro E em
  outubro. A parcela do próprio mês sai nele de todo jeito; cada mês à frente tira uma.
- Data de FIM que o início ultrapassou anda junto (`fimQueSegueOInicio`, `lib/dates.ts`), e o
  calendário do fim recebe `min` = início: recorrente ("Termina em") e lembrete ("Até").
- Contagem que depende de outra (dívida: pagas ≤ total) assenta no teto; digitação em curso não é
  mexida — "1" é o caminho para "12" —, o ajuste vem no `onBlur`.

**Dinheiro digitado NÃO entra nesta regra**: trocar o valor que a pessoa escreveu (retirar da meta
além do guardado, pagar mais que a fatura) seria decidir quanto dinheiro se move por ela. Ali o
campo explica e o botão espera.

### Campo que some não escreve, e controle que não grava não aparece (22/09/2026)

Varredura dos formulários depois do bug acima, mesma classe — valor que ficava no estado quando o
campo sumia, ou tela que mostrava uma coisa e gravava outra:

- **Juros do Pix** seguia no payload depois de trocar a conta para corrente, o tipo para receita
  ou parcelar: gravava uma segunda linha de juros invisível. Uma condição só (`mostraJuros`) no
  campo e no payload, e o hook recusa juro fora de gasto.
- **"Até" do lembrete** mostrava vazio (ou a data antiga) com o UNTIL = hoje gravado por baixo.
  O texto próprio vale só durante a digitação; fora dela o campo mostra a regra, e repetição que
  termina antes do primeiro lembrete trava o salvar.
- **"Tipo" na edição de recorrente** trocava a tela e não a série (a RPC não grava `kind`): virou
  só leitura.
- **Retirar da meta** além do guardado: o banco recusa (`20260922130000`), a tela desliga o botão.
- Transferência zera o "vou pagar depois" (o vencimento escondido travava o Salvar); a dívida diz
  por que o total não pode ficar abaixo das já pagas; o tipo escondido volta ao padrão.

### O campo que NOMEIA o registro: "Nome" em entidade, "Título" em evento

**"Descrição" não é título, e ter os dois confunde** (15/09/2026). A queixa foi literal —
*"tem que ter titulo obrigatorio, descricao nao é titulo… Esta muito confuso o que é titulo e o
que é descriçao, normalmente o titulo vem em cima e com o label titulo… As vezes nao é
estabelecimento que ele vai lançar e sim um titulo de uma compra"*.

**`transactions.description` sempre FOI o título** — é o que toda lista desenha como nome da
linha e o que a RPC de parcelamento emenda em "(1/2)". Ele estava com o rótulo errado, com
`multiline` (cara de parágrafo) e opcional. Foi **renomeado, não duplicado**: uma coluna `title`
nova seria o terceiro campo de nome, que é exatamente a confusão reclamada.

| forma | rótulo do campo-nome | onde |
|---|---|---|
| **entidade** (conta, meta, bem, dívida, pasta) | **"Nome"**, primeiro campo | já estava certo |
| **evento** (lançamento, recorrente, lembrete) | **"Título"**, primeiro do seu grupo | era "Descrição", "Descrição" e "O que lembrar" |

**Estabelecimento é OUTRO dado e continua opcional.** Nem toda compra tem estabelecimento (uma
transferência, um reembolso, um presente), e nem todo estabelecimento é o título que a pessoa
quer ler na lista. Os dois lado a lado, um obrigatório e um não.

A ordem seguiu junto: **tipo → título → estabelecimento → valor** → categoria → conta → como se
divide → quando (ver a régua acima).

### Campo obrigatório é campo que BLOQUEIA — e "obrigatório" não é `NOT NULL`

**A régua não é o banco, é o registro sair USÁVEL** (15/09/2026). Auditar por `NOT NULL sem
default` responde a pergunta errada: a compra parcelada que sumiu do app **salvou limpa no
banco**, e era justamente esse o defeito. O que faltava não era uma coluna, era o NOME.

- **Todo registro que a lista mostra por um nome exige o campo que É esse nome.** Onde a tela cai
  num fallback (`description ?? merchant ?? 'Sem descrição'`, `r.description ?? 'sem descrição'`,
  `name || 'Financiamento'`), o formulário impede que se chegue nele.
- **Valor que o registro existe para carregar entra na mesma régua.** Um bem em R$ 0,00 não soma
  no patrimônio nem informa nada na lista — `net-worth` só olhava o nome.
- **Campo com default mostra o default no `placeholder`**, nunca um exemplo diferente dele. O nome
  da dívida sugeria "Financiamento do carro" e gravava "Financiamento": o campo parecia vazio,
  salvava, e a dívida nascia com outro nome. **Desde 23/09/2026 a dívida não tem mais nome
  padrão**: o "Nome" abre o formulário, é obrigatório ("Dê um nome" quando o resto já está
  preenchido) e a "Conta que paga" vem logo abaixo, opcional — pedido do dono do produto.
- **Botão desabilitado sem dizer por quê é o defeito espelho** (§7b do design: erro abaixo do
  campo). Um "Salvar" cinza que não explica é a mesma frustração com outra cara.

**`recurring` era o pior caso e passou batido na primeira varredura**: `podeSalvar` cobria
valor e datas e **não** o nome, então a série nascia anônima e o materializador a transformava
em doze linhas "sem descrição" — o defeito do lançamento multiplicado por 12.

**Auditado tela a tela: o resto do app já bloqueia** — contas, orçamentos, metas, regras e
membros por `disabled`; lembrete e as quatro telas de conta por zod com a mensagem; pasta e nota
rápida retornam cedo com erro inline. **Não converter as ~8 telas que guardam à mão para zod** —
elas guardam certo, e reescrever é escopo que ninguém pediu. O que prende a classe é TESTE:
`simple-finance-ui.test.ts` renderiza a tela e aperta Salvar, e o caso que vale é o formulário
incompleto com `writes.length === 0`.

### Uma intenção, um rótulo — vale dentro do MESMO arquivo

`debts.tsx` sozinho tinha **três** rótulos para a conta pagadora ("Conta para pagar", "Conta
para pagar (opcional)", "Conta que paga"), **dois** para o valor mensal do contrato ("Valor da
parcela", "Valor da prestação") e **dois** para o histórico ("Parcelas já pagas", "Quantas
parcelas já foram pagas?"). São modos diferentes do mesmo cadastro, não conceitos diferentes.

- O sufixo **"(opcional)" não entra no rótulo** — é explicação, e explicação mora no `hint`
  (§7b). O rótulo diz o que o campo É.
- **Substantivo, não pergunta**, quando existe um rótulo-substantivo para o mesmo dado em outra
  tela. Pergunta continua onde ela É a escolha da tela ("É bem ou dívida?") — ali não há
  duplicata para unificar.
- `"Quanto você pagou"` (a tela de PAGAR, nos dois modos de dívida desde 25/09/2026) continua
  diferente de `"Valor da parcela"` (o cadastro) **de propósito**: um é quanto está saindo agora,
  o outro é o contrato.

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

### Criar e editar um registro financeiro é UM formulário: `/finance/lancar` (29/09/2026)

*"devo conseguir criar tudo direto ali… e não ser redirecionado para a tela deles"* e *"às vezes
ele clicou sem querer, preencheu as informações e agora tem que fechar o modal de recorrente e
perder tudo"*. Eram três formulários em três telas (o lançamento, a folha de Recorrentes, a de
Dívidas), costurados por `?de=`, "Voltar" e `dismiss(2)`. Hoje é uma tela modal só, com
`FormatoDoLancamento` no topo: escolha atual em destaque e alternativas **Uma vez | Recorrente | Financiamento** abertas no lugar (spec
`2026-09-29-formulario-unico-e-categorias-design.md`):

- **Três corpos, um contrato.** `components/finance/formulario-do-lancamento.tsx`,
  `formulario-da-serie.tsx` e `formulario-da-divida.tsx` recebem `CorpoProps`
  (`corpo-do-lancar.ts`). O hospedeiro (`app/finance/lancar.tsx`) desenha o seletor, lê os campos
  comuns (`Comum`, `lib/lancar.ts`: tipo, título, valor, conta, data, categoria, estabelecimento) e
  os entrega ao corpo seguinte. Os campos continuam os da criação (`CamposDaSerie`,
  `CamposDaCompra`) — nada copiado.
- **Trocar de tipo não perde nada.** O estado INTEIRO de cada corpo fica guardado por tipo
  (`registrarEstado`/`estadoGuardado`): voltar a Recorrente devolve a frequência e o fim, não só
  o comum. A troca é um crossfade curto só no conteúdo abaixo do seletor (sem movimento com
  Reduzir Movimento); o toque durante a saída vale só o último.
- **"Salvar e criar outro"** remonta o corpo limpo e mantém tipo, conta e data
  (`comumDepoisDeSalvar`) — lançar três contas seguidas sem reabrir nada.
- **Editar abre no tipo do registro.** Trocar o tipo e salvar PERGUNTA o alcance e converte
  (`opcoesDaConversao`, `converter_registro`; a régua mora em `finance.md` → *Mudar o tipo de um
  registro*); voltar ao tipo original antes de salvar é edição comum.
- **Os atalhos de tipo são UMA lista** (`ATALHOS_DE_LANCAMENTO`, rótulo e ícone): os menus
  "Lançar" da Hoje e das Finanças, e cada um abre `hrefDoLancar(tipo)`. Escritos à mão por tela, a
  Hoje ficou sem Recorrente e Financiamento enquanto as Finanças tinham os dois.
- **As rotas antigas são cascas `<Redirect>`** para o formulário único, no tipo certo:
  `transaction-form`, `nova-recorrente`, `novo-financiamento`, `recurring?edit=`/`?create=1` e
  `debts?create=financing`/`?id=&edit=1` — APK em campo, notificação e link antigo continuam
  chegando. Rota nova de criar ou editar esses três tipos não nasce: é `hrefDoLancar`.
- **A exceção é o adiantamento** (08/10/2026): ele não é um quarto tipo, é o pagamento de
  parcelas que já existem. "Aplicar" no "E se…?" abre `/finance/aplicar-adiantamento?grupo=`
  (parcelas cobertas, título, valor com o desconto, data e conta) e o lançamento dele reabre a
  mesma tela por `?id=` (`hrefDoLancamento`); apagar pergunta "Desfazer o adiantamento?", sem alcance.

### Formulário num `Sheet` que OUTRA tela abriu devolve para ela ao fechar

**Duas telas ainda hospedam formulário num `Sheet`, e chegar neles de fora é um `push` na tela
da LISTA com um parâmetro** — `/finance/installments?edit=` e `/finance/accounts?create=1|cartao`
(todo "Cadastrar conta", "Cadastrar cartão" e "Novo cartão" de outra tela, 25/09/2026: antes caíam
na lista). Fechando o sheet, a lista ficava: a pessoa era largada numa tela que ela nunca pediu.
A queixa foi literal (15/09/2026): *"cliquei em editar a compra inteira e quando eu clico em
voltar, ao invés de voltar para a tela onde eu estava, ele me leva para a tela de Parceladas"*.

O `push` está certo — é como a pilha sabe voltar. O que faltava era **fechar o formulário fechar
também a tela que só existia para hospedá-lo**: `useVoltarQuandoFechar`
(`src/hooks/use-voltar-quando-fechar.ts`), usado nos TRÊS pontos de saída (o ✕ do `TaskHeader`, o
`onClose` do `Sheet` e o sucesso do salvar). Quem abriu pela própria lista continua na lista —
só volta quem veio de fora, e `simple-finance-ui.test.ts` prende os dois lados.

Não confundir com a guarda de `?edit=` já consumido (`edicaoAberta`), que existe para o sheet
não reabrir no render seguinte. São duas perguntas diferentes sobre o mesmo parâmetro.

**Formulário novo que se abre por parâmetro nasce com isso** — senão a régua volta a divergir
tela a tela, que é como ela nasceu.

### Os botões do Agente têm DOIS prefixos, e a tela conhecia um só

**`pa:` é HITL; `ds:` é RASCUNHO — e a tela descartava todo `ds:`** (15/09/2026). A queixa
veio de um print: *"escolha ou diga o nome do cartão"* com nada para escolher. O motor já
mandava a lista de cartões (o MESMO payload que vira botão no WhatsApp); `parseUiActions`
(`src/lib/agent-chat.ts`) saía cedo quando não havia `pending_id`, e rascunho não tem nenhum.

| prefixo | o que é | como se responde |
|---|---|---|
| `pa:<pendente>:…` | HITL (`pending_actions`): confirmar, recusar, escolher um registro | rota `/actions/<pending_id>`, que revalida o candidato contra a lista CONGELADA |
| `ds:<rascunho>:…` | rascunho: qual cartão, "é o total ou cada parcela?", "crio esse cartão?" | MENSAGEM comum com `clicked_id`; o servidor só aceita `ds:` por ali |

Três regras que caem disso:

- **O sufixo do `ds:` não é interpretado na tela.** `t:`, `create_card:`, `financing` — quem
  sabe o que significam é `draft.parse_slot_click`, no servidor. O app devolve o id CRU; uma
  segunda cópia daquela tabela divergiria da primeira. A exceção é `c:`, que é a convenção
  COMPARTILHADA e diz "esta opção é um registro".
- **Registro x saída sai do `candidateId`, não da `decision`.** É ele que faz `ChatActions`
  escolher entre pílulas no balão e o botão que abre a lista; filtrando por `choose`, os oito
  cartões caíam como oito pílulas — o desenho que aquela seção recusou duas vezes.
- **Pergunta de rascunho NÃO trava o campo de texto.** Os botões ali são atalho para o que já
  existe; digitar continua valendo, e é assim que se escolhe um cartão que não coube na lista
  ou se cria um novo. HITL continua travando: lá a resposta sai dos botões.

### Com o teclado aberto, o primeiro toque num botão É o toque (25/09/2026)

**Toda rolagem declara `keyboardShouldPersistTaps="handled"`** (`always` só na barra de
formatação da nota, que mora sobre o teclado). No padrão `never` a rolagem pega o primeiro toque
para fechar o teclado, e o botão não recebe nada — medido no s26: "Registrar pagamento" tocado com
o teclado aberto só fechava o teclado, sem `pressIn`. E vale para as FOLHAS: o `Sheet` é um
`Modal`, mas o sistema de responder sobe pela árvore do REACT, e a rolagem da tela por trás é
ancestral da folha. `anti-slop.test.ts` quebra se uma rolagem nascer sem a prop.

### Teclado e área segura: um mecanismo por superfície (27/09/2026)

*"tem telas que com o teclado aberto eu não consigo scrollar… o teclado tampa o input de baixo"* e
*"no tablet deitado… a barra de tarefas sobrepõe a parte de baixo do modal"* (Galaxy Tab A11+).

- **Tela**: `Screen` (`KeyboardAwareScrollView`). **Folha**: o corpo com campo é `SheetScroll`,
  ÚLTIMO filho do `Sheet` — `ScrollView` e `insets.bottom` dentro de `<Sheet>` quebram o
  `anti-slop.test.ts`.
- **A folha não encolhe com o teclado.** Com `KeyboardAvoidingView` no `Sheet` E a rolagem
  abrindo o teclado inteiro, sobrava um vão vazio da altura do teclado no fim do formulário. A
  rolagem desconta o que fica ABAIXO da folha (`AbaixoDaFolha`): `insets.bottom` no celular,
  `abaixoDoDialogo` no diálogo do tablet — CONTA, não `measureInWindow`, que no iPhone mediu a
  folha 62pt fora do lugar durante a subida do teclado. No `formSheet` do iPad o UIKit move a
  folha sozinho, e ali vale o `automaticallyAdjustKeyboardInsets` (ramo só de iOS).
- **A barra de tarefas do tablet é `insets.bottom`**, e deitado o recorte da câmera é inset de
  LADO: `Screen`, `AppHeader`, `PillTabBar` (centrada na área segura, no máximo 560dp), FAB e
  toast somam `insets.left/right`. O diálogo do tablet cabe dentro da área segura
  (`tabletSheetFrame`).
- Para reproduzir: `wm size 1600x2560 && wm density 320`, `settings put system user_rotation 1`,
  `wm set-ignore-orientation-request true` (o Android 16 ignora a orientação em tela grande) e a
  navegação por 3 botões — e devolver tudo depois.

## Evolução financeira — regras de UI (outubro/2026)

As regras de domínio estão em `finance.md` → *Evolução financeira — 22 pontos*; aqui só o que é
tela. Entradas sem rota órfã: todo ponto tem caminho a partir de Hoje, Finanças ou Patrimônio.

### Formulário único (`/finance/lancar`)

- **Ordem do evento com o que entrou**: tipo → título → estabelecimento → valor → categoria (+ detalhe
  opcional, `SubcategoryField`) → **forma de pagamento** (`PaymentMethodField`, `SelectField`: o método
  vem ANTES da origem que ele restringe) → conta/cartão → como se divide → quando → **Classificação**
  (`ExpenseClassificationField`, dois controles separados, só em gasto) → extras. Seis meios nunca
  viram `Segmented` (aceita 2 a 4 alternativas curtas).
- **Origem se cria no lugar**: o `AccountPicker` tem "Criar conta/cartão" que abre os MESMOS campos
  (`AccountFormFields`) inline, sem `Modal` dentro de `Modal`; o lançamento fica montado, cancelar
  fecha só o cadastro e salvar o lançamento espera o cadastro acabar. Durante tentativa ambígua
  os campos do cadastro ficam bloqueados.
- O seletor mostra saldo ou limite numa terceira linha (consultas agregadas, nunca uma por opção);
  falha mostra "indisponível" com recuperação e a origem continua selecionável.
- **"Ao salvar"** (`FinanceWritePreview`) some imediatamente ao mudar o rascunho; a consulta espera
  350 ms, cancela a anterior e **não usa `placeholderData`** (número de rascunho antigo sob valor
  novo é mentira). Privacidade vale para números, cronograma e rótulo acessível.
- **Duplicar abre o formulário e nunca grava**: `hrefDoLancar('uma', paramsDaCopia(...))` com a data
  de hoje; "Duplicar" também nos menus de item das listas. Cópia de parcela avisa "vira um
  lançamento à vista".
- **Favoritos nunca gravam sozinhos**: a fileira (até 6) preenche o formulário e a pessoa salva. Ordem
  do topo do formulário: perguntas da voz → seletor de formato → favoritos → nota da cópia.
  "Salvar como favorito"/"Virar favorito" gravam o modelo; gerenciar fica em Gerenciar → Favoritos
  (`SecaoDeArquivados`).
- **Voz**: "Por voz" nos atalhos de `ATALHOS_DE_LANCAMENTO` (gravar, transcrição editável, "Montar
  lançamento"); o hook de gravação é um só (`use-gravador-de-voz.ts`) compartilhado com a conversa. O
  que a fala não disse fica VAZIO e vira nota no topo (`perguntas`); cancelar não grava.
- Série de **transferência**: "Da conta" e logo depois "Para a conta", sem categoria nem método.
  "Termina em" tem piso no início original e fim antes do próximo vencimento é **Encerrar**
  (a tela diz o que fica e o que sai, com números, antes de salvar).

### `Explica` — "Como é calculado"

- Um primitivo só (`components/ui/explica.tsx`): botão (i) de 44pt ao lado do TÍTULO do bloco, nunca
  legenda permanente. O texto vem de `src/lib/explicacoes.ts` (uma função por indicador, com teste),
  a partir do payload que desenhou o número; **nenhum período ou janela escrito à mão**. Sem número,
  o (i) some. Indicador novo com total, período ou estimativa nasce com a sua entrada no catálogo.

### Telas e rotas novas

- `/finance/comecar` — primeiro cadastro em passos puláveis (entradas: passo "contas" dos Primeiros
  passos da Hoje e o estado vazio de Finanças). **A tela segura o passo durante o salvar**
  (`onSalvando` até o `onCriada`): as contas recarregavam antes de o progresso gravar e o passo
  efetivo piscava (resumo, ou passo 1 ainda tocável).
- `/finance/acumulacao` — simulador local (Patrimônio → "Quanto vou acumular"); premissas em
  `usePreferencia`, nunca banco; até 3 cenários; a curva troca quando o cálculo termina.
- `/finance/why` — "Por que mudou?" (bloco "Onde foi o dinheiro"); tocar numa linha abre Lançamentos
  com `from`/`to` exatos e o filtro da dimensão, e o total da lista bate com o da linha.
  `/finance/transactions` passou a aceitar `from`/`to`, `subcategoryId` (com `none`), `paymentMethods`,
  `expensePatterns` e `expenseNecessities`.
- Avisos abrem o item (`invoice`, `transaction`); item ausente = "Isto não existe mais" com caminho
  para a lista.

### Metas, reserva e investimentos

- Folha Guardar/Retirar: `Segmented` Guardar | Retirar e, abaixo, a chave "Transferir de outra
  conta" / "Transferir de volta" (desligada = já está na conta / liberar), origem antes do destino,
  efeito por conta antes de salvar e "Desfazer" no extrato.
- **Nunca dois seletores de abas seguidos** (06/10/2026, *"dois tabnav seguido um do outro"*): ou
  viram UM (`Sai | Entra | Adiantar` no "E se…?"), ou o segundo vira chave, lista (`SelectField`)
  ou campo rotulado. Botões do mesmo nível vão em `ButtonRow`.
- **A celebração de marco toca DEPOIS que a folha sai**: no sucesso do aporte a folha ainda descia
  por cima do anel e ninguém via. Celebra uma vez por travessia (memória por usuário no aparelho,
  chave `meta:<goal_id>`); abrir, puxar para atualizar e Realtime não celebram. Sem som e sem push;
  com Reduzir movimento, só halo e háptico.
- Reserva e plano de metas vivem em `Sheet` irmão estável dos painéis adaptativos, para a troca de
  colunas/orientação não perder rascunho nem tentativa idempotente; erro e confirmação ficam acima
  da rolagem da folha. Tentativa ambígua oferece "Confirmar tentativa" e "Conferir e encerrar
  tentativa" (mesma intenção).
- Posição de investimento: valor atual, aplicado, resultado (qualidade em palavras, sem número quando
  indisponível), recebido; as abas Valor/Rendimento/Aplicado são `Segmented` da MESMA folha.
  Valor monetário que encolhe com fonte grande usa `encolhe={false}` no `Money`.
- Campo de entrada da pessoa (renda-base, valor digitado) segue legível com valores ocultos; prévia,
  distribuição e comparação mascaram.

### Armadilhas de verificação (já custaram QA falso)

- **Integrar por patch (`git apply`) com o Metro de pé deixa bundle velho no aparelho**: o Metro não
  pega os arquivos escritos. Dê `touch` nos arquivos e prove a tela nova (um marcador visível) ANTES
  de contar qualquer passo de QA.
- Corrija o defeito, depois reconfira no MESMO aparelho: o passo errado do F21 e a celebração do F19
  só apareceram em vídeo quadro a quadro, não em captura parada.

## Estado local

- Preferir estado de servidor (Query) + `useState`. Zustand só se estado global de UI real aparecer (hoje não há nenhum) — não criar store "por via das dúvidas".
- **Escolha de VISUALIZAÇÃO fica gravada** (28/09/2026, *"essas micro configurações têm que salvar
  sempre"*): régua Mês/Ciclo, horizonte e modo da Projeção, período dos gráficos, estratégia das
  Dívidas. O caminho é `usePreferencia` (`hooks/use-preferencia.ts`: por usuário, no aparelho,
  lido na abertura para a tela nascer como a pessoa deixou). **Filtro não entra** (tipo, status,
  categoria, conta, escopo da busca): filtro que volta sozinho esconde item sem avisar. E o que uma
  ação da visita muda sozinha (a hipótese do "E se…" esticando o horizonte) não vira preferência.

## Qualidade

- `npx tsc --noEmit` e `npx expo lint` limpos antes de commitar.
- Componentes reutilizáveis em `src/components/` (subpasta por domínio, ex.: `finance/`); componente usado por uma tela só pode viver inline na tela.
