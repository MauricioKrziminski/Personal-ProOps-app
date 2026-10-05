# F20 acumulação e renda futura — QA nativo iOS

iPhone 17 Pro (simulador, iOS 26.5), app `com.proops.personal.dev`, conta `dev@proops.local`, Metro 8081. Bundle novo provado: o menu "…" de Finanças tem "Quanto vou acumular" e Patrimônio tem a linha homônima. Nada foi gravado no banco. Valores lidos pela árvore de acessibilidade (idb), conferidos com cálculo independente em Python.

| # | Caso | Resultado | Evidência |
|---|---|---|---|
| 1 | Abrir pelas duas entradas (menu "…" de Finanças; linha em Patrimônio) | PASSA | 01a-menu-financas, 01b-tela-via-financas, 01c-tela-via-patrimonio |
| 2a | R$ 0 + R$ 100/mês, 12 meses, 1% a.m., fim: R$ 1.268,25 (aportado 1.200,00 + rend. 68,25) | PASSA | 02a-acumular-fim |
| 2b | Mesmo, aporte no início: R$ 1.280,93 | PASSA | 02b-acumular-inicio |
| 3a | 12% a.a., R$ 1.000, aporte 0, 2 anos: R$ 1.254,40 | PASSA | 03a-12aa-1254 |
| 3b | Taxa zero, R$ 500 + 100 x 36: R$ 4.100,00 (rendimento 0,00) | PASSA | 03b-taxa-zero-4100 |
| 4 | Inflação 10% > retorno 5%: nominal 4.463,51, real 3.353,50 (confere), nota "Perde para a inflação." | PASSA | 04-inflacao-maior |
| 5a | Renda 5.000/mês, retirada 4%: capital R$ 1.500.000,00; sem retorno real: "não atinge em até 100 anos" | PASSA (com defeito de texto, D1) | 05a-renda-1500000-nao-atinge |
| 5b | Com 12% a.a., sem inflação, 500 + 100/mês: "43 anos e 4 meses" (confere: mês 520) | PASSA | 05b-renda-atinge-43a4m |
| 6 | "Usar meus investimentos (R$ 26.500,00)" = Investimentos de Patrimônio (R$ 26.500,00); campo preenchido com 26.500,00 | PASSA | 06a-usar-investimentos, 06b-patrimonio-investimentos |
| 7 | Comparar: 3 cenários (botão Comparar some no 3º), tabela compara, remover leva a 2 | PASSA (D4) | 07a-tres-cenarios, 07b-removido |
| 8a | Taxa 150% a.a.: "A taxa vai de −50% a +100% ao ano.", sem cartão de resultado | PASSA | 08a-taxa-150 |
| 8b | 100 anos + 11 meses: "O prazo vai de 1 mês a 100 anos.", sem resultado | PASSA | 08b-prazo-100a11m |
| 8c | Anos = 200: o campo assenta em 100 e calcula (R$ 92.687.484,24), sem NaN/Infinity | PASSA com ressalva (D3) | (valor lido na árvore) |
| 9 | Sair e voltar (pelo Patrimônio) e matar/relançar o app: 2 cenários, cenário 2 selecionado, premissas iguais | PASSA | 09-reaberto-apos-relaunch |
| 10 | Escuro + accessibility-large + ocultar valores: resultado, "Aportado/rendimento", tabela e "Usar meus investimentos" viram "Valor oculto"/•••••; gráfico sem escala; "Remover cenário" cortado na borda direita | FALHA (D2) | 10a-dark-acclarge-top, 10b-dark-acclarge-oculto-top, 10c-..., 10d-... |

## Defeitos

- **D1 (texto)**: modo Renda, quando não atinge, a frase sai "Com as premissas de Acumular, atinge não atinge em até 100 anos." `quandoAtinge()` já devolve "não atinge…" e a tela antepõe "atinge". Em `acumulacao.tsx` (linha da frase) e `quandoAtinge`.
- **D2 (layout, fonte grande)**: com accessibility-large a fileira "Comparar | Remover cenário" não quebra linha e o segundo botão sai cortado na borda direita (10c). O botão "Remover cenário" fica fora da tela.
- **D3 (contrato)**: o contrato diz que fora do domínio o campo explica e nada é calculado. Para Anos, o `QuantityField` (máx. 100) corrige 200 para 100 ao sair do campo e calcula. Prazo total > 1200 meses e taxa fora da faixa seguem o contrato (mensagem, sem cálculo). Decidir se o clamp é aceito.
- **D4 (UX menor)**: o rodapé "Simulação com as taxas…" não é fixo: rola com o conteúdo, ao fim da tela (contrato e pedido diziam rodapé fixo). Na tabela Comparar, o valor à direita (valor no fim / capital) não tem rótulo; no modo Acumular o subtítulo fala de "Capital necessário" e "atinge" (herdados do modo Renda) ao lado do valor final sem nome.
- Observação: ocultar valores esconde números, mas os campos de entrada (patrimônio inicial, aporte) mostram o que a pessoa digitou, e a curva continua visível (sem escala). Pelo contrato ("sem números nem escala") passa.

## Problemas do runner (não do app)

- `idb ui swipe` iniciado sobre um campo de texto o focava e abria o teclado; o teclado cobria os alvos e deslocava o scroll. Contornado com swipes em x=380/200 fora dos campos e tocando num rótulo para fechar o teclado.
- Digitar com `idb ui text` em campo de centavos precisa de backspace prévio (HID 42); um 1º teste caiu em campo errado por causa do teclado e foi refeito, sem efeito no resultado final.
- A árvore de acessibilidade lista elementos fora da tela com y > 874; o scroll foi confirmado pela mudança do y.
- Preferências de cenário ficaram salvas no aparelho (2 cenários) pelo `usePreferencia`; nada no banco.

## Configurações restauradas

Início: aparência do simulador `light`, tamanho de conteúdo `large`, tema do app "Claro", valores visíveis. Fim: os mesmos quatro valores confirmados.
