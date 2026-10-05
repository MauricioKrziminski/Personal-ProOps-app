# F20 — acumulação e renda futura

Estado: contrato do incremento, antes do código. Sem banco: é cálculo de cenário, não grava nada
no livro-caixa, orçamento, projeção ou saúde financeira. Não declara implementação nem testes.

## Comportamento

Tela `/finance/acumulacao` ("Quanto vou acumular"), aberta pela seção Investimentos de
Patrimônio e pelo menu do painel de Finanças. Dois modos (`Segmented`):

1. **Acumular**: patrimônio inicial (sugestão: soma do valor atual das posições F13, editável) +
   aporte por mês + prazo (anos e meses) + taxa hipotética (% ao ano | % ao mês) + aporte no
   início ou no fim do mês + inflação opcional (% ao ano) → **valor no fim** (nominal e, com
   inflação, "em dinheiro de hoje"), total aportado e quanto veio de rendimento; gráfico da curva.
2. **Renda desejada**: renda mensal desejada (em dinheiro de hoje) + taxa de retirada hipotética
   (% ao ano, ex.: 4) → **capital necessário**; com as premissas do modo 1, quando ele é
   atingido (ou "não atinge em até 100 anos").

Até 3 cenários lado a lado (**Comparar**): cada um é uma cópia editável das premissas; a curva
mostra o selecionado e uma tabela compara valor no fim / capital necessário / quando atinge.
Rodapé fixo e curto: "Simulação com as taxas que você escolheu. Não é recomendação nem promessa
de retorno." Premissas ficam salvas no aparelho por usuário (`usePreferencia`): reabrir mostra o
mesmo cenário.

## Domínio — `src/lib/accumulation.ts` (puro, `node --test`)

- Taxa anual → mensal **equivalente**: `(1+a)^(1/12) − 1` (nunca a/12). Rótulo diz qual é qual.
- Valor futuro mensal: `VF = P·(1+i)^n + A·((1+i)^n − 1)/i · (1+i)^[início]`; **i = 0**: `P + A·n`
  (fórmula própria, sem divisão por zero). Real: deflacionar por `(1+inf_m)^n`.
- Curva: um ponto por mês (até 1200 meses), em centavos arredondados ao centavo só na SAÍDA
  (cálculo em float, resultado `Math.round`); o último ponto da curva = o valor fechado.
- Capital necessário = renda anual (12 × mensal) ÷ taxa de retirada. Quando atinge: primeiro mês
  em que o valor real ≥ capital (busca na curva).
- Domínio: prazo 1..1200 meses; taxa −50%..+100% ao ano (negativa admitida: perda); inflação
  0..50%; retirada 0,1..20%; valores 0..R$ 1 bilhão (teto contra overflow); aporte 0 permitido.
  Fora disso, o campo explica e o cálculo não roda (dinheiro digitado não é ajustado sozinho).
- Inflação maior que o retorno: valor real cai, a tela diz "perde para a inflação".

## UI

Campos do kit (`MoneyField`, `QuantityField`, `formatNumberBR` para %); gráfico com o
`MeasuredSparkline`/`ScrubChart` existente (sem animar valor fictício: a curva troca quando o
cálculo termina); ocultar valores oculta números e a escala; fonte grande; tablet com largura.

## Aceite (matriz)

Taxa zero; taxa negativa; inflação > retorno; capital inicial já suficiente (atinge no mês 0);
aporte zero; 1 centavo; 100 anos; conversão anual/mensal (12,68% a.a. ↔ 1% a.m.); valores no
teto; aporte no início × fim. Conferência contra cálculo independente (3 exemplos calculados à
parte, escritos no teste com a conta). Reabrir mostra o mesmo cenário. Nativo nos dois sistemas,
claro/escuro, fonte grande, ocultar valores, Reduzir movimento.
