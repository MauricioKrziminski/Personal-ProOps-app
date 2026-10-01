# Entrada em compras e filtros completos

Pedido: compreender e reproduzir antes de alterar; implementar um item por vez, testar no emulador após cada entrega e registrar evidência de regressão.

## Ambiente e reprodução

- Baseline `a5ee7860`, `main` inicialmente limpo; implementação em `gabriel/entrada-filtros`. Metro 8081 neste repositório.
- Durante a execução entrou o commit concorrente `49468625` (seletores); preservado. A comparação final usa esse HEAD, sem descartar trabalho concorrente.
- iPhone 17 Pro, iOS 26.5, UDID `F0BDF23C-0286-4183-97E3-3BCC61D4267D`. Reprodução inicial em `com.proops.personal`; aceitação final em `com.proops.personal.dev`, conectado ao Metro local. O scheme exclusivo `com.proops.personal.dev:///...` evita escolher entre dois apps com o mesmo nome. A identidade nativa não determina o banco.
- `scripts/supabase-target.sh`: CLI e `.env.local` confirmados em staging `utkqoiigimqzeenxkxdl`. Produção está fora deste trabalho.
- Capturas iniciais: `/private/tmp/proops-before.png`, `/private/tmp/proops-financing-before.png`.
- Financiamento: abrir `/finance/lancar?tipo=financiamento`. Existem valor, prazo, pagas e primeira parcela; não há entrada. Compra parcelada usa a mesma limitação no contrato `EntradaParcelada`.
- Lançamentos: seleção mensal civil/ciclo e chips de tipo/estado. Conta e origem ficam em submenus. Não há data inicial/final arbitrárias nem filtro de valor.

## Problema 1: entrada é um movimento separado do contrato

Raiz: os modelos atuais descrevem apenas as parcelas. A RPC parcelada distribui TODO o `total_cents`; a dívida fixa usa parcela × quantidade. Um gasto com `debt_id` é tratado pelo trigger como prestação paga. Acrescentar uma entrada por esse vínculo alteraria indevidamente saldo e contagem.

Decisão de implementação: guardar uma despesa de entrada vinculada por referências próprias ao plano OU dívida, sem usar `debt_id`/`installment_plan_id`. A despesa usa o fluxo financeiro existente para caixa, categoria, fatura, edição e exclusão. A criação de contrato + entrada é uma transação atômica e idempotente. A entrada tem valor, data e conta; só datas já ocorridas podem ser marcadas pagas. As parcelas mantêm seus números e histórico. Excluir o contrato remove a entrada associada; excluir a entrada remove apenas seu movimento, sem recalcular prestações contratadas.

No modo total, o valor da compra inclui entrada e só o restante é parcelado. No modo cada parcela, o total é entrada + parcela × quantidade. Em financiamento amortizado, saldo/principal continuam representando apenas a parte financiada, explicitamente rotulada. Entrada não é amortização.

Aceitação:

- R$ 1.200 − R$ 200 de entrada = 5 × R$ 200; a soma de despesas é R$ 1.200.
- 3 × R$ 333,33 + entrada de R$ 200 = R$ 1.199,99; sem float em dinheiro.
- Entrada não conta como parcela paga e não altera cronograma ou saldo da dívida.
- Conta/data da entrada independentes da primeira parcela; conta de outro workspace recusada.
- Salvar repetidamente com a mesma chave não duplica contrato nem entrada; payload diferente com a mesma chave é recusado.
- Entrada inválida, maior/igual ao total ou data futura paga bloqueia sem gravação parcial.
- Sem entrada conserva os contratos existentes, inclusive fim do mês, cartão e parcelas já pagas.
- Entrada pode ser consultada, editada e apagada; contrato mostra vínculo e total; conversão não a confunde com prestação.

## Problema 2: filtros completos e intervalo escolhido

