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
A distribuição final será registrada no documento da release v1.6.2 depois de conferida.

## Corrida adicional na restauração da sessão

Na última checagem nativa do iOS, depois da publicação da v1.6.1, uma abertura fria deixou a
cortina em “Confirmando…” mesmo depois de o sistema aceitar a credencial. O diagnóstico
pontual, sem substituir a API nativa, mostrou que a tentativa já estava cancelada antes de
receber o resultado: o efeito do `LockOverlay` iniciou o pedido para a conta restaurada antes
que o efeito de identidade do `LockProvider` processasse a hidratação da sessão. Esse efeito
comparava a conta atual com o valor inicial ainda vazio e invalidava o pedido recém-criado.

O retorno nativo chegou ao JavaScript e o `active` chegou em seguida; a hipótese de falta de
evento ou de Promise nativa não entregue foi descartada nessa reprodução. Os eventos estão em
[hidratacao-antes.json](../qa/2026-10-01-bloqueio-transicao/ios/hidratacao-antes.json).
A v1.6.1 publicada será preservada; esta correção segue em uma nova versão.

A identidade agora pertence à tentativa no instante em que ela começa, e não ao último efeito
de sessão executado. O efeito cancela somente uma tentativa pertencente a outra conta.
O callback de autenticação recebe a identidade atual; uma hidratação com efeito filho antes
do pai continua válida. O teste adicional falhou antes da correção e passou depois; os 81
casos focados e os 1.410 da suíte completa passam. A abertura fria e a saída durante a onda
foram validadas também com a API nativa real do simulador iOS, sem adaptador de sucesso.
