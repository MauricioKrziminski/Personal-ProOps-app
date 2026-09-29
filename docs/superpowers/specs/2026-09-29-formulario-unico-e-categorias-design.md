# Formulário único de lançamento e categorias personalizáveis — design

Data: 29/09/2026. Aprovado em partes pelo dono do produto nesta data.

## Por quê

*"Eu tava pensando mais na facilidade de cadastrar vários tipos de lançamentos um em seguida do
outro… não precisar fechar, ter tudo ali."* Hoje lançamento, recorrente e financiamento são três
formulários em três lugares (uma tela modal e duas folhas dentro de telas de lista); trocar de tipo
é fechar um e abrir outro, e atalho entre eles empilha folhas.

*"As categorias… têm que ser de fácil acesso para criar novas ou editar, tá meio escondido e mais
escondido ainda se quiser criar uma nova."* Criar só existe digitando na busca do "Todas…";
editar não existe.

## Parte 1 — A tela e o fluxo

- **Uma tela modal nova, `/finance/lancar`**: `TaskHeader` (✕, título, Salvar), o seletor
  **Uma vez | Recorrente | Financiamento** logo abaixo e os campos do tipo escolhido. O título
  segue o tipo: "Novo lançamento" / "Nova recorrência" / "Novo financiamento" (ou "Editar …").
