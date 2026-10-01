# QA Android — com.proops.personal.dev / emulator-5554

Branch gabriel/entrada-filtros. Sem edição de código, git ou dados remotos. O worker deixou o AVD aberto; depois da conferência de preferências, o primário encerrou somente esse AVD de QA. As cópias duráveis das evidências estão vinculadas no README desta pasta.

## Checks reais
- Lembretes, Importações, Dívidas, Parceladas: aplicar busca/critério, cancelar limpeza, aplicar limpeza passaram. Evidência normal obtida antes do último ajuste de geometria, conforme autorização do primário; código de consumidores permaneceu igual.
- Pós-fix final e cold launch: Recorrentes, Lançamentos, Arquivadas e Lixeira passaram aplicar busca, cancelar limpeza e aplicar limpeza.
- Home Notas: busca fixa preservada ao aplicar tag; folha sem segundo campo Buscar; contagem2/resumo busca+tag; cancelar limpeza preservou busca/tag; aplicar limpeza zerou ambos e restituiu grade de pastas.
- Pasta qaclean: abriu via card, filtro busca/cancelar limpeza/aplicar limpeza passaram. Fixture não alterada por este agente; cleanup do primário confirmado depois.
- Lembretes pós-fix: quatro critérios -> Filtros · 4, resumo2+mais2, accessibilityLabel completo com data/busca/Pausados/WhatsApp; um único Limpar datas; tema escuro; fonte sistema2.0 com resumo inteiro5 linhas; folha abriu/fechou e limpeza foi aplicada com fonte2.
- Restaurado e conferido nativamente: font_scale1.0, Night mode no, filtro0. App atualmente na rota Recorrentes, pois fonte recriou Activity a partir do Intent original do cold launch. Manifest não contém fontScale em configChanges.

## Evidências principais
- /private/tmp/proops-clean-android-final-qa.log
- /private/tmp/proops-clean-android-final-fix.mp4 (59.23s; duração mvhd verificada)
- /private/tmp/proops-clean-android-reminders-font2-multiple-dark-font2.png
- /private/tmp/proops-clean-android-reminders-font2-font2-sheet.png
- /private/tmp/proops-clean-android-reminders-font2-font2-controls.png
- /private/tmp/proops-clean-android-reminders-final-date-single-reset.png
- /private/tmp/proops-clean-android-reminders-final-multiple-light.png
- /private/tmp/proops-clean-android-reminders-final-multiple-dark.png
- /private/tmp/proops-clean-android-home-search-tag.png
- /private/tmp/proops-clean-android-home-sheet-single-search.png
- /private/tmp/proops-clean-android-home-clear.png
- /private/tmp/proops-clean-android-folder-clear.png
- /private/tmp/proops-clean-android-recurring-clear.png
- /private/tmp/proops-clean-android-transactions-clear.png
- /private/tmp/proops-clean-android-archived-clear.png
- /private/tmp/proops-clean-android-trash-clear.png
- /private/tmp/proops-clean-android-final-restored.png
XMLs homônimos existem para os flows finais, exceto final-restored (dump temporário /data/local/tmp/proops-qa.xml).

## Limites
- Rótulos conferidos pela árvore UIAutomator; TalkBack não ativado.
- Vídeo gravado e metadados verificados; não assistido integralmente por este agente.
- Fonte mudou Activity: comportamento de aumento no MESMO mounted tree foi provado no iPhone pelo primário; Android validou após reaplicar em2.0.
- Privacidade monetária revisada em fonte e testes focados; não foi alternado useConceal na UI Android.
- Intermediários de HMR e amostras durante animação foram descartados como evidência de bug; nenhum novo defeito concreto no QA estável.
