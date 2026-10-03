# F07 — reserva de emergência identificada

Implementado, com [aceite funcional](aceite.md) depois do F06 `52c03f66`. Branch
`gabriel/financas-22-melhorias`; banco exclusivo staging `utkqoiigimqzeenxkxdl`.
Integra o contrato dos 22 pontos já aprovado. Não iniciar F08 antes de código, banco,
iOS, Android e fechamento visual do F07. Nenhuma publicação ou produção autorizada.

## Decisão e fronteira

Inferir reserva de todo o caixa foi descartado porque não identifica intenção nem fonte.
Reusar apenas `goals.saved_cents` foi descartado porque seu ledger não identifica origem
e não prova liquidez. A solução é configuração por workspace com vínculos de alocação,
sem criar transação, aporte de meta ou novo ativo. O patrimônio e os saldos continuam
derivados das fontes existentes. A métrica antiga da saúde passa a se chamar **Caixa cobre**;
seu score e contrato legado não são redefinidos neste incremento.

`emergency_reserves`: workspace PK, autor, `base_mode` manual/observed,
`manual_monthly_cents` positivo somente no modo manual, `target_months` inteiro1..60,
`edit_revision` e timestamps. Uma configuração por workspace.

`financial_allocations`: workspace, autor, finalidade reserve/goal, `goal_id` somente
para goal, exatamente uma FK `account_id` ou `asset_id`, `amount_cents` inteiro positivo,
`liquidity_confirmed` e timestamps. Unique por finalidade/meta/fonte. F07 grava somente
reserve; a unidade de fonte/valor compartilhada permite que F11 identifique os aportes
de metas existentes, sem inventar uma origem para o legado agora.

`reserve_month_reviews`: workspace/mês civil PK, fingerprint do consumo observado,
autor e data da revisão. Revisão explícita do mês significa que a pessoa conferiu
o registro daquele mês, inclusive quando nenhum gasto existe. Não é inferida de renda,
saldo inicial, data de cadastro ou da ausência de transações.

Contas ativas fora do cartão usam `private.caixa_das_contas` na data financeira BRT; não reservar
o limite do cartão, caixa sem conta nem expectativa futura. Ativos elegíveis são
investment/crypto/equity, ativos e não passivos, com valor atual; o usuário precisa
confirmar disponibilidade imediata de toda fonte escolhida. Liquidez não é deduzida do
nome/classe. Ativo que representa o mesmo investimento já cadastrado numa conta não deve
ser selecionado novamente; o editor explica isso. Vínculo retirado não apaga a fonte.

Uma gravação não pode alocar mais que o valor disponível, descontadas alocações de outras
finalidades na mesma fonte. Duas metas na mesma fonte disputam o mesmo teto. Não restringir
gastos reais para sustentar uma reserva: se saldo/valor cai depois, exibir falta de lastro.
Cada finalidade compartilha proporcionalmente o lastro restante: `floor(alocação ×
min(disponível, total alocado) / total alocado)`, aritmética inteira/numeric no banco.
Fonte arquivada/inválida ou sem liquidez confirmada contribui zero. Não inventar prioridade
da reserva sobre uma meta nem somar valores planejados sem lastro à cobertura.

Metas antigas sem fonte não provam dinheiro livre. Leitura informa a soma ainda sem
origem, calculada por meta como `max(saved_cents − alocações identificadas,0)`.
Se positiva, salvar requer confirmação explícita de que os valores escolhidos não são
os mesmos dessas metas; valor confirmado deve corresponder à leitura atual. Mudança
concorrente recusa a gravação e exige nova conferência. Não distribuir o legado entre contas.

## Base explicável

Manual: essencial mensal positivo e inteiro; zero/negativo/overflow recusados.
Observada: três meses civis completos anteriores à data financeira BRT da leitura. Consumo usa
gastos já acontecidos (`cleared` ou compra de cartão com fatura e data até hoje), pela
data de ocorrência, excluindo quitação de fatura e transferências. Usa necessidade F06;
sem classificação não vira não essencial. Cada mês publica quantidade, total essencial,
quantidade/valor não classificados e fingerprint determinístico das linhas de consumo.

Só os três meses revisados, com fingerprint atual e zero gastos sem classificação,
produzem a base `ceil(soma essencial /3)`. Mês sem gastos revisado vale zero; mês sem
revisão significa insuficiência. Base total zero permanece insuficiente, não infinito ou
zero meses de cobertura. Nova importação, correção/remoção/reclassificação de consumo
invalida sua revisão quando altera o fingerprint. Modo manual permite começar sem histórico.
Alvo = base × meses; diferença = max(alvo − lastro confirmado,0). Sem base válida,
alvo/cobertura/diferença são null com motivo explícito. Dinheiro sempre em centavos seguros.
Cobertura exibida usa décimos conservadores calculados por divisão inteira dos centavos,
sem arredondar proteção para cima. Uma fração positiva inferior a um décimo é explicada
como “Menos de 0,1 mês”, preservando a diferença entre pouca cobertura e zero.

