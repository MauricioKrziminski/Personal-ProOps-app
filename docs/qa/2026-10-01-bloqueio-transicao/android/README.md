# QA nativa Android — bloqueio

01/10/2026. AVD isolado `proops_lock_qa`, serial `emulator-5580`, aplicativo `com.proops.personal.dev`, staging, JS servido pelo Metro 8081 com a correção na branch `gabriel/bloqueio-transicao`. Conta de demonstração; PIN sintético do próprio AVD. Não houve alteração de fontes, banco ou dados financeiros.

## Resultados observados

- Bloqueio Sim / Na hora foi ativado no Perfil. Home/volta abriu a credencial REAL do Android (`com.android.systemui`, título `Desbloquear o app`).
- PIN errado manteve a credencial com `Wrong PIN` (`06-wrong-pin.xml`). Cancelar voltou à cortina inteira `App bloqueado / Tentar de novo` (`07-cancelled.png`).
- Retry manual e PIN correto abriram o app (`09-correct-keyevents.png`); nenhuma repetição automática de prompt foi observada após sucesso comum.
- Home em cinco tempos de retorno do PIN, seguido de volta rápida, terminate+launch ou volta após alguns segundos: todos retornaram ao novo prompt. Os JSONs registram tempos medidos; os vídeos e imagens registram o estado visual.
- `rapid-050`: Home terminou 0,724s depois do comando Enter; nova credencial na volta.
- `rapid-350`: 1,068s; nova credencial na volta.
- `rapid-800`: 1,291s; cortina começando a sair antes de Home; nova credencial na volta.
- `terminate-1100`: 1,699s; após force-stop+launch, a primeira captura era splash do dev build; a captura estabilizada confirmou nova credencial (`terminate-1100-settled-return.xml`).
- `later-1300`: 2,053s; borda curva e conteúdo da cortina esmaecido antes de Home (`later-1300-before-home.png`), retorno após 3,683s abriu nova credencial (`later-1300-return.xml`).
- Carência 30s: retorno em 3,055s dispensou prompt; retorno em 32,054s pediu novamente (`grace30-inside.json`, `grace30-outside.json`). Screenshot dentro da janela confirma 30s selecionado.
- Ao terminar, carência devolvida a Na hora e Bloqueio Não; Home/volta final sem prompt nem cortina (`restored-off.png`, `restored-off-return.xml`). AVD deixado ligado.

## Melhores evidências

- `07-cancelled.png`: conteúdo protegido depois de cancelar.
- `later-1300-before-home.png`, `later-1300-home.png`, `later-1300-return.xml`, `later-1300.mp4`: revelação, Home e novo prompt.
- `terminate-1100.mp4`, `terminate-1100-settled-return.xml`: encerramento/reabertura.
- `grace30-inside.png`, `grace30-outside.xml`: fronteira da carência real.
- Cada trial possui JSON de comandos/tempos e vídeo MP4 completo; helpers `qa.py`, `boundary.py`, `grace.py` operam somente o serial isolado.

## Limites

Screenshots/vídeos não provam a ordem interna de eventos AppState nem o instante do resultado JS. Os tempos são medidos após o comando Enter e incluem overhead de ADB/captura. A credencial segura do sistema aparece preta no screencap/screenrecord; o XML identifica o prompt e o erro. A regressão não foi comparada ao código original no Android nesta QA. Não é teste de binário release nem de aparelho Android físico; biometria não foi ensaiada. Carência 60s não foi ensaiada nativamente, por decisão do primary; há cobertura unitária de fronteiras. O funcionamento do PIN comum e a onda visível antes do Home foram observados, porém não equivalem a instrumentação do ciclo de vida JS.
