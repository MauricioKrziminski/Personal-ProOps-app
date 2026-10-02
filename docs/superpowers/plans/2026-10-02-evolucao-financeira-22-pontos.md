# Evolução financeira — plano de execução dos 22 pontos

> **For agentic workers:** usar `executing-plans` ou delegação limitada a responsabilidades do ponto ativo. Nenhuma segunda feature começa antes do aceite nativo do ponto anterior. Preservar mudanças concorrentes e relatar arquivos, evidência, checks executados e limites.

**Goal:** entregar os 22 pontos da especificação com contratos financeiros corretos, identidade visual do ProOps e prova real em iOS/Android.

**Architecture:** domínio puro em `src/lib`, componentes financeiros reutilizáveis e primitivas por plataforma; hooks TanStack para rede; transações/RLS/locks no Postgres e ferramentas Python determinísticas. Reusar o launcher, projeção e ledgers atuais. Extrair responsabilidades quando necessário, mantendo compatibilidade dos contratos publicados.

**Tech Stack:** Expo57, RN0.86, React19, TypeScript, Reanimated4/Skia/Gesture Handler, TanStack Query, Supabase Postgres e Python/FastAPI/LangGraph.

## Restrições globais

- Fonte vinculante: [especificação completa](../specs/2026-10-02-evolucao-financeira-22-pontos-design.md). Numeração é a última lista aprovada pelo usuário.
- Trabalho em `gabriel/financas-22-melhorias`; baseline `b7eccc0e`. Staging `utkqoiigimqzeenxkxdl`; produção não autorizada.
- Dinheiro inteiro em centavos; transferência/aporte/alocação não são consumo; datas locais explícitas; escopo por workspace.
- Null legado é desconhecido; patch omitido preserva. RPCs antigas continuam funcionando. Migration aplicada não é editada.
- Reusar tokens/Fonts/Field/SelectField/Screen/SheetScroll e ações nativas. Nenhum kit novo sem lacuna comprovada.
- iOS e Android reais no simulador/emulador são gates individuais, com persistência/efeitos verificados; hardware e produção são estados separados.

## Fase 0 — descoberta concluída

- [x] Inventariar features dos dois projetos e mapear os 22 pontos ao ProOps.
- [x] Ler instruções, produto, fonte visual e contratos do launcher/financeiro.
- [x] Identificar regras de compatibilidade, simulação/conversão, RRULE/versões, importação, schema Gemini no teto e riscos do juro sem dono.
- [x] Consultar Expo57, documentação Supabase e referências oficiais de produto.
- [x] Executar contexto impeccable uma vez e pesquisas UI/UX Pro Max; rejeitar sugestões que contradizem a identidade existente.
- [x] Confirmar ref staging do app/CLI; identificar Android `emulator-5574` e iPhone17Pro iOS26.5.
- [x] Escrever especificação completa antes de código.

APIs existentes permitidas: `SelectField(options,value,onChange)`, `Field(label,error,hint,children)`, `AccountPicker(accounts,value,onChange)`, `CorpoProps`, `Comum`, `linhasDoLancamento`, `argsDaParcelada`, `linhaDaRecorrente`, `linhaDoFinanciamento`, `useSimulacao` e `useConverterRegistro`. Ler a implementação antes de estender assinatura. Não criar outro expansor RRULE, cálculo de fatura/ciclo na tela, fluxo Edge Function ou enum adicional em FinanceAction sem probe.

## Ciclo obrigatório por ponto

