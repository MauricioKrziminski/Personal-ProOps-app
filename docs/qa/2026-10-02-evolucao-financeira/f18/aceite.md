# F18 — aceite e limites

Estado: **aceito no staging** em 05/10/2026. Branch `gabriel/financas-22-melhorias`, staging
`utkqoiigimqzeenxkxdl`, agente de staging `agente-staging-00211`. [Contrato](contrato.md).

**Encerrar uma série** (o pedido de 03/10: cancelar uma assinatura mantendo os meses pagos): em
Recorrentes, "Encerrar" mostra antes o que fica e o que sai ("Ficam 1 paga e 0 atrasadas. Saem 1
cobrança futura (R$ 39,90). A série vai para Encerradas."), e encerrar tira só as cobranças
futuras em aberto. A cobrança numa fatura paga, adiada ou paga em parte fica e é contada. A série
vai para Encerradas e volta por "Reabrir". O "Termina em" do editor tem como piso o início
original, não o próximo vencimento: encerrar hoje uma assinatura que vence no mês que vem é
possível.

**Transferência recorrente entre contas próprias:** Recorrente → Tipo Transferência, "Da conta" e
logo depois "Para a conta", sem categoria. O agendador e a ocorrência prevista tocada gravam uma
`transfer` normal; a projeção mostra as duas pontas, e receita e despesa não mudam.

## Banco e agente

- `20261005160000_recurring_transfers_and_end.sql` (escrita como `20261005120000`, renomeada na
  integração porque a do F17 já estava no staging): `recurring_transactions.counterparty_account_id`
  com checks e gatilho de escopo (contas diferentes, mesmo espaço, destino nunca cartão, nenhuma
  arquivada); `end_recurring_series` e a prévia sobre a mesma regra privada
  (`private.series_end_scope`), com recibo selado e trava; o fim editado no formulário passa pela
  MESMA regra.
- A revisão antes do push achou um defeito alto e três médios, todos corrigidos:
  - reabrir uma série encerrada recriava como PAGAS as cobranças do intervalo; agora o próximo
    vencimento vai para a próxima ocorrência futura;
  - o piso do início lia o `dtstart`, que a edição de calendário reescreve;
  - encerrar não travava as linhas nem reconferia o status antes de apagar;
  - o fim editado apagava cobrança de fatura paga em parte.
- Suíte SQL inteira depois do push: 109/111 (as duas de fora são as de banco vazio e data fixa).
  pytest do agendador (1258) e ruff verdes; agente deployado no staging.

## Código

`npx tsc --noEmit`, `npx expo lint` e `npm test` (2306) com exit 0.

## Nativo

| Aparelho | Resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 (simulador) | 6/6: assinatura com a de setembro paga e a de novembro em aberto, Encerrar com a prévia certa (a futura sai, a paga fica, nada novo), Reabrir sem recriar passado como pago, "Termina em" com piso no início e aviso antes do próximo vencimento, transferência (ordem dos campos, mesma conta recusada), escuro + fonte grande + ocultar valores + Reduzir movimento. [Resultado e capturas](evidence/ios/) |
| Android 16 `emulator-5574` | 5/5, os mesmos casos; saldo de hoje e em 90 dias iguais antes e depois da transferência. [Resultado e capturas](evidence/android/) |

Oráculo: as quatro séries "QA F18 …" e suas três cobranças apagadas por ID, nenhuma série
existente alterada; lançamentos, séries e caixa iguais à linha de base.

## Limites

- Na Projeção, o "entra/sai" do período soma a transferência dos dois lados (bruto), como já
  fazia com a transferência avulsa prevista; o saldo não muda.
- No iPhone, depois de encerrar, a lista de Lançamentos ainda mostrou a prevista de outubro da
  série até o app ser reaberto, embora a chave seja invalidada no sucesso; no Android não
  aconteceu. A folha levou ~15 s para fechar (o staging estava lento).
- Mesma conta na transferência: no seletor de destino a origem nem aparece; a frase de recusa
  aparece quando a origem é trocada para a conta do destino.
- A série encerrada oferece "Reabrir", não "Editar"; reabrir pelo "Termina em" foi coberto no SQL.
- Do revisor, documentados: trocar o destino reescreve só a versão aberta do histórico; apagar a
  conta usada numa série de transferência falha (FK `set null` × check); transferência com origem
  no cartão além do horizonte gravado não aparece na projeção; no staging o agendador não roda.
- `QA-ANDROID-20261003-ANR` (F07) segue aberta. Sem produção, push ou tag; agente só no staging.
