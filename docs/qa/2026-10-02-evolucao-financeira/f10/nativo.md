# F10 — evidência nativa

## Android

QA em 03/10/2026, branch `gabriel/financas-22-melhorias`, pacote
`com.proops.personal.dev`, exclusivamente no `emulator-5574`. Modelo
`sdk_gphone64_arm64`, Android 16/API 36, 1344×2992, density 480. Ambiente:
staging `utkqoiigimqzeenxkxdl`; produção não foi acessada por este worker.
Interações pelo Maestro 2.11; ADB somente para inventário, settings, screenshots
e logcat. Nenhuma edição de código, SQL, DB ou Git pelo worker Android.

Meta Notebook: alvo R$9.000,00, guardado R$2.400,00, restante R$6.600,00,
prazo real 02/03/2027. O editor inicialmente abriu o cenário inferido, sem plano
persistido. A tabela abaixo separa prova visual de sucesso completo do runner.
Cada pasta de fluxo contém YAML, log e resultado da execução.

| Caso | Observação e resultado | Evidência |
| --- | --- | --- |
| 1. Mensal zero | **Prova visual**: campo mensal R$0,00, explicação e Salvar desativado. Runner interrompido em `eraseText`, não considerado execução verde. | [PNG](evidence/native/android/screenshots/android-zero-observed.png), [fluxo](evidence/native/android/flows/android-zero-keyboard-retry/) |
| 2. Mensal 659999 centavos, primeiro 31/01 | **Passou**: 31/01/2027 R$6.599,99; 28/02/2027 R$0,01; duas contribuições. Data escolhida pelo calendário inline. | [PNG](evidence/native/android/screenshots/android-two-events.png), [calendário](evidence/native/android/flows/android-monthly-659999/), [asserts](evidence/native/android/flows/android-two-events/) |
| 3. Mensal 220001 centavos | **Passou**: 31/01 e 28/02 R$2.200,01; 31/03 R$2.199,98; três contribuições. Aviso de ultrapassar prazo real 02/03. | [PNG](evidence/native/android/screenshots/android-three-events.png), [entrada](evidence/native/android/flows/android-three-prepare/), [asserts](evidence/native/android/flows/android-three-events/) |
| 4. Troca de modos | **Passou**: Por prazo conserva 02/03 e primeiro 31/01; volta a Por mês conserva R$2.200,01 e primeiro 31/01. | [prazo](evidence/native/android/screenshots/android-deadline-preserved.png), [mensal](evidence/native/android/screenshots/android-monthly-preserved.png), [fluxo](evidence/native/android/flows/android-switch-preserve/) |
| 5. Inicial cobre restante | **Passou**: mensal R$0,00, inicial R$6.600,00 em 03/10/2026, conclusão hoje, um evento inicial e Salvar habilitado. | [PNG](evidence/native/android/screenshots/android-initial-input.png), [fluxo](evidence/native/android/flows/android-initial-prepare/), [asserts](evidence/native/android/flows/android-cancel-reopen/) |
| 6. Cancelar e reabrir | **Passou**: descarta rascunho e retorna cenário inferido Por prazo 02/03, primeiro mensal 03/10, inicial zero. Nenhum save nesta fase. | [PNG](evidence/native/android/screenshots/android-cancel-reopen.png), [fluxo](evidence/native/android/flows/android-cancel-reopen/) |
| 7. Escuro e fonte 1.3 | **Passou nos campos F10**: texto/hint quebram linhas, previsão e calendário legíveis. Encontrado valor encolhido na linha “Disponível no fim”, tratado no caso 9. | [campos e defeito](evidence/native/android/screenshots/android-dark-large-fields.png), [calendário](evidence/native/android/screenshots/android-dark-large-calendar.png), [fluxo](evidence/native/android/flows/android-dark-large/) |
| 8. Privacidade e movimento reduzido | **Passou**: resultado e hint mostram “Previsão oculta”; conclusão e calendário desaparecem; campos próprios mensal R$1.320,00/inicial zero permanecem visíveis. Alternar modos conserva prazo sob escalas de animação zero. | [resultado](evidence/native/android/screenshots/android-private-result.png), [campo mensal](evidence/native/android/screenshots/android-private-monthly-input.png), [fluxo](evidence/native/android/flows/android-private-motion/) |
| 9. Reflow do dinheiro | **Corrigido pelo agente principal e validado**: recaptura escuro/fonte 1.3 mostra −R$52.319,36 legível em “Disponível no fim”. | [PNG final](evidence/native/android/screenshots/android-amount-reflow-fix.png), [fluxo](evidence/native/android/flows/android-crossread1/) |
| 10. Leitura cruzada do save iOS | **Passou**: Por mês R$2.200,01, primeiro 31/01, inicial R$0,01 em 03/10; quatro contribuições, conclusão 31/03 e último R$2.199,97. | [fontes](evidence/native/android/screenshots/android-crossread1-fields.png), [calendário](evidence/native/android/screenshots/android-crossread1-calendar.png), [fluxos](evidence/native/android/flows/android-crossread1-calendar/) |
| 11. Preparar Por prazo | **Passou**: prazo do plano 31/03; preservados primeiro 31/01 e inicial R$0,01 em 03/10; mensal calculado R$2.200,00, último R$2.199,99, quatro contribuições. | [calendário](evidence/native/android/screenshots/android-deadline-final-events.png), [fluxo de preparo](evidence/native/android/flows/android-deadline-save-prepare/) |
| 12. Save Android único | **Salvo uma vez** após liberação e leitura iOS. Reserva conferida antes: prazo 03/09/2027, primeiro 03/10/2026, inicial zero. Runner falhou apenas na espera por título ausente; caso 13 prova persistência sem repetir save. | [reserva](evidence/native/android/screenshots/android-reserve-unchanged.png), [log e resultado](evidence/native/android/flows/android-save2-once/) |
| 13. Reabrir save Android | **Passou**: fontes persistidas Por prazo 31/03, primeiro 31/01, inicial R$0,01 em 03/10. Resultado mensal R$2.200,00/último R$2.199,99/count 4. | [fontes](evidence/native/android/screenshots/android-read2-persisted-fields.png), [resultado](evidence/native/android/screenshots/android-read2-persisted-result.png), [fluxo](evidence/native/android/flows/android-read2/) |
| 14. Restaurar preferências | **Passou**: tema Claro, valores visíveis, fonte 1.0; lista exibe guardado R$2.400,00 e cenário salvo. Settings conferidos abaixo. | [PNG final](evidence/native/android/screenshots/android-original-settings-final.png), [fluxo](evidence/native/android/flows/android-final-original/) |