1. Fixar assinatura/ownership em uma nota do ponto ativo e verificar contratos atuais.
2. Escrever testes de comportamento ausente e observar falha correta, não erro de infraestrutura.
3. Implementar incremento vertical completo; conferir diff e regras aplicáveis.
4. Executar os testes focados, depois os gates globais exigidos pela área.
5. Aplicar apenas schema revisado no ambiente de teste confirmado; regenerar tipos. Registrar lista exata de migrations.
6. Rodar matriz iOS/Android do ponto com dados identificáveis; conferir gravação e números.
7. Revisar imagens/gestos em tema claro/escuro, texto1,3 e movimento reduzido; corrigir em lote e confirmar.
8. Atualizar [registro de execução](../../qa/2026-10-02-evolucao-financeira/README.md), documentação de domínio e paridade. Aceitar e só então abrir a tarefa seguinte.

Não registrar etapa como feita porque foi planejada. Se faltar um dos gates, permanecer no ponto.

## Tarefas e arquivos

### F01 — Pagamento independente da origem

**Consumir:** campos comuns e builders canônicos; contratos JSON de `create_purchase`, `converter_registro`, `simular`; escopos de edição; scheduler/materialização/importação.
**Produzir:** contrato `PaymentMethod` nullable com labels/validação; seletor financeiro reutilizável; armazenamento/hidratação e leitura no detalhe; escrita e edição idempotentes/atômicas quando compostas.

Arquivos: novos `src/lib/payment-method.ts`, testes correspondentes e `src/components/finance/payment-method-field.tsx`; modificar `lancar.ts`, `serie.ts`, `compra.ts`, `escrita.ts`, `hipotese.ts`, os três corpos/campos do launcher, `account-picker.tsx`, `use-finance.ts`, detalhe e tipos gerados. Schema em migration nova criada pelo CLI, teste em `supabase/tests/payment_methods.sql`. Python apenas nas ferramentas/jobs que precisam conservar/propagar o novo contrato; FinanceAction não cresce automaticamente.

Exemplo de teste de comportamento (assinatura concreta será fixada no incremento):

```ts
assert.equal(paymentMethodError('pix', { type: 'credit_card' }), null);
assert.equal(paymentMethodError('debit', { type: 'credit_card' }), 'Escolha uma conta para pagar no débito.');
assert.equal(paymentMethodLabel(null), 'Não informado');
```

- [x] Provar RED do contrato, conservação entre formatos/builders e round trip SQL.
- [x] Implementar schema/defaults por tipo e compatibilidade legado/cliente anterior.
- [x] Implementar componente e campos compartilhados, edição/conversão/simulação.
- [x] Resolver atomicidade e vínculo dos juros no fluxo tocado; não selecionar juro ambíguo.
- [x] Rodar testes focados + types/lint/node tests; pytest/ruff quando Python mudar.
- [x] Provar SQL: null, seis métodos, campo omitido, limpar, workspace errado, escopos, idempotência, preview sem persistência, duas compras Pix no mesmo dia e entrada independente.
- [x] Testar criação/edição/cancelamento/troca de formato e salvar/criar outro no iOS/Android, com conferência de método/saldo/fatura.
- [x] Registrar aceite, imagens e limitações; liberar F02.

Aceite técnico em 02/10/2026 no staging; [matriz e limites](../../qa/2026-10-02-evolucao-financeira/f01/registro-nativo.md).

### F02 — Cadastro de origem no contexto

Arquivos: `accounts.tsx`, `account-picker.tsx`, `useSaveAccount`, componente extraído `account-form.tsx` e host contextual do launcher. Interfaces: formulário recebe valor inicial/modo e devolve id persistido; seletor recebe ação de criação, não instancia cadastro em cada tela.

- [ ] RED: retornar origem criada mantém draft; retry não duplica cadastro.
- [ ] Extrair os campos reais e guardas de conta/cartão sem copiar markup.
- [ ] Integrar criação/cancelamento/erro/seleção e invalidação mínima.
- [ ] Executar gates e cenários F02 da spec nos dois sistemas; registrar aceite.

### F03 — Saldo/limite no seletor

Arquivos: `accounts.ts`, `AccountPicker`, hooks de saldo/cartão, consultas auxiliares e testes de opções. Interface: metadata contextual opcional com estado de consulta explícito, nenhum zero inventado.