Raiz: a tela de lançamentos limita a janela ao mês/ciclo apesar de a consulta já aceitar `from`/`to`. Critérios secundários ficam dispersos; previsões são outra consulta e possuem janela máxima de 62 dias. Filtrar páginas já carregadas esconderia resultados e totais reais.

Decisão: folha de filtros com rascunho e Aplicar/Limpar/Cancelar. Intervalo inclusivo de datas, tipo, estado, categoria, conta, origem e mínimo/máximo em centavos; indicador de recorte ativo. Consultas recebem os mesmos filtros, paginam no servidor e invalidam sua chave quando o recorte muda. Janela longa de previsões é dividida em blocos compatíveis com a RPC, sem truncamento silencioso. Filtro não persiste entre visitas nem substitui preferência de régua.

Auditoria do app:

| Superfície | Aplicação |
|---|---|
| Lançamentos e extratos de conta | Intervalo, tipo, estado, categoria, conta, origem, valor e texto |
| Recorrentes | Texto, conta, categoria, tipo e estado; data da próxima execução nas ativas |
| Parceladas | Texto, conta, categoria, estado, primeira parcela e total parcelado sem entrada |
| Dívidas | Texto, tipo, conta, estado e primeiro vencimento; arquivos também participam da busca |
| Lembretes | Texto, estado, canal e próxima execução; filtros antes das páginas de 20 |
| Notas, pasta, arquivadas e lixeira | Texto, pasta/tag existentes e intervalo de atualização; filtros antes das páginas de 30 |
| Importações | Data, nome, formato OFX/CSV e conta; filtro antes da paginação; estado continua derivado dos itens |
| Fatura, ciclo, relatórios e projeção | Preservar unidade do domínio (fatura/ciclo/ano/horizonte); extrato livre acessível em Lançamentos |
| Histórico do agente e alertas | Manter navegação por conversa e fluxo de leitura/limpeza de avisos por dia, com paginação própria |
| Contas, cartões, carteira, categorias, regras, metas e pessoas | Listas de configuração ou posição atual; período financeiro fica nos extratos associados |
| Hoje, Financeiro, plano e patrimônio | Resumos com régua/horizonte próprios; recorte detalhado fica nas listas de movimentos |
| Formulários, detalhe de nota/conversa, acesso, assinatura e guia | Telas de uma entidade ou tarefa, sem lista histórica a recortar |

Aceitação: limites inclusivos, mesmo dia, virada de mês/ano, cancelamento sem efeito, limpeza total, busca combinada, zero resultados acionável, conta sem conta, transferência recebida, resultados após primeira página, erro recuperável, temas e teclado. Não mostrar agregado do período inteiro como se fosse total de uma lista filtrada.

## Verificação

Cada item termina com testes de domínio/integração e fluxo nativo. Matriz: usuário novo, usuário com histórico, usuário com cartão/conta distintos, usuário corrigindo um cadastro e usuário com muitos resultados. Gates: `npx tsc --noEmit`, `npx expo lint`, `npm test`; SQL em staging com rollback; se agente mudar, ruff/pytest e verificação correspondente. Resultados e problemas adicionais encontrados serão acrescentados aqui com evidência, sem declarar prontidão baseada só em testes unitários.

## Entrada — resultados da primeira entrega

