# Guardar dinheiro (caixinha / investimento) — a fazer

Pedido do dono do produto em 13/09/2026. **Não construir antes de fechar a diferença entre a
planilha e o app.**

## O pedido, na palavra dele

> *"Eu ainda queria uma feature que se eu quisesse investir esse dinheiro que está no saldo em
> algo (caixinha Nubank, investir, guardei em algum outro lugar do banco) e funcionar exatamente
> como se fosse no banco essa questão de guardar, pagar, saldo, fatura, financiamento, etc, no
> sentido de que se sobrou um valor de saldo, ele não vai abater na sua dívida até que de fato
> você vá lá e pague o que está devendo usando saldo."*

## A regra que ele está descrevendo, e ela é maior que a feature

⚠️ **Saldo em conta NÃO abate dívida sozinho.** Hoje a tela Hoje e a Projeção fazem
`caixa − fatura em aberto` e mostram um número só (`TENHO HOJE −R$ 370,92`, com 0,72 na conta e
371,64 de fatura vencida). Para ele isso está errado:

> *"Não é porque meu saldo na conta é 0,72 que fechei o ciclo com −370,92. Se eu não paguei nada
> com esse saldo, o saldo na conta permanece exatamente na conta e o que faltou pagar continua
> faltando pagar. Somente conta se eu tivesse dinheiro sobrando positivo na conta, aí junta o
> dinheiro como se eu tivesse guardado para o próximo mês."*

Então um ciclo fechado tem **dois** números, não um:

| | |
|---|---|
| sobrou na conta | 0,72 |
| ficou faltando pagar | 371,64 |

Compensar os dois só é legítimo quando sobra positivo — aí a sobra vira o dinheiro que entra no
ciclo seguinte.

## O que a feature em si precisa

- Conta do tipo "guardado" (caixinha, RDB, investimento) que **sai do caixa disponível** mas
  continua no patrimônio.
- Mover dinheiro para lá e de volta é **transferência**, nunca despesa — igual ao que já vale
  para aporte em meta (`goal_deposit`).
- Dinheiro guardado **não** entra na projeção de caixa como disponível, e **não** abate fatura
  nem dívida até um pagamento explícito.
- O extrato do Nubank já mostra esses movimentos como `Aplicação RDB` / resgate — eles existem no
  dado real e hoje entram como despesa/receita comum.

## Por onde começar

`accounts.type` já tem `investment`, e `private.cash_total` já exclui `credit_card` mas **inclui**
`investment` — é a primeira linha a mexer. Ver `assets`/`asset_valuations` para o que já existe
de patrimônio.
