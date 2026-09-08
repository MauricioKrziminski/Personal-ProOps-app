# Fluxos financeiros: investigação dos pontos 3, 6 e 7

Data: 08/09/2026. Estado: diagnóstico documentado antes da implementação. Inspeção de código local; não comprova comportamento do backend publicado nem de aparelho.

## 3. Edição completa de lançamentos

### Causa comprovada

- `src/app/finance/transaction-form.tsx` já carrega o lançamento por ID e permite editar valor, conta, data, categoria, descrição, estabelecimento, tipo e situação. Não existe bloqueio por origem WhatsApp/agente. O gate impede criar duplicata enquanto a consulta de edição está carregando ou falhou.
- `src/hooks/use-finance.ts:useSaveTransaction` considera sucesso qualquer UPDATE sem erro, sem conferir que uma linha voltou. RLS/ID removido podem produzir zero linhas alteradas e fechamento incorreto do modal.
- `agent/app/tools/finance.py:update_transaction` só monta correções de valor, categoria e data. O schema/prompt não distinguem conta corrigida da conta usada na busca. Editar conta por conversa é lacuna real, diferente do formulário do app.
- A migração `0013_cards_and_installments.sql:tg_transactions_set_invoice` recalcula `invoice_id` quando conta/data mudam, mas só preenche vencimento quando `due_at` está nulo. Mover compra de ciclo/cartão pelo agente preserva vencimento antigo. Sair do cartão limpa `invoice_id`, mas preserva o vencimento herdado. O formulário mascara parte do problema ao enviar `due_at: null` em cartão.

### Correção proposta

Exigir retorno de exatamente uma linha no UPDATE do app. Preservar dados digitados no erro. Ampliar schema, resolução contextual e executor do agente em coordenação com a investigação de agente. Corrigir o trigger compartilhado para manter fatura/vencimento juntos ao trocar data/conta, distinguindo vencimento herdado de vencimento explicitamente informado ao sair do cartão.

Não tratar edição de parcela como edição do plano inteiro. Pagamento de dívida e pagamento de fatura têm efeitos adicionais: mudar um lançamento isolado não recalcula automaticamente saldo amortizado ou a transferência que quitou uma fatura. Documentar e testar essas invariantes antes de prometer edição indiscriminada de tais operações.

### Validação prevista

1. Editar transação oriunda de WhatsApp no app, trocar valor/conta e reler a mesma linha; contagem de registros permanece igual.
2. ID removido/invisível retorna erro, nunca sucesso; formulário permanece aberto.
3. Trocar data cruzando fechamento e trocar cartão A por B: `invoice_id`, `due_at` e totais derivados correspondem ao novo cartão/ciclo.
4. Cartão para banco/sem conta: remove vínculo e vencimento herdado, preservando vencimento explicitamente fornecido para uma despesa pendente.
5. Correção conversacional ambígua exige seleção de conta existente e confirmação do alvo correto; conta de outro workspace não pode ser vinculada.

## 6. Financiamento de carro

### Causa comprovada

- `0023_debts.sql` já oferece dívida com `kind='financing'`, principal/saldo, taxa mensal, prazo, parcelas pagas, valor da parcela, dia de vencimento e `account_id` pagadora. `pay_debt_installment` cria despesa vinculada à dívida e reduz principal líquido de juros.
- A tela `finance/debts.tsx` existe, mas só é alcançável em Gerenciar > Dívidas. O FAB Lançar abre exclusivamente `transaction-form`. Isso induz cadastro pelo parcelamento de compra em vez de financiamento.
- Hook/tela de dívida omitem `account_id`, `installment_cents` e `installments_paid` na edição. A tela chama o campo de prazo de “Parcelas que faltam”, mas grava em `installments`; o cronograma SQL subtrai `installments_paid` novamente. Uma dívida com pagamentos já registrados perde prazo ao ser editada.
- O cronograma SQL ancora datas em `current_date + N meses`, não em vencimentos contratuais; não é agenda contratual persistida. Cadastro de dívida não materializa por si só prestações pendentes na projeção de caixa.

### Decisão de modelo proposta

Financiamento deve ser um passivo em **Dívidas e financiamentos**, vinculado à conta usada para pagar. Conta bancária continua representando dinheiro disponível; cartão continua representando compras/faturas. Reusar `debts` e sua RPC de pagamento, sem criar um cartão fictício nem duplicar a dívida em plano de compra.

