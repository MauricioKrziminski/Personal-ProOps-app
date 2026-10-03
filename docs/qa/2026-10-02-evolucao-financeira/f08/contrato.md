# F08 — capacidade conjunta das metas

Aceite funcional F08 registrado após F07 `dfb822d0`. Branch
`gabriel/financas-22-melhorias`, somente staging `utkqoiigimqzeenxkxdl`.
Escopo e execução já autorizados pelo plano dos 22 pontos. F09 liberado; ver [aceite e limites](aceite.md).

## Decisão

O aporte realizado fica em `goal_contributions`; o novo plano descreve intenções futuras.
Salvar/cancelar/simular o plano não cria aporte, transação, recorrência, transferência,
ativo ou alocação com lastro. A contribuição mensal reduz a disponibilidade do cenário,
preservando o saldo de caixa informado pela projeção existente. Origem/destino e execução
de aportes pertencem ao F11; uma transferência real continua tendo o efeito da regra vigente.

Alternativas consideradas: hipóteses de despesa no simulador existente confundiriam dinheiro
separado com consumo e atingiriam o limite de 30 registros; plano exclusivamente local não
acompanharia a conta em outro aparelho. A solução usa configuração persistente por workspace,
itens por meta e uma projeção somente leitura no servidor, com o mesmo fluxo de caixa atual.

Plano aberto preserva snapshot, revisão e fingerprint financeiro das metas. Nova meta,
aporte, retirada, alvo/prazo alterados ou arquivamento exigem reabrir/conferir antes de salvar.
Renomear sem mudar o estado financeiro não sobrescreve nada: o comando grava somente o plano.

## Dados e calendário

`goal_plans`: workspace PK, autor, revisão segura e timestamps.
`goal_plan_items`: workspace + goal PK, autor, `included`, `monthly_cents`, `first_on`.
Incluído exige centavos positivos e uma data civil válida; excluído grava ambos como null.
FKs/trigger também preservam o workspace da meta; delete cascata, arquivamento remove efeito.
RLS de leitura por membro, DML direto revogado. Plano vazio libera todas as intenções.

Sem plano salvo, sugerir para metas abertas com prazo futuro: primeiro aporte hoje em BRT,
depois a mesma data civil de cada mês, com clamp do dia no último dia do mês. Contar apenas
ocorrências até o prazo, incluindo a primeira. Sugestão = ceil(restante / ocorrências).
Prazo vencido ou ausente não inventa capacidade/periodicidade: mensalidade fica null até
escolha explícita. Uma mensalidade escolhida pode planejar meta sem prazo; o rótulo continua
informando que não há prazo. Prazo vencido continua marcado, mesmo com proposta mensal.

Ocorrências anteriores a hoje não são aportes realizados. A projeção considera apenas as
próximas ocorrências e limita a última ao restante `max(alvo − saved_cents,0)`, por meta.
Meta concluída/arquivada não gera intenção. Prazo não é estendido em silêncio; resultado
mostra quando o plano não cobre o restante até a data informada. Ajustar o prazo usa a edição
existente da meta e invalida o snapshot do plano.

Reusar `private.cash_total` e `private.eventos_de_caixa`, as fontes de `forecast_json`,
filtradas pelo workspace do plano: a RPC pública agrega todos os espaços do usuário e não
pode ser usada diretamente como capacidade de um espaço. Sem reimplementar cartão/fatura,
dívida, recorrência, renda pendente ou transferência. Calendário de aporte é civil;
agregação acompanha Mês/Ciclo e os limites da régua vigente.
Dinheiro é numeric/bigint no SQL e texto decimal na resposta, validado antes de virar number.
Horizonte 1..3650 dias segue `private.clamp_forecast_days`; não baixar dias no modo mensal.

Disponibilidade do cenário = caixa projetado − lastro identificado atualmente nas contas
de caixa − intenções futuras cumulativas. Valores já alocados em investimentos fora desse
caixa não são subtraídos de novo. Reusar o lastro proporcional F07 para fontes disputadas.
Metas com dinheiro guardado sem origem identificada permanecem uma ressalva explícita;
não deduzir que ele está no caixa ou fora dele. Renda futura ausente e metas sem plano completo
também qualificam o cenário. Um saldo positivo não vira selo incondicional de aprovação.

## API implementada no staging

Contratos aplicados pelas migrations `20261003164859`, `20261003164902` e
`20261003172501`, com os tipos gerados a partir do staging. Produção não foi alterada.

`goal_planning_state(p_workspace_id uuid, p_days int, p_view text, p_mode text,
p_preview jsonb default null)` retorna:

```text
{workspace_id, workspace_name, cycle_close_day:null|inteiro1..31, as_of, days, view:civil|cycle, mode:month|day,
 edit_revision:null|inteiro, goals_fingerprint:hex32,
 goals:[{goal_id,name,target_cents,saved_cents,deadline:null|date,
   included,monthly_cents:null|decimal,first_on:null|date,
   suggested_cents:null|decimal, origin:saved|suggested|draft,
   deadline_status:none|future|past}],
 reserved_cash_cents, unassigned_goals_cents, income_present:boolean,
 incomplete_goal_ids:uuid[], excluded_goal_ids:uuid[], missed_deadline_goal_ids:uuid[],
 points:[{day,cash_cents,planned_cents,cumulative_planned_cents,available_cents}],
 months:[{month,from,to,partial,cash_cents,planned_cents,
   cumulative_planned_cents,available_cents,first_pressure_on:null|date}],
 first_pressure_on:null|date,minimum_available_cents}
```