- Migration `20260930164920` aplicada **somente em staging** após RED/GREEN com rollback e revisão. Tipos regenerados, consultas com FK explícita (novo vínculo torna embeds sem hint ambíguos).
- SQL passou: criação atômica, retry, payload divergente, RLS/workspace, input inválido sem resíduo, cartão/quitar/desfazer, contas arquivadas no histórico, conversão, simulação com rollback e cascata. Conversão de datas: 92 casos.
- `npm test`: 1.263/1.263; `npx tsc --noEmit` e `npx expo lint`: saída 0. 18 testes dos hooks executam as escritas reais contra transporte simulado, incluindo retry depois de erro.
- iPhone: financiamento criado pelo formulário, entrada R$ 200 + 5×R$ 200, saldo R$ 1.000 e zero pagas; edição da entrada para R$ 150 conservou saldo/contagem. Exclusão da entrada pelo formulário deixou o contrato intacto.
- iPhone: compra de R$ 1.200, entrada R$ 200, cinco parcelas de R$ 200. Conferência SQL: plano R$ 1.000 + despesa da entrada R$ 200, sem duplicação.
- iPhone: entrada anexada a financiamento existente pelo formulário dedicado, R$ 100 em Nubank Cartão. Calendário não avança para outubro por limite máximo de hoje.
- Evidência durável em `docs/qa/2026-09-30-entrada-filtros/`. Inventário de QA e limpeza descritos na aceitação final.
- Encontrados e corrigidos: entrada não oferece parcelar/converter; data futura bloqueada também na edição; unidade do valor preservada no rascunho ao alternar formatos; campos da entrada com espaçamento e mensagens por campo; testes VM ganharam os globals/hooks reais usados pela implementação concorrente de movimento.

## Filtros — implementação e regressões

