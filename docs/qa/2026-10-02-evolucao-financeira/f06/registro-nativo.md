# F06 — validação nativa em andamento

Status: **não aceito**. F07 não iniciado. Branch `gabriel/financas-22-melhorias`.
Backend obrigatório staging `utkqoiigimqzeenxkxdl`, sessão QA TEST; não produção.
Build de desenvolvimento 1.6.3 existente, JavaScript servido pelo Metro de staging 8081.
Não é publicação/release nem execução física de dispositivos.

## Evidência já obtida

- iPhone 17 Pro/iOS 26.5, UUID `F0BDF23C-0286-4183-97E3-3BCC61D4267D`:
  Classificação revelada, Fixo + Essencial selecionados independentemente. Gasto de 102
  centavos salvo por UI, com Pix e banco QA iOS, data 03/10/2026. Reaberto no detalhe,
  que mostrou Fixo e Essencial no kit existente; captura aberta e inspecionada.
- Android API36/arm64, `emulator-5574`, AVD `tudo_azul_audit_20261002`:
  mesma seleção, 102 centavos/Pix/banco QA Android; Salvar fechou o formulário.
  Comparação SQL dos dois registros foi executada em leitura de staging, sem duplicação:
  fontes das duas dimensões explicit; valores/contas/meio preservados.

- Editor de categoria: categorias QA distintas criadas por UI nos dois sistemas com Fixo/Essencial;
  persistência conferida em SQL. Gasto automático de 111 centavos, sem conta/meio, em cada categoria:
  ambas as origens category_default; nenhum padrão inferido pelo nome.
- NULL consciente: gasto de 3 centavos/Pix/banco QA por sistema; Previsibilidade Não classificar
  foi salva como null/explicit, Necessidade Essencial/category_default. Oracle confirmou cada par.
  Salvar e criar outro voltou ao título vazio, valor zero, categoria vazia e Não classificado;
  conta e Pix continuam conforme o reinício incumbente. Capturas de draft/reinício abertas.
- Edição: originais de 102 centavos receberam sua categoria QA e Fixo/Não essencial. UI terminou
  nos dois sistemas; as quatro combinações foram executadas nos dois sistemas e snapshots SQL conferiram os pares.
  O último passo Variável/Essencial também exigiu valor/conta/Pix/título/categoria iguais e
  exatamente um novo receipt de edição por sistema. As seis capturas das combinações restantes foram abertas e inspecionadas; seleções e hierarquia visual corretas.
- Concorrência de categoria em duas sessões reais: evidência e erro inicial do harness estão
  detalhados em registro-sql.md. Nenhum comando financeiro; apenas revisão/receipts da categoria QA.

Capturas e logs financeiros ficam somente em `/private/tmp`; nenhum raw entra no Git.
Oráculo independente de leitura: `/private/tmp/proops-f06-native-oracle.py` e snapshots
`proops-f06-native-oracle-{initial,ios-saved,both-saved}.json`. O primeiro baseline tinha
zero registros `QA F06`; os seis gastos e as duas categorias até aqui foram criados por UI.
O teste de concorrência alterou somente revisão/updated_at e receipts da categoria QA Android.

## Ajustes do roteiro e limites

Maestro 2.11 não aceita screenshot absoluto fora do diretório da execução: corrigido para
nomes relativos. Sucesso de comando tap/scroll não comprova o alvo: as capturas mostraram
campo monetário atrás do cabeçalho fixo e digitação enviada ao título. A tentativa com zero
foi corretamente recusada pelo app, com Informe o valor; nenhuma escrita. O roteiro foi
reposicionado por gesto nativo observado, e 1,02 foi confirmado antes de salvar.
Seletores de conta usam o label acessível completo e aguardam animação; a lista pode ser
revelada inline e o item ficar acima da posição de scroll, exigindo direção/posição correta.

No Android, digitação ASCII por caractere reproduziu o problema registrado do WindowManager:
`starting_reveal`, duas esperas ~5s por caractere e deadline do driver. Logcat específico em
`/private/tmp/proops-f06-android-input-logcat.txt`. Entrada Unicode do Maestro passou.
Não houve mudança de animação de produto ou escalas de animação do Android. A configuração
QA `stylus_handwriting_enabled` foi temporariamente colocada em 0 para evitar a barra flutuante;
o valor original era ausente e deve ser restaurado ao terminar.

