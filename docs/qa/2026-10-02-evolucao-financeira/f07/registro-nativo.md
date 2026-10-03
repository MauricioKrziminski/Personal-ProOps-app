# F07 — registro nativo e fronteira de aceite

Registro de 03/10/2026, branch `gabriel/financas-22-melhorias`, somente staging
`utkqoiigimqzeenxkxdl`. F01–F06 aceitos. **F07 com aceite funcional no staging**;
F08 liberado. A disposição e os limites estão no [aceite](aceite.md).
Este documento separa execução efetiva, falha, recuperação e pendência. Não certifica
release, produção ou aparelho físico.

## Ambiente e evidência

App `com.proops.personal.dev`, build debug 1.6.3; Metro 8081 com `EXPO_NO_DOTENV=1`.
Uma execução adicional usou APK local release com JavaScript embutido, OTA desativada e
configuração de staging, reinstalando o debug original em seguida sem limpar dados.
iPhone 17 Pro e iPad A16 com iOS 26.5; Android API 36 em `emulator-5574`.
Baseline Android: 1344×2992, density 480, font scale 1, modo noturno desligado,
app Claro e valores revelados. A opção de QA para stylus foi temporariamente zero;
a chave foi removida ao final, restaurando sua ausência original.

Logs, dumps, manifests, capturas e snapshots financeiros ficam em `/private/tmp`.
Nenhum desses arquivos, identificador de usuário/workspace, credencial ou dado bruto
financeiro integra este registro. Os valores abaixo são a fixture sintética usada no
staging. Capturas são evidência visual; assertions e exit codes não substituem sua revisão.

## Matriz efetiva

| Plataforma/caso | Evidência e resultado | Limite |
| --- | --- | --- |
| iPhone, resumo/editor em Claro e Escuro | `proops-f07-iphone-final-matrix.log`, exit 0; sete capturas de temas e privacidade revisadas | Não mede contraste por instrumento nem frames |
| iPhone, fonte XL | Clipping de `1.200,00` para `.200,00` reproduzido; após ajuste compartilhado de MoneyField, `proops-f07-ios-accessibility-fit.log`, exit 0, mostra valor inteiro e ações alcançadas | Não é certificação de VoiceOver falado |
| iPhone, teto monetário | Entrada inicial alcançou somente nove dígitos; complemento confirmou `999.999.999,99`. `proops-f07-ios-accessibility-ceiling-capture.log`, exit 0; captura mostra teto inteiro com teclado, fechar/reabrir preserva `1.200,00` | Ocultar teclado por automação falhou; não atribuído ao app |
| iPad, troca de orientação | Rascunho com 54.321 centavos e horizonte 10 preservado em retrato → paisagem → retrato; cancelar/reabrir retorna base 120.000 centavos e horizonte 9 | Sem gravação deste rascunho |
| iPad, fonte XL e ações | Logs `proops-f07-ipad-postfit-{continue,accessibility,cleanbottom,restore}.log`, exit 0; capturas retrato/paisagem/acessibilidade revisadas, valor completo e ações alcançadas | Primeiro runner `postfit-main` saiu 1 em assertion de zero que a captura mostrava; limite de automação, não passe daquele runner |
| Android, confirmação de metas/liquidez | Ack habilita Salvar; liquidez Tesouro desligada desabilita; religada habilita. Logs `matrix-open` e `matrix-gates`, exit 0 | Estado de habilitação exercitado sem salvar nessa matriz |
| Android, retirar vínculo/cancelar | Retirar Tesouro modifica somente draft; cancelar/reabrir restaura as duas fontes | Não prova retirada persistida |
| Android, zero | Valor efetivo `0,00`, erro inline e Salvar desabilitado; cancelar/reabrir retorna `1.200,00`. `matrix-zero`, exit 0 | Sem gravação inválida |
| Android, alocação excessiva | Valor efetivo `30.000,00` acima do disponível, erro inline e Salvar desabilitado; cancelamento restaura `3.000,00` da fonte. `matrix-over-resume`, exit 0 | `matrix-over` saiu 1 por seletor fora do viewport; recuperação usou rolagem e confirmou valor real |
| Android, temas | Resumo/editor Escuro e resumo Claro renderizados; `matrix-dark`, exit 0. Contraste do SwitchRow corrigido no primitivo; `android-switch-verdict-final`, exit 0, confirma ON/OFF Claro/Escuro, cancelamento e reabertura | Disabled não recapturado separadamente; props nativas e iOS preservados |
| Android, retry offline | Tentativa congelada, fechar bloqueado, mesma intenção e identidade no retry; após rede voltar, uma confirmação e reabertura com horizonte 7 | Primeira execução expôs exceção Java; texto foi corrigido depois. Essa prova valida protocolo, não o texto final |
| Android, conferência terminal | Falha offline da conferência preserva tentativa; retorno online encerra e libera fechamento; reabertura com base `1.200,00` e horizonte 9 | Encerramento sela identidade; não escreve valores financeiros |
| Persistência entre plataformas | Configuração final revisão 8, base 120.000 centavos, horizonte 9; conta 300.000 e ativo 100.000 centavos, ambas com liquidez confirmada | São valores da fixture de staging |
| Oráculo financeiro | Dez recibos selados: oito sucessos e dois cancelamentos; sete hashes financeiros idênticos entre início e snapshot após CAS nativo | Prova do intervalo observado, sem garantia para operações não executadas |