## API e segurança

`emergency_reserve_state(p_workspace_id uuid, p_as_of date)` retorna JSON fechado:

```text
{ workspace_id, workspace_name, as_of,
  config: null | {base_mode, manual_monthly_cents, target_months, edit_revision},
  sources: [{kind:account|asset, id, name, eligible, archived,
    available_cents, other_allocated_cents, allocated_cents, liquidity_confirmed,
    effective_cents, valuation_date:null|YYYY-MM-DD}],
  months: [{month:YYYY-MM-01, expense_count, essential_cents,
    unclassified_count, unclassified_cents, fingerprint, reviewed}],
  unassigned_goals_cents }
```

Contagens/revisão inteiras; valores bigint publicados como texto decimal para evitar
perda antes da validação no cliente. Candidatos ativos e fontes vinculadas inválidas
continuam disponíveis para explicar/retirar vínculo; todas as fontes são do workspace.
Resposta fora do contrato, valores inseguros, IDs/fontes/mês repetidos ou mês inválido
viram erro de leitura, sem fallback para zero.
O app omite `p_as_of`: o servidor determina hoje em America/Sao_Paulo. O dia local do
aparelho participa apenas da chave de cache, sem impor seu fuso/relógio à regra financeira.

`save_emergency_reserve(p_input jsonb,p_request_id uuid)` recebe todos os campos:

```text
{ workspace_id, expected_revision:null|inteiro,
  base_mode:manual|observed, manual_monthly_cents:null|inteiro,
  target_months:inteiro, unassigned_goals_ack_cents:inteiro,
  allocations:[{kind:account|asset,id,amount_cents:inteiro,liquidity_confirmed:true}],
  reviewed_months:[{month:YYYY-MM-01,fingerprint}] }
```

Reposição atômica somente da finalidade reserve; lista vazia libera seus vínculos.
Reviews omitidas saem da configuração. Criar exige revisão null e ausência da configuração;
editar exige a revisão exata. Resultado `{workspace_id,edit_revision}`. JSON sem campos
desconhecidos, tipos exatos; todas as validações no banco também. Recibo usa intenção
existente (`private.reserve_payment_request` / `finish_payment_request`), replay antes
de CAS, payload fechado e workspace verificado antes de devolver o recibo.

Os helpers antigos de recibo permitem atualização do próprio registro pelo papel
authenticated. F07 não toma esse resultado mutável como prova de execução: um recibo
selado em `private.emergency_reserve_write_receipts`, sem grants de escrita/leitura ao
cliente, guarda payload/resultado produzidos pelo comando. Replay usa essa prova;
resultado genérico preenchido sem prova selada é recusado. Não alterar a infraestrutura
antiga fora do incremento. Testar forja própria e alteração do resultado genérico após
um commit legítimo, sem tornar sucesso fictício uma confirmação no app.

Tabelas novas: RLS deny-by-default, select de membros, DML direto revogado.
Wrapper público invoker chama comando privado definer restrito: autenticação e membership
revalidadas, search_path vazio, todas as FKs/fontes consultadas com workspace explícito.
Esse limite permite proteger invariantes contra DML direto. Sem definer para resolver
um erro de permissão; sem acesso a dados financeiros de outros workspaces.
Lock transacional `financial-allocations:<workspace>` serializa revisão e disputa de
fontes; ordenação consistente, row locks das fontes e revisão de meses conferida no save.
Workspace usa KEY SHARE; fontes e metas usam SHARE ordenado. Contribuições não recebem
lock invertido em relação a `edit_goal_contribution`. Uma despesa nova pode entrar durante
a revisão: o fingerprint fica desatualizado na leitura seguinte. Cinco experimentos com
duas conexões confirmaram convivência com aporte e edição do ledger de metas sem deadlock.
Funções novas revogam PUBLIC/anon; tabelas expostas recebem grant SELECT explícito e Realtime.