- [ ] RED: limite considera parcelas/faturas e privacidade; erro não vira saldo zero.
- [ ] Reusar agregação e ampliar seletor sem consulta por opção.
- [ ] Verificar parcial/adiamento/negativo/limite ausente e desempenho de lista.
- [ ] Executar gates e matriz nativa F03; registrar aceite.

### F04 — Efeito financeiro antes de salvar

Arquivos: `escrita.ts`, `hipotese.ts`, hook de simulação e componente de preview financeiro; integrar nos corpos do launcher. Interface: draft canônico → consequência identificada pelo mesmo draft, sem aritmética de fatura duplicada.

- [ ] RED: resposta atrasada não aparece sob draft novo; preview confere com aplicação.
- [ ] Extrair preview de leitura usando regra de servidor existente e rollback.
- [ ] Integrar resumo/cronograma/entrada/erro e movimento do kit.
- [ ] Executar bordas de fechamento/data/centavos e gates nativos F04; registrar aceite.

### F05 — Recortes por pagamento

Arquivos: `transactions.tsx`, detalhe, `TransactionFilters`, query do ledger esperado e testes de filtros. Interface: métodos[]/não informado explicitamente distinguíveis de filtro ausente.

- [ ] RED: filtragem antes de paginação e paridade materializado/previsto.
- [ ] Implementar filtros/links/chaves/cache e detalhe com a mesma semântica.
- [ ] Provar combinações/datas abertas/páginas e total coerente.
- [ ] Executar gates e matriz nativa F05; registrar aceite.

### F06 — Duas classificações independentes

Arquivos: metadata de categorias, campos compartilhados, builders, ledger/série/plano, SQL de classificação e snapshots. Interface: duas dimensões nullable e defaults aplicados explicitamente, sem inferir recorrência.

- [ ] RED: todas combinações, override, omissão/limpeza e reclassificação por alcance.
- [ ] Implementar snapshots/defaults/propagação e mudança explícita de histórico.
- [ ] Provar consumo inalterado e isolamento/concorrência.
- [ ] Executar gates e matriz nativa F06; registrar aceite.

### F07 — Reserva identificada

Arquivos: `net-worth.tsx`, health query, novo domínio/configuração de reserva e unidade de fonte/alocação. Interface: configuração + fontes + histórico essencial → cobertura/alvo/qualidade da base.

- [ ] RED: sem histórico não é zero; fontes repetidas não duplicam patrimônio.
- [ ] Implementar cálculo/configuração/vínculo e leitura explicável.
- [ ] Integrar ficha/configuração usando objetivos/componentes existentes.
- [ ] Provar dados insuficientes/fontes parciais/concorrência e gates nativos F07; registrar aceite.

### F08 — Capacidade conjunta das metas

Arquivos: `goals.tsx`, `forecast.tsx`, hipóteses, domínio de plano de metas. Interface: metas ativas + compromissos → cenário de caixa, sem movimentação persistida.

- [ ] RED: duas metas somam compromissos e cancelamento não grava.
- [ ] Implementar plano/simulação com regra atual, avisos e ajuste.
- [ ] Provar renda incerta, saldo negativo, fatura e prazos próximos.
- [ ] Executar gates e matriz nativa F08; registrar aceite.

### F09 — Subcategoria opcional

Arquivos: categorias, categoria sheet/picker, novo contrato de subcategoria, RPCs de rename/merge/delete e propagação pelos registros/rules.

- [ ] RED: mudança de pai limpa vínculo incompatível; filhos + sem detalhe fecham total.
- [ ] Implementar identidade/defaults/migração compatível e operações atômicas.
- [ ] Integrar cadastro/edição local, preservando texto livre legado.
- [ ] Provar colisões/merge/escopos/importação e gates nativos F09; registrar aceite.

### F10 — Planejar por contribuição

