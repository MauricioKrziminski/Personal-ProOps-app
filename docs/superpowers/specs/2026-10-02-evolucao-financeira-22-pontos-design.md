# Evolução financeira do ProOps — especificação dos 22 pontos

Data: 02/10/2026. Baseline: `main`, `b7eccc0e`. Trabalho: `gabriel/financas-22-melhorias`.
Referência funcional: Tudo-Azul `dev`, `bf0428a`. Autorização: Gabriel aprovou os 22 pontos e pediu documentação antes da execução, implementação individual e validação real em iOS e Android antes de avançar.

## 1. Objetivo e contrato de entrega

A pessoa registra como pagou, entende de onde vem o dinheiro e planeja objetivos sem precisar conferir os números numa planilha. O ProOps continua sendo um lugar calmo para decidir, com captura por conversa e cálculos determinísticos. A expansão usa o formulário único, as contas, as faturas e a projeção existentes.

Esta especificação define produto, domínio, interfaces planejadas, desenho, sequência e aceite para **todos os 22 pontos**. Não é uma declaração de que foram implementados. O estado executado e a evidência ficam no [registro de execução](../../qa/2026-10-02-evolucao-financeira/README.md). A numeração segue a última lista entregue ao Gabriel: reserva é F07, capacidade das metas F08 e subcategorias F09; o relatório inicial tinha outra ordenação.

Cada ponto atravessa, nesta ordem:

1. Confirmar fonte atual, contratos e dependências; escrever testes que falham pelo comportamento ausente.
2. Implementar domínio, persistência, integração e interface; refatorar a responsabilidade necessária quando a estrutura atual impedir correção ou atomicidade.
3. Executar checks automatizados e provar a gravação/leitura e os efeitos financeiros com dados controlados.
4. Interagir com a versão modificada em **iOS e Android**; verificar navegação, teclado, estados, edição, cancelamento e casos reais da matriz do ponto.
5. Revisar composição nos dois temas, fonte ampliada, movimento reduzido e telefone/tablet aplicáveis. Registrar aparelhos, versão, comandos, resultado e capturas.
6. Corrigir os problemas encontrados, verificar a correção e registrar a aceitação. Só então iniciar o próximo ponto.

Um teste verde não substitui execução nativa. Uma imagem não prova persistência. Instalação não prova abertura. Uma consulta em banco não prova que o usuário consegue chegar ao fluxo. Se um ambiente indispensável não estiver acessível, o ponto permanece sem aceite e a execução seguinte não começa.

## 2. Fontes de verdade e recursos que permanecem