Aviso de desenvolvimento Android observado: Can't perform a React state update on a component
that hasn't mounted yet. Stack visível ContextNavigator/ExpoRoot, sem causa estabelecida até
agora. Foi aberto para inspeção e dismiss nativo. Não é tratado como resolvido/preexistente
apenas porque não aparece o componente F06; falta diagnóstico e avaliação final.

## Ainda necessário antes de aceitar

Adoção explícita em edição, período/backfill com manuais preservados,
edições por alcance/séries/parcelas/dívidas/conversões e rascunho ao mudar formato; filtros
positivos/AND/unknown; recuperação de erro/retry; temas/fontes/compacto/tablet/privacidade;
inspeção de todas as capturas finais e revisão visual independente. Rerodar somente gates
justificados por novas alterações. Restaurar configurações QA.

## Oráculo de edição avulsa

A checagem inicial do roteiro exigia incremento de revisão +1 por edição; a UI salvou a
combinação correta, mas essa suposição fez o harness parar. O contrato incumbente F01
(`20261002134032_payment_methods.sql`) faz três UPDATEs quando o payload completo inclui
conta e data; F06 conserva essa sequência. As revisões observadas 0 → 3 → 6 não significam
três lançamentos ou três intenções. O oráculo foi corrigido para contar receipts concluídos
por id/intenção, exigir conservação de valor/conta/Pix/título/categoria e conferir a revisão
real retornada pelo contrato. Não alteramos banco/código de produto para satisfazer uma
suposição incorreta do teste. Capturas e snapshots de cada combinação ficam privados.

## Histórico de um único dia — confirmado nos dois sistemas

Categorias QA iOS/Android mudaram de Fixo/Essencial para Variável/Não essencial pela UI,
com Aplicar ao histórico e De/Até 03/10/2026. Ambas as confirmações nativas foram capturadas
e abertas. No Android a asserção do toast expirou depois do fechamento; isso não foi usado
como falha da gravação nem provocou uma segunda aplicação. O retorno e o banco são a prova.

Oráculo de leitura independente `proops-f06-backfill-oracle.py`, antes/depois, exit0:
quatro registros auditados, duas intenções, período inclusivo de um dia. Em cada sistema,
o gasto automático passou a variable/category_default e discretionary/category_default;
o gasto com Não classificar conservou null/explicit na previsibilidade e recebeu apenas
discretionary/category_default na necessidade. Os dois gastos manuais de 102 centavos
permaneceram integralmente iguais, incluindo revisão. Hashes de transactions (sem os quatro
campos, revisão/updated_at), accounts, installment_plans, recurring_transactions, debts,
budgets, card_invoices e account_balances foram idênticos antes/depois. Não houve nova
transação financeira durante a janela. Snapshots/auditoria ficam privados em
`proops-f06-backfill-{before,after}.json`.

No iOS o seletor de data do roteiro confundia o texto da data inicial com o botão do dia
no calendário final. A captura mostrou Até vazio e Salvar desabilitado; nenhuma escrita.
Corrigido para selecionar o segundo match observado do dia, com calendário inicial fechado.
O app então exibiu a confirmação do intervalo correto e concluiu uma única intenção.

## Contratos e leitura positiva

Na UI iOS, uma série QA de 13 centavos, mensal no dia 4 e primeiro vencimento 04/10/2026,
foi criada com Boleto/banco QA e Fixo/Essencial explícitos. Uma compra QA de 22 centavos
em duas parcelas foi criada com Pix/banco QA e Variável/Não essencial vindos da categoria;
plano e as duas parcelas persistiram o mesmo snapshot. Um financiamento QA de duas
parcelas de 15 centavos foi salvo com Boleto/banco QA, primeiro vencimento 04/10/2026,
Fixo/explicit e Necessidade sem valor/origem. Cada contrato e suas linhas foram conferidos
em leitura SQL; a série não foi materializada para satisfazer a leitura prevista.