Os 12 PNGs Android da primeira matriz foram vistos individualmente e conferidos contra
`proops-f07-android-matrix-manifest.json`: sem overlay, branco ou clipping do valor-alvo,
teclado recolhido, 1344×2992. Isso não cobre os cenários interrompidos pela ANR.

## Persistência e oráculo

A sequência persistida foi: revisão 1 criada no iOS; revisão 2 recebeu base 1.120.000
centavos por erro de entrada da automação; correção na revisão 3 para 120.000; Android
adicionou ativo na revisão 4 e confirmou retry offline com horizonte 7 na revisão 5;
iOS levou o horizonte a 9 na revisão 6. No CAS após PT409, iOS gravou 11/revisão 7; Android recusou rascunho 10 da revisão 6, reabriu 11 e restaurou 9 na revisão 8. São dez recibos selados: oito sucessos e dois cancelamentos. O snapshot final `state-after-native-cas-restored.json` mantém os sete hashes financeiros idênticos. A revisão 2 **não** aprova o valor pretendido.

O oráculo somente leitura comparou snapshots inicial e `state-after-http-conflict.json`.
Hashes de contas, ativos, metas, contribuições, transações, patrimônio e saldos de contas
permaneceram idênticos. Configuração/alocações de reserva e recibos mudaram conforme as
operações documentadas; não houve movimento de dinheiro nesse intervalo.
O script privado `proops-f07-read-state.py` não deve ser importado: possui execução no
nível do módulo. Não foi importado para escrever este registro.

## Falhas relevantes, correções e recuperações

1. **Texto offline:** a reprodução inicial mostrou `UnknownHostException` no formulário.
   O tratamento passou a usar mensagem de recuperação do domínio. A execução anterior
   permanece prova da intenção congelada, e não aprovação retroativa da mensagem final.
2. **Automação iOS:** às 09:04:46 houve `EXC_BAD_ACCESS` com topo em
   `XCTAutomationSession`. O relatório não mostra frames React como ponto da falha;
   não há prova para atribuir a causa ao F07 ou ao app. O incidente não certifica
   estabilidade do app nem invalida automaticamente as execuções posteriores.
3. **Fonte XL:** clipping real do MoneyField foi reproduzido e corrigido no componente
   compartilhado. Reexecuções no iPhone e iPad mostram `1.200,00` inteiro; iPhone também
   mostra o teto monetário completo com teclado. O alcance inicial de nove dígitos foi
   registrado e corrigido na entrada da automação antes da captura do teto real.
4. **CAS nativo Android:** revisão obsoleta recebia timeout apesar da recusa SQL direta.
   A investigação do retry de `40001` pelo PostgREST levou à quarta migration, que usa
   `PT409` de negócio. Duas chamadas HTTP autenticadas recusaram em 81 ms e 39 ms com
   status 409, mensagem contratual e estado idêntico. Depois da mudança, `android-cas-pt409-refusal.log` saiu 0: recusa humana, nenhuma opção Confirmar e reabertura com 11. A prova HTTP foi complementada pela UI.
5. **ANR Android:** a matriz de privacidade foi interrompida por diálogos System UI e
   ProOps. O flow original completou o toque em **Ocultar valor** e falhou na assertion
   **Mostrar valor**. O snapshot `Input Dispatcher State at time of last ANR` mostra o
   mesmo DOWN em ProOps e no monitor `edge-swipe`, uma janela SPY de tela inteira, sem
   pilfering de ponteiros. O nome do monitor não comprova um swipe na borda. Primeiro
   dump ProOps, 09:42:02.489, mostra main em JavaTimer/heap; segundo,
   09:42:13.148, mostra main em espera nativa e JS em estado S, sem provar responsividade contínua. A coleta com atraso aproximado de 19,5 s
   não prova causa. Carga baixa do host e cerca de 51% de memória livre tampouco provam
   ausência de problema no emulador/app. **Causa aberta; não atribuída ao F07.**
