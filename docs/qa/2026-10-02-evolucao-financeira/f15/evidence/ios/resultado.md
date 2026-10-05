# F15 "Por que o gasto mudou" — QA nativo iOS (iPhone 17 Pro, staging, dev@proops.local)

Bundle novo comprovado: o bloco "Para onde foi" da raiz do Financeiro tem "Por que mudou?" e `/finance/why` abre. App usado: `com.proops.personal.dev` (o que está ligado ao Metro 8081).

| # | Caso | Resultado | Screenshot |
|---|------|-----------|------------|
| 1 | Abre de Finanças; atual x anterior, diferença total, contribuições por linha (ciclo 11/09-10/10 vs 11/08-10/09: R$ 11.214,46 x R$ 8.560,97, +R$ 2.653,49 / +31%) | PASSA | c1-why.png |
| 2 | Soma das contribuições = diferença do topo, no centavo, em todas as dimensões: Categoria (9 linhas = +2.653,49), Detalhe (Sem detalhe +2.653,49), Pagamento (-2.555,51 +5.209,00 = +2.653,49), Tipo fixo/variável (+2.649,23 +4,26), Essencial ou não (+2.648,86 +2,59 +2,04). Todas = +2.653,49 | PASSA | c2-Detalhe.png, c2-Pagamento.png, c2-Tipo.png, c2-Essencial.png |
| 3 | Toque na linha abre folha "Ver em <mês anterior> / <atual>" e depois Lançamentos filtrado (Gastos, categoria, período exato). Total da lista (soma dos subtotais por dia) = número da linha: Sem categoria out +R$ 6.210,50 (positiva, 3 dias: 5.217,16 + 93,34 + 900,00) OK; moradia set R$ 2.014,30 (negativa, 214,30 + 1.800,00) OK; contas out R$ 2.462,33 OK; Pagamento "Não informado" out R$ 6.005,46 OK; Mês: Sem categoria out 6.210,50 (inclui 30/10) e set 900,00 OK | PASSA | c3-sem-out.png, c3-moradia-set.png |
| 4 | Régua Mês <-> Ciclo (na raiz): Ciclo 11/09-10/10 = 11.214,46 x 8.560,97; Mês 01/10-31/10 = 8.438,12 x 10.125,64, diferença -1.687,52 / -17%, contribuições fecham no centavo; períodos de Lançamentos acompanham (01/10 a 31/10). Régua devolvida a Ciclo | PASSA | c4-why-mes2.png |
| 5a | Anterior sem dado (abril x março de 2026): R$ 900,00 x R$ 0,00, "+R$ 900,00 · sem gasto em março de 2026", sem percentual, sem divisão por zero | PASSA | c5-abril.png |
| 5b | Os dois períodos vazios (deep link fev x jan): "Nenhum gasto nos dois períodos", sem crash (ver defeito D2) | PASSA com ressalva | c5-ambos-zero.png |
| 6 | Escuro + accessibility-large + ocultar valores: sem corte, nenhum valor em reais exibido (topo, linhas e rótulos de acessibilidade viram "••••••" / "Valor oculto"); folha "Ver em ..." legível. Reduzir Movimento: ligado via `defaults` e app relançado, sem diferença observável (ver runner) | PASSA (Reduzir Movimento não verificável) | d2-why.png, d3-tipo.png, d4-sheet.png |

## Defeitos / observações

- D1 (baixo): com valores ocultos o topo mostra "Diferença •••••• · +31%". O percentual continua visível; dinheiro não. Decidir se isso é aceitável.
- D2 (baixo, texto): períodos vazios dizem "Sem diferença.  · sem gasto em janeiro de 2026" (espaço duplo, frase redundante com o card vazio).
- D3 (cosmético): no cabeçalho, quando o rótulo do período atual cabe em uma linha e o anterior quebra em duas (abril x março), os valores ficam em alturas diferentes (c5-abril.png).
- Quando o mês não tem gasto, o bloco "Para onde foi" (e a entrada "Por que mudou?") não aparece (fevereiro/março de 2026). Comportamento coerente; só abre com gasto.
- Um LogBox amarelo ("Open debugger to view warnings") apareceu durante a sessão (dev); não investigado, o aviso não aparece em release.

## Problemas do runner

- O `idb swipe` iniciado em y>790 cai na tab bar e não rola; o toast do LogBox também bloqueia gestos. Usei y inicial 700 e dispensei o toast.
- O app tem tema próprio (Perfil > Tema): `simctl ui appearance dark` não escurece enquanto o tema salvo for "Claro". Mudei para Escuro e devolvi a Claro.
- zsh não divide variável sem aspas (`${=d}`).
- `com.proops.personal` e `.dev` estão instalados; só o `.dev` estava no Metro.

## Estado restaurado

Valores iniciais: appearance light, content_size large, ReduceMotionEnabled 0, valores visíveis, tema do app Claro, régua da Financeiro em Ciclo. No fim: appearance light, large, ReduceMotion false, valores visíveis, tema Claro, régua Ciclo. Nenhum registro financeiro foi criado, editado ou apagado.
