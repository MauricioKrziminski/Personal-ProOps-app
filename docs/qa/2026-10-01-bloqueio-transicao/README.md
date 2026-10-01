# QA do bloqueio na transição — 01/10/2026

## Antes e depois

O `LockProvider` e a cortina reais são exercitados nos testes, com promessas nativas e eventos
controlados. O código v1.6.0 apresentou 20 falhas nos 76 casos da primeira comparação; o código
corrigido passa nos 80 casos finais. [RED](baseline-red.log) · [GREEN](focused-green.log).
Os quatro casos adicionados depois da comparação inicial cobrem desligamento e disponibilidade
do retry ao trocar de conta. Esta última revisão reproduziu e corrigiu um estado ocupado preso.

No simulador iPhone 17 Pro/iOS 26.5, a comparação usou uma cópia isolada da v1.6.0 e depois
os arquivos corrigidos. Apenas `expo-local-authentication` foi substituído por uma dependência
que entrega sucesso após 2,5s; AppState, Home/volta, provider e animação são nativos/reais.
Essa configuração de QA não entra no app nem no build publicado. O simulador usa staging.

A sequência registrada foi: primeiro Home/volta inicia tentativa → Home durante a tentativa →
sucesso antigo em segundo plano → nova volta. Antes, a volta mostrou o app revelando e não
iniciou nova tentativa; depois, mostrou `App bloqueado / Confirmando…` e iniciou outra.
A segunda autenticação válida concluiu normalmente. Screenshots corroboram o estado visual;
os eventos internos são comprovados pelo [log instrumentado](ios/lifecycle-controlado.log),
não inferidos das imagens. [Antes](ios/antes-retorno.png) · [Depois](ios/depois-retorno.png).
Os JSONs de timeline registram comandos, horários e os resultados das capturas de acessibilidade.
O ajuste final de identidade da sessão foi testado por regressões do provider; esse ensaio
visual anterior não troca a conta.

## Credencial real Android

AVD de QA isolado, Android 16/API 36, `com.proops.personal.dev`, conta de demonstração de staging.
PIN errado, cancelamento, retry, sucesso e cinco formas de sair/voltar foram ensaiados usando
a senha real do sistema. Incluem a onda já visível, volta rápida, encerramento e volta tardia.
Todos os retornos exigidos pediram senha. A carência 30s dispensou em 3,055s e exigiu em 32,054s.
[Relatório e limites](android/README.md) · [Onda antes de Home](android/later-1300-before-home.png) ·
[Vídeo](android/later-1300.mp4) · [Novo prompt](android/later-1300-return.xml).

O prompt protegido por FLAG_SECURE aparece preto no screencap: o XML identifica a credencial e
`Wrong PIN`. O ensaio Android não usa o adapter de autenticação do simulador iOS. Os vídeos
não provam a ordem de AppState. Não há teste nativo de biometria ou carência 60s; as variantes
sem pausa e as fronteiras 0/30/60 são cobertas pelos testes do provider.

## Revisão

React Doctor foi usado como apoio. A limitação de otimização do React Compiler para try/finally
e a recomendação de migrar runOnJS já existiam no código base; não são falhas da autenticação.
O alerta de tamanho do provider é de manutenção, sem um comportamento incorreto demonstrado.
A revisão de concorrência encontrou o retry preso na troca direta de conta, corrigido e coberto
por duas regressões que verificam o estado que controla a disponibilidade do botão.

TypeScript, lint e suíte completa são registrados na release depois do último portão. Não
houve escrita financeira, migration nem alteração do agente. O PIN é sintético do AVD isolado.
Bloqueio Android restaurado a Não/Na hora; preferência do simulador iOS preservada. Servidores
Metro usados no ensaio e configuração temporária são restaurados após o QA.
