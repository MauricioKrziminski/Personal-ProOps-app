# F09 — evidência nativa

**Estado: matriz funcional aceita pelo principal, com limites abaixo.** Sessões realizadas em 03/10/2026 no staging `utkqoiigimqzeenxkxdl`, com simulador iOS e emulador Android. Este registro organiza uma seleção portátil de capturas, fluxos e resultados; não representa build distribuído nem teste em aparelho físico.

## Cobertura confirmada

| Plataforma | Interação observada | Evidência selecionada |
|---|---|---|
| iOS | Criação/uso e leitura do lançamento com detalhe; operações efetivadas de mover, juntar e remover; leitura após remoção | [linha salva](evidence/native/screenshots/ios-created-row.png), [move](evidence/native/screenshots/ios-moved-child.png), [contagens após merge na mesma visita](evidence/native/screenshots/ios-merge-samevisit-counts.png), [catálogo após remoção](evidence/native/screenshots/ios-deleted-catalog.png), [lançamentos preservados após remoção](evidence/native/screenshots/ios-rows-after-delete.png) |
| iOS | Breakdown anual e privacidade de valores/labels | [mercado anual](evidence/native/screenshots/ios-annual-breakdown.png), [breakdown oculto](evidence/native/screenshots/ios-privacy-breakdown.png) |
| Android | Criação e salvamento único de um lançamento F09 (R$ 2,34); leitura cruzada e filtro por detalhe, edição somente leitura, troca do pai limpando o draft e cancelamento, filtro obsoleto bloqueado, Sem detalhe preservando as linhas e relatório com fonte 1,3 | [salvo uma vez](evidence/native/screenshots/android-saved-once.png), [filtro/leitura cruzada](evidence/native/screenshots/android-crossread-filtered-detail.png), [editor somente leitura](evidence/native/screenshots/android-readonly-editor.png), [limpeza do draft](evidence/native/screenshots/android-parent-clears-draft.png), [filtro obsoleto](evidence/native/screenshots/android-stale-filter-blocked.png), [filtro Sem detalhe](evidence/native/screenshots/android-none-filter.png), [relatório com fonte 1,3: R$ 48,57 e Sem detalhe](evidence/native/screenshots/android-report-large-font.png) |

Os fluxos Maestro, YAML, logs e resultados correspondentes estão em [flows](evidence/native/flows/). Os snapshots de apoio são [native-oracle-progress.json](evidence/native/native-oracle-progress.json) e [native-report-oracle.json](evidence/native/native-report-oracle.json). O total do breakdown também foi comparado com `annual_by_category(2026)` usando role authenticated: ambos 4.857 centavos/3 registros.

O passe final conferiu [total iOS](evidence/native/screenshots/ios-total-layout-final.png) e [Android escuro/fonte 1,3](evidence/native/screenshots/android-report-large-font.png) depois de reutilizar `Row.inlineValue`; a composição separa rótulo e dinheiro. As imagens finais foram inspecionadas pelo principal.

## Limites da cobertura

- Criação e uso foram exercitados no iOS. Android também criou e salvou uma vez um lançamento F09 de R$ 2,34; o recibo real foi conferido pelo principal. A captura e o fluxo estão em [android-preview-save](evidence/native/flows/android-preview-save).
- Rename, move, merge e delete foram efetivados no iOS. Android fez leitura cruzada do detalhe movido e conferiu os lançamentos; não executou essas mutações estruturais.
- Escopos, importação, scheduler e corridas têm evidência SQL/Node/Python documentada separadamente, sem interação equivalente completa na UI nativa.
- A leitura Android com fonte 1,3 foi conferida no relatório em escuro após relançamento. Nesta sessão, a hierarquia selecionou Escuro enquanto a pintura permaneceu clara; relançar carregou a preferência e renderizou escuro. A causa da repintura não foi comprovada nem corrigida; não é aceitável contar o primeiro exit 0 como prova visual.
- Não houve build novo para distribuição nem execução em dispositivo físico. O incidente F07 `QA-ANDROID-20261003-ANR` continua aberto; a ausência de nova ocorrência não o fecha.
- Fonte 1,0, night no, teclado físico 0 e stylus null originais foram restaurados e lidos de volta; tema Claro e tela após relançamento foram inspecionados. Privacidade iOS voltou a valores visíveis. [Preferências restauradas](evidence/native/android-settings-restored.json).
- Não houve nova rodada F09 em tablet, VoiceOver/TalkBack ou Reduce Motion. Os novos controles reutilizam kit/motion já exercitados nos pontos anteriores; isso não equivale a passar esses cenários novamente no F09.

## Defeitos e correções observados durante a automação

- **Defeito real da prévia:** a lista permitida de `preview_finance_write` ainda recusava `subcategory_id`, embora o salvamento estivesse funcionando. A correção foi aplicada e a prévia pronta foi reaberta e conferida no iOS; o Android também mostrou prévia pronta antes de salvar.
- **Defeito real de contagens em cache:** após o move, as contagens de pais ficaram antigas na mesma visita de Categorias, embora lançamentos e catálogo já refletissem o novo pai. A invalidação foi corrigida; a contagem de mesma visita após merge foi conferida no iOS. A prova selecionada é [esta captura](evidence/native/screenshots/ios-merge-samevisit-counts.png).
- **Assertiva de automação corrigida, sem defeito visual:** uma checagem esperava que a linha do relatório expusesse texto combinado; a UI fornece labels separados. A verificação passou usando as labels reais e a captura anual foi inspecionada.
- **Seletor de restauração corrigido, sem defeito do app:** a automação procurou “Revelar valor”, mas o controle observado era “Mostrar valor”. A restauração foi concluída e a tela conferida.

## Artefatos

As 15 capturas selecionadas estão em [evidence/native/screenshots](evidence/native/screenshots/). O pacote exclui snapshots completos de banco, recibos privados avulsos, hierarquias inteiras e logcat. [Limpeza restrita](evidence/native/native-cleanup-proof.json) e [leitura independente posterior](evidence/native/native-after-independent-proof.json) confirmam remoção dos dois lançamentos QA e oito recibos próprios, 132 transações originais, nenhum detalhe QA restante e 17 conjuntos públicos/caixa exatamente iguais ao baseline. As 12 versões privadas de recorrência conferem com a captura anterior ao merge/delete; não houve baseline privado anterior à primeira criação QA.

[Janela de runtime](evidence/native/android-runtime-window.json): zero ANR/FATAL/input timeout novos na captura, mas warnings Reanimated de SurfaceMountingManager ausente. Não prova causalidade com a repintura nem encerra o incidente F07. A captura própria foi encerrada ao final.