Instruções: `AGENTS.md`, `CLAUDE.md`, `.claude/rules/{frontend,finance,design,workflow,supabase,agent,ai-gemini}.md`. Direção visual: `PRODUCT.md`, `DESIGN.md`, spec Suave de 16/09 e implementação dos primitivos. Antes de API Expo, consultar [SDK 57](https://docs.expo.dev/versions/v57.0.0/). Fontes antigas em `docs/design/` são histórico: por exemplo, `transacao-form.md` ainda descreve a tela anterior; criar/editar hoje é `/finance/lancar`.

O baseline já contém: lançamento único nos formatos Uma vez/Recorrente/Financiamento, salvar e criar outro, categoria personalizada no fluxo, contas e saldo derivado, cartão com fechamento configurável, pagamento parcial/integral/histórico e adiamento reversível, recorrência mensal/semanal/anual, edição por alcance, parcelamento com entrada e histórico, importação com conciliação, orçamento em reais, metas com ledger, ativos com reavaliação, projeção e múltiplas hipóteses, voz no agente, alertas e privacidade.

Preservar esses recursos. Não transplantar o limite mensal da referência, exclusão destrutiva de contas, bloqueios universais por percentual de dívida, quatro fatias obrigatórias de orçamento ou fórmulas que ignoram patrimônio atual.

## 3. Direção de experiência e referências

Modo **Operate**: a pessoa conclui uma tarefa em pé, numa mão, com dados sensíveis, fonte ampliada e conexão imperfeita. A inovação aparece na continuidade entre registro, consequência e planejamento, usando a identidade atual do ProOps.

Referências consultadas em 02/10/2026:

- [Copilot Money](https://www.copilot.money/): inspiração para organização financeira, relação entre dado e investigação e acabamento de produto. Adaptação proposta: explicar o que mudou com acesso aos lançamentos reais.
- [Linear Mobile](https://linear.app/mobile): referência de hierarquia, navegação e edição móvel. Adaptação: tarefa curta, resposta imediata e detalhe progressivo.
- [Apple Wallet](https://www.apple.com/wallet/) e [guia oficial](https://support.apple.com/guide/iphone/about-apple-wallet-iphc05dba539/ios): identidade dos cartões, continuidade espacial e leitura de informações associadas ao cartão. Reusar a face e a carteira existentes.
- Awwwards é régua de acabamento e pesquisa de direção de movimento; não é especificação de controles financeiros nativos. Não afirmar que uma referência foi premiada sem evidência. Capturas e estudo visual de cada nova superfície entram no respectivo incremento antes do aceite.

As interpretações acima são decisões de design do ProOps, não recursos prometidos por essas empresas. O resultado genérico do UI/UX Pro Max sugeriu serifas, azul e padrão de landing page; esses elementos conflitam com a identidade existente e não serão importados. Aplicar suas regras de acessibilidade, formulário, toque e adaptação junto da stack React Native.

### 3.1 Sistema visual e componentes

- Plus Jakarta Sans, faces de `Fonts` por peso; números monetários tabulares. Martian Mono só em código nas notas.
- Cores semânticas de `src/constants/theme.ts`; medidas de `src/design/tokens.ts`. Não introduzir paleta por feature.
- Ritmo: 24dp entre blocos, 8dp dentro de grupo, 12dp entre linhas relacionadas; margens e largura pertencem a `Screen`, `SheetScroll` e primitivas adaptativas.
- Superfícies de conteúdo opacas, um destaque relevante por tela. Cor de emissor somente dentro da face do cartão.
- Regra mais recente e primitivos permitem `GlassBackdrop` nos controles interativos de iOS 26; Android e iOS anteriores recebem sua implementação própria. Não desenhar vidro decorativo em conteúdo. O texto antigo de DESIGN.md e o sidecar têm divergências: não usá-los para substituir o comportamento atual.
- `Field`, `MoneyField`, `DateField`, `QuantityField`, `SelectField`, `Segmented`, `TaskHeader`, `Screen`, `SheetScroll`, `Button`, `Row`, `Money`, `LedgerRow`, `EmptyState`, `ErrorState`, `VerMais`, `SecaoDeArquivados` e ações nativas são o vocabulário inicial.
- Valor gravado de lista variável usa `SelectField`. `Segmented` aceita 2–4 alternativas curtas. Chips representam filtros. Seis meios de pagamento não viram seis segmentos comprimidos.
- Páginas financeiras ampliadas usam `AdaptivePanes`/`FinanceTabletCanvas`; formulários respeitam a largura máxima existente e safe areas em retrato, paisagem e janela dividida.
- Nome, identificador e valor não truncam. Alvo de toque mínimo 44pt no iOS e 48dp no Android; rótulo, seleção e erro devem ser acessíveis sem depender de cor.

### 3.2 Movimento e performance

Reusar `Presenca`, `MudancaSuave`, `TrocaSuave`, springs/timings de tokens, Gesture Handler, Reanimated 4 e Skia já instalados. O movimento deve revelar relação: forma de pagamento muda a origem, contribuição reposiciona um marco, hipótese modifica o futuro. Não animar uma sequência de números intermediários fictícios.

Microinterações seguem o primitivo; movimentos maiores podem existir em uma experiência de planejamento ou transição merecida, sem impor espera ao lançamento cotidiano. Gestos e interpolação de gráficos ficam na UI thread. Preparar dados fora do canvas, virtualizar listas longas, cancelar consultas obsoletas e separar transformações visuais de cálculos financeiros. Reduce Motion substitui deslocamento/parallax por apresentação estável/crossfade. O botão continua respondendo enquanto efeitos decorativos terminam.

Biblioteca nova exige lacuna concreta no kit atual, compatibilidade SDK57/RN0.86/React19/New Architecture, licença, manutenção e evidência de comportamento nas duas plataformas. Não instalar um segundo kit inteiro de formulários para trocar a identidade do app. A primeira feature usa a stack instalada.

## 4. Arquitetura e invariantes comuns

### 4.1 Responsabilidades

- `src/lib/`: contratos, normalização, validação e builders puros por domínio. Mantêm dinheiro em centavos e datas explícitas. Não fazem rede.
- `src/components/finance/`: campos e unidades financeiras reutilizáveis; consomem contratos tipados. `src/components/ui/`: desenho por plataforma e acessibilidade.
- `src/hooks/`: consultas/mutações TanStack Query, cliente Supabase único, invalidação e Realtime. Queries falhas não viram zero ou vazio.
- `supabase/migrations/`: constraints, propriedade por workspace, regras financeiras, atomicidade e concorrência. Não editar migration aplicada. RPC existente conserva assinatura para clientes publicados.
- `agent/app/`: Python/FastAPI/LangGraph, parsing, ferramentas determinísticas, scheduler e importação. Não criar Edge Functions ou outro agente paralelo.
- Testes TS de funções e UI, SQL de integração sob rollback e pytest verificam camadas distintas. Matriz nativa fecha a entrega.

Os nomes de arquivos/APIs novos indicados neste documento são **contratos planejados**, não interfaces já disponíveis. O plano do ponto fixa a assinatura concreta antes do primeiro teste; nunca chamar API presumida.

### 4.2 Dinheiro, tempo e escopo

1. `amount_cents` inteiro positivo; direção em `kind`. Rejeitar NaN, infinito, decimal em centavos e números fora da faixa segura do cliente. Percentuais têm unidade explícita e política de arredondamento.
2. Transferência própria não aumenta receita/despesa. Compra no crédito não debita banco antes do pagamento; pagamento de fatura não duplica gasto. Aporte/resgate e alocação têm semântica própria.
3. Datas civis, vencimento e instante têm contratos distintos. Passar o dia local explicitamente; funções dependentes de hoje usam America/Sao_Paulo. Clamp de último dia e bissexto usa a regra existente.
4. Régua Mês/Ciclo preservada por tela; receita, consumo, caixa, saldo atual e previsão nunca são agregados com bases diferentes sob o mesmo rótulo.
5. Escopo por **workspace**, autor por `user_id`; validar propriedade de todas as contas, metas, ativos e referências. Authenticated não significa acesso a qualquer registro.
6. Legado desconhecido permanece desconhecido. Omissão em patch significa preservar; `null` explícito significa limpar. Clientes antigos não apagam os novos dados por omissão.
7. Dinheiro oculto continua oculto em seletores, previews, gráficos e avisos; estados de erro e sem histórico são distintos de zero.

### 4.3 Escrita, concorrência e idempotência

Uma intenção composta é uma transação no servidor: registro + juros vinculados, aporte + transferência, alocação + ledger, mudança de série + ocorrências. Nada de sequência de chamadas com meia gravação visível.

A chave de requisição identifica a intenção e sobrevive à tentativa de rede. Mesma chave e payload devolvem o resultado anterior; mesma chave com payload diferente é conflito. Um novo lançamento intencional, mesmo idêntico, recebe chave nova. Guardas de UI reduzem duplo toque, mas a garantia final é o banco. Edição usa revisão/lock para não sobrescrever uma mudança concorrente em silêncio. Toda associação e desfazer revalidam o workspace e o estado dentro do lock.

Simulação usa o mesmo builder/regra do aplicar, com rollback, sem notificações ou escrita externa. Chaves de importação existentes não mudam pela adição de metadata. Falta de prova sobre método não sobrescreve um método já conhecido.

### 4.4 Compatibilidade e publicação

Staging confirmado: `utkqoiigimqzeenxkxdl`. Produção: `kwriuifcwyvdrxtspjiz`, fora da autorização desta execução. Rodar `scripts/supabase-target.sh` antes de qualquer escrita remota. Teste financeiro usa workspace/usuário de demonstração identificado e cleanup restrito aos registros do teste.

Migration primeiro em ambiente de teste; backend deve aceitar cliente antigo; app usa contrato disponível. Regenerar `database.types.ts` da fonte. Função pública nova revoga EXECUTE de PUBLIC/anon, fixa search_path e aplica autenticação/propriedade. Rodar testes de permissões. Consultar changelog e documentação oficial do Supabase antes de novas APIs.

Commit local, push, tag, publicação de app/OTA e promoção de produção são estados diferentes. A sequência de implementação não autoriza promoção de produção ou envio de WhatsApp/e-mail. Teste do agente usa override sem-envio.

## 5. Especificação individual

### F01 — Forma de pagamento independente da origem

**Base:** `Comum` em `src/lib/lancar.ts`, três corpos em `src/components/finance/`, `src/lib/{escrita,serie,compra}.ts`, `src/hooks/use-finance.ts`, schema SQL e agente. Não existe metadata geral de método; há Pix no crédito com juros.

**Experiência:** tipo → título → estabelecimento → valor → categoria → forma de pagamento → conta/cartão → divisão → datas/extras. Campo recolhido `SelectField` com Pix, crédito, débito, dinheiro, transferência e boleto; escolha neutra “Não informar”. O método vem antes da origem que ele restringe. Ao editar, mostrar o que foi gravado. Transferência para terceiros continua despesa/receita; transferência entre próprias contas continua `kind=transfer`.

**Domínio:** `payment_method` nullable com valores canônicos `pix`, `credit`, `debit`, `cash`, `bank_transfer`, `boleto`. Null não é Pix nem crédito presumido. Forma não muda sozinha status, data, saldo ou `kind`. Crédito seleciona cartão; débito seleciona origem bancária; dinheiro, quando tem origem, seleciona carteira cash. Pix pode ter origem bancária ou crédito. Boleto/transferência externa também não devem virar uma transferência própria. Registro sem origem continua representável quando a informação realmente faltar; crédito exige cartão para definir sua fatura. Compatibilidade deve ser explicitada na UI e no servidor, sem selecionar outra conta por adivinhação.

Guardar e hidratar nos registros avulsos, séries, planos parcelados e defaults de pagamento do financiamento quando aplicável; histórico e ocorrências herdam a versão correta. A entrada da compra é uma movimentação independente e não herda cegamente o método financiado. Conservar os campos ao alternar formatos, converter, voltar, aplicar hipótese e salvar/criar outro. Usar os mesmos builders em simulação e gravação. Importação/agente legados aceitam ausência e preservam valor conhecido ao corrigir outros campos.

**Robustez:** reavaliar juros do Pix: o lookup atual por cartão/data/título pode associar o juro errado entre duas compras do mesmo dia, e editar hoje grava compra e juro separadamente. Se o novo fluxo tocar essa lógica, vincular dono e editar atomicamente antes do aceite, sem adotar uma linha ambígua. O schema FinanceAction do Gemini já está no teto medido; não adicionar enum/propriedade sem desenho compacto e probe real. O campo no app pode existir enquanto criação antiga do agente grava null, mas paridade implementada deve ser identificada com precisão.

**Aceite:** round trip dos seis métodos e null; edição e limpeza; troca de conta incompatível; Pix bancário e Pix no crédito; dois Pix com juros no mesmo dia; boleto pendente/quitado; pagamento externo x transferência própria; parcelas com resto, entrada e passado; alcances recorrentes; conversão entre formatos; cliente antigo; retry e payload conflitante. Comprovar método persistido e totais financeiros preservados em iOS e Android.

### F02 — Criar conta/cartão dentro do lançamento

**Base:** `account-picker.tsx`, `accounts.tsx`, `useSaveAccount`. Categoria já tem criação local.

**Fluxo:** abrir origem → Criar conta/Criar cartão → preencher cadastro no contexto → salvar → origem nova selecionada e campos do lançamento intactos. Cancelar fecha só o subfluxo. Funciona sem contas e com várias contas. O formulário de conta/cartão é extraído do atual para um componente de domínio reutilizado pela lista e pelo launcher; não manter duas versões.

**Dados:** nome/tipo/saldo atual para conta; nome/limite/fechamento/vencimento e conta pagadora para cartão. Reusar ajuste do saldo atual, defaults e validações existentes. Retornar id criado só após sucesso; invalidar contas e saldos, não limpar todo cache. Repetição da requisição não cria dois cadastros; nomes iguais não são identidade.

**UI:** ação de criação dentro do seletor, com apresentação gerida pelo primitivo/host. Evitar Modal dentro de Modal no Android. Preservar foco e rolagem no retorno, teclado e cancelamento acessíveis, origem criada compatível com método.

**Aceite:** duplo toque/retry, erro de rede, conta negativa, cartão sem dias, nome longo/igual, cancelamento, método mudado durante retorno, arquivo arquivado, teclado aberto e volta nativa. Confirmar uma entidade criada e draft intacto nas duas plataformas.

### F03 — Saldo e limite no seletor

**Base:** `useAccountBalances`, `useCardSummary`, `src/lib/accounts.ts`, `AccountPicker`.

**Fluxo:** escolher origem vendo saldo ou limite disponível e contexto de fechamento. Saldo negativo aparece com sinal; dado ainda não recebido mostra carregamento; falha oferece recuperação. Ocultar valores obedece privacidade.

**Domínio:** saldo vem da consulta derivada existente. Limite usa todas as obrigações que realmente o comprometem, pagamento parcial e parcelas futuras conforme regra do ProOps. Não somar somente a fatura visível. Limite ausente não vira ilimitado/zero. Saldo não implica disponibilidade bancária em tempo real; trata-se do registrado no ProOps. Avisar insuficiência sem impedir registro histórico verdadeiro.

**UI:** ampliar metadata do seletor existente, texto secundário com `Money`/formatação que respeite privacidade, identificadores quebram linha. Reusar query de recurso, sem chamada por cada opção.

**Aceite:** 0, negativo, limite não cadastrado, comprometimento parcelado, parcial/adiamento, consulta lenta/falha/atualizada, privacidade, muitas contas e nome longo. Seleção continua disponível sem número quando consulta auxiliar falha; medir abertura sem cascata N+1.

### F04 — Prévia do efeito financeiro

**Base:** `escrita.ts`, `useSimulacao`, `hipotese.ts`, regras SQL de fatura/caixa.

**Fluxo:** resumo compacto junto da decisão: Pix quitado mostra saída na conta; pendente mostra vencimento e que não alterou saldo atual; crédito mostra ciclo e vencimento; parcelada mostra compromisso total, parcelas e entrada separada. Expandir para detalhar cronograma sem outra tela de lançamento.

**Domínio:** prévia deriva do mesmo registro canônico/regra que salvará. Datas do fechamento, inclusão no próprio dia, último dia, pagamentos e conta pagadora vêm do servidor. Simulação não deixa dados. Resultados têm identidade do draft: resposta antiga de uma consulta não aparece sob valor novo. Distinguir limite, caixa atual e previsto.

**UI/motion:** transição contínua da origem ao efeito, `TrocaSuave` e estados estáveis; nenhuma contagem falsa. Teclado não encobre resumo/ação. Em tablet, apoio contextual sem duplicar controles.

**Aceite:** antes/no/depois do fechamento; fevereiro/31; data futura/passada; centavos e entrada; trocar conta/valor rápido; offline/retry; ocultação. Conferir preview contra efeito gravado, sem duas cópias da aritmética.

### F05 — Filtros e detalhes por pagamento

**Base:** `transactions.tsx`, `[txId].tsx`, `TransactionFilters`, ledger esperado e testes de filtros.

**Fluxo:** selecionar um ou vários meios e combinar com status, conta, categoria, data/valor. “Não informado” é um filtro concreto. Detalhe mostra método e origem com edição no launcher. Ex.: boletos pendentes numa conta.

**Domínio:** filtro no servidor e na porção prevista devem ter a mesma semântica; contar paginação após filtro e manter ordem. Não filtrar apenas as primeiras 50 linhas no cliente. Resumo ativo tem a mesma base da lista ou usa a regra atual de ocultar o resumo global. Chaves incluem todos os filtros, mas filtros não viram preferência persistente.

**UI:** reusar filtro visual existente, chips exclusivamente para filtros e botão de limpar. Estado vazio explica a combinação; falha não diz “sem gastos”.

**Aceite:** histórico null, múltiplos meios, item após página inicial, previstas de versões antigas, datas abertas, conta recebendo transferência, zero resultado e limpar. Agregados e exportação/links que recebam filtro devem ser explicitamente coerentes.

### F06 — Fixa/variável e essencialidade independentes

**Base:** metadata de categoria, `categoria-sheet.tsx`, escrita de transações/séries/planos, orçamentos.

**Fluxo:** classificação opcional com dois controles separados: previsibilidade fixa/variável e essencial/não essencial. Categoria pode sugerir defaults; usuário ajusta o lançamento. Aluguel fixo/essencial, mercado variável/essencial, assinatura fixa/não essencial.

**Dados planejados:** campos nullable distintos e origem da classificação (explícita ou default aplicado). Guardar snapshot no lançamento para que mudar categoria hoje não reescreva o passado sozinho. Mudança de padrão pergunta novos registros ou histórico selecionado; backfill explícito, atômico e auditável. Uma recorrência não determina nenhuma dessas dimensões.

**UI:** campos avançados/progressivos, labels curtos, ajuda contextual. Nada de julgamento ou bloqueio de registro por ser não essencial.

**Aceite:** as quatro combinações e desconhecido; override vence default; renomear/juntar categoria; alteração de histórico por alcance; importação/agente sem prova deixam desconhecido; pagamento de fatura e transferência excluídos de consumo. Totais antes/depois iguais, apenas recorte muda.

### F07 — Reserva de emergência dedicada

**Base:** `net-worth.tsx`, saúde financeira, contas/ativos, F06. Já existe cobertura de caixa em meses; a reserva não deve apresentar todo caixa como reservado.

**Fluxo:** definir fontes da reserva → indicar despesas essenciais mensais manualmente ou usar histórico → escolher meses-alvo → ver valor reservado, alvo, cobertura e diferença. Editar fonte/base/meta e retirar vínculo sem apagar conta/ativo.

**Dados planejados:** configuração por workspace, base manual ou observada, horizonte configurável, fontes/alocações sem duplicar patrimônio. Uma fonte vale uma vez; se apenas parte estiver reservada, alocação não excede disponível e disputa com outras reservas/metas é explícita. Base histórica explica período, meses observados e classificação incompleta; insuficiência retorna estado de insuficiência, não 0 meses. Defaults editáveis são sugestões.

**UI/motion:** usar ficha de objetivo/reserva com `Money`, progresso e detalhe da base; evolução do marco acompanha dado confirmado. Uma nova rota só se a configuração/extrato não couberem na superfície existente; sem criar outra Home.

**Aceite:** sem histórico, renda nova, mês sem gasto x mês sem dados, fonte arquivada/desvalorizada, fonte em duas metas, parcial da conta, despesa reclassificada, base zero/negativa inválida, edição concorrente. Caixa e patrimônio total não aumentam pela alocação.

### F08 — Metas cabem no planejamento?

**Base:** `goals.tsx`, `forecast.tsx`, hipóteses e saldo previsto.

**Fluxo:** meta valor/prazo → contribuição necessária → Simular no planejamento → ver efeito conjunto com todas as metas e compromissos → ajustar → salvar plano. Simulação identifica cenário e fonte dos dados.

**Domínio:** contribuição planejada não cria saída real nem série silenciosa. Alocações no mesmo caixa reduzem livre, sem duplicar consumo; transferência para fora do caixa disponível tem efeito correspondente. Considerar metas simultâneas, parcelas, faturas, renda variável e pendências na régua vigente. Desconhecimento de renda/histórico não vira aprovação falsa. Aviso de saldo negativo informa data e hipótese; não bloquear por percentual universal.

**UI:** detalhe da meta com apoio da projeção existente e ação “Ajustar plano”; gráfico permite examinar o período. Reusar seleção de horizonte e comportamento por plataforma.

**Aceite:** duas metas concorrentes, prazo próximo/passado, parcialmente concluída, sem renda, salário em duas datas, cartão/fatura, dado desatualizado e cenário que não cabe. Cancelar hipótese não cria contribuição; salvar meta não muda caixa.

### F09 — Subcategorias opcionais

**Base:** categorias livres, appearance e RPCs renomear/juntar/apagar.

**Fluxo:** selecionar Alimentação → detalhar Mercado/Restaurante/Delivery se desejar → criar no contexto. Categoria simples continua suficiente. Editar nomes, mover subcategoria para outro pai e juntar mediante impacto explicado.

**Dados planejados:** identidade estável para subcategoria por workspace e categoria pai compatível com o texto livre atual; transações mantêm categoria e referência opcional. Não substituir em massa categorias históricas por FK obrigatória. Normalização sem acento/caixa para colisão, escopo em orçamentos/regras/histórico, operação atômica de merge. Remover subcategoria preserva lançamento sem detalhamento.

**UI:** seletor secundário só quando útil, respeita defaults/draft e criação local. Não preselecionar uma subcategoria de outro pai quando categoria muda. Reusar `CategoriaSheet` e extrair campo comum.

**Aceite:** pai trocado, nomes iguais em pais distintos, criação concorrente, merge com orçamento, renomeação de série/histórico, legado null, agente/importação livre, arquivo arquivado. Soma de filhos + sem detalhe fecha o total do pai.

### F10 — Prazo a partir da contribuição

**Base:** cálculo mensal já existente em metas; F08.

**Fluxo:** escolher “Tenho um prazo” ou “Posso guardar por mês”. Alterar uma entrada atualiza a derivada; não manter dois campos disputando estado. Mostrar data estimada, quantidade de contribuições e saldo restante.

**Domínio:** primeira versão sem rendimento; considerar guardado atual, aporte inicial e data da próxima contribuição. Divisão inteira/arredondamento para cima preserva alvo, última contribuição pode ser menor. Guardar 0 não produz infinito/data inválida: explica o necessário. Meta atingida tem resultado próprio. Rendimento opcional entra depois pelo F20 como hipótese explícita.

**UI/motion:** `MoneyField`/`DateField`/`QuantityField`, modo curto `Segmented`; recalcular derivado sem mover caret ou interromper digitação. Transição entre horizonte e valor mantendo continuidade.

**Aceite:** 1 centavo, alvo menor que guardado, prazo hoje, data 31/bissexto, contribuição maior que restante, zero e valor muito grande. Data estimada confere com cronograma exato; trocar modo preserva intenção.

### F11 — Reservar x transferir de verdade

**Base:** ledger de metas e transferência própria; F07/F08.

**Fluxo:** “Guardar” → separar valor já na conta ou registrar transferência para outra conta. “Retirar” → liberar alocação ou transferir de volta. Mostrar efeito no disponível e em cada conta. Vincular transferência já existente/importada quando for o mesmo movimento.

**Dados planejados:** alocação com fonte, meta, valor e histórico; movimento opcional referencia **uma** transferência canônica. Uma transferência não pode ser vinculada duas vezes como novo aporte. Soma de alocações por fonte respeita o valor conhecido; alterações históricas e desvalorização mostram déficit, sem fabricar saldo. Lock fonte/meta para concorrência; request id e revisão para editar/desfazer.

**UI:** decisão explícita entre as duas ações, origem/destino conforme necessidade, resumo do efeito. Edição reutiliza os mesmos campos e explica alcance. Desfazer movimentação remove/reverte os vínculos em uma transação; apagar conta não apaga dinheiro de meta em silêncio.

**Aceite:** duas metas tentando alocar saldo simultaneamente, resgate excessivo, aporte repetido, vínculo importado, edição parcial, contas iguais, fonte arquivada, cancelar/retry, transferência futura. Nenhuma alocação duplica patrimônio ou vira consumo.

### F12 — Aporte e resgate com origem/destino

**Base:** contas investment, ativos/reavaliação, transferências, F11.

**Fluxo:** aplicar → origem bancária → posição de investimento → valor/data → revisar; resgatar → posição → destino → revisar. Histórico abre detalhe, editar e desfazer.

**Dados planejados:** ledger de movimentos ligado a uma posição e à movimentação financeira canônica. Escolher uma representação de custódia: conta de investimento ou ativo ligado à conta; nunca contar as duas como patrimônio independente. Aporte reduz fonte e aumenta posição, resgate faz inverso; não entram no consumo/salário. Importação concilia a mesma identidade. Resgate respeita valor disponível e concorrência dentro do lock.

**UI:** formulário curto compartilhado, tipo controla origem/destino, título/posição e valor antes do calendário, agrupamento consistente com Patrimônio. Resultado atualiza consultas afetadas e mantém histórico paginado.

**Aceite:** parcial/total/excessivo, aporte seguido de valorização, data retroativa/futura, valor corrigido, excluir movimento com dependências posteriores, origem=destino, idempotência e conciliação. Verificar conservação do total em movimentação sem rendimento.

### F13 — Principal, resultado e reavaliação

**Base:** `update_asset_value`, histórico de valuations, F12.

**Fluxo:** aporte coloca dinheiro; resgate retira; atualização informa valor da posição; rendimento recebido informa entrada real. Explicar variação observada sem prometer rentabilidade histórica inexistente.

**Domínio:** ledger distingue aporte/resgate/resultado recebido/valuation/correção de abertura. Principal e variação têm fontes explícitas; ganho não realizado não entra no caixa. Resgate não é todo renda. Quando custo/resultado não for conhecido, mostrar indisponível e permitir informação posterior, sem assumir custo zero. Não calcular rentabilidade anualizada com datas incompletas. Atualização retroativa respeita valuations posteriores e revisões.

**UI:** extrato com natureza e efeito, composição resumida e detalhe da base; dinheiro verdadeiro na animação. Correção e rendimento são ações distintas.

**Aceite:** posição antiga sem custo, resultado positivo/negativo, principal integralmente resgatado, aportes no mesmo dia, split de resgate, correção inicial, excluir valuation, mesma requisição e concorrência. Conferir patrimônio e caixa separadamente.

### F14 — Planejamento percentual junto do orçamento

**Base:** `budgets.tsx`, limites por categoria/padrão/mês/rollover, F06/F09.

**Fluxo:** escolher planejamento em reais ou percentual → informar renda planejada/base → grupos editáveis → distribuir → ver equivalente em reais → aplicar aos orçamentos escolhidos. Não transformar a tela de assinatura `/finance/plan` em orçamento pessoal.

**Dados planejados:** plano versionado por período/workspace, renda-base e percentuais em unidade inteira (ex.: basis points). Soma alvo 100% ou saldo não alocado visível; política explícita de resto em centavos. Persistir valores aplicados e a base histórica. Renda real variável não reescreve limites automaticamente. Rollover e limite específico continuam prevalecendo conforme contrato atual.

**UI:** composição editável com barra/diagrama acessível, números e labels antes do gráfico; confirmação explica categorias afetadas e conflito com orçamento existente.

**Aceite:** renda zero/negativa/variável, soma 99,99/100/100,01, centavos de resto, grupo sem categoria, categoria em dois grupos, rollover, mês específico e mudança posterior de renda. Planejado e realizado dizem seu denominador.

### F15 — Explicar por que o gasto mudou

**Base:** análises/categorias/tendência e filtros; F05/F06/F09.

**Fluxo:** diferença do período → decomposição determinística por categoria/subcategoria/método/classificação → itens que compõem a diferença → detalhe/edição existente. Ex.: R$300 a mais = R$200 alimentação fora + R$100 assinaturas quando os registros sustentarem isso.

**Domínio:** mesmos períodos completos e lente em ambos os lados. A soma das contribuições, incluindo não classificado, explica o delta; entradas/transferências/aportes não viram gasto. Sem base anterior, mostrar mudança absoluta e indisponibilidade de percentual. Não usar IA para inventar causalidade: “contribuiu para a diferença” é evidência de distribuição, não diagnóstico do comportamento.

**UI:** abrir progressivamente do número à evidência com `Row`/barras e lista; comparação acessível, sem seis cards repetidos. Resultado grande é agregado no servidor; itens paginados.

**Aceite:** período anterior zero/sem dados, estorno/crédito, item mudou de categoria, não informado, filtros cruzados e ciclos diferentes. Soma das diferenças fecha centavo a centavo e tocar abre o conjunto correto.

### F16 — Voz contextual no Financeiro

**Base:** agente/texto/STT já existentes, `conversation-screen.tsx`, launcher e F01.

**Fluxo:** “Lançar por voz” → gravar → transcrição revisável → rascunho financeiro → revisão no formulário existente → salvar. Informação ausente/ambígua permanece como pergunta/sem escolha. Cancelar não grava.

**Domínio:** reutilizar pipeline STT, sessão, guardas e ferramentas do agente; um modo rascunho não executa escrita antes da confirmação. IDs só podem vir de candidatos do workspace. Compactar/enriquecer contrato do Gemini com probe antes de alterar schema no teto medido; preservar idempotência de mensagem e intenção aplicada. Sem outro classificador financeiro independente. Método citado chega a F01 com semântica consistente.

**UI/motion:** microfone nos atalhos de lançar, estado escutando/processando/revisar, cancelamento claro e onda responsiva ao áudio real, respeitando movimento reduzido. Permissão de microfone com recuperação; teclado/voz não competem.

**Aceite:** permissão negada, áudio vazio/ruído, interrupção por ligação/background, rede falha, duas contas com mesmo nome, valor/total de parcelas ambíguo, “Pix no crédito”, datas relativas, cancelamento/retry e retorno ao rascunho. Nenhuma escrita durante parsing; teste real de interpretação além de dublês.

### F17 — Explicações e avisos acionáveis

**Base:** `Note`, ajuda/guide existentes, alertas e detalhes de orçamento/fatura/projeção/saúde.

**Fluxo:** tocar ajuda do indicador → ver o que conta, período, fonte e eventual estimativa → abrir itens. Aviso abre a fatura, planejamento ou lançamentos relacionados, preservando filtro e contexto. Conteúdo curto e específico; detalhe fica na ação, não em parágrafo em toda tela.

**Domínio:** registrar um catálogo de explicação por indicador com base/período/qualidade extraídos da mesma resposta; nada de texto dizendo “12 meses” quando a fórmula usa 3. Deep links de alertas revalidam existência/permissão; item apagado oferece recuperação sem criar outro. Não mudar canais/dedupe para acrescentar ajuda.

**UI:** primitivo de disclosure/help acessível e uniforme, alvo confortável; folhas de leitura com medida em tablet, linguagem pt-BR e valores protegidos.

**Aceite:** vazio/erro/dados insuficientes, indicador estimado, deep link frio e item arquivado/apagado, privacidade e fonte grande. Ajuda descreve exatamente o total mostrado e ação abre sua evidência.

### F18 — Transferência recorrente entre contas próprias

**Base:** transferência avulsa, RRULE, scheduler, projeção e escopos. Na referência o backend suporta, mas o fluxo nativo está oculto; é uma extensão do ProOps.

**Fluxo:** recorrente → transferência → origem/destino → valor/calendário → revisar. Editar ocorrência ou regra com o alcance atual. Pausar/encerrar preserva histórico. Alternar formato não troca transferência por despesa silenciosamente.

**Domínio:** série com dois ids de conta distintos, mesma propriedade; nenhuma categoria de consumo ou renda. Materialização/adopção/marcação de skip e ledger esperado preservam a identidade por ocorrência; saldo de origem e destino muda uma vez, consolidado conserva. Projeção por conta reflete os dois lados; insuficiência registrada avisa, sem inventar saldo. Cartão como origem continua apenas no contrato de Pix no crédito explicitamente suportado, sem confundir com reserva bancária comum.

**UI:** mesmos `CamposDaSerie` com apresentação condicionada, destino logo após origem; resumo compacto. Reusar calendário e descrição de regra própria.

**Aceite:** contas iguais/de outro workspace, mensal31/semanal/anual, cron repetido, série pausada, editar só/futuras/todas, mover data, ocorrência prevista tocada, registro importado adotado, futuro além da janela e saldo negativo. Receita/despesa consolidadas não mudam.

### F19 — Marcos e identidade visual das metas

**Base:** metas/ledger, F08/F10/F11.

**Fluxo:** meta pode receber ícone e marcos editáveis em valor/percentual; progresso mostra próxima etapa e o que falta. Uma contribuição confirmada atravessa o marco; retirada pode voltar etapa. Meta concluída permite revisão/arquivamento existente.

**Domínio:** marcos ordenados e únicos no intervalo do alvo. Alterar alvo recalcula percentuais sem falsificar histórico; cruzamento deriva do ledger, não de pontos por número de registros. Eventos visuais idempotentes por revisão/marco, sem notificações duplicadas nem estímulo a lançar dinheiro fictício.

**UI/motion:** `RingGauge`/barra e ícone do kit; um momento de celebração localizado, tátil e opcional, com Reduce Motion e som desligado por padrão. Não bloquear leitura/ação.

**Aceite:** aporte cruza vários marcos, retirada desfaz avanço, alvo reduzido/aumentado, duplicar evento/reabrir tela, offline, meta concluída e fonte grande. Percentuais derivam do guardado real.

### F20 — Acumulação e renda futura

**Base:** projeção financeira existente, F10/F12/F13; cálculo específico novo.

**Fluxo:** patrimônio disponível inicial → contribuição → prazo/taxa hipotética → estimativa; ou renda desejada → taxa de retirada hipotética → capital necessário. Escolher premissas nominais/reais e ver cenário. Não apresentar como recomendação de produto ou promessa de retorno.

**Domínio:** contratos explícitos de taxa mensal/anual, aportes no início/fim do período, horizonte, inflação opcional e arredondamento. Considerar patrimônio inicial; taxa zero tem fórmula própria; negativos admissíveis são definidos e domínio inválido é recusado. Limites numéricos/horizonte evitam overflow. Cálculo de cenário não alimenta caixa real, orçamento ou health score. Receita futura tem hipótese de retirada, não rentabilidade garantida.

**UI/motion:** superfície de planejamento com gráfico real e comparação de cenários, controles do kit, detalhe de premissas. Atualização de curva acompanha interação na UI thread após dados calculados; sem animar valor fictício.

**Aceite:** taxa zero/negativa, inflação maior que retorno, capital já suficiente, aporte zero, 1centavo, horizonte grande, conversão anual/mensal e grandes valores. Comparar com solução fechada/exemplos calculados independentemente; reproduzir cenário reaberto.

### F21 — Primeiro cadastro financeiro guiado

**Base:** onboarding conta/ciclo/avisos, first steps, F02.

**Fluxo:** iniciar finanças → conta + saldo atual → cartão opcional + ciclo → primeiro lançamento opcional → abrir visão financeira. Pular/retomar é permitido. Não exigir cartão, WhatsApp ou planejamento completo para usar o app.

**Domínio:** reutilizar criação de conta/cartão e regra de ajuste de abertura, sem inserir receita artificial para saldo inicial. Progresso por workspace/usuário conforme responsabilidade, com passos idempotentes vinculados aos ids criados. App interrompido retorna ao passo efetivo, sem novo cadastro. Usuário com contas pré-existentes recebe caminho apropriado.

**UI/motion:** moldura de onboarding existente e transição curta de contexto, inputs com teclado/safe area, resumo do que foi criado. Nenhuma segunda versão de formulário de conta.

**Aceite:** pular todos, saldo negativo/zero, retomada após fechar, rede cai depois de salvar, cadastro existente, troca de workspace, cartão sem conta pagadora, fonte grande e aparelho pequeno. Ao terminar há um conjunto único de cadastros e abertura correta.

### F22 — Favoritos e duplicação de lançamento

**Base:** `/finance/lancar`, `Comum`, estado guardado e salvar/criar outro já existente.

**Fluxo:** ação Duplicar numa movimentação abre rascunho novo revisável; data padrão explícita de hoje. Salvar como favorito captura template editável; escolher favorito abre o mesmo formulário. Apagar favorito não apaga movimento real.

**Domínio:** duplicar copia dados de usuário (título/categoria/método/origem/valor/configuração autorizada), jamais id, source_message_id, invoice_id, plano/série/debt_id, status de quitação, batch de importação ou idempotency key. Parcela/pagamento/juros vinculados não se tornam uma cópia da obrigação inteira sem escolha explícita. Template referencia conta/categoria; origem arquivada pede revisão. Uma duplicação intencional recebe intenção nova; duplo toque no mesmo salvar continua uma só.

**UI:** ações via `ItemLink`/menus do kit, seletor de favorito sem lista longa obrigatória no lançamento; nome/organização simples, edição com campos compartilhados.

**Aceite:** avulso/parcelada/recorrente/pagamento vinculado, conta arquivada, favorito renomeado/excluído, data antiga, pending/cleared, método incompatível, retry e duas duplicações intencionais iguais. Nenhum vínculo contábil antigo é reutilizado.

## 6. Sequência e dependências

Executar **F01 → F02 → … → F22**, com gate entre os pontos. Dependências não autorizam adiantar uma segunda feature visível. Infraestrutura mínima necessária de um ponto pode ser extraída como parte dele e testada ali.

| Bloco | Resultado ao final | Dependências relevantes |
|---|---|---|
| F01–F05 | Registro de pagamento, origem contextual e consulta | F03/F04 usam regra atual, F05 depende de F01 |
| F06–F11 | Classificação, reserva e planejamento/alocação | F07 usa F06; F08 simula sem antecipar escrita de F11; F09 detalha; F10 inverte prazo; F11 fecha movimentação |
| F12–F15 | Carteira, resultado e análise do planejamento | F12 usa modelo de vínculos do F11; F13 usa ledger; F14/F15 usam classificação e subcategoria |
| F16–F18 | Captura, explicação e automação | F16 reutiliza contratos F01; F17 documenta todos os cálculos entregues; F18 amplia recorrência mantendo neutralidade |
| F19–F22 | Progresso, cenários, ativação e reutilização | F19 usa metas; F20 usa patrimônio/ledger; F21 usa F02; F22 usa contrato canônico |

## 7. Matriz de qualidade comum

Para cada ponto, registrar cenários de sucesso, obrigatórios incompletos, erro inline, consulta lenta, consulta falha, vazios verdadeiros, sem classificação/histórico, cancelamento, retorno nativo, teclado aberto no primeiro toque, fonte ampliada, claro/escuro, Reduce Motion, ocultar saldo, nomes longos, múltiplas contas, offline/retry, duplo toque, resposta perdida, conflito de revisão, workspace errado e cliente anterior.

Casos financeiros transversais: 1centavo; resto na última parcela; limite máximo seguro; data31/fevereiro/bissexto; após21h BRT; régua civil/ciclo; saldo negativo; fatura aberta/fechada/paga/parcial/adiada; parcelas passadas; receita/card legado; entrada com conta diferente; série prevista/materializada/alterada/pulada; importação idêntica/conciliação; apagar/desfazer com dependências. Os casos aplicáveis de cada ponto entram no seu plano e não são apenas declarados cobertos.

Checks conforme área alterada: `npx tsc --noEmit`, `npx expo lint`, `npm test`; `agent/.venv/bin/ruff check app --select F,E9` e pytest no cwd agent; testes SQL do contrato, permissões anon e isolamento. Alteração de prompt/schema/catálogo exige avaliação real de interpretação e probe do schema. Agente ponta a ponta exige HMAC e override `docker-compose.sem-envio.yml`.

Evidência nativa: nome/UDID ou serial, OS, variante/bundle, commit + diff, backend/ref, dados controlados, passos e resultado persistido, screenshots/captura quando necessário. Capturar iPhone/Android phone e classes tablet aplicáveis, dois temas e fonte ampliada; evitar declarar hardware físico validado por teste em simulador.

## 8. Aceitação final do programa

Os 22 pontos precisam ter aceite individual, nenhuma migração/app anterior quebrado, paridade app/agente explicitamente registrada, testes globais finais adequados às mudanças e comparação visual de composição. Atualizar instruções de domínio quando o contrato evoluir, `docs/AGENTE-PARIDADE-COM-O-APP.md` para ações novas e catálogo de ajuda correspondente. Registrar pendências reais e alcance de verificação sem mascarar ausência de iOS, Android, hardware ou produção.

Concluído local/staging é diferente de publicado. A promoção de produção e a release serão tratadas com o alvo e artefatos concretos quando Gabriel solicitar.