Durante janela sem saves, o hook HTTP real e oracle independente coincidiram em nove
recortes positivos de lançamentos e em 132 linhas previstas, 17 classificadas (recorrente
e dívida). Hashes completos dos modelos e saldos ficaram iguais. Detalhes/limite de
Fixo materializado estão em registro-http.md.

A troca nativa de rascunho de Uma vez para Financiamento revelou perda dos padrões
category_default. A captura final mostrou Não classificado; não houve save. Correção e
regressões estão em andamento. O problema não é dado como resolvido pela leitura HTTP.

As tentativas de A/B Android anteriores não provam baseline: o Metro temporário 8082
havia encerrado. Root reiniciou somente 8082 e conferiu manifesto atual com Host Android,
launchAsset 10.0.2.2:8082 e bundle literal HEAD de 19.301.183 bytes, formulário presente
e zero marcadores F06. O A/B será refeito somente com essa conexão comprovada.

## Troca de formato — duas falhas reproduzidas e corrigidas

Na criação Uma vez → Financiamento, a primeira rodada iOS perdeu as dimensões
category_default porque a consulta da dívida não recebia a categoria do rascunho.
A correção usa a categoria comum somente na criação; edição continua usando
exclusivamente categoria/workspace do contrato. Consulta pendente/erro bloqueia
criação e prévia e oferece retry no componente existente. Nove testes RED/GREEN,
UI 347/347 e TypeScript passaram. Reteste nativo iOS com formulário novo confirmou
Variável/Não essencial no financiamento; captura 041256 foi aberta.

O percurso seguinte Financiamento → Recorrente → Uma vez reproduziu outra falha:
Não classificar escolhido manualmente era trocado pelo snapshot antigo ao voltar
a um formato já visitado. O estado privado inteiro prevalecia sobre o comum recente.
Os três corpos agora restauram os campos privados e carregam apenas a classificação
da última intenção comum, sem trocar o baseline/revisão de edição. Criação continua
resolvendo sugestões pela categoria própria; NULL/valor explicit permanece. Edição
conserva inclusive uma adoção consciente de category_default e não adota defaults
novos implicitamente.

TDD observado: 16/16 falhas por snapshot antigo → 16/16 GREEN; UI 363/363 e TypeScript
exit0. O agente principal leu a alteração e executou novamente os 16 casos, exit0,
log proops-f06-format-roundtrip-root.log. Reteste nativo desta segunda correção
ainda pendente; não confundir GREEN do harness com execução nos dispositivos.

## Recortes positivos iOS — execução parcial confirmada

Categoria QA + Variável + Não essencial mostrou compra e gasto automático corretos,
sem resumo global; os dois grupos independentes selecionados foram capturados e
inspecionados. Adicionar Não informado à previsibilidade manteve três grupos de
filtro, com OR dentro da dimensão e AND com necessidade; o gasto NULL apareceu.
Remover Variável deixou apenas esse gasto, excluindo automático e compra. Link com
previsibilidade inválida ocultou a lista; cancelar o editor conservou o erro; Aplicar
uma seleção válida recuperou. Os rótulos das linhas são acessíveis como título +
valor/data, não o título isolado: ajustado o roteiro, sem alteração do produto.
A limpeza final está sendo concluída após aguardar a abertura da folha.

## Restauração de formato — GREEN nativo iOS

O mesmo percurso Uma vez → Financiamento → escolher NULL consciente → Recorrente →
Uma vez → Financiamento manteve Não classificar/Não essencial em todas as etapas e
retornos. Exit0 em proops-f06-ios-format-native-green.log; captura final de Uma vez
043634 aberta e inspecionada. Nenhuma gravação no percurso. A limpeza final dos filtros
também passou nesse roteiro, aguardando a folha aberta e tocando Limpar filtros
diretamente; o gesto anterior no topo arrastava a folha para fechar.

## Rotação de controles interativos — RED/GREEN iPad

iPad A16/iOS26.5, fonte accessibility-large, app Claro e Escuro: expandir classificação
e girar retrato → paisagem → retrato deixou a seta aberta e removeu os dois controles
e suas ajudas. Confirmação com espera de 10s falhou; seletores ausentes da árvore
acessível. As capturas RED foram abertas, incluindo o caso Claro 043804.

