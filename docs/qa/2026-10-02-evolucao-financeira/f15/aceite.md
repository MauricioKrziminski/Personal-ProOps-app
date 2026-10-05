# F15 — aceite e limites

Estado: **aceito no staging** em 05/10/2026. Branch `gabriel/financas-22-melhorias`, staging
`utkqoiigimqzeenxkxdl`. [Contrato](contrato.md).

No bloco "Para onde foi" das Finanças, **Por que mudou?** (`/finance/why`) compara o gasto do
período com o anterior, na régua escolhida (Mês ou Ciclo), e mostra quanto cada linha contribuiu
para a diferença, por Categoria, Detalhe, Pagamento ou Tipo (fixo/variável, essencial ou não).
Tocar numa linha pergunta o período e abre Lançamentos filtrado exatamente naquele conjunto.

## Banco

- `20261005112000_spending_change.sql` — `public.spending_change(p_cur_from, p_cur_to,
  p_prev_from, p_prev_to, p_dimension)`, invoker sob RLS. Escrita como `20261004180000` e
  renomeada na integração: o staging já tinha a `20261005110000`, e o CLI recusa migration
  anterior à última aplicada. Só cria função nova; nada substituído.
- `spending_change` e `anon_sem_execute` passaram depois do push; tipos regenerados do staging.

## Código

Correções do QA: com os valores ocultos o percentual da diferença some junto com o dinheiro (ele
entrega o tamanho da mudança); com os dois períodos vazios a linha diz só "Sem diferença." (saía
"Sem diferença.  · sem gasto em janeiro"). `npx tsc --noEmit`, `npx expo lint` e `npm test` com
exit 0.

## Nativo

| Aparelho | Resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 (simulador) | 6/6: abrir, cinco dimensões fechando a diferença no centavo, tocar abre o conjunto certo (Sem categoria, moradia, contas, "Não informado"), Mês ↔ Ciclo, período sem gasto e os dois vazios, escuro + fonte grande + ocultar valores. [Resultado e capturas](evidence/ios/) |
| Android 16 `emulator-5574` | 5/5: as mesmas contas (+R$ 2.653,49 no ciclo, −R$ 1.687,52 no mês) e os totais das listas batendo com as linhas. [Resultado e capturas](evidence/android/) |

Só leitura: nenhum registro foi criado ou mudado nos dois aparelhos.

## Limites

- O percentual e "Sem diferença." foram corrigidos depois dos dois aparelhos; não houve nova rodada
  nativa (a regra é a mesma do F13 para o sinal e o percentual).
- Lançamentos filtrado pelo link não tem card de total (a régua "com filtro o card some"); a
  conferência foi pela soma dos subtotais do dia.
- Com fonte 1,3 no Android, o rótulo "Pagamento" do seletor encolhe um pouco mais que os vizinhos.
- Quando um só dos rótulos do topo quebra em duas linhas, os dois valores ficam em alturas
  diferentes.
- Mês sem gasto não mostra o bloco "Para onde foi", então a entrada também não aparece.
- Reduzir movimento no iOS foi ligado por `defaults` e não deu para conferir o efeito.
- `QA-ANDROID-20261003-ANR` (F07) segue aberta. Sem produção, push, tag ou deploy do agente.