- Folha única com rascunho por abertura. Aplicar publica o recorte; fechar cancela; Limpar dentro da folha só altera o rascunho até aplicar. Nenhum filtro de visita é gravado nas preferências.
- Lançamentos e importações filtram no PostgREST antes da paginação. Notas e lembretes também preservam os filtros nas páginas seguintes. Listas de contratos carregam todas as páginas antes de aplicar seus critérios, com desempate estável e erro explícito em vez de resultado truncado.
- Datas `date` têm bordas inclusivas. Timestamps usam meia-noite no fuso exibido pela pessoa e teto exclusivo do dia seguinte, incluindo transições de horário de verão. Previsões longas são divididas em janelas inclusivas/disjuntas de até 62 dias, paginadas, com cancelamento e falha de qualquer janela propagada ao período.
- Resumos globais de lançamentos, recorrentes e parceladas saem durante o recorte. Estratégia/saldo global de dívidas ficam explicitamente identificados como dívidas ativas. Resultados arquivados, encerrados ou terminados encontrados por filtros abrem diretamente.
- Contas arquivadas continuam disponíveis para filtrar histórico e para exibir uma conta já vinculada na edição. Novos pagamentos continuam sujeitos à guarda de conta ativa no banco.
- Problemas adicionais corrigidos: lixeira era ordenada por exclusão só no pedaço carregado; agora ordena no servidor antes de paginar. “Ver mais” de lembretes ficava preso a um painel no tablet. Busca de notas agora mostra as notas do recorte sem uma grade de pastas que não correspondesse ao texto/período.
- Teclado corrigia “lixeira” para “Liberia”; o filtro preserva o texto, como a busca existente. RED/GREEN e teste nativo depois de reiniciar a frio comprovaram a correção.
- Cartões de notas apareciam visualmente e desapareciam da árvore AX no iOS. `ItemLink` agora oferece uma caixa acessível fora do preview nativo, preserva rótulos financeiros ricos, ativação e ações da mesma lista do menu. Testes usam Link/Trigger/Slot reais do SDK instalado. O QA confirmou AX, navegação por toque e menu contextual com preview. A fronteira `NativeLinkPreview` com `display:contents` é a hipótese causal sustentada pela fonte; o funcionamento corrigido foi comprovado no nativo.
- Botão mantinha a largura do rótulo antigo ao trocar para “Filtros ativos”. O rótulo/ícone agora medem em fluxo natural; loader, feedback e cores continuam animados. RED/GREEN em ambos os materiais e captura final confirmam uma linha legível.
- Calendário: setembro (cinco semanas) → agosto (seis) deixava 30/31 fora da moldura e sem toque, embora presentes no AX. A grade interativa agora mede em fluxo natural, preservando crossfade do cabeçalho. Isso sozinho passou no teste isolado, mas falhou no iPhone; a investigação do ancestral revelou a altura animada de abertura retida ao destacar o worklet de `Presenca`. O mesmo envelope agora permanece aplicado e escreve `height: 'auto'` ao assentar. A [documentação do Reanimated 4](https://docs.swmansion.com/react-native-reanimated/docs/core/useAnimatedStyle/#remarks) confirma que remover um estilo animado não limpa suas propriedades e que ele prevalece sobre estilos estáticos. Teste de integração com `DatePickerField`, `Calendar` e `Presenca` reais: RED em três casos; GREEN em sete. Aceitação a frio no iPhone mostrou 30/31, selecionou 31/08 e bloqueou o intervalo invertido; depois aceitou 30/09 nas duas bordas. Preparação, saída, limites, ações inativas e movimento reduzido mantêm cobertura.
- O campo de calendário não anunciava sua data ao leitor de tela. Agora `accessibilityValue` expõe a data ou placeholder, acompanhado de RED/GREEN e valor AX conferido no iPhone. Entrada também anuncia valor, data e conta no alvo acessível.

### Evidência nativa

Foram criadas fixtures sintéticas em staging: 56 lançamentos, 26 lembretes pausados (sem enviar avisos), 34 notas e 23 importações, mais uma pasta com uma das notas de QA. O alvo foi colocado depois da primeira página de cada lista.

| Persona/cenário | Resultado observado |
|---|---|
| Histórico extenso | Lançamento na posição 56 encontrado por mínimo=máximo R$ 300,50; nota após as primeiras 30, lembrete após os primeiros 20 e importação após as primeiras 20 encontrados sem paginar manualmente |
| Conferência de parcelas | Período 30/09/2026–30/01/2027 mostra prestações gravadas e previstas ao longo dos cinco meses |
| Valor inválido | Mínimo R$ 200 e máximo R$ 100 desabilitam Aplicar e exibem erro; R$ 200–R$ 200 é inclusivo |
| Datas inválidas | Inicial 30/09 e final 31/08 bloqueiam Aplicar; corrigir final para 30/09 encontra a nota alvo |
| Combinação financeira | Texto + 30/09 nas duas bordas + Gastos + Concluído + Sem conta + No app encontra somente o alvo; seleções conferidas antes de aplicar |
| Refinar e desistir | Cancelar alteração do texto conserva o recorte anterior; reabrir mostra o valor aplicado; limpar devolve a lista |
| Agenda | Um dia + Pausados + Notificação e WhatsApp encontra o lembrete alvo |
| Importação | 01/09/2026 nas duas bordas + CSV + Sem conta encontra só o alvo; seleções conferidas no rascunho |
| Organização de notas | Texto funciona em notas, arquivadas, lixeira e dentro da pasta, mantendo o escopo desta |
| Nada encontrado | Recorrentes exibem estado vazio acionável sem resumo global nem mensagem enganosa de ativas |
| Acessibilidade e aparência | Cartão AX navegável e menu nativo preservado; tema escuro escolhido no próprio app e depois restaurado para Claro |

Fast Refresh não refletiu algumas mudanças neste simulador. As correções finais foram carregadas encerrando/reabrindo exclusivamente `.dev`; `localhost:8081/json/list` confirmou o alvo Hermes correspondente. Não se confundiu uma captura de bundle antigo com defeito da versão final.

## Aceitação final

- `npm test`: **1.324/1.324**, zero falhas, cancelados, skips ou todos. `npx tsc --noEmit`, `npx expo lint` e `git diff --check`: saída 0.
- `supabase/tests/down_payment.sql` repetido após integração em staging, com rollback: `PASS: entrada, atomica, retry, guards, RLS, cascade, cartao, sem entrada, simular/converter`. Nenhuma mudança no agente Python.
- Testes dos hooks executam consultas reais com transporte simulado: predicados antes de paginação, filtro nas próximas páginas, mais de 1.000 resultados previstos, período de 335 dias, limite de concorrência, cancelamento, erro de uma janela, conta arquivada e placeholder de outro recorte descartado. Datas exercitam virada de mês/ano, fevereiro bissexto e dia de 23 horas no horário de verão. Os testes de UI exercitam rascunho, limpar/cancelar, intervalos/valores inválidos e zero inclusivo.
- Fluxos financeiros nativos: criação, consulta, edição e exclusão da entrada; conta/cartão independentes; saldo e número de pagas conferidos no SQL. Ensaio adicional sem salvar: R$ 200 de entrada + 5×R$ 200 = R$ 1.200 no modo cada parcela, seleção de 31/08 aceita e navegação para outubro bloqueada pelo máximo de hoje. Links financeiros continuam anunciando saldo/valor e abrem pelo toque após a mudança de `ItemLink`.
- React Doctor 0.9.14: `--scope changed --base HEAD --include-untracked --no-score --no-supply-chain --no-cache`, **zero erros e 18 avisos**. Dezessete são complexidade de funções que já cruzavam o limiar no baseline; as funcionalidades aumentaram parte dessas métricas. `DatePickerField` mudou de 18/17 para 19/18 (ciclomática/cognitiva), `PresencaAnimada` reduziu de 20/20 para 19/19. O aviso de lookup em recorrentes é falso positivo: `semAcento(...).includes(...)` opera sobre `string`, não array. A extração do campo de data compartilhado eliminou o aviso introduzido no novo editor; o estado vazio da lixeira também não cria novo aviso. Não houve supressão de regras nem score remoto inventado. Esses avisos descrevem custo de manutenção, sem defeito funcional demonstrado.
- Evidência em [README do QA](../qa/2026-09-30-entrada-filtros/README.md), com capturas originais e manifest de integridade. Aceitação nativa em iPhone; materiais opaco/vidro e ramos de movimento reduzido também cobertos localmente. Não foi executado um segundo dispositivo Android/tablet nesta tarefa.
- Limpeza atômica em staging por IDs e proprietário/workspace conferidos: 139 fixtures + uma pasta, dois contratos de QA, sete movimentos vinculados e três pedidos de escrita removidos. A primeira preflight recusou um UUID transcrito com `b20a` em vez de `b20b`; nenhuma remoção ocorreu nessa tentativa, e o inventário foi corrigido contra o banco antes de executar. A fatura preexistente foi preservada, assim como seus quatro movimentos originais e metadados de quitação. Tema original Claro restaurado. [Resultados dos gates e limpeza](../qa/2026-09-30-entrada-filtros/verificacao.txt).

Migração aplicada em staging e implementação no checkout `gabriel/entrada-filtros`. Publicação de versão/produção não integra esta entrega.


## Revisão visual posterior — filtros compactos

O feedback de 30/09 rejeitou abas/chips/pílulas redundantes de Lançamentos e os três botões da seção de datas. Critérios concentrados na folha; período, contagem e resumo textual no cabeçalho; ícone único redefine as datas no rascunho. Revisão também corrigiu largura flex do resumo, ocultação imediata de dinheiro no crossfade, régua efetiva do retorno e corte vertical no Button em fonte máxima. Nenhum contrato financeiro ou dado alterado nesta revisão.

Verificação final: **1.338/1.338** testes, TypeScript/lint/diff saída0; integração do editor em telefone/tablet no harness; QA direta iPhone em Claro/Escuro, reset/cancelar/aplicar, resultado vazio e fonte máxima. Preferências Claro e fonte large restauradas. Evidências e limites: [filtros-visuais](../qa/2026-09-30-filtros-visuais/README.md).


## Continuação visual — outras listas

O padrão compacto agora é compartilhado por Lembretes, Importações, Dívidas, Parceladas, Recorrentes e Notas (aba, pasta, Arquivadas e Lixeira). Saiu a limpeza repetida ao lado do botão; ela permanece na folha e nos estados vazios como recuperação contextual. Tags de Notas passaram à folha; busca fixa, navegação de pastas, ações das notas e edição das tags de uma pasta foram preservadas. Opções, resumo e rótulo acessível usam os mesmos critérios, com ordem da folha independente da ordem dos toques. Valor de Parceladas continua explicitamente sem a entrada.

Problemas adicionais corrigidos nesta continuação:

- Notas podia restaurar busca antiga ao abrir/aplicar a folha antes do debounce. A abertura captura a digitação atual antes de montar o rascunho; aplicar/limpar sincronizam a busca e cancelam o timer anterior. Teste com timers controlados exercita o race, cancelamento, tags e limpeza.
- O resumo mantinha a geometria animada ao retirar o envelope de `TrocaSuave` depois do crossfade. QA nativo em fonte máxima comprovou altura presa em19 pontos e texto cortado; manter o mesmo envelope com dimensões `auto` ao assentar devolve o layout ao nativo. Opacidade/transform do conteúdo continuam desanexadas no repouso para preservar material e interação. Dois testes RED; movimento+UI financeira GREEN314/314. A largura mínima do resumo também impede uma coluna de120,67 pontos: na fonte máxima ele usa370 pontos e o botão vai para a próxima linha.
- Contagem e resumo agora derivam do mesmo objeto, preservando zero, intervalos, nomes completos, acessibilidade e ocultação imediata de valores. Seleções inexistentes usam descrição humana; UUIDs não chegam ao cabeçalho. Maps eliminam o novo aviso de lookup sem suprimir regras.

Gates finais desta continuação: **1.348/1.348** testes, TypeScript/lint/diff saída0. React Doctor instalado0.9.14: zero erros,19 avisos;18 funções já complexas e o falso positivo em string. `TrocaSuave` passa a ser incluída no diagnóstico de alterações porque recebeu uma edição direta; a correção remove uma condicional da função que já existia no HEAD. Nenhuma falha funcional foi demonstrada por esses avisos; detalhes e limites em [outras-listas](../qa/2026-09-30-filtros-visuais/outras-listas/README.md).

QA nativo desta continuação concluído em iPhone e Android: aplicar/cancelar/limpar nas listas, tags+busca, redefinição única, zero inclusivo, valores ocultos, Claro/Escuro e fontes ampliadas. Preferências e filtros restaurados. A única pasta/tag temporária foi removida depois do QA dos dois dispositivos; as duas notas ativas e três arquivadas originais foram preservadas. AVD read-only criado pelo primário foi encerrado sem salvar snapshot; nenhum dado financeiro foi alterado. Limites de Android/fonte, acessibilidade e tablet estão registrados no QA, sem reivindicar execução nativa em iPad.

## Datas contextualizadas e intervalos abertos

A continuação remove o título repetido das datas e coloca o domínio diretamente no rótulo de cada input nos dez consumidores. Lançamentos aceita somente inicial (“A partir de”) ou final (“Até”), com borda inclusiva e sem impor o mês/ciclo no lado vazio. Conforme decisão expressa do usuário, uma data busca registros; as duas também incluem previsões calculadas. O mês/ciclo padrão conserva suas previsões. Registros futuros já existentes, inclusive parcelas com selo previsto, permanecem no histórico aberto.

A correção atravessa folha, tela e hooks: predicados opcionais em todas as páginas; validação da ordem preservada; prontidão independente de consultas da régua; previsões em cache/em trânsito e erros inativos excluídos; refresh/retry somente das consultas pertinentes; guardas dentro de queryFn para refetch manual de RPCs com argumentos incompletos. A redefinição única junto ao primeiro rótulo mexe só nas datas do rascunho, conserva outros critérios e exige Aplicar; fechar cancela.

Problemas adicionais reproduzidos e corrigidos nesta continuação: erro de datas fora da área visível, agora contextual no campo final; período espremido na fonte máxima; TextField de altura fixa cortando glifos, agora acompanha a linha escalada respeitando limites e geometria do chamador; dias sem ano em histórico de vários anos; total diário espremendo a data; piso escalado da Row excedendo a largura do card e cortando título/valor. Cabeçalho pode quebrar linha; Row mede o painel real e limita o piso ao espaço disponível, com valor ajustado apenas quando não cabe em sua própria linha. Nenhuma fonte foi limitada globalmente.

Gates finais: **1.364/1.364**, zero falhas, cancelados, skips ou todos; TypeScript/lint/diff saída0. React Doctor instalado0.9.14: zero erros,20 avisos —18 funções já complexas, a Row que cruza o limiar com o layout medido (ciclomática15/cognitiva16) e o falso positivo em string. O diagnóstico completo e o custo de manutenção estão registrados, sem supressões nem defeito funcional inferido apenas do aviso.

QA direta iPhone e Android: datas independentes, ambas, mesmo dia, ordem invertida, cancelamento, reset/limpeza, combinação com tipo, Claro/Escuro e fontes ampliadas. Rótulos dos dez consumidores conferidos no iPhone; composição telefone/tablet no harness. Registro de2027 comprovou ausência de teto oculto no histórico aberto. Vídeo nativo registra reset/cancelar/aplicar; capturas posteriores comprovam layout final. Uma suspeita de cor do botão foi descartada após instrumentação e conferência do hook original em repouso: o AVD lavapipe demorava a assentar a animação; toda instrumentação foi removida.

A pasta vazia temporária foi criada após autorização expressa e removida pelo app. Duas notas ativas e três arquivadas originais preservadas. iPhone Claro/fonte large e Android Sistema/fonte1,0/night no restaurados, filtros de QA limpos; apenas o AVD read-only iniciado pelo primário foi encerrado sem salvar snapshot. Sem alteração financeira/migration/publicação nesta continuação. Evidências, RED/GREEN, limites e hashes: [QA das datas abertas](../qa/2026-09-30-filtros-visuais/datas-abertas/README.md).

## Alinhamento do rótulo — 01/10/2026

Reproduzida a diferença de 9 pontos entre os centros do rótulo “Lançamento a partir de” e do reset. A linha centralizava o envelope, mas sua camada interna com flex preenchia a altura da ação e alinhava o texto no topo. Centralizar o conteúdo dessa camada no `Field` corrige a causa, com layout natural e sem deslocar input ou segundo rótulo.

QA direta iPhone em fonte normal/máxima, com/sem datas e reset: centros coincidem e geometria fica estável ao ocultar a ação. Aplicar confirma o intervalo aberto; reset só altera o rascunho; cancelar conserva o intervalo aplicado. **1.364/1.364**, TypeScript/lint/diff saída0. Fonte large, filtros limpos e Notas originais conferidos ao final. Evidências e limites: [QA do alinhamento](../qa/2026-10-01-alinhamento-rotulo/README.md).

## Gap das datas — 01/10/2026

Reproduzida a diferença que restou após centralizar o reset: 18 pontos no primeiro campo e 9 no segundo. A ação de 36 pontos deixava espaço adicional abaixo do texto centralizado. O `Field` passa a medir texto/linha e descontar esse espaço do gap solicitado; as duas datas compartilham o token de 16 pontos. O alvo interno dos inputs mede 17 pontos com a borda. A geometria acompanha fonte/quebra de linha; o reset permanece centralizado e campos comuns conservam seu espaçamento.

Regressão com o componente real e eventos de layout de alturas diferentes. **1.365/1.365**, formulário/movimento36/36, TypeScript/lint/diff saída0; React Doctor sem erros ou avisos novos (20 anteriores). Oito estados nativos iPhone: vazio/selecionado/reset, fonte normal/intermediária/máxima, rótulo longo de duas linhas contra uma, aplicar/cancelar e restauração. Fonte large e Notas originais conferidas ao final. Evidências, arredondamento e limites da automação: [QA do gap](../qa/2026-10-01-gap-rotulo/README.md).