Os novos controles F06 passaram a usar Presenca imediata do kit existente, a mesma
variante de campos de entrada: geometria e disponibilidade são regidas pelo estado
React/layout natural; só o deslocamento se anima. A extensão inclui os novos grupos
interativos de padrões/período no editor de categoria e o gate da classificação.
Não foi introduzido timer/reset/medição corretiva nem removido o movimento.

Teste de movimento com componente/helper reais, molas/medição sem conclusão
automática: RED por altura 0 na área interativa, controle reduced passou; GREEN 2/2.
Prende resize/fonte grande, reversão, NULL independente, acessibilidade e cleanup.
O harness executa o domínio puro no mesmo realm das fixtures Node; o primeiro RED
por incompatibilidade de realm foi descartado, sem relaxar a validação de produção.

Reteste do roteiro nativo exato, fonte accessibility-large, exit0, captura 045108
aberta: os dois seletores, quatro rótulos/valores e ajudas permanecem visíveis após
a rotação. Roteiro reexecutável rotacao-classificacao.yaml inicia sem rascunho anterior;
usa somente categoria QA em staging e não salva.

## Alcances iOS — confirmação independente de valores preservados

Série QA: Fixo/Essencial → Variável/Essencial. Cancelar a escolha do alcance conservou
o editor; confirmar Das próximas em diante fechou. Não oferece Só esta no contrato.
Oráculo independente de leitura conferiu variable/explicit, essential/explicit e
identidade de oito hashes financeiros antes/depois, sem mudar calendário, valores ou saldos.

Primeira parcela QA: Variável/category_default → NULL/explicit somente nessa dimensão,
com Só esta parcela. Necessidade continua discretionary/category_default; segunda
parcela e plano continuam variable/category_default. Oito hashes financeiros iguais.
Capturas e JSON privados, sem dados financeiros raw no repositório.

## Fechamento de alcances e rascunhos — complemento

Android: ciclo completo Uma vez → Financiamento → NULL consciente → Recorrente →
Uma vez → Financiamento, exit0 em proops-f06-android-format-native-green.log.
Os padrões automáticos e o NULL explícito sobreviveram aos retornos; sem gravação.

iOS: editar somente a necessidade da dívida QA para Essencial, exit0 em
proops-f06-ios-debt-edit-resume.log. A primeira asserção procurou o resumo acima
da área visível; o seletor Essencial estava correto. Roteiro corrigido para voltar
ao resumo antes de afirmar. Banco confirmou fixed/explicit + essential/explicit.
A comparação final com scope-before confirmou os oito hashes financeiros iguais
após as edições de série, parcela isolada e dívida. Não houve mudança de valores,
calendário, plano, parcelas pagas ou saldos.

## Recortes Android e adoção consciente iOS

Android, proops-f06-android-filters-complete.log exit0: variável AND não essencial;
OR variável/Não informado dentro da previsibilidade, depois somente Não informado;
remoção de resultados incompatíveis; link inválido bloqueado, fechar conserva erro,
Aplicar seleção válida recupera, Limpar filtros + Aplicar remove os critérios.
Capturas de lista/folha/NULL/erro/cancelamento/limpeza disponíveis para a revisão final.

iOS: Usar padrão da categoria trocou o rascunho manual de Variável/Essencial para
Variável/Não essencial. Cancelar não gravou; reabrir mostrou o manual original.
A reabertura inicial coincidiu com a animação da saída e a rolagem foi anulada;
após aguardar, proops-f06-ios-adopt-cancel-resume.log exit0 confirmou a preservação.
Roteiro passou a aguardar o fechamento do primeiro modal antes de abrir o seguinte.

## Contratos e alcances Android — valores conferidos

Um contrato por criação: série 13 centavos/Boleto, compra 22 centavos em duas parcelas/Pix,
dívida 30 centavos em duas parcelas de 15/Boleto. Defaults de ambas as dimensões
variable/category_default e discretionary/category_default em todos os contratos.
A dívida permaneceu com zero pagamentos e 30 centavos restantes.

Editar recorrência para fixed/explicit no alcance Das próximas em diante conservou
necessidade discretionary/category_default. Cancelar foi conferido pelo botão real:
o seletor textual do driver não disparou a ação; toque no centro físico do botão fechou
sem gravação. Depois confirmar passou, exit0 proops-f06-android-series-scope-save.log.

