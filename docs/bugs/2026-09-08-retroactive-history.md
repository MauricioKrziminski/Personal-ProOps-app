# Histórico de parcelas: diagnóstico e decisão

## Causas comprovadas antes da alteração

- `create_installment_plan` deriva `cleared` de `occurred_at <= current_date`, sem perguntar se houve pagamento.
- `_promote_due_transactions` repete isso para toda compra parcelada. Uma escolha pendente seria sobrescrita pelo cron.
- Formulário de compra não recebe quantidade já paga; formulário de dívida guarda contador interno 0, sem entrada de histórico para novas dívidas.
- Parcela e fatura são entidades diferentes: pagar oito parcelas de uma compra não autoriza quitar outras compras das mesmas faturas.

## Referências e decisão

[Actual](https://actualbudget.org/docs/schedules/) oferece aprovação manual/automática e vinculação a transações do histórico. [YNAB](https://support.ynab.com/en_us/how-to-fix-the-starting-balance-error-in-loan-accounts-Hyx_2xd0c) exige saldo devedor correspondente à data inicial para evitar cálculo incorreto. [Organizze API](https://github.com/organizze/api-doc) distingue atualização atual, futura e de todas as ocorrências. Não foi encontrada evidência de uma correção de bug específica idêntica à foto nesses produtos; essas são referências de comportamento, não uma alegação sobre incidentes deles.

Decisão de produto: perguntar quantas parcelas iniciais já foram pagas, inclusive aceitar zero. Data passada não implica pagamento. Mostrar 1..8 pagas e 9..48 pendentes no caso explícito de oito pagas; não quitar o plano completo. Parcelas vencidas não pagas continuam pendentes. Na dívida já existente, cadastrar saldo devedor atual + contagem histórica não insere saídas artificiais nem abate novamente esse saldo. Pagamentos novos usam o ledger normal.

## Implementação

RPC com quantidade paga explícita, preservando a regra única de datas/ciclo no banco. Entrada antiga sem histórico rejeita data retroativa com orientação, em vez de inferir pagamento. Cron só promove recorrências com auto-confirmação explícita. Formulários mostram campo de histórico e resumo antes de salvar. Nenhum dado existente será retroativamente reclassificado pela migração.

## Validação

Comprovado: teste PostgreSQL isolado falhou no código anterior (histórico retroativo aceito sem pergunta), passou no novo. Casos 0/8/48 pagas, conservação dos centavos, limites inválidos, conta arquivada e cron preservando pendências passaram. A recorrência com auto-confirmação explícita continua sendo promovida quando vencida; recorrências manuais e futuras permanecem pendentes. Helpers de formulário tiveram duas falhas reproduzidas e quatro testes passaram após correção.

Migração `20260908153143_explicit_installment_history.sql` aplicada somente no staging `utkqoiigimqzeenxkxdl`, após guard e dry-run mostrando um arquivo. Tipos regenerados de public+graphql_public. Script `agent/scripts/verify_staging_installment_history.py` executou a RPC real com `SET LOCAL ROLE authenticated`: 0/8/48 pagas, soma exata, ciclos/faturas por trigger, nenhuma fatura inteira quitada e conta de outro workspace recusada. Todas as fixtures voltaram a zero por rollback obrigatório. Cron global não executado remotamente; sua semântica foi verificada em PostgreSQL isolado.

Integração final: 279 testes do app e 531 do backend passaram, com TypeScript e lint limpos. A evidência de gesto/formulário e suas limitações estão em `2026-09-08-refresh-device-validation.md`. Produção não alterada nesta rodada.

### Pagamentos fora de ordem

A tela de parceladas calculava a próxima parcela como quantidade paga + 1. Isso só funciona para pagamentos consecutivos. Agora usa o menor número ainda pendente; regressão cobre oito iniciais pagas, terceira paga isoladamente e plano quitado.