Expor entrada própria no Lançar e formulário. Permitir conta pagadora não cartão e valor contratual da prestação usando campos existentes. Corrigir a semântica de parcelas restantes versus total/pagas. Informar o escopo de projeção e estimativa Price sem afirmar reprodução de contrato SAC, taxas e seguros não cadastrados. Agente deve reconhecer financiamento como dívida, não obrigar cartão.

### Validação prevista

1. Lançar > Financiamento abre cadastro com tipo financing, sem solicitar cartão.
2. Salvar principal, saldo, taxa, parcelas restantes e conta pagadora; reler mesmos dados.
3. Dívida com 4 parcelas pagas e 8 restantes continua com 8 linhas estimadas após editar (total 12), sem segunda subtração.
4. Pagar prestação reduz conta pagadora uma vez, cria uma despesa com debt_id, reduz saldo conforme juros e incrementa parcelas pagas uma vez.
5. Conta de outro workspace/cartão rejeitada pelo banco; contas acessíveis ao workspace funcionam. Concorrência de pagamento deve ser serializada antes de ampliar este fluxo.
6. Não confundir cronograma estimado com prestações pendentes que ainda não existem na projeção.

## 7. Despesa/receita recorrente no Lançar

### Causa comprovada

`finance/recurring.tsx` já cria receitas/despesas com presets mensal/semanal/anual, conta, início/fim e confirmação automática. Gerenciar > Recorrentes é a única descoberta direta. O formulário de lançamento só oferece evento simples, parcelamento e pendência; não permite escolher repetição.

### Correção proposta

Adicionar opção explícita Recorrente no Lançar e acesso no formulário de criação, reaproveitando a tela/form existente. Abrir diretamente o cadastro via parâmetro de rota com tipo/valor/descrição/conta/data preenchidos, sem criar transação avulsa antes da série. Não oferecer converter edição existente em recorrência sem definir o destino da ocorrência atual.

RRULE, `dtstart`, materialização de 90 dias e unicidade `(recurring_id, occurred_at)` continuam centrais; não duplicar gerador no cliente. Criação precisa explicar que os lançamentos aparecem após o processamento, quando aplicável.

### Validação prevista

1. Lançar > Recorrente abre criação diretamente; tipo Receita também disponível.
2. Formulário preenchido > Repetir preserva tipo/valor/conta/data/descrição e não cria avulso.
3. Criar série, executar scheduler isolado duas vezes e verificar ausência de duplicatas.
4. Cancelar não insere série/transação. Data final anterior ao início e intervalo inválido não podem ser salvos.
5. iOS/Android: opções acessíveis, rolagem/teclado e retorno do sheet; registrar separadamente prova real de aparelho e checks estáticos.

## Referências e limites

Documentação Expo SDK 57 consultada antes de qualquer implementação: https://docs.expo.dev/versions/v57.0.0/. Atualização Supabase e retorno de linhas: https://supabase.com/docs/reference/javascript/update. Skill Supabase lida; nenhuma migração aplicada ou ambiente remoto alterado nesta investigação.

## Implementação e evidências em 08/09/2026

- Lançar agora apresenta gasto/receita, recorrência e financiamento. Formulário avulso encaminha para recorrência preservando valores e substituindo a rota, sem inserir avulso. Financiamento abre tipo correto; conta pagadora e prestação são campos do modelo existente. Parcelas restantes são convertidas para total somando as já pagas. Taxa ausente não é inventada para financiamento.
- UPDATE de transação e dívida exige retorno de uma linha. Erros de domínio SQL permanecem visíveis sem fechar o formulário.
- `0057_finance_edit_and_debt_accounts.sql` realinha vencimento/fatura, valida workspace da conta e conta pagadora não cartão. Pagamento de dívida é serializado com bloqueio da linha da dívida.
- Cada pagamento novo passa a registrar ordem, juros, principal e saldo após pagamento. O trigger de transações deriva o histórico (ignora alterações desses campos enviadas pelo cliente). Corrigir valor do último pagamento com histórico atualiza o saldo atomicamente; apagar o último restaura o principal e a contagem. Conta e data podem ser corrigidas mantendo a ordem da amortização.
- **Limite explícito:** pagamentos anteriores à migração não possuem alocação histórica. Valor/exclusão são rejeitados com motivo; conta e data continuam editáveis, respeitada a cronologia. Pagamentos com pagamentos posteriores também não aceitam correção econômica direta. A tela aponta Dívidas e financiamentos para conciliação. Isso não constitui edição econômica completa de todo o legado.
- Não há migração retroativa inventando taxa/principal históricos. O cronograma permanece estimativa Price, sem agenda contratual/SAC/tarifas nem materialização automática de prestações na projeção.