Todos os campos monetários são texto decimal; caixa/disponível/mínimo admitem negativos,
os demais são não negativos. `points` é vazio no modo mensal; `months` é vazio no diário.
`month` usa `YYYY-MM`, como a régua existente; as demais datas usam `YYYY-MM-DD`.
O mínimo cobre todos os dias do horizonte no servidor, inclusive pressão dentro de um mês
que encerra positivo; o cliente não o estima a partir dos pontos mensais.
Datas/IDs/mês repetidos, objetos/campos fora do contrato e valores inseguros são erro de
leitura; desconhecido nunca recebe fallback zero. Preview fechado:
`{goals_fingerprint,items:[{goal_id,included,monthly_cents:null|inteiro,first_on:null|date}]}`.
Pode conter mensalidade/data incompleta para mostrar a lacuna, sem autorizar save.
Fingerprint obsoleto é recusa PT409, sem recalcular silenciosamente sobre outra meta.

`save_goal_plan(p_input jsonb,p_request_id uuid)` recebe:

```text
{workspace_id,expected_revision:null|inteiro,goals_fingerprint:hex32,
 items:[{goal_id,included,monthly_cents:null|inteiro,first_on:null|date}]}
```

Um comando transacional valida membership, payload fechado, lista exata das metas abertas,
fingerprint, revisão e calendário; substitui só os itens do plano. Sem escrita financeira.
Resultado `{workspace_id,edit_revision}`. Recibo privado selado, replay antes de CAS sob lock
do workspace, mesma identidade + payload idêntico; forja de recibo genérico não prova commit.
`resolve_goal_plan_attempt` usa o mesmo input/UUID: devolve sucesso ou sela cancelamento terminal
antes de uma requisição atrasada. Reutilizar o protocolo de intenção F07 sem vincular o novo
domínio à semântica de reserva. Lock/ordenação compatíveis com edição de metas/aportes/F07.
Wrappers públicos restritos, search_path vazio, grants explícitos e testes de RLS/advisors.

## Experiência no app

Extensão das telas Metas/Projeção dentro da identidade existente; modo Operate. Metas ganha
“Simular juntas” próximo ao resumo; o menu de cada meta oferece o mesmo planejamento
posicionado naquele item. Projeção exibe resumo do plano e “Ajustar plano” no contexto atual.
Uma Sheet estável usa TaskHeader, SheetScroll, Field/MoneyField, DatePickerField/Calendar e SwitchRow.
A tela possui a sessão, preservada entre colunas/orientações. Cancelar descarta somente draft.

Primeiro viewport: resultado conjunto, período concreto e mínimo disponível do cenário;
qualificações materiais junto ao resultado. Em seguida, comparação com o caixa base e metas
com mensalidade/primeira data. Ajustar um item mostra como muda o mesmo período; gráfico e
linhas usam os valores confirmados do servidor, sem interpolar números financeiros fictícios.
Reusar Skia/gestos/movimento do kit; legendas e tabela permitem ler a relação sem depender de cor.
Privacidade também cobre disponibilidade, gráficos, frases e labels acessíveis. Campos em
edição mostram o próprio valor conforme a regra F07. Sem outro hero escuro ou kit paralelo.

Carregamento/erro/preview anterior são estados distintos. Query falha não mantém cenário velho
como atual. Salvar exige preview da intenção corrente; duplo toque compartilha uma operação.
Tentativa ambígua congela intenção e fechamento, com confirmar/conferir e encerrar; conflito
comprovado permite reabrir. Metas fora do plano e planos incompletos ficam explícitos.

Referências funcionais verificadas em 03/10: [Monzo Pots](https://monzo.com/help/budgeting-overdrafts-savings/what-is-a-pot)
para distinguir saldo de dinheiro separado; [YNAB Targets](https://www.ynab.com/features/goal-tracking)
para relacionar valor/prazo/esforço periódico. O desenho herda PRODUCT/DESIGN e componentes
do ProOps. UI/UX Pro Max: curva temporal, legenda/alternativa textual, sem depender só de cor.

## Verificação e sequência

1. RED de DTO/builder e SQL: duas metas somam intenções, último aporte não passa do alvo,
   simulação/cancelamento/save preservam caixa/ledger. Prazo passado e dados ausentes explícitos.
2. Backend/read model + plano atômico, RLS/fingerprint/CAS/replay/recibo selado e terminal.
3. Domínio/hook + sessão e UI incumbentes, navegação/privacidade/régua e atualização externa.
4. Gates de código/banco; uma matriz nativa por plataforma, revisão visual em lote e correções.
   Monitorar o incidente ANR do F07; recorrência interrompe a execução para coleta contemporânea.
5. Registrar aceite/limites e commit local; somente depois F09.

Casos: duas metas/prioridades diferentes, aporte já feito, retirada/novo alvo/prazo durante draft,
sem renda, salário em duas datas, fatura única, saldo negativo, prazo próximo/passado/sem prazo,
dia31/bissexto, ciclo não civil, arquivamento, legado sem origem, reserva no mesmo caixa,
fonte fora do caixa, cenário desatualizado, cancelamento, offline/retry e dois aparelhos.

Implementação e verificações de código/banco/nativas concluídas nos cenários registrados.
O [registro SQL](registro-sql.md) reúne fixtures com rollback, quatro corridas reais,
controle negativo, limpeza e advisors. A matriz nativa e a disposição final são registradas
separadamente: gates de código não substituem interação ou persistência nos aparelhos.