Arquivos: domínio de metas, campos e ficha existentes. Interface: alvo/guardado/próximo aporte/contribuição → calendário exato e prazo; modo inverso usa a mesma regra.

- [ ] RED: resto final, zero, alvo atingido e calendário31/bissexto.
- [ ] Implementar cálculo puro e derivado sem disputa de campos/caret.
- [ ] Comparar cronograma e simulação; conservar modo/intenção.
- [ ] Executar gates e matriz nativa F10; registrar aceite.

### F11 — Alocar ou movimentar

Arquivos: metas/ledger, fontes de reserva e domínio de vínculos com transferências, hooks/RPCs/detalhes. Interface: intenção alocação/transferência ou vínculo existente → uma operação atômica e reversível.

- [ ] RED: duas metas concorrentes não reservam o mesmo dinheiro; retry/vínculo não duplica.
- [ ] Implementar ledger/alocação/transferência com locks, revisão e request id.
- [ ] Integrar escolher efeito/origem/destino/editar/desfazer com formulário comum.
- [ ] Provar conservation/cleanup/importação e gates nativos F11; registrar aceite.

### F12 — Aporte e resgate

Arquivos: patrimônio/ativos, transfers e novo ledger de investimentos. Interface: posição, origem/destino, valor/data → movimento canônico + efeito na posição.

- [ ] RED: resgate concorrente não excede posição; uma custódia não conta duas vezes.
- [ ] Implementar movimento/edição/desfazer/conciliar atomicamente.
- [ ] Integrar formulário compartilhado e histórico paginado.
- [ ] Provar consumo/renda/caixa/patrimônio e gates nativos F12; registrar aceite.

### F13 — Resultado e valuation distintos

Arquivos: ledger F12, `update_asset_value`, valuations, composição de patrimônio. Interface: principal conhecido/variação/recebimento/correção com estado de qualidade explícito.

- [ ] RED: valuation não entra no caixa; patrimônio antigo sem custo não inventa rendimento.
- [ ] Implementar regras de cada operação e edição temporal.
- [ ] Integrar composição/extrato/explicações, reusando ação de reavaliação.
- [ ] Provar ganho/perda/resgate/correção e gates nativos F13; registrar aceite.

### F14 — Plano percentual

Arquivos: budgets, domínio de plano pessoal e versões, SQL de aplicação aos limites. Interface: renda-base + distribuição inteira → valores em reais e resto explicado.

- [ ] RED: soma/arredondamento e renda nova não alteram histórico.
- [ ] Implementar plano/operação de aplicação e conflitos com limites atuais.
- [ ] Integrar edição e comparação com denominadores explícitos.
- [ ] Provar rollover/mês específico/dados inválidos e gates nativos F14; registrar aceite.

### F15 — Explicar diferenças

Arquivos: finance-analysis-panes, reports, agregação SQL e links de filtros. Interface: dois períodos da mesma lente → contribuições ao delta + ids/recortes investigáveis.

- [ ] RED: contribuições incluindo desconhecido somam delta; percentual sem base é indisponível.
- [ ] Implementar agregação determinística e consultas paginadas de evidência.
- [ ] Integrar investigação progressiva/links sem uma segunda home.
- [ ] Provar regimes/filtros/créditos e gates nativos F15; registrar aceite.

### F16 — Voz no lançamento

Arquivos: composer/STT/chat/agent API, parsing/draft do agente, launcher. Interface: captura → transcrição → draft revisável sem escrita → builder canônico.

- [ ] RED: cancelar/parsing não escreve; ambiguidade não escolhe id.
- [ ] Desenhar contrato compacto, testar schema com Gemini real antes de alterar classificador.
- [ ] Implementar ponte, permissões/retomada/erro e revisão financeira.
- [ ] Executar pytest/ruff/evaluation/HMAC sem-envio e gates nativos F16; registrar aceite.

