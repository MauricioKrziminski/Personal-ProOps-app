# Aplicar o adiantamento do "E se…?" — desenho (08/10/2026)

Pedido do dono do produto: *"Tudo que eu colocar ali na hipótese, eu devo conseguir aplicar"*, e
o adiantamento era a única hipótese sem "Aplicar". Decisões dele (08/10/2026):

- **Um lançamento só**: *"se eu coloquei que adiantei três parcelas em dezembro, tem que ter um
  lançamento único falando que adiantei 3 parcelas em dezembro… pode ser que tenha desconto, tem
  que mostrar isso também, tenho que colocar a data… como se eu tivesse marcado como pago"*.
- **Financiamento**: um pagamento só ("as últimas" encurta o prazo, "as próximas" conta N pagas).
- **Compra parcelada**: as parcelas que sobram **mantêm o número** (1/12 … 7/12 …), como na
  fatura do banco.

## O registro

`transactions.adiantamento jsonb` marca o lançamento do adiantamento e guarda o que ele cobriu
(para desenhar "10ª a 12ª" e para desfazer). `expected_amount_cents` = a soma das parcelas
cobertas: a diferença para o valor pago é o DESCONTO.

| origem | onde mora o lançamento | o que muda na origem |
|---|---|---|
| compra parcelada | DENTRO da compra (`installment_plan_id`, `installment_no` = a 1ª coberta); as outras cobertas saem | o total da compra cai o desconto; nada renumera |
| financiamento | avulso, categoria do pagamento da dívida | últimas: `installments −= N`; próximas: `installments_paid += N`; o saldo cai (fixa: N × parcela; com juros: o valor pago) |
| recorrente | avulso, categoria e conta da série | as ocorrências cobertas saem e ficam puladas (`recurring_moved_occurrences`) |

Status, como no "Paguei": conta e data até hoje → pago naquela data; data futura → em aberto
naquele dia; cartão → entra na fatura da data (recusa fatura fechada).

## Travas

- **O lançamento do adiantamento não muda por tabela** (`a_adiantamento_fica`, BEFORE UPDATE, roda
  antes do `set_invoice`): valor, data, conta, número, título e o próprio `adiantamento` ficam
  como estão em qualquer escrita em lote (propagar valor da série, reescrever "(i/N)", repartir o
  total). Só `edit_anticipation` (GUC `proops.editando_adiantamento`) os muda. Status e categoria
  seguem livres: a fatura que se quita leva junto.
- `update_installment_plan` trata o adiantamento como parcela TRAVADA que ocupa N números: não
  recria as cobertas, não reparte valor nele, conta todas no "já pago".
- `apagar_parcelas` renumera por PESO (o adiantamento ocupa N números) e, no "Só esta" sobre o
  adiantamento, DESFAZ em vez de apagar.
- `anticipation_candidates` não oferece o lançamento de adiantamento e passa a devolver a
  identidade de cada parcela (`id`, `on`) — o servidor confere a lista pedida contra ela.

## Desfazer

Apagar o lançamento devolve a origem: na compra, as parcelas voltam com o id, a data e o valor de
antes (pelo `apagar_parcelas` "Só esta"); na dívida e na série, por gatilho AFTER DELETE. Dívida:
só se nada mudou depois (o par contrato/saldo é o que o adiantamento deixou), senão recusa com o
caminho. Restauração nunca acontece quando a origem já não existe (cascata).

## App

"Aplicar" no adiantamento abre `/finance/aplicar-adiantamento?grupo=` (tela modal): as parcelas
cobertas (linha do tempo), Título, Valor pago (com "Desconto de R$ X"), Data, Conta ou cartão e o
que acontece ao salvar. Salvar grava (`apply_anticipation`, recibo por `p_request_id`) e tira o
grupo do rascunho. O lançamento aparece com "Adiantamento · 10ª a 12ª · desconto R$ X"; Editar
reabre a mesma tela (`edit_anticipation`).
