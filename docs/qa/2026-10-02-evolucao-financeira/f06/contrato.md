# F06 — classificações independentes do gasto

Status: aceite técnico no staging em 03/10/2026, após código, SQL, interfaces nativas
e fechamento da revisão visual independente. F05 aceito em `224808b9`.
Integra a especificação dos 22 pontos já autorizada; não muda a identidade do produto.

## Decisões de domínio

Previsibilidade e necessidade são dimensões distintas e opcionais de **gastos**.
Previsibilidade: Fixo / Variável / Não classificar. Necessidade: Essencial / Não essencial /
Não classificar. Aluguel pode ser fixo/essencial, mercado variável/essencial e uma
assinatura fixa/não essencial. O usuário decide; nenhum registro é bloqueado por sua escolha.
Um agendamento, uma recorrência ou um parcelamento não prova nenhuma classificação.

Receitas, transferências próprias e pagamentos de fatura não são consumo e não recebem
essas classificações. Uma taxa de Pix é outro gasto e não herda a classificação da compra.
Entrada e parcelas da compra herdam o snapshot do próprio contrato; cada registro pode
receber um ajuste no alcance escolhido. Nenhuma regra muda valores, saldos ou consumo.

Quatro colunas nullable em lançamento, série, plano e dívida:

| Coluna | Valores |
|---|---|
| `expense_pattern` | `fixed`, `variable`, null |
| `expense_pattern_source` | `explicit`, `category_default`, null |
| `expense_necessity` | `essential`, `discretionary`, null |
| `expense_necessity_source` | `explicit`, `category_default`, null |

Valor conhecido exige origem conhecida. `category_default` exige valor conhecido;
`explicit` com valor null é a decisão consciente de não classificar e impede uma nova
sugestão automática. Quatro nulls representam ausência de prova. Fonte do lançamento
(`app`, `whatsapp`, `import`, `recurring`) não substitui a origem de cada dimensão.

Categoria guarda `default_expense_pattern`, `default_expense_necessity` e revisão de edição.
Na criação, os padrões vêm exclusivamente da configuração do workspace padrão. A aparência
de uma categoria pode continuar vindo de outro workspace acessível; essa aparência não é
prova de um padrão de classificação. Ao editar registro de outro workspace, uma adoção
explícita do padrão precisa consultar a configuração daquele workspace, sob RLS.
Esses padrões são sugestões usadas pelo formulário na criação e gravadas como snapshot.
Mudar categoria/padrão não recalcula classificações de registros existentes. Abrir um
registro antigo para editar também não preenche sua classificação silenciosamente.
O comando explícito Usar padrão da categoria permite adotá-lo durante a edição.

Em criação, trocar a categoria atualiza as dimensões sugeridas; um ajuste manual,
inclusive Não classificar, permanece. Trocar de formato do formulário conserva o
rascunho. Salvar e criar outro reinicia a classificação junto da categoria/título/valor.
Série/plano já criado conserva seu snapshot para novas ocorrências; alterar o padrão
da categoria só muda os cadastros seguintes, não contratos existentes.

## Abordagens consideradas

- Calcular pelo nome/categoria a cada leitura: descartado porque reescreve o passado
  implicitamente e não permite distinguir decisão manual de sugestão.
- Gravar a classificação por uma segunda chamada após salvar: descartado porque uma
  falha de rede deixaria a operação parcialmente concluída.
- **Snapshot nos contratos e registros, integrado às escritas atômicas existentes:**
  escolhido. Helpers puros normalizam escolhas, defaults e patches; RPCs aplicam os
  campos na mesma transação das operações financeiras, mantendo alcance/revisão/intenção.

## Fluxos e componentes

No formulário, uma seção compacta Classificação exibe o resumo e revela dois controles
separados. Usar `Row`, `Field`, `SelectField`, `Presenca` e tokens incumbentes. A seleção
desconhecida é uma opção real; as ajudas explicam as duas dimensões sem julgamento.
O detalhe mostra os snapshots; filtros de Lançamentos podem recortar cada dimensão
independentemente, incluindo Não informado. Grupos se combinam por AND; classificação
não é deduzida da conta, categoria atual ou recorrência. O resumo global não é total do recorte.

Na categoria, os dois padrões aparecem por revelação progressiva no editor existente.
Salvar nome/ícone/cor/padrões é uma única operação. Alterar padrões oferece:

1. Só novos cadastros — conserva contratos e todo histórico.
2. Aplicar ao histórico de um período escolhido — ambas as datas são obrigatórias;
   explica quantos registros foram atualizados após confirmação e mantém ajustes manuais.