- **Parcelado continua dentro de "Uma vez"** (campo de parcelas e "Cada parcela | Total da
  compra").
- **"Financiamento" é o formulário de dívida inteiro**, com o "Tipo" (financiamento,
  empréstimo…) que já existe; o rótulo do seletor é "Financiamento", igual aos menus.
- **Trocar o tipo** leva os campos comuns: título, valor, conta, data, categoria (no
  financiamento, título → "Nome" e valor → "Valor da parcela"). O que existe só num tipo entra e
  sai com crossfade curto; os comuns não se movem. No iOS os de baixo deslizam
  (`transicaoDeLayout`); no Android a reorganização é de uma vez (animação de layout trava a view,
  `design.md` §5). O que foi digitado num tipo fica guardado se a pessoa voltar a ele antes de
  salvar.
- **Salvar**: na criação, **"Salvar"** (fecha) e **"Salvar e criar outro"** (salva, mostra o
  aviso, limpa e mantém tipo, conta e data). Na edição, só "Salvar"; se o tipo mudou, antes vem a
  pergunta da Parte 2.
- **Quem abre a tela**, já no tipo certo: todo "Lançar" (Hoje, Finanças, "+" de Lançamentos, a
  fatura), o "+" de Recorrentes e de Dívidas, todo "Editar" de lançamento, recorrente e dívida, e o
  Aplicar do "E se…?". Editar abre pré-selecionado no tipo do registro e o seletor continua lá.
- **Sai**: as folhas de formulário de Recorrentes e Dívidas (as listas ficam), as rotas
  `nova-recorrente` e `novo-financiamento`, os botões "Recorrente | Financiamento" do topo do
  lançamento e o "Voltar" do `TaskHeader` (o seletor faz o papel deles). `ATALHOS_DE_LANCAMENTO`
  continua sendo a fonte dos menus "Lançar".
- **Não muda**: as folhas de AÇÃO (pagar parcela, dar baixa, adiar fatura) e as perguntas de
  alcance de edição que já existem ("Só esta / Esta e as próximas / Todas", "Só esta parcela / A
  compra toda").

## Parte 2 — Mudar o tipo de um registro que já existe

**A âncora** é o registro aberto. Abrindo uma série ou uma dívida pela lista, a âncora é a próxima
ocorrência/parcela em aberto. As datas contam a partir dela.

A pergunta vem **no salvar**, e mostra só as opções que mudam alguma coisa:

| opção | com o registro antigo | o novo |
|---|---|---|
| **Só esta** | a âncora sai da série; a série continua, e a data vira "pulada" (`recurring_moved_occurrences`) para o agendador não recriá-la | a âncora vira o tipo novo, com os campos do formulário |
| **Desta em diante** | o passado fica como histórico. Série: termina no dia anterior e as em aberto a partir da âncora saem. Compra parcelada: fica só com as parcelas pagas (o total vira a soma delas). Dívida: encerrada e arquivada, com os pagamentos | começa na data da âncora |
| **Todas, apagando as anteriores** | série, compra ou dívida some inteira, inclusive o que já foi pago | começa na data da âncora |
| **Manter o atual e criar um novo** | nada muda | criado ao lado |

- **Lançamento avulso** (sem série): **"Converter"** ou **"Manter e criar um novo"**. Converter
  ADOTA a linha no tipo novo, com o mesmo id: 1ª ocorrência da recorrente, 1º pagamento do
  financiamento, ou parcela 1 do parcelado (`convert_transaction_to_installments`, que já existe).
- **"Só esta" só existe na ocorrência de recorrente.** Parcela não existe sozinha (é pedaço do
  total da compra) e pagamento de dívida entra na conta do contrato.
- **Sem passado, as opções que dariam o mesmo resultado se fundem** (recorrente sem ocorrência paga:
  "Converter" / "Manter e criar um novo").
- **Recusas com motivo e caminho**: mexer numa fatura paga ou adiada ("desfaça o pagamento da
  fatura antes", a régua de `private.parcela_travada`). Pagamento de dívida só se apaga em "Todas".
- **No banco**: `public.converter_registro(p_origem jsonb, p_alcance text, p_destino jsonb)`,
  numa transação só — encerra a origem e cria o destino; qualquer recusa desfaz tudo. A criação
  do destino passa pelas MESMAS funções de criação por tipo que o `simular` já usa (extraídas para
  `private.criar_registro(tipo, dados)`), para não nascer uma segunda cópia da regra. `security
  invoker` sob a RLS de sempre, `revoke execute … from public, anon`, e `set timezone` no
  cabeçalho se usar `current_date`.

## Parte 3 — Categorias

- **Tabela nova `categories`** (por espaço): `name` (o texto como os registros guardam), `icon`,
  `color` (token de nome da paleta das notas), `created_at`; único por espaço e nome sem acento.
  RLS deny-by-default com a policy de workspace. Os registros continuam guardando TEXTO (sem FK):
  WhatsApp e agente seguem iguais. Categoria sem linha usa o ícone adivinhado pelo nome
  (`category-icons.ts`) e fica sem cor.
- **Tela "Categorias"** (`/finance/categories`), alcançada pelo menu das Finanças, pelo Perfil e
  por "Gerenciar categorias" no "Todas…" do seletor: lista com ícone colorido, nome e em quantos
  lançamentos aparece; "+" no header cria; tocar edita (nome, ícone numa grade de ~30 ícones de
  finanças, cor nos 8 tons das notas); arrastar à esquerda apaga.
- **Renomear, juntar e apagar**, cada um numa função que muda tudo de uma vez:
  - renomear: lançamentos, recorrentes, compras parceladas, orçamentos e regras de categorização;
  - juntar: renomear para uma que existe pergunta antes ("Juntar *roupa* com *roupas*?"); com
    orçamento das duas no mesmo mês, fica o da que recebe, e o aviso diz isso;
  - apagar: os registros ficam sem categoria e os orçamentos dela saem; a confirmação diz quantos
    lançamentos e orçamentos.
- **O seletor**: as 5 mais usadas continuam em chips, agora com ícone e cor; um chip **"+ Nova"**
  sempre à vista abre a criação (nome, ícone, cor) e, salva, já a escolhe; "Todas…" continua com
  busca e "Gerenciar categorias".
- **A cor aparece em todo lugar onde a categoria aparece**: o mapa de ícones passa a devolver
  ícone + cor — disco do ícone nas listas (lançamentos, Hoje, fatura, orçamento), chips do
  seletor, fatias e legenda de "Para onde foi" e anéis de orçamento. Sem cor, o tom de hoje. É
  conteúdo do usuário, como a cor das notas (`design.md` §2b): nenhum tom é `tint`, `danger` ou
  `warning`, e todos têm par claro/escuro.
- **Agente**: grava só o nome, sem mudança. Renomear, juntar, apagar e personalizar são só do app
  — uma linha em `docs/AGENTE-PARIDADE-COM-O-APP.md`.

## Parte 4 — Testes e verificação

- **SQL**: `converter_registro` por origem (avulso, ocorrência, série, parcela, pagamento, dívida)
  × opção — o que "Desta em diante" mantém, o que "Todas" apaga, a âncora com o mesmo id, a data
  pulada que o agendador não recria, a recusa com fatura paga, e nada gravado quando falha no
  meio. Categorias: renomear, juntar (com conflito de orçamento) e apagar em todas as tabelas que
  guardam categoria. `anon_sem_execute.sql` com as funções novas.
- **Telas**: seletor pré-selecionado por quem abriu; campos comuns levados na troca; "Salvar e
  criar outro"; a pergunta com só as opções válidas por origem; todos os "Lançar"/"Editar" abrindo
  a tela nova; "+ Nova" no seletor; a tela Categorias criando, editando e apagando; cores nas
  listas e nos gráficos. Os testes das folhas que saem são reescritos ou apagados, com o motivo.
- **Aparelho** (iPhone normal e acessibilidade grande; Android normal e 384dp × 1,3, nos dois
  temas): três tipos em sequência com "Salvar e criar outro"; trocar o tipo com campos preenchidos
  e ver a transição; editar uma recorrente e converter em cada opção; criar categoria pelo seletor,
  personalizar, renomear, juntar e apagar; cores nos gráficos. O que for criado no staging é
  apagado pelo ID anotado.
- **Produção** (só o Gabriel roda): as migrations novas junto com as quatro do "E se…?" ainda
  pendentes (`20260929120000`, `130000`, `140000`, `150000`), depois o app. MINOR (1.5.0). O
  agente não muda.
