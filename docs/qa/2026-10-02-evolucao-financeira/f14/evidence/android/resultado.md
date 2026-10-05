# F14 Android (emulator-5574) — resultado

Bundle novo provado: Orçamentos tem "Mais opções" com "Planejar por percentual" (o primeiro carregamento ainda não tinha; foi preciso Reload).

| # | Caso | Resultado | Evidência |
|---|---|---|---|
| 1 | Editor vazio: renda-base primeiro, com foco | PASSA | 04-vazio.png, 03-menu.png |
| 2 | Base 10.000: casa 30% = R$ 3.000,00 e eletrônicos 15% = R$ 1.500,00 (servidor); 100,01% mostra "A soma dos percentuais é 100,01%: passa de 100%" e Salvar fica DISABLED (dump); 100% habilita | PASSA | 06-casa30-ok.png, 33-soma-10001.png, 37-soma-100.png |
| 3 | Mesma categoria em duas linhas: "A categoria casa aparece em mais de uma linha." e Salvar DISABLED | PASSA | 35-duplicada.png |
| 4 | Salvar e reabrir (fechando e abrindo o editor): renda, linhas e percentuais persistem; comparação planejado × realizado ("sem renda lançada neste período") | PASSA (toast "Plano salvo" NÃO capturado) | 41-salvo-comparacao.png, 45-reaberto.png |
| 5 | Aplicar ao limite padrão: prévia "casa: R$ 2.340,00 → R$ 3.000,00" e "eletrônicos: R$ 1.730,00 → R$ 1.500,00", com "Já tem limite de ... para todo mês"; depois a lista mostra casa 3.000 e eletrônicos 1.500 | PASSA | 48-preview-padrao.png, 51-lista-pos-aplicar.png |
| 6 | Só outubro: com plano casa 20%, prévia "casa: R$ 3.000,00 → R$ 2.000,00 — Vale o limite padrão de R$ 3.000,00; só em outubro passa a R$ 2.000,00." (não diz "sem limite"). Com valor planejado igual ao padrão (3.000 → 3.000) a prévia mostra só "→" sem frase (54) | PASSA | 58-so-mes-padrao-vigente.png, 54-so-mes-igual.png |
| 7 | Toque duplo em Aplicar (dois `input tap` na mesma shell): aplicou, folha fechou, lista com valores certos, sem erro | PASSA parcial: contagem de aplicações no banco NÃO verificada (a UI não lista aplicações) | 51-lista-pos-aplicar.png |
| 8 | Escuro + fonte 1,3 + animações 0 + valores ocultos: editor, comparação e prévia sem corte; só o campo Renda-base mostra dinheiro (10.000,00); "= •••••• por mês", "Distribuído 90% ... •••••• ", prévia e frase do padrão mascarados | PASSA (ver defeito menor 2) | 61, 63, 65, 67 |

## Defeitos / observações

1. Menor, sem captura: o toast "Plano salvo" não apareceu em screenshot (o LogBox do dev e a latência do emulador); persistência provada pela reabertura.
2. Menor, tema escuro (67-escuro-aplicar.png): os switches de categoria na folha "Aplicar" têm trilho quase invisível sobre o fundo escuro, só o botão claro aparece.
3. Campo Renda-base mostra o valor com valores ocultos (esperado/observado, sem máscara).
4. "= R$ x por mês" mostrou transitoriamente 300,00 antes de assentar em 3.000,00 (debounce do servidor; estado final correto).
5. Sem sugestão "Entrou R$ X em <mês>" visível: não havia renda lançada no período (a comparação diz "sem renda lançada").

## Problemas do runner

- Emulador lento: telas congelam por até ~1 min com o MoneyField focado; um primeiro conjunto de toques foi perdido. Back com teclado oculto FECHA o editor e perde o rascunho (refiz).
- Screenshot reduzido é 800 de altura: coordenadas = x3,74 para o original (errei uma vez).
- LogBox amarelo intercepta toques no rodapé até ser dispensado.

## Estado do banco/app alterado

- Plano de orçamento: versão 1 (renda 10.000; casa 30, eletrônicos 15, Futuro sem categoria 55) e versão 2 (casa 20%, eletrônicos 15, Futuro 55) salvas.
- Limite padrão aplicado: casa 2.340 → 3.000 e eletrônicos 1.730 → 1.500 (aplicados 1x pelo caso 5/7; possivelmente duas aplicações registradas pelo toque duplo). Nada foi aplicado só no mês.
- Restaurado: night no, font_scale 1.0, animações 1/1/1, privacidade (valores visíveis como no início); stayon voltou a false (valor inicial não registrado).