6. **Recuperação ANR:** Wait não resolveu. Fechar ProOps no diálogo e relançar sem
   `clearState` recuperou o app; `proops-f07-android-anr-cold-recovery.log`, exit 0,
   confirmou base `1.200,00`, horizonte 9, reabertura e fechamento. Isso recupera a sessão;
   não corrige nem encerra o diagnóstico da ANR. A coleta Perfetto foi solicitada por oito minutos. A análise encontrou somente 23,957334 s retidos, após a recuperação: main Running máximo 45,022 ms e InputConsumer máximo 102,052 ms, sem slice ANR nesse intervalo. Há 37 ftrace_setup_errors notice. Isso não cobre o incidente nem prova sua causa; a matriz de privacidade passou sem nova ANR.

Dumps Android privados: `proops-f07-android-native-anr-094203.txt` e
`proops-f07-android-native-anr-094208.txt`. Relatório iOS privado:
`/Library/Logs/DiagnosticReports/ProOps-2026-10-03-090446.ips`.

7. **Recaptura visual e Sheet:** a primeira revisão recusou três imagens: fontes de privacidade fechadas, campos/ícones vazios no resize e largura antiga no retorno. O Sheet agora conserva a árvore do formulário e a animação/apresentação por abertura; layout e transparência Android acompanham a largura. Duas provas de lifecycle confirmam uma montagem, nenhum unmount e draft/identidade preservados. As capturas estabilizadas 448→800→448 dp mostram 543,21/10; cancelar/reabrir retorna 1.200,00/9. Frames imediatamente após `wm size` ainda pegaram transição, e uma coleta limitada de pixels teve timeout; não se certifica sua duração/fluidez. Eventos recentes lidos não mostraram novo ANR, mas não provam a causa do incidente anterior. Revisão completa nova abriu 38 imagens válidas.
8. **Fechar iOS:** salvar/reabrir 11 foi confirmado e persistido; o último seletor Fechar não fechou e uma fonte do draft ficou desligada, sem gravação. O toque na posição visível 8%/13% fechou, runner exit0. Um roteiro intermediário falhou antes do toque por percentual decimal não suportado. Não se atribui a causa do seletor ao app sem prova.

9. **Regressão do Sheet atual:** `ios-sheet-regression` e `ipad-sheet-regression` saíram 0: abrir, alterar horizonte 9→10, cancelar e reabrir conserva 1.200,00/9; iPad também faz retrato→paisagem→retrato. As três capturas foram vistas individualmente. O seletor Fechar funcionou nessas execuções; a falha anterior não foi apagada do registro.
10. **Fechamento visual:** revisão válida pediu apenas o contraste do SwitchRow Android Escuro. Uma correção com tokens no primitivo e quatro recapturas ON/OFF em Claro/Escuro recebeu `resolved` e `disposition: ship` no Verdict Pass. Esse ship cobre o fix pontuado; não certifica ANR, frames, leitor falado ou todo o aplicativo. Dois runners iniciais falharam na navegação ao tema da tela Perfil; o terceiro chegou à seção e completou a prova.
11. **Recorte delegado de estabilidade:** três repetições de 11:56:51 a 12:02:40
    saíram 0: toque Ocultar/Mostrar, editor com rascunho 543,21/10, abertura do painel
    Android, retorno, cancelamento e reabertura em 1.200,00/9. A primary conferiu os
    runners, os três PNGs do painel, o render final e os logs contínuos; zero novos
    marcadores ANR/crash nesses logs. Não houve Salvar, recuperação ou mudança de PID.
    O trace válido reteve 169,816580 s, de 12:00:52.586605 a 12:03:42.403185: cobre o
    painel da segunda repetição e toda a terceira, não a primeira nem o início da segunda.
    Três arquivos iniciais de 0/12/12 bytes são coletas inválidas, sem valor de prova.
    Baseline e ausência da chave secure de stylus preservados; coletores encerrados.
    Relatório privado: `proops-f07-anr-bounded/resultado.md`. Resultado **não reproduzido
    em 3 tentativas**, sem causa ou correção comprovada. Próxima captura relevante é a
    janela contemporânea do DOWN/timeout, se houver recorrência, com stacks dos dois
    consumidores; repetir a matriz visual não resolve essa lacuna.