No cliente, tentativa ambígua congela payload e UUID até confirmação: retry idêntico,
duplo toque não cria operação paralela, edição/cancelamento não descarta uma escrita cujo
commit é desconhecido. Recusa SQL comprovada antes de ambiguidade libera o rascunho;
isso inclui os códigos completos 40001 e 40P01, sem tratar toda classe 40 como recusa.
O sucesso confirma identidade/revisão e invalida leitura. Sem atualização otimista de dinheiro.
Consultas/Realtime/foco contemplam fontes, contribuições, classificações e novas tabelas.
Depois de ambiguidade, um SQLSTATE genérico continua insuficiente para descartar a tentativa.
A exceção comprovada é `PT409` com a mensagem exata `Reserva alterada; confira novamente`
(o marcador `40001` anterior continua reconhecido por compatibilidade):
o comando verifica o recibo selado sob o lock antes de produzir esse marcador de CAS.
Se a intenção já tivesse sido confirmada, devolveria o recibo original, mesmo após outra
escrita avançar a revisão. Essa recusa libera fechamento/reabertura também quando a
resposta de uma recusa anterior se perdeu. A prova vale para o protocolo autenticado,
workspace preservado e revisões do comando; exclusão/recriação do mesmo UUID ou reset
administrativo de revisões ficam fora desse protocolo.

`resolve_emergency_reserve_attempt(p_input jsonb,p_request_id uuid)` recebe a intenção
congelada e sua mesma identidade. Sob o mesmo advisory e membership revalidada, devolve
o recibo selado existente. Se a intenção ainda não foi aplicada, sela o resultado exato
`{workspace_id,cancelled:true}` na mesma tabela privada. Esse encerramento é terminal:
uma requisição original atrasada ou um retry recebe o cancelamento antes de qualquer
efeito. Não cria configuração, alocação, review ou recibo genérico; não movimenta dinheiro.
Payload diferente na mesma identidade é recusado, inclusive depois do encerramento.

Essa RPC permite sair da ambiguidade quando saldo, meta ou classificação mudou sem
avançar a revisão da reserva. Um `22023` sozinho não prova que uma requisição ainda em
trânsito nunca será aplicada. O cliente oferece **Conferir e encerrar tentativa** após
uma falha ambígua, mantendo a opção de retry idêntico **Confirmar tentativa**. Ambas
compartilham intenção/UUID e uma única operação em andamento. Resultado cancelado só
libera a sessão depois de DTO fechado e workspace correspondente; resposta perdida
na própria conferência preserva a tentativa. Sucesso recuperado fecha com confirmação;
encerramento fecha com aviso informativo e invalida a leitura para a próxima edição.
Durante a conferência, a ação permanece visível com indicador de andamento.

Erros apresentados à pessoa usam textos de recuperação do domínio. Exceções de rede,
endereços do servidor e detalhes Java não aparecem no formulário.

## UI e aceite

Conflito de revisão é recusa de negócio `PT409`/HTTP 409. Não usa `40001` para provocar
retry transitório do PostgREST. A quarta migration altera somente esse SQLSTATE, sem
mudar locks ou efeitos. Erros genéricos de serialização após perda de resposta continuam
ambíguos e não liberam uma identidade em trânsito.

Seção Reserva de emergência em Patrimônio, usando Money/progresso/Row do kit; detalhe da
base e fontes no mesmo contexto. Configuração em Sheet/TaskHeader/Field, MoneyField,
QuantityField, SelectField e controles incumbentes; nenhum segundo Home ou rota necessária.
Separar valor escolhido de lastro atual; período e insuficiência aparecem no detalhe.
Revelações interativas usam Presenca imediata, progresso acompanha dado confirmado,
Reduce Motion e máscara visual/acessível respeitados. Erro de refetch não mostra número antigo
como atual. Editor conserva snapshot/revisão enquanto o dado se atualiza em background.
A tela possui a sessão, a tentativa idempotente e os detalhes expandidos. A folha é um
irmão estável dos painéis adaptativos, evitando perder rascunho/tentativa na troca de
colunas. Mensagens globais de erro e confirmação ficam acima da rolagem da folha.

Matriz: manual/observada, mês revisado sem gasto/sem dados, classificação incompleta,
reclassificação/importação, parcial/duplicada/cartão/outro workspace/duas metas,
arquivar/desvalorizar, concorrência/CAS/replay/perda de resposta, cancelar/retirar vínculo,
base inválida/centavos/valor máximo, privacidade, fonte grande/temas/tablet e offline/retry.
Provar caixa/patrimônio/ledger financeiro idênticos por oráculo. Testar iOS e Android antes
do aceite; registrar códigos de saída, persistência, capturas/revisão e limites reais.

Referências técnicas verificadas: [Supabase functions](https://supabase.com/docs/guides/database/functions),
[grants Data API](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically),
[PostgreSQL locks](https://www.postgresql.org/docs/current/explicit-locking.html).
Changelog consultado em 03/10/2026; alterações recentes de ltree/ciphers/operators não são
usadas por este contrato. Nenhuma atualização de SDK/CLI/dependências planejada.
