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

## Checagem nativa final do iOS e restauração da sessão

Depois da publicação da v1.6.1, uma abertura fria com a API nativa real do iOS ficou em
“Confirmando…”. O [diagnóstico da hidratação](ios/hidratacao-antes.json) separa duas execuções:
a primeira mostra o resultado nativo entregue ao JS como sucesso, com a tentativa cancelada,
e a chegada posterior de `active`; a segunda registra o pedido filho iniciado para a conta
restaurada e o efeito pai cancelando-o na mesma montagem. A árvore de acessibilidade da
execução anterior, sem instrumentação, confirma o botão ocupado e o app bloqueado.

O teste de regressão reproduz a ordem de efeitos filho → pai durante a hidratação, executando
o provider real. Antes da correção: 40 testes passaram e apenas esse falhou; depois, os
[81 testes focados](focused-green-v1.6.2.log) passaram. A tentativa passa a guardar a conta para
a qual nasceu: a sessão restaurada não cancela seu próprio pedido, e trocar a conta continua
recusando o resultado antigo. Nenhuma API nativa foi substituída nessa checagem final.

Com o código corrigido da v1.6.2, no app de desenvolvimento `com.proops.personal.dev` do
simulador iPhone 17 Pro/iOS 26.5, conectado ao staging:

- A abertura fria restaurou a sessão, pediu a credencial nativa e chegou à Hoje sem ficar em
  “Confirmando…”: [desbloqueio normal](ios/nativo-desbloqueio-normal.png).
- Sair com Home e voltar pediu a senha novamente.
- Três saídas após confirmar a credencial, em aproximadamente 0,807, 1,185 e 1,603 segundos,
  voltaram ao prompt. A captura do caso intermediário comprova a
  [onda ainda revelando o app](ios/nativo-onda-interrompida.png), seguida da
  [nova exigência de senha](ios/nativo-volta-pede-senha.png).
  [Sequências e tempos](ios/nativo-interrupcoes.json).

As credenciais foram sintéticas do simulador. Isso verifica a integração nativa, o lifecycle
e a cortina; não prova Face ID ou a validade da senha no iPhone físico. A tela de credencial
simulada não ofereceu cancelamento com Escape; cancelamento e senha errada continuam cobertos
pelos testes de comportamento e pelo QA Android anterior. Não houve nova rodada completa no
Android após o ajuste de identidade da tentativa. Os diagnósticos temporários foram retirados
antes da compilação, sem alterações nas dependências nativas.
