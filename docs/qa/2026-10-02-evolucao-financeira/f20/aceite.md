# F20 — aceite e limites

Estado: **aceito no staging** em 05/10/2026. Branch `gabriel/financas-22-melhorias`. Sem banco e
sem agente. [Contrato](contrato.md).

"Quanto vou acumular" (`/finance/acumulacao`), aberta pelo menu "…" do painel de Finanças e pela
seção Investimentos de Patrimônio. **Acumular**: patrimônio inicial, aporte por mês (no início ou
no fim), prazo, taxa hipotética (% ao ano, convertida para a mensal equivalente, ou % ao mês) e
inflação → valor no fim, em dinheiro de hoje, aportado e rendimento, com a curva. **Renda
desejada**: renda mensal e taxa de retirada → capital necessário e quando as premissas o atingem.
Até 3 cenários, com a tabela Comparar. As premissas ficam no aparelho, por usuário.

"Usar meus investimentos" lê `net_worth_now.investments_cents` — as posições do F13 pelo valor
atual mais os bens de investimento —, o mesmo número da seção Investimentos de Patrimônio
(R$ 26.500,00 no staging, igual nos dois aparelhos).

## Código

`src/lib/accumulation.ts` (puro, com teste: taxa zero, taxa negativa, inflação maior que o
retorno, mês 0, teto, 100 anos, 12,68% a.a. ↔ 1% a.m. e três exemplos calculados à parte). Nada
grava no livro-caixa, no orçamento, na projeção ou na saúde financeira.

Correções do QA: a frase "atinge não atinge em até 100 anos" (e "atinge já atingido") —
`quandoAtinge` devolve a frase inteira; os campos dentro de `Section` (uma lista de linhas) ficavam
sem recuo e com a primeira letra cortada no Android — viraram um grupo de campos comum; a fileira
"Comparar | Remover cenário" não quebrava na fonte grande; a tabela Comparar não dizia qual número
mostrava. Conferido no iPhone a `accessibility-large` (`evidence/ios/11a`, `11b`).
`npx tsc --noEmit`, `npx expo lint` e `npm test` (2331) com exit 0.

## Nativo

| Aparelho | Resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 (simulador) | 9/10 e o 10º depois da correção: entradas, R$ 1.268,25 (fim) e R$ 1.280,93 (início) a 1% a.m., R$ 1.254,40, taxa zero R$ 4.100,00, inflação > retorno com "Perde para a inflação.", capital R$ 1.500.000,00 e "43 anos e 4 meses" conferidos, investimentos, 3 cenários, taxa fora da faixa explicada sem NaN, reabrir igual, escuro + fonte grande + ocultar valores. [Resultado e capturas](evidence/ios/) |
| Android 16 `emulator-5574` | 9/9 nos mesmos valores; 26.500 + 100 × 60 a 1% no início = R$ 56.391,10 conferido à mão. [Resultado e capturas](evidence/android/) |

Nada foi gravado no banco; os cenários de teste ficaram só nos aparelhos.

## Limites

- **Anos acima de 100** não é recusado: o campo de quantidade assenta em 100 ao sair e calcula (a
  regra do kit para quantidade; o contrato dizia "explica e não calcula"). Prazo total acima de
  1200 meses e taxa fora da faixa seguem recusados com a frase.
- O aviso "Simulação com as taxas…" fica no fim da tela e rola com ela, não fixo: o design não
  ancora nada sobre o conteúdo que rola.
- Com "ocultar valores", os campos de entrada continuam mostrando o que foi digitado (como em todo
  formulário do app); resultado, tabela, botão de investimentos e a escala do gráfico se ocultam.
- Sem aviso de ordem de grandeza para valores enormes; o teto é R$ 1 bilhão.
- No Android, "Quanto vou acumular" fica abaixo da dobra no menu "…" de Finanças (precisa rolar).
- Não vistos no Android: retirada = 0, taxa negativa, inflação > retorno, 100 anos e teto (cobertos
  no iPhone ou nos testes).
- `QA-ANDROID-20261003-ANR` (F07) segue aberta. Sem produção, push ou tag.
