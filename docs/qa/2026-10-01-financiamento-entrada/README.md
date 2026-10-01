# QA — entrada, edição e conversões — 01/10/2026

Baseline `6d9e93fd`; correção v1.6.3. QA financeiro somente em staging `utkqoiigimqzeenxkxdl`. Nenhum dado financeiro de QA foi escrito em produção.

Este relatório público contém resultados e procedimentos. Capturas, acessibilidade, inventários e snapshots financeiros foram preservados somente na máquina de QA, em `/private/tmp/proops-release-1.6.3/qa-evidence-private`. Eles não fazem parte do histórico publicado. [Causas e correções](../../bugs/2026-10-01-financiamento-entrada.md).

## Aceitação nativa iOS

iPhone 17 Pro, iOS 26.5, app dev SDK 57 com JS do checkout via Metro e staging. A amostragem abaixo não equivale a repetir manualmente cada combinação SQL.

| Fluxo | Resultado observado |
|---|---|
| Ativar entrada | Campos completos disponíveis imediatamente, sem erro/foco automático; quatro alternâncias, digitação logo após abrir e preservação ao fechar com teclado ativo. Movimento cosmético não libera layout/touch por callback. |
| Criar por total/parcela | Entrada separada; total desconta antes de dividir; modo por parcela soma ao custo. Caso mínimo 12×R$0,01 com entrada passou após correção. |
| Editar entrada | Valor, data e conta alterados; remoção e reinclusão depois de criado; saldo/quantidade da dívida preservados e identidade conferida no banco. |
| Conversões | Financiamento↔recorrente, parcelamento com entrada e plano 5x→1x. Futuro conserva fatos pagos; Todas requer confirmação. Troca de cobrança fixa↔juros conserva pagamento real e entrada. |
| Seletores/calendário | Reativam fechados com valores preservados; nova escolha de conta/data e fim de mês funcionam. Handlers antigos/duplicados e após desmontagem têm RED/GREEN. |
| Fatura protegida | Exclusão completa e conversão Todas recusadas pelo app quando a entrada pertence a fatura paga. Contrato, fatura e movimentos integralmente idênticos após ambas; nenhum destino criado. |
| Contas e orçamento | MoneyField conserva centavos, digitação/apagamento e fica acima do teclado. Seletor altera o tipo e fecha ao tocar a opção atual, sem salvar o rascunho. |
| Recorrência | Mensal→semanal→mensal, seleção de último dia e depois data fixa, sem salvar. |

O teste de limite do total exibe a razão de Salvar bloqueado sem marcar campo vazio recém-aberto. Redução do total e desaparecimento do erro após corrigir também têm cobertura automatizada. Reduced motion foi exercitado em teste, não alterado nas preferências do simulador. Vídeos são observação visual: não há perfil de CPU válido nem benchmark de latência/FPS.

## Regressões automatizadas e banco

- `npm test`: **1.441/1.441**, zero falhas/cancelados/ignorados; TypeScript/lint saída 0.
- Agente completo: **1.218/1.218**. Um teste antigo de paridade da descrição Pix foi atualizado para a declaração compartilhada vigente, sem mudar regra financeira.
- Componentes reais: **57 testes de movimento/seleção** e **299 de formulários**. [Movimento](../../../src/lib/form-motion-ui.test.ts), [formulários](../../../src/lib/simple-finance-ui.test.ts), [retries](../../../src/lib/refresh-consistency.test.ts), [helpers](../../../src/lib/finance-form.test.ts).
- React Doctor 83/100: zero erros; mesmos três avisos de complexidade existentes, sem diagnóstico novo/supressão.
- [Conversões com entrada](../../../supabase/tests/converter_entrada.sql): **153 combinações**, histórico 0/1/2, futuro/todas/manter e destinos. Guarda de fatura, RLS, atomicidade, entrada avulsa e identidade também conferidos.
- [Troca de cobrança](../../../supabase/tests/debt_contract_mode_switch.sql): **36 trocas future**, declarações/pagamentos reais e ida/volta; história integral preservada.
- [Retry](../../../supabase/tests/converter_request_idempotency.sql): 14 casos sequenciais; mesmos IDs após resposta perdida/origem apagada; payload/usuário/workspace/operação diferentes recusados.
- [Proteção da fatura](../../../supabase/tests/debt_entry_delete_invoice_guard.sql): seis recusas paga/adiada/parcial×delete/converter Todas e quatro casos permitidos em fatura aberta/fechada; RLS/história/retry.
- [Concorrência](../../../supabase/tests/debt_entry_invoice_concurrency.py): **14/14**, duas sessões autenticadas, bloqueios observados, ambas ordens de exclusão/conversão×pagar/adiar, baixa histórica e retry concorrente. Cópias de RPC vivem em `pg_temp`; corpos das sete RPCs aplicadas são exatamente iguais aos candidatos, todos invoker.
- Onze suítes SQL compartilhadas novamente aprovadas: entrada, conversão genérica/parcelada/recorrente, reparcelamento, alcances/ocorrências atômicos, financiamento maleável, contrato scoped, pagamento parcial e adiamento. Testes `.sql` usam rollback obrigatório.

## Limpeza, ambientes e limites

Fixtures próprias da UI e do runner concorrente removidas. Conexão nova confirmou ausência dos registros/pedidos e igualdade integral dos dados financeiros anteriores; o relatório público não contém esses dados. O runner concorrente usa commits apenas nas fixtures isoladas para permitir uma segunda conexão e faz limpeza no finally.

Sete migrations testadas primeiro em staging e posteriormente promovidas à produção após autorização e dry-run exato. [Distribuição e números das migrations](../../releases/2026-10-01-v1.6.3.md).

Android não chegou ao formulário devido a ANRs de ProOps/system; a sessão de outro projeto foi preservada e os processos de QA próprios foram encerrados. Não se afirma aceitação Android. Compilação/instalação/execução no iPhone físico são registradas separadamente na release. Não se afirma ausência absoluta de regressões fora dos cenários verificados.