12. **Preferência de movimento reduzido do sistema:** no iOS, `main` saiu 0; a
    preferência foi confirmada OFF→ON→OFF, o fluxo com ON completou e o fluxo separado
    de restauração do app terminou com a tela de patrimônio acessível e editor fechado.
    O rascunho de base mensal 543,21/horizonte 10 meses foi cancelado; reabrir mostrou
    base 1.200,00/horizonte 9. As capturas do
    sistema e do app foram conferidas pela primary; banners de desenvolvimento aparecem
    na borda inferior das capturas do app. Evidência privada:
    `/private/tmp/proops-f07-ios-reduced-motion/results.json` e
    `/private/tmp/proops-f07-ios-reduced-motion/resultado.md`. O horário da restauração
    do app não foi preservado com precisão; 12:26:23 é do restore do sistema.
    No Android, a execução longa com escala de transição 1.0→0→1.0 terminou no wrapper por
    timeout de 300 s. O `maestro.log` contém 50 passos `COMPLETED`, mas o timeout impede
    tratá-la como execução concluída com exit 0. A tentativa imediata de restaurar a UI
    encerrou com `DeviceServerDiedException`/gRPC `UNAVAILABLE` do driver Maestro; isso
    não demonstra crash do app nem ANR. Depois, um clean finish independente saiu 0:
    reabriu o editor com 1.200,00/9, capturou e fechou sem salvar. A escala de transição
    `transition_animation_scale` voltou a 1.0 via `finally`; screenshots e fluxo foram conferidos pela primary.
    Evidências privadas: `/private/tmp/proops-f07-android-reduced-motion-phase-normalized.log`,
    `/private/tmp/proops-f07-android-reduced-motion/cleanfinish-maestro.log` e
    `/private/tmp/proops-f07-android-motion-cleanfinish.log`. Tentativas Android iniciais
    de navegação/precondição permanecem falhas sem causa provada e não contam como passes.
    Nenhum desses fluxos tocou Salvar ou escreveu dados financeiros. A preferência real
    do OS foi exercitada; medição de FPS/frames e fluidez continua pendente.
    Uma inspeção privada do contrato do timer encontrou clamp do valor negativo a zero
    na new architecture; overflow de intervalo finito acima de 2^31 ms exigiria primeiro
    vencimento em cerca de 24,9 dias, sem chamador desse intervalo encontrado no recorte. Isso não
    explica a ANR observada; não houve patch de timer.

13. **Execução independente do Metro:** APK local release 1.6.3, mesmo ID e assinatura
    de desenvolvimento, gerado com ambiente público de staging e `EXPO_NO_DOTENV=1`.
    O manifest empacotado confirmou `debuggable=false` e OTA desativada; `assets/app.config`
    e o JS embutido contêm o destino staging. A URL de produção está ausente. O identificador
    de produção presente no JS é a constante de rótulo de `environment.ts`, sem URL/cliente
    de produção. A primeira compilação offline falhou por dependência de lint ausente no
    cache; a compilação com resolução normal do Gradle passou em 4m55s. Duas verificações
    iniciais do harness pararam antes de instalar: banner Java no XML e constante de rótulo
    confundida com configuração. Esses preparativos não contam como passes nativos.
    O flow saiu 0 de 13:06:59 a 13:09:14: ocultar/revelar, detalhe das fontes mascarado,
    rascunho 543,21/10 preservado após painel Android, cancelar/reabrir 1.200,00/9 e
    privacidade preservada após cold launch. Cinco PNGs conferidos individualmente, sem
    banner de desenvolvimento. Logs contínuos têm zero marcadores novos de ANR/crash;
    `lastanr` ficou idêntico. Não se infere causa ou correção do incidente anterior.
    Snapshots antes/depois: sete oráculos financeiros, estado da reserva e dez recibos
    idênticos; revisão 8 mantida. Reinstalação do debug original saiu 0, sem `clearState`;
    o flow separado de restauração saiu 0 às 13:12:41, abriu o editor 1.200,00/9 e fechou.
    Evidência privada: `/private/tmp/proops-f07-embedded-android/`, incluindo guard,
    manifest empacotado, hashes dos APKs, logs, resultados, cinco PNGs e snapshots.
    SHA256 do APK diagnóstico: `78675d1aed97feb225ee55936e0e10ddc70e12fc0e70c204adf8b80dcd5c4149`.

## Pendências para aceite

