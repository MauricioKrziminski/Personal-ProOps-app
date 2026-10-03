# F09 — subcategorias opcionais

Aceite funcional após F08 `8641fa38`, em 03/10/2026. Branch `gabriel/financas-22-melhorias`,
somente staging `utkqoiigimqzeenxkxdl`. Integra o desenho e o plano dos 22 pontos já
aprovados; F10 liberado. [Aceite e limites](aceite.md).

## Decisão e compatibilidade

Categoria continua texto livre. Acrescentar identidade UUID opcional de subcategoria,
com escopo de workspace e namespace do pai normalizado sem acento/caixa. O pai é texto,
não uma FK obrigatória a `categories`: essa tabela configura aparência/defaults, nem toda
categoria legada tem linha nela e há grafias equivalentes. Uma subcategoria nova não obriga
criar configuração ou converter históricos. O UUID do filho sobrevive a rename/move.

Alternativas: tornar todo pai uma entidade obrigatória exigiria migrar agentes/importações
e históricos; codificar pai/filho numa string quebraria filtros, defaults e orçamentos.
A identidade opcional mantém o contrato atual e permite operações consistentes no filho.

Sem detalhe é um estado explícito, representado por null. Não adivinhar filho com base no
estabelecimento ou em lançamentos antigos. Agente/importação antigos continuam funcionando.
Não introduzir defaults próprios de classificação no filho: os padrões F06 continuam do pai;
trocar somente o filho preserva classificações manuais e o draft. Detalhe não é obrigatório
para salvar e sua ausência não exibe aviso de incompletude.

## Dados e invariantes

`subcategories`: id, workspace_id, user_id, parent_category, parent_key, name, name_key,
edit_revision, timestamps. Nome/pai em minúsculas, sem espaços nas pontas, 1..40 caracteres;
keys produzidas pelo servidor com a mesma normalização `private.fold` do projeto.
Unicidade `(workspace_id,parent_key,name_key)` resolve criação concorrente e colisão de
caixa/acento; não marcar unaccent falsamente immutable para construir um índice.
RLS por membro; comandos controlam alterações estruturais e revisão segura.

Referência opcional `subcategory_id` em transações, recorrências, compras parceladas,
pagamentos de dívida, regras/import suggestions e snapshots privados correspondentes.
Keys derivadas de workspace/pai e FKs compostas deferred impedem commit incompatível,
inclusive quando um move concorre com a inserção de um lançamento. Exceções de dívida
podem guardar `category`/`category_set`: mover seu filho conserva um pai próprio sem
mudar o contrato e as outras parcelas. Apagar o filho preserva esse snapshot do pai.
O servidor confere workspace e pai; referência explícita inválida é erro, não fallback null.
Troca de pai por cliente legado, sem novo filho explícito, limpa vínculo incompatível.
O cliente também limpa imediatamente ao trocar pai/workspace e nunca reaproveita um UUID
que retornou de criação assíncrona de uma visita anterior.

Copiar detalhe nas materializações/conversões que já copiam categoria; preservar os escopos
uma/futuras/todas e snapshots pagos/históricos. Não estender metadata para tarifa técnica Pix
ou pagamento de fatura como se fossem a compra principal. Contas arquivadas não devem
impedir rename puramente de categoria/detalhe.

A entrada de uma compra já copia a categoria da compra: também herda seu detalhe. Sua
conta e forma de pagamento continuam independentes; o envelope da entrada permanece fechado.
Sugestões de importação usam `suggested_subcategory_set` para distinguir legado sem escolha
de uma escolha explícita Sem detalhe, inclusive quando o valor já era null. Adoção conserva
IDs e snapshots compatíveis na ausência de escolha.

O schema medido de `FinanceAction` permanece no limite Gemini (18 campos/14 ações). Regras
com detalhe comprovado propagam ao executor; `ResourceField` aceita UUID/null para regras,
recorrências e dívidas. Escolha explícita de detalhe em linguagem natural no DTO financeiro
ainda precisa de uma fronteira própria e validação; não é declarada concluída.

## Operações estruturais

Criar/editar usam payload fechado, revisão esperada e request UUID imutável. Recibo privado
selado comprova commit; reutilizar o protocolo compartilhado de tentativa sem acoplar o
domínio a plano de metas/reserva. Replay vem antes do CAS; intenção ambígua não pode mudar.
Membership/revisão/payload são conferidos dentro da transação. Conflito exige reabrir.

Rename muda nome do filho, preservando UUID e vínculos. Move atualiza pai e categoria dos
registros vinculados, templates/snapshots/rules/import suggestions no mesmo workspace.
Explicar o alcance e o efeito na leitura dos orçamentos dos pais, sem transferir dinheiro.
Colisão com filho do destino exige juntar explicitamente, com revisões de origem/destino.
Merge conserva identidade/nome do receptor, redireciona referências e remove a origem.
Delete remove só o detalhe: referências viram null, categoria e registros financeiros ficam.

Rename/merge/delete de pai existentes mantêm seu alcance atual entre espaços do usuário.
Estender esses comandos atomicamente para filhos: reparent antes de remover configuração,
juntar homônimos no receptor mediante confirmação do merge do pai e limpar detalhes ao
apagar pai. Preservar a regra atual de orçamento: no mesmo mês, prevalece o do receptor.
Vínculos de filhos não podem ficar com pai incompatível durante a transação ou após replay.
Locks de categoria usam ordem compatível com F06 e edição de templates/ocorrências.