### F17 — Explicações verificáveis

Arquivos: catálogo de ajuda, detalhes e alertas/deep links. Interface: indicador + base/período/qualidade → ajuda/ação coerente com a query exibida.

- [ ] RED: texto da fórmula/período e alvo do alerta correspondem à resposta real.
- [ ] Implementar catálogo/primitivo de ajuda e destinos com recuperação.
- [ ] Aplicar às features entregues sem legendas permanentes em todo bloco.
- [ ] Provar privacidade/item ausente e gates nativos F17; registrar aceite.

### F18 — Transferência recorrente

Arquivos: tipos comuns/série, CamposDaSerie, scheduler, projeção/ledger, materialização e escopos.

- [ ] RED: origem/destino afetam conta uma vez e consolidado/renda/despesa conservam.
- [ ] Estender contrato RRULE de dois ids e edição, sem conversão silenciosa de tipo.
- [ ] Implementar materialização/adopção/skip/projeção e UI existente.
- [ ] Provar cron repetido/alcances/horizonte/importação e gates nativos F18; registrar aceite.

### F19 — Marcos das metas

Arquivos: goal domain/ledger, ficha e componente de progresso. Interface: alvo/ledger/marcos → etapa derivada/evento visual idempotente.

- [ ] RED: retirada/alteração de alvo recalcula e reabrir não celebra repetidamente.
- [ ] Implementar configuração e progressão sem contagem por volume de cadastros.
- [ ] Integrar momento visual do kit, acessibilidade e Reduce Motion.
- [ ] Provar múltiplos marcos/concorrência e gates nativos F19; registrar aceite.

### F20 — Cenários de acumulação

Arquivos: novo domínio puro de acumulação e superfície de planejamento com gráficos existentes. Interface: patrimônio inicial, aporte, taxa/unidade, horizonte, inflação/retirada → cenário com premissas explícitas.

- [ ] RED: taxa zero e patrimônio inicial conferem com cálculo independente.
- [ ] Implementar fórmulas estáveis/faixas/centavos e casos negativos definidos.
- [ ] Integrar cenários/gráfico/ajuda sem alterar livro-caixa.
- [ ] Provar limites e gates nativos F20; registrar aceite.

### F21 — Ativação financeira

Arquivos: onboarding/first steps, formulário de conta/cartão F02 e progress state. Interface: passo efetivo + ids criados → retomada idempotente.

- [ ] RED: interrupção após salvar retoma sem nova entidade/receita artificial.
- [ ] Implementar passos puláveis e usuário com cadastros preexistentes.
- [ ] Integrar moldura/movimento/campos existentes.
- [ ] Provar retomada/workspace/saldo inicial e gates nativos F21; registrar aceite.

### F22 — Duplicar e favoritos

Arquivos: ações de detalhe/lista, launcher/common, domínio de template e armazenamento por workspace. Interface: projeção de campos de usuário → draft novo sem vínculos contábeis.

- [ ] RED: clone não copia ids/obrigação/quitação e novo salvar tem intenção própria.
- [ ] Implementar duplicação e template editável/arquivável com validação de origem.
- [ ] Integrar menus/seletor sem substituir salvar/criar outro.
- [ ] Provar dependências/duplo toque/duas cópias intencionais e gates nativos F22; registrar aceite.

## Verificação integrada final

- [ ] Confrontar os 22 aceites com a spec; todo recurso localiza-se no fluxo e tem comportamento real.
- [ ] Executar gates globais necessários, suíte SQL financeira e isolamento; verificar cliente anterior.
- [ ] Exercitar jornada início → pagamento → consulta → orçamento → meta/reserva → investimento → cenário → captura/duplicação em ambos os sistemas.
- [ ] Conferir paridade app/agente, docs de domínio/ajuda e matriz de evidência.
- [ ] Registrar resultado local/staging e artefatos concretos; publicação de produção depende de pedido próprio.
