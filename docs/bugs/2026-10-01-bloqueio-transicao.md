# Bloqueio durante a volta da autenticação

## Relato e reprodução

Com o bloqueio ligado, uma senha correta iniciava a revelação antes do app voltar a `active`.
Sair nesse intervalo e reabrir podia dispensar a próxima autenticação. A sequência reproduzida
no `LockProvider` real foi: autenticar → inactive → sucesso → background → active.

A v1.6.0 abria no sucesso mesmo fora do primeiro plano. Sua bandeira `systemUiOpen` permanecia
ligada até o próximo `active`, que também podia pertencer a uma saída real. Esse retorno era
interpretado como o fechamento do prompt, consumindo a exigência de senha.

Os testes atuais executados contra o código anterior deram 76 casos, 56 aprovados e 20 falhas,
sem cancelamentos ou casos ignorados; saída 1. O teste controla apenas as dependências nativas,
promessas e eventos, mantendo o provider e a política de bloqueio reais.

## Correção

Uma tentativa autenticada só abre quando a mesma visita volta ao primeiro plano. No iOS,
`background` invalida a tentativa pendente, exige uma nova autenticação na volta e cobre o app.
No Android, o primeiro `background` pode pertencer à própria tela de credencial e continua
permitido; uma saída após o resultado invalida a tentativa. O pedido seguinte espera a limpeza
da operação anterior, preservando a guarda contra prompts simultâneos.

Logout, troca de conta, desligamento da trava e desmontagem invalidam o resultado antigo e
resolvem uma espera por `active` como recusada. A troca direta de conta também restaura o estado
do botão para que o retry continue disponível, preservando a cobertura existente. Erros nativos
liberam a guarda e permitem retry.
O seletor de arquivo/câmera e operações de sistema aninhadas preservam sua exceção existente.

A cortina relocka com tinta opaca no próprio render e progresso zerado, sem animar conteúdo
exposto até a cobertura. Cada saída tem uma validade própria: callbacks de animação e timers
antigos não podem desmontar uma cortina mais recente, inclusive com Reduce Motion.

## Verificação

Os 80 testes focados passam. Cobrem ambas as ordens resultado/active no iOS e Android,
biometria Android sem pausa, resultados tardios, cancelamento, retry, reentrância, sessões,
lifetime, UI externa aninhada, carência 0/30/60 e callbacks de cortina já enfileirados.

[Reprodução, evidências e limites do QA](../qa/2026-10-01-bloqueio-transicao/README.md).
A distribuição será registrada no documento da release v1.6.1 depois de conferida.