| Caso | Estado neste registro |
| --- | --- |
| Android, privacidade após recuperação | Passou, runner `proops-f07-android-privacy-final.log`, exit 0: resumo/fontes/hints ocultos, campo editável preservado e visibilidade restaurada |
| Android, compacto/fonte ampliada/teto de 11 dígitos | Passou em 384 dp/fonte 1,3; valor completo e teto real `999.999.999,99`, cancelar/reabrir retorna `1.200,00` |
| Android, resize para 800 dp com draft aberto e retorno/cancelamento | Passou no render estabilizado após correção do Sheet; capturas válidas conferidas e cancelamento conserva 1.200,00/9. Fluidez/duração da transição não certificadas |
| Android, CAS nativo após `PT409` | Passou: iOS gravou 11/rev7, Android stale 10 recusado com mensagem humana sem Confirmar; reabertura 11 e restauração 9/rev8 confirmadas |
| Android, contraste do switch ligado no Escuro | Fix resolved pelo revisor; ON/OFF Claro/Escuro conferidos em quatro PNGs e runner exit 0 |
| ANR Android | Não reproduzida nas três tentativas debug nem no fluxo do APK embutido; incidente aberto, sem causa/correção comprovadas; disposição no aceite |
| Offline iOS | Não executado |
| VoiceOver/TalkBack falados | Não executados |
| Reduce Motion do iOS / escala de transição Android | iOS completou; Android alternou `transition_animation_scale` 1.0→0→1.0 e restaurou, mas a rodada longa teve timeout do wrapper; clean finish independente saiu 0 |
| FPS/frames e fluidez da animação | Não medidos |
| APK local release / aparelho físico / produção | APK diagnóstico embutido executado no emulador; aparelho físico e produção não executados |
| Aceite F07 e avanço F08 | Aceite funcional no staging registrado; F08 liberado. Certificação de estabilidade e distribuição permanecem fora deste aceite |

Os cenários de base observada, revisão de mês, classificação, lastro, permissões e
concorrência estão no [registro SQL](registro-sql.md); não são promovidos a testes
nativos por esse fato. A [matriz contratual](contrato.md) permanece a referência do aceite.

## Estado de restauração observado

No iPad: app Claro, sistema claro, fonte large, retrato, valores revelados e simulador
desligado após a regressão do Sheet. No iPhone: fonte large/sistema claro preservados,
app Claro e valores revelados confirmados por `ios-restore-light`, exit 0; simulador ligado.
O teste de movimento reduzido terminou com a preferência do sistema OFF e o app restaurado.
No Android: tamanho físico original restaurado, fonte 1, app Claro/revelado e editor fechado;
chave temporária de stylus removida e escala de transição `1.0` restaurada. A recuperação
anterior preservou os dados da sessão.
APK diagnóstico local executado e debug original restaurado; não houve distribuição,
publicação ou execução em produção.

## Verificações de código

Após a mudança do Sheet, a suíte completa passou: 1.839 testes, zero falhas/skip,
`proops-f07-sheet-final-tests-confirmed.log`. Uma assertion antiga que exigia literalmente
`visible={visible && focused}` foi substituída pela prova comportamental de foco/lifecycle
do Sheet, que exercita a ocultação da janela e o fechamento da sessão. A primeira suíte
desse trecho falhou somente nessa assertion; não é promovida a passe.
TypeScript e lint passaram após a correção final do SwitchRow; os quatro testes existentes
de contraste/papéis da paleta também passaram. React Doctor final: zero erros e sete
warnings (quatro de complexidade e três de busca em array), sem diagnósticos adicionais
pela correção do switch. Score/API desabilitados; não há alegação de pontuação.

## Logs privados de apoio

- iPhone: `proops-f07-iphone-final-matrix.log`,
  `proops-f07-ios-accessibility-fit.log`,
  `proops-f07-ios-accessibility-ceiling-capture.log`.
- iPad: `proops-f07-ipad-postfit-{main,continue,accessibility,cleanbottom,restore}.log`.
- Android: `proops-f07-android-matrix-report.md`,
  `proops-f07-android-matrix-manifest.json`, `proops-f07-android-matrix-*.log`,
  `proops-f07-android-{offline-freeze,offline-retry,resolution-offline,resolution-online,cas-terminal-resolution}.log`,
  `proops-f07-android-anr-cold-recovery.log`, `proops-f07-android-privacy-final.log`.

Este registro reúne contrato, registro SQL, execução primária e logs privados indicados.
O manifesto portátil contém hashes/origens de 38 imagens da revisão completa e quatro
do fix final; os bytes permanecem privados. A documentação não substitui a execução nem
fecha a causa do incidente de estabilidade. O [aceite funcional](aceite.md) registra
explicitamente sua disposição e as qualificações restantes.