Primeira parcela: NULL/explicit + discretionary/category_default, exit0
proops-f06-android-purchase-scope.log. Segunda parcela preservada; plano conserva
todos os campos de negócio e classificação, com revisão 5→6 do protocolo CAS.
Oráculo corrigiu uma comparação que primeiro selecionou o plano errado e depois
incluiu a revisão técnica na igualdade; a conferência final não exclui campos de negócio.
Ambas as edições conservaram os oito hashes financeiros do baseline após as criações.

Privacidade iOS: lista filtrada manteve máscara também no rótulo acessível, sem R$;
exit0 proops-f06-ios-privacy.log. Preferência de valores revelados restaurada.

## Fechamento de origem, controles e recuperação

O teste real de edição de financiamento sem workspace revelou que o cache do workspace
padrão ainda podia oferecer Usar padrão da categoria, embora a ação já recusasse a adoção.
RED: um dos três casos falhou pela presença de defaults sem prova do workspace original.
O hook agora só publica defaults quando aquela configuração é necessária e comprovada;
GREEN 3/3, sem categoria/sem workspace/com workspace próprio. Sem inferência ou troca
silenciosa do workspace e sem alteração SQL.

Os dois pares Field/SelectField foram extraídos para ExpenseClassificationControls,
reutilizados pelo formulário e editor de categoria. Fragment sem wrapper ou geometria
nova; origens manuais e adoção continuam nos pais. O callback puro passou a se chamar
adoptCategoryDefaults: o nome anterior parecia um hook chamado em callback para o
React Compiler. React Doctor: seis erros reais corrigidos, zero erros; nove avisos de
complexidade permanecem no alcance, sem supressão ou refatoração ampla do fluxo assíncrono.
Capturas nativas finais de ambos os consumidores inspecionadas pelo agente principal.

Android, fonte 1.3 e tema Escuro: salvar um rascunho de QA com rede desativada
(modo avião + Wi-Fi desligado) preservou os dados e o NULL manual. Leitura independente
antes do retry confirmou zero registros com aquele título. Rede restaurada, Salvar fechou
o editor, exit0 proops-f06-android-offline-retry.log. Oráculo autenticado em staging
confirmou exatamente um gasto confirmado de 9 centavos/Pix/banco QA Android,
NULL/explicit + discretionary/category_default e um único recibo de escrita concluído.
Demais lançamentos QA, categorias e contas iguais. Os oito hashes financeiros do baseline
correspondem integralmente ao resultado depois de retirar somente essa nova linha e
reverter seu efeito esperado de -9 centavos no saldo/confirmado do banco: nenhuma outra
mudança financeira. JSON e recibos completos permanecem privados fora do Git.

Privacidade Android: proops-f06-android-privacy.log exit0, classificação Variável AND
Essencial + categoria QA. Valor e rótulo acessível mascarados, sem R$; preferência de
valores revelados restaurada. Não equivale a sessão de TalkBack/VoiceOver.

Gates após a última correção de origem: node --test 1703/1703, TypeScript --noEmit
exit0 e EXPO_NO_DOTENV=1 npm run lint exit0. Logs proops-f06-accept-{node,types,lint}.log.
Tablet Android, abertura fria final e revisão visual independente ainda em conclusão.

## Fonte de acessibilidade iPhone e abertura fria Android

iPhone17Pro/iOS26.5, content_size accessibility-large: controles e ajudas de cada
dimensão legíveis por rolagem, Salvar acessível, fechar sem gravar; exit0 do runner
com proops-f06-ios-large-final.yaml, comandos/capturas na execução 2026-10-03_061455.
Necessidade e Previsibilidade capturadas separadamente e abertas; grande cabeçalho
do kit reorganiza a ação sem truncar. content_size large original restaurado em finally.

Android frio/quente: proops-f06-android-links-final-green.log exit0. Primeiro link
Variável AND Essencial conferiu linha QA exata e excluiu incompatíveis; segundo
Não informado AND Não essencial mostrou retry/NULL e parcela prevista, excluindo
as linhas anteriores. Capturas finais com ícones/carregamento concluídos abertas;
sem aviso visível no novo runtime. Token unknown na primeira versão do roteiro
era inválido e foi corretamente recusado; corrigido somente no QA para not_informed.