Correção posterior da legenda do card validada no Android: [visível](evidence/native/android/screenshots/android-caption-visible-settled.png) mostra “R$2.200,00/mês · previsão mar/2027”, conforme cenário real.
Com privacidade ligada, [card privado](evidence/native/android/screenshots/android-caption-private-settled.png) mostra “Plano oculto” sem previsão/data; assert de ausência da legenda pública passou.
[Visível](evidence/native/android/flows/android-caption-visible/), [privado](evidence/native/android/flows/android-caption-private/) e [restauração](evidence/native/android/flows/android-caption-restore/) passaram; privacidade false restaurada, demais preferências originais preservadas, sem editor/save/cleanup novo.

O oráculo de banco do agente principal confirmou save iOS revisão 1 e save
Android revisão 2. Na revisão 2: Notebook `deadline`, prazo 31/03/2027, mensal
derivado 220000 centavos, primeiro 31/01/2027, inicial 1 centavo em 03/10/2026,
último 219999 centavos, quatro contribuições. Os 17 conjuntos públicos
financeiros comparados e o caixa permaneceram iguais. Esta informação veio do
oráculo principal; o worker Android não realizou escrita SQL nem a comparação.
A limpeza das fixtures está em [Limpeza](#limpeza).

### Falhas de automação preservadas

- [Abertura inicial](evidence/native/android/flows/android-open/): `takeScreenshot`
  absoluto recusado por escapar da pasta de saída. A UI abriu; execução não
  aceita como pass. Demais capturas usaram nomes relativos.
- [Primeira verificação de privacidade](evidence/native/android/flows/android-privacy/):
  matcher “Previsão da meta oculta” não é exposto pela hierarquia Android;
  o texto efetivo é “Previsão oculta”. Execução falha preservada; caso 8 usa
  matcher observado e passou. Não houve falha de privacidade visível.
- [Save único](evidence/native/android/flows/android-save2-once/): aguardar ausência
  de “Plano de metas” era ambíguo com a seção da lista após o sheet fechar.
  Execução não aceita como pass integral. O fechamento foi confirmado visualmente
  e pelo subtítulo ausente; caso 13 reabriu e comprovou persistência sem novo save.
- O teclado Gboard abriu handwriting overlay. Settings temporários IME=1 e
  stylus=0 permitiram teclado numérico; ambos foram restaurados. `eraseText:20`
  foi interrompido após zerar visualmente; comandos posteriores com seis dígitos
  completaram. Latência do runner não foi usada como medida de desempenho do app.

### Preferências e runtime

Originais e finais verificados: fonte `1.0`, `show_ime_with_hard_keyboard=0`,
`stylus_handwriting_enabled=null`, night mode `no`, tema Claro, privacidade
false, `animator_duration_scale=null`, `transition_animation_scale=1.0`,
`window_animation_scale=1.0`. Temporários do gate visual: fonte 1.3, tema Escuro,
três escalas de animação zero. Font scale recriou a Activity e o fluxo abriu
novamente o editor antes das capturas; nenhum rascunho financeiro foi salvo
nessa etapa.

[Originais de entrada](evidence/native/android/android-original-settings.json),
[originais do gate visual](evidence/native/android/android-visual-settings.json),
[restauração final](evidence/native/android/android-settings-restored-final.json),
[resumo Android](evidence/native/android/android-final-summary.json).

O [recorte de runtime final](evidence/native/android/android-runtime-final.txt)
ficou vazio para os matchers consultados de `ANR in com.proops.personal.dev`,
`FATAL EXCEPTION` e `am_anr` com o pacote. Há
[avisos WindowManager](evidence/native/android/android-runner-latency-logcat.txt)
de timeout de animação no período da automação. Esses recortes não demonstram
cura da ANR F07 nem medem a responsividade física.

## iOS

iPhone 17 Pro, iOS 26.5, simulador `F0BDF23C-0286-4183-97E3-3BCC61D4267D`,
pacote `com.proops.personal.dev`, staging, conta `dev@`. Interações pelo Maestro
2.11. Relato do worker iOS: [ios-evidence-report.md](evidence/native/ios/ios-evidence-report.md).

| Caso | Resultado | Evidência |
| --- | --- | --- |
| Mensal zero | **Passou**: R$0,00 e Salvar desativado | [PNG](evidence/native/ios/screenshots/ios-cleared-monthly-native.png) |
| Mensal 220001 centavos | **Passou** (assert exato) | [PNG](evidence/native/ios/screenshots/ios-exact-monthly-settled.png) |
| Troca de modos conserva rascunhos | **Passou** | [prazo](evidence/native/ios/screenshots/ios-deadline-preserved-draft.png), [mensal](evidence/native/ios/screenshots/ios-monthly-preserved-draft.png) |
| Calendário 31/01 → 28/02 → 31/03 | **Passou** | [calendário](evidence/native/ios/screenshots/ios-january-calendar-before-selection.png), [rascunho](evidence/native/ios/screenshots/ios-january31-monthly-draft.png) |
| Inicial R$0,01, quatro eventos, último 219997 | **Passou** | [data](evidence/native/ios/screenshots/ios-initial-one-cent-date.png), [calendário](evidence/native/ios/screenshots/ios-final-monthly-calendar.png) |
| Save iOS (revisão 1) e reabertura | **Passou**, um save só | [fonte](evidence/native/ios/screenshots/ios-read1-monthly-source.png), [datas](evidence/native/ios/screenshots/ios-read1-initial-and-dates.png) |
| Escuro + XXXL, efeito do plano | **Passou** sem truncar | [PNG](evidence/native/ios/screenshots/ios-crossread2-dark-large-effect.png) |
| Privacidade | **Passou**: “Previsão oculta”, sem conclusão/calendário; card “Plano oculto” | [folha](evidence/native/ios/screenshots/ios-private-fixed-sheet-previsao-oculta.png), [card](evidence/native/ios/screenshots/ios-private-fixed-root-plano-oculto.png) |
| Leitura cruzada do save Android (revisão 2) | **Passou**: Por prazo 31/03, inicial R$0,01, último R$2.199,99 | [fontes](evidence/native/ios/screenshots/ios-crossread2-final-deadline-source.png), [calendário](evidence/native/ios/screenshots/ios-crossread2-exact-last-calendar.png) |
| Reduzir movimento (04/10/2026) | **Passou**: com `ReduceMotionEnabled=1` (o Reanimated avisou no Metro), Por prazo ↔ Por mês conservou R$2.200,00, prazo 31/03/2027 e primeiro 31/01/2027; fechou pelo ✕ sem salvar. Como já era 04/10, o inicial de 03/10 ficou fora da conta (3 contribuições) com o aviso “O aporte inicial ficou no passado” — regra do domínio, não regressão | [ligado](evidence/native/ios-reduce-motion/ios-reduce-motion-on2.png), [mensal](evidence/native/ios-reduce-motion/rm-monthly.png), [prazo](evidence/native/ios-reduce-motion/rm-deadline-again.png), [inicial no passado](evidence/native/ios-reduce-motion/rm-initial.png), [fechado](evidence/native/ios-reduce-motion/rm-after-close.png) |
| Restauração | **Passou**: Reduzir movimento off, aparência light, content size large, tema Claro, valores visíveis | [motion off](evidence/native/ios-reduce-motion/ios-reduce-motion-restored-off.png), [tema](evidence/native/ios-reduce-motion/ios-theme-restored-claro.png), [originais](evidence/native/ios/ios-original-visual-settings.json) |

A troca de modo sob Reduzir movimento mostra o bloco do efeito vazio por um
instante enquanto recalcula ([PNG](evidence/native/ios-reduce-motion/rm-deadline-again.png));
é recomputação, não animação, e assenta em seguida.

## Limpeza

`proops-f10-native-cleanup.py --verify` conferiu em 04/10/2026 que o plano
continuava idêntico ao gravado pelo Android (a prova de movimento não escreveu)
e `--execute` apagou só o plano e os quatro recibos dos dois `request_id` do QA.
Dezessete conjuntos financeiros e o caixa iguais antes e depois.
[Prova](evidence/native/persistence/cleanup-proof.json).

## Limites gerais

Teste em emulador/simulador não equivale a aparelho físico. Persistência UI,
revisão/ledger no banco, checks estáticos e aceite final são provas distintas.
Não foram usadas capturas transitórias como prova final de persistência.
