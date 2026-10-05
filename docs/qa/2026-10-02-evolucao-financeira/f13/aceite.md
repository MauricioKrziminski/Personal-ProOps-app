# F13 — aceite e limites

Estado: **aceito no staging** em 05/10/2026. Branch `gabriel/financas-22-melhorias`, staging
`utkqoiigimqzeenxkxdl`. [Contrato](contrato.md).

A posição de investimento mostra **Valor atual**, **Aplicado**, **Resultado** (com a qualidade em
palavras: conhecido, estimado ou "Atualize o valor para ver o resultado", nunca R$ 0,00),
**Recebido** e "atualizado em DD/MM". Na folha da posição: Atualizar valor, Rendimento recebido e
Informar aplicado. Em Patrimônio, as contas de investimento entram em Investimentos pelo valor
atual; caixa, projeção e reserva não mudam. Bens: marcação retroativa não muda o valor atual e a
marcação pode ser apagada (menos a única).

## Banco

- `20261004160000_investment_valuations.sql` — tabela `investment_valuations`, comando
  `investment_value_command` (recibo selado, revisão, P0001 nas recusas), números da posição numa
  função só (`private.investment_position_numbers`, lida pela tela e pelo patrimônio),
  `net_worth_now`, `update_asset_value` (marcação mais recente; data futura vira hoje) e
  `delete_asset_valuation`.
- `20261004163000_investment_same_day_movements.sql` — **defeito achado no Android**: atualizar o
  valor para R$ 850 e resgatar R$ 810 no MESMO dia deixava o valor em R$ 850 e o resultado em
  +347%, porque só entrava o movimento com data DEPOIS da atualização. Agora o empate do mesmo dia
  é decidido pela ordem de registro (`recorded_at` da atualização, que anda junto com a edição,
  contra o `created_at` do movimento); vale também para o aplicado informado. Teste com o caso do
  QA (850 → resgate 810 → valor 40, resultado −150) e com a edição (informar de novo inclui o que
  já estava registrado). Conferido no SQL; o nativo não foi rodado de novo depois dessa correção.
- Testes SQL depois do push: `investment_valuations`, `investment_movements` e `anon_sem_execute`
  passaram. Tipos regenerados do staging.

## Código

Correções do QA iOS: o valor de Investimentos no Patrimônio e na seção não encolhe mais
(`encolhe={false}`); ocultar valores esconde também o sinal e o percentual do resultado; o texto
da qualidade "conhecido" virou "Calculado com tudo que foi aplicado e resgatado". `npx tsc
--noEmit`, `npx expo lint` e `npm test` com exit 0. Paridade em `docs/AGENTE-PARIDADE-COM-O-APP.md`.

## Nativo

| Aparelho | Resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 (simulador) | 11/11, com três defeitos corrigidos depois (valor minúsculo, sinal/percentual sob privacidade, rótulo de qualidade). [Resultado e capturas](evidence/ios/) |
| Android 16 `emulator-5574` | 8/8: sem atualização, estimado, conhecido com resultado negativo, confirmação de substituir o aplicado, rendimento, resgate excessivo recusado e resgate total, privacidade/escuro/fonte 1,3/animações 0, limpeza. [Resultado e capturas](evidence/android/) |

Oráculo do banco depois dos dois aparelhos e da limpeza: Tesouro Selic R$ 26.500,00 só com a
marcação de 03/09/2026, Apartamento e Carro iguais, `cash_total` e `net_worth_now` idênticos à
linha de base (caixa R$ 39.249,15; líquido R$ 475.085,40). As contas "QA F13 iOS Corretora" e
"QA F13 Android Corretora" foram apagadas por ID, sem transação, movimento ou atualização ligada.

## Limites

- Atualização de valor com data ANTES do primeiro aporte conta o aporte como ganho (valor = última
  atualização + o que entrou depois). É a regra do contrato; a tela não avisa.
- Com resultado indisponível, "Aplicado" mostra a abertura informada ao lado do valor atual = saldo
  no app; coerente com o contrato, pode confundir.
- As abas Valor/Rendimento/Aplicado da folha (`Segmented`) não crescem com a fonte grande.
- O encolhimento do `Row` com coluna de valor fixa no iOS (primitivo, anterior ao F12) segue sem
  correção geral; os valores do F13 saíram dele por `encolhe={false}`.
- Emulador Android lento (30–60 s por tela) e um ANR do runner durante "Informar aplicado",
  recuperado com reinício; a ação funcionou na repetição. `QA-ANDROID-20261003-ANR` (F07) segue
  aberta. Simulador/emulador não são aparelho físico. Sem produção, push, tag ou deploy do agente.
