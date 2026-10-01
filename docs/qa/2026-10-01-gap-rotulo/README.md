# Gap dos rótulos de data — 01/10/2026

Branch `gabriel/entrada-filtros`; app de desenvolvimento `com.proops.personal.dev`, iPhone 17 Pro/iOS 26.5. Comparação direta no simulador, capturas originais sem edição. Fonte e filtros restaurados ao final.

## Problema e correção

Depois do alinhamento do reset, o primeiro campo continuava com 18 pontos entre o texto e o alvo nativo do input, enquanto o segundo tinha 9. O primeiro reservava uma linha de 36 pontos para a ação; centralizar o texto de 18 pontos deixava 9 pontos adicionais abaixo dele, somados ao gap do formulário. O segundo não tinha esse espaço extra.

O `Field` agora mede a linha e seu texto, descontando do gap solicitado o espaço que a ação já ocupa abaixo do rótulo. A geometria segue a altura real, inclusive ao mudar fonte ou quebrar o rótulo em várias linhas. O gap de layout permanece não negativo. As duas datas usam `Space.lg` (16 pontos entre texto e borda); o alvo nativo interno acrescenta a borda de 1 ponto. Na fonte normal, ambas medem 17 pontos. O reset continua centralizado com o primeiro rótulo. Campos comuns conservam o espaço anterior de 8 pontos.

A regra vive no componente compartilhado dos filtros e alcança seus dez consumidores. Foram alterados `field.tsx`, `list-filters.tsx` e o teste de regressão em `form-motion-ui.test.ts`; os hashes desses três arquivos permaneceram iguais durante o QA nativo.

## Evidências

| Evidência | Resultado |
|---|---|
| [before.png](before.png), [before-metrics.json](before-metrics.json) | Antes: 18 pontos versus 9 |
| [normal-empty.png](normal-empty.png), [normal-selected.png](normal-selected.png), [normal-reset.png](normal-reset.png) | Depois: 17 pontos em ambos; selecionar/resetar não desloca campos |
| [medium-font-selected.png](medium-font-selected.png) | Fonte intermediária: diferença de 1 pixel físico no arredondamento do layout |
| [maximum-font-selected.png](maximum-font-selected.png), [maximum-font-reset.png](maximum-font-reset.png) | Fonte máxima: gaps de aproximadamente 17 pontos em ambos; reset alinhado |
| [debts-normal-empty.png](debts-normal-empty.png), [debts-medium-empty.png](debts-medium-empty.png) | Rótulo longo: inicial com duas linhas e final com uma mantêm o mesmo gap, com tolerância de 1 pixel físico |
| [metrics.json](metrics.json), [native-verified-events.log](native-verified-events.log) | Oito estados nativos, frames AX, medidas e hashes do código |
| [field-motion-tests.log](field-motion-tests.log), [tests-summary.log](tests-summary.log), [verification.json](verification.json) | Testes e verificações finais |

QA cobriu datas vazias, inicial selecionada, Aplicar, reset no rascunho, cancelar preservando o filtro aplicado, fonte normal/intermediária/máxima e rótulos de alturas diferentes em Dívidas. Diferenças fracionárias de até 0,334 ponto correspondem a um pixel físico no simulador de escala 3. Sem perda de texto ou mudança de alvo do reset.

O novo teste monta o `Field` real, entrega eventos de layout nativo com alturas de 18, 30, 60 e 128 pontos, verifica o gap visual, remoção do acessório e preservação do comportamento dos campos comuns. **1.365/1.365** no conjunto completo, sem falhas/cancelados/skips/todos; **36/36** na suíte de formulário/movimento. TypeScript, lint e diff sem erro. React Doctor: zero erros e os mesmos 20 avisos da etapa anterior, sem diagnóstico novo no `Field` ou supressões.

Duas tentativas de automação exigiram ajuste de sincronização: uma leu o reset ainda presente; a conferência instrumentada confirmou sua remoção. Outra não abriu a folha ao reduzir a fonte. Os seis estados de Lançamentos já tinham passado; uma execução separada concluiu os dois cenários de Dívidas e conferiu a limpeza. O código não mudou entre essas tentativas. Os eventos publicados incluem somente os estados verificados e controles do filtro.

Fonte `large` conferida, filtros limpos, tela Notas restaurada com duas notas ativas e três arquivadas. Nenhum registro financeiro ou pasta criado/alterado. Não houve nova execução Android/iPad neste ajuste. As evidências anteriores foram preservadas.