### Checks executados

1. `node --test src/lib/finance-form.test.ts`: 2 testes passaram; parcelas restantes e intervalo/data final de recorrência. Antes da implementação o módulo inexistente produziu falha esperada de carregamento.
2. `npx tsc --noEmit`: passou.
3. ESLint nos arquivos financeiros alterados: passou.
4. PostgreSQL embarcado PGlite 0.3.14, instalado somente em `/private/tmp/proops-finance-sql-20260908`: `supabase/tests/finance_invariants.mjs`. Execução `--before` com trigger original falhou exatamente no vencimento antigo após alterar a data (20/09 versus 20/10). Nova migração passou: troca de ciclo/cartão, limpeza de vencimento herdado, preservação de vencimento explícito, isolamento por workspace, conta pagadora, limites de pagamento, amortização, correção/exclusão do último, bloqueio de alteração de histórico pelo cliente e bloqueio financeiro do legado.
5. Emulador Android `emulator-5554`, app **dev** `com.proops.personal.dev`, Metro 8081, 384 dp/font 1.3: menu Lançar com as três ações acessíveis; formulário real abre Financiamento selecionado, permite rolar até prestação/conta/parcelas; recorrência abriu Receita selecionada, R$ 1.234,00 e descrição de fixture preservados. Capturas em `/private/tmp/finance-menu.png`, `/private/tmp/finance-debt.png`, `/private/tmp/finance-debt-bottom.png`, `/private/tmp/finance-recurring.png`. Prévia temporária restaurada com diff vazio. Nenhum botão Salvar/Criar acionado.

### Não comprovado por estes checks

PGlite exercitou PostgreSQL real com tabelas dependentes mínimas, não o schema Supabase inteiro com RLS/Realtime/cron. Não foi aplicado schema em staging/produção. Não foram exercidos criação remota autenticada, scheduler de recorrência, sessão nativa completa ou WhatsApp fim a fim nesta subinvestigação. UI foi montagem dos componentes reais em prévia pública com cache fictício, distinta de persistência remota. Concorrência é protegida por `FOR UPDATE`, mas não houve teste com duas conexões simultâneas no PGlite.

## Correção conversacional de conta: complemento

A lacuna do agente foi corrigida com `FinanceAction.new_account`, separado do campo de conta corrente/busca. Resolução única e ativa por workspace é congelada no alvo antes da confirmação; inexistência/ambiguidade interrompe com esclarecimento e não pede SIM enganoso. Resumo mostra conta e valor novos. Executor não resolve novamente o nome após SIM: UPDATE usa ID congelado e verifica conta ativa/no workspace no mesmo comando, com RETURNING; nenhuma linha alterada não vira sucesso. “Sem conta” remove explicitamente o vínculo. Alteração de conta do plano parcelado inteiro é recusada antes de confirmar; parcela individual permanece editável no app.

Validação: 9 novos testes cobriram campo distinto, confirmação, ID congelado, ambiguidade, destino indisponível, ausência de congelamento e grafo real com InMemorySaver antes/depois do SIM. Suíte focal de 51 testes passou incluindo schemas, policy, resolve, planos e consentimento de cartão. Probe real anterior à implementação, criado com `create_model`, aceitou 15 campos × 14 tipos; probe final `agent/scripts/probe_transaction_account_schema.py` com FinancePlan/FINANCE reais aceitou e devolveu `update_transaction`, `new_amount_cents=5400`, `new_account="conta Nubank"`, `account=null` no `gemini-3.7-flash`. Somente texto fictício foi enviado. O orçamento de schema de FinanceAction foi atualizado para o valor efetivamente medido 210; outros domínios conservam 198. Não houve UPDATE contra banco remoto.