Tablet Android: a primeira abertura do roteiro estava sobre um formulário já existente;
SINGLE_TASK/result3 no log e captura confirmam reutilização do rascunho, não falha fria.
Preparação passou a conferir Finanças antes do novo título único. O ensaio seguinte
mostrou os controles corretamente, mas terminou sobre a cortina de notificações
após rolagem do driver. AndroidManifest/app.json limitam Android a retrato; orientação
paisagem não é parte do aceite dessa plataforma e não foi habilitada para satisfazer
o roteiro. iPad permanece com rotação real aprovada. Reteste de tablet usa o retrato
suportado, com limpeza manual independente e sem salvar.

## Fechamento das classes e restauração

Android800dp/fonte1,3/Escuro: proops-f06-android-tablet-portrait-green.log exit0;
dois seletores/ajudas, NULL manual somente na previsibilidade, cancelamento e editor
de categoria compartilhado aprovados. Capturas 061451 abertas. Não é hardware tablet.
Android384dp/fonte1,3/Escuro: proops-f06-android-compact-green.log exit0; ambos os
controles e Salvar alcançáveis, escolhas corretas, fechar sem gravar; captura 061926 aberta.

Verificação final de preferências: tamanho físico1344x2992 sem override, densidade480
sem override, fonte1.0, night no, stylus_handwriting_enabled ausente, avião0/Wi-Fi1;
iPhone content_size large. Wrappers usam finally e leitura original antes da mudança.
iPad já restaurado Claro/OSlight/content_size large/retrato e desligado.

Leitura autenticada final depois desses testes: oito hashes financeiros, snapshots QA,
contratos, categorias e audit exatamente iguais à leitura após o retry9c. Nenhuma
gravação pelos testes finais de fonte/layout/cancelamento. Roteiros sem credenciais nem
IDs de usuário/workspace/conta versionados neste diretório; categoria sintética já existente.
Manifesto captures.json registra os 17 arquivos nativos inspecionados, com hash/dimensões;
bytes completos privados em /private/tmp/proops-f06-final-review.

## Ajuste de validação e aceite final

A revisão visual independente pediu uma correção material: aviso de classificação inválida
mostrava copy de carregamento e Tentar de novo, embora o handler já abrisse filtros.
O teste do componente real falhou pela ausência do EmptyState/Ajustar filtros; depois
da correção passou, incluindo padrão inválido e necessidade inválida, queries bloqueadas,
abrir/cancelar/aplicar e recuperação. Logs privados validation-copy-red/green.
Gates finais após essa mudança: Node1703/1703, zero fail/skip/cancelled; lint/TypeScript
exit0, logs /private/tmp/proops-f06-review-fix-{node,lint,types}.log. Sem mudança SQL.

iOS: proops-f06-ios-validation-fix.log exit0, aviso/CTA/cancelar/Aplicar/linha automática
recuperada. Android: proops-f06-android-validation-fresh-green.log exit0 com mesmos passos
e rolagem até a linha recuperada. O primeiro roteiro Android passou a recuperação, mas
falhou na asserção de uma linha abaixo das previsões; corrigida a rolagem do roteiro.
Um reteste repetiu o link idêntico sobre a mesma rota já filtrada manualmente; o seed
não foi reaplicado, comportamento incumbente também do F05. Novo cenário prepara
Finanças antes da abertura, sem mudança de URL/sincronização do produto. Não contar
essas falhas do roteiro como passes nem como regressão financeira comprovada.

Revisor abriu novamente a captura Android corrigida, verificou bytes/hash/dimensões e
fonte: ship para a única correção pontuada. A revisão inicial das17 capturas permanece
o alcance original; os fluxos funcionais acima foram executados separadamente pela primary.
Regras duráveis registradas em DESIGN.md e .impeccable/design.json por merge F06,
sem substituir identidade/tokens. Aceite técnico no staging em03/10/2026; F07 liberado.
Hardware físico, build release, produção, paridade Gemini, leitor de tela falado, FPS
e offline nativo iOS não certificados. Capturas/JSON financeiros completos privados.