Backfill só atinge gastos gravados daquela categoria/workspace no período, exclui
transferências e pagamento de fatura, e atualiza cada dimensão elegível separadamente.
Origem `explicit`, inclusive null explícito, sempre vence o padrão. Contratos de série,
compra e dívida não são reescritos pelo backfill de lançamentos. Mudança de padrão para
null remove classificações que vieram do padrão; não inventa categoria ou zero de consumo.

Renomear/juntar/apagar categorias conserva snapshots: ao juntar, os padrões da categoria
de destino prevalecem nos cadastros seguintes. Classificação antiga permanece no próprio
registro. Backfill é explícito, atômico, idempotente e registra antes/depois dos quatro
campos, período, categoria, workspace, autor e intenção; o audit não publica dados pessoais.
O rename/join incumbente continua abrangendo os workspaces acessíveis: em cada um, os
padrões do receptor configurado prevalecem. Um receptor apenas usado, sem configuração,
continua sem padrões, inclusive nos espaços compartilhados. Travas de workspace seguem
a mesma ordem de UUID em chamadas concorrentes.

## Arquitetura e alcance

`expense-classification.ts` é o domínio fechado de valores/origens, resolução de sugestões,
patches por dimensão, resumo e filtros. O componente compartilhado compõe o kit; não
cria outra tela, paleta, biblioteca ou motor de animação. A identidade Operate/Suave/Papel
e Tinta é herdada, sem concept roll para uma extensão local.

Builders de lançamento/série/compra/dívida/conversão/hipótese/prévia usam a mesma entrada.
Omissão conserva metadados na edição; null explícito limpa a dimensão. Só campos alterados
propagam, para não apagar ajustes de outras ocorrências. Ledger materializado e previsto
leem o mesmo snapshot temporal. Scheduler/materialização herdam o contrato comprovado;
importação/agente sem prova continuam null e não inferem padrões por nome.

Histórico de recorrência também guarda os campos. Dividir uma versão por alcance conserva
calendário e demais metadados. Dívida usa exceções numeradas por dimensão para distinguir
override null de ausência de override. Edição financeira que preserva classificação não
pode apagar essas exceções. Alteração Só esta não muda o contrato; futuras/todas seguem
a régua existente, incluindo proteção de revisão e replays.

Todas as mudanças de schema são migrations novas; tipos foram gerados do staging.
Alvo obrigatório `utkqoiigimqzeenxkxdl`, conferido por `scripts/supabase-target.sh` antes
de qualquer aplicação. Sem produção, push ou release. Dados de QA serão controlados
e separados dos dados pessoais; fixtures SQL usam rollback.

## Sequência e aceite

- [x] RED/GREEN de domínio: quatro combinações, independência, desconhecido, origem,
  omissão/null, override, troca de categoria/formato, editar legado e reinício.
- [x] Schema/validação SQL, snapshots de criação, materialização/previsão e preservação
  de metadados em operações financeiras e conversões.
- [x] Editor de categoria atômico: defaults, rename/merge/delete, período/backfill,
  diário antes/depois, isolamento de workspace, concorrência e retry com mesma intenção.
- [x] Formulários/helpers/hooks: criação e edição por alcance, detalhe e recortes,
  erro/recuperação sem perda do rascunho; prévia e escrita continuam equivalentes.
- [x] SQL com rollback prova totais/budgets/saldos idênticos antes/depois e não permite
  mudar outros workspaces. Null explícito e apenas uma dimensão não alteram a outra.
- [x] Gates TypeScript/lint/Node; outros gates apenas se seus arquivos forem alterados.
- [x] iOS/Android: criação/reabertura, quatro combinações, default/override/limpeza,
  edição por alcance e cancelamento; histórico selecionado e exclusão de manuais;
  erro/retry/replay, tema/fonte/compacto/tablet, privacidade e revisão visual independente.

Nenhum item é aceito com um teste planejado. Registrar comandos/códigos de saída,
aparelho/build/backend, passos/resultados, capturas e limites antes de marcar F06 concluído.

O [aceite](aceite.md) reúne a matriz e os limites executados. A documentação do sistema
visual registra somente os componentes construídos. F07 liberado após esse fechamento.

Referências técnicas consultadas: [funções e permissões Supabase](https://supabase.com/docs/guides/database/functions),
[JSON PostgreSQL](https://www.postgresql.org/docs/current/functions-json.html) e changelog
oficial de Supabase. Nenhuma atualização de Supabase/CLI/SDK/RN neste incremento.
Foi adicionada somente patch-package8.0.1 para persistir a correção estreita e guardada
do Router instalada durante QA; ver navegacao-android.md e patches/README.md.