## Leitura, soma e filtros

Uma leitura de subcategorias pertence a um workspace concreto, independente da aparência
global de categorias. DTO fechado valida UUIDs, nomes, revisão/contagens seguras e namespace.
Não usar dados anteriores como atuais ao trocar pai/espaço ou em erro de consulta.
Nome desconhecido/referência obsoleta exige conferência; não exibir UUID cru ao usuário.

Relatórios e orçamentos mantêm total por pai. Acrescentar breakdown versionado por período,
workspace, tipo, pai e filho, com linha Sem detalhe. Reusar critérios financeiros existentes
para evitar contar pagamento de fatura/transferência como gasto novo. Soma de filhos e
Sem detalhe deve fechar exatamente o pai, em centavos; nenhum arredondamento intermediário.
Filtro por filho usa sua identidade, com pai/espaço coerentes; não concatena nomes numa string.
Assinaturas antigas de relatórios permanecem compatíveis com clientes já publicados.

## Experiência e componentes

Modo Operate de Impeccable: identidade, tokens, espaçamento, tipografia, movimento e padrões
já aprovados em PRODUCT/DESIGN. Não criar kit/tela paralelos. Usar Field, SelectField,
Row/Section, SearchField, TaskHeader, SheetScroll, Presenca e motion existente.

Categoria simples continua o caminho curto. Após escolher pai, um detalhe opcional colapsado
permite selecionar/criar filho; Sem detalhe permanece a primeira opção. Criar no contexto
retorna selecionado somente à mesma sessão/pai. Preferir formulário inline quando a tela
já está em uma Sheet; não sobrepor uma nova Modal para um nome curto.
Categorias ganha acesso aos detalhes de cada pai; nome, mover, juntar e remover mostram
impacto compreensível e confirmação de mudanças em registros. Lista aberta tem busca e
paginação progressiva. Reusar extrações pequenas dos controles de categoria quando necessário.

Entradas acessíveis, alvo de toque existente, longos nomes/fonte ampliada, loading/erro/vazio,
cancelamento e teclado seguem o kit. Privacidade cobre totais/breakdown/labels, mantendo os
campos próprios de edição legíveis conforme F07. Animação de expansão/seleção usa UI thread;
não substituir por transições financeiras inventadas ou restringir movimento arbitrariamente.

## Sequência e aceite

1. RED de DTO/draft: troca de pai limpa UUID, alias equivalente preserva, outro espaço recusa,
   null legado é válido, filho removido não é escolhido automaticamente, total fecha sem perda.
2. DDL/commands/read model e RED SQL: colisão concorrente, replay/CAS, move/merge/delete,
   parent merge com orçamento, RLS e conta arquivada; conferir ausência de movimentação.
3. Integrar metadata aos comandos e snapshots atuais; provar escopos pagos/futuros/todos,
   conversões, cron, agente/importação e ausência opcional em clientes antigos.
4. Hooks/controles/formulários/gerenciamento/breakdown, com sessão estável e defaults F06.
5. Gates e QA iOS/Android: criar/usar/reabrir, trocar pai, cancelar, rename/move/merge/delete,
   filtros/totais, privacidade, erro e persistência entre aparelhos. Limpar só fixtures novas.
6. Registrar evidências/limites e commit local; iniciar F10 somente após aceite.

As seis migrations foram aplicadas apenas no staging em 03/10/2026, após dry-run.
Os cinco contratos SQL passaram no schema aplicado; a sexta migration corrigiu a allowlist
da prévia, com RED/GREEN real e regressão F04/F06. Treze regressões financeiras, quatro
corridas estruturais e cinco provas do SQL de materialização do scheduler passaram. Os
tipos foram regenerados do schema real; assinatura/DTO da prévia permaneceram compatíveis.

A rodada final de código passou: 2.103 testes Node, 99 testes Python focados, TypeScript e
lint sem erro. React Doctor: zero erros, 18 avisos de heurísticas registrados. Advisors após
as seis migrations: os mesmos 23 avisos anteriores, nenhum erro e delta zero.

QA nativo e persistência concluídos na matriz delimitada de [nativo.md](nativo.md).
R$ 1,23/R$ 2,34 foram criados em aparelhos diferentes. Rename/move/merge/delete preservaram
UUIDs e valores dos lançamentos; remover só o detalhe manteve categoria e histórico.
Relatórios iOS e Android fecharam em 4.857 centavos/3 registros, iguais às consultas de
total anual e breakdown autenticadas. Privacidade iOS e relatório Android escuro/fonte 1,3
foram conferidos visualmente. O total reutiliza o layout de extrato da Row para não encostar
no rótulo em fonte ampliada; 11 testes JSX, tipos e lint passaram após esse último ajuste.

As duas fixtures e seus oito recibos foram limpos por identidade/intenção comprovadas.
Leitura independente confirmou os 17 conjuntos públicos e caixa idênticos ao baseline;
12 versões privadas de recorrência permaneceram iguais à captura anterior ao merge/delete.
O registro de runtime preserva o ANR F07 aberto e a repintura do tema observada nesta sessão;
não é declaração de estabilidade de distribuição ou de execução do serviço do agente.
