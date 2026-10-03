# F06 — diagnóstico e correção versionada do Router

Durante QA Android houve um aviso intermitente de atualização de estado antes da montagem,
com ContextNavigator/ExpoRoot e dispatchSetState na pilha. O baseline F05 não mostrou o
aviso nos reinícios ensaiados; isso não elimina uma corrida de tempo. Os módulos reais
instalados confirmaram que a Promise inicial chama o setter durante render sem portão
de commit. A mesma causa está descrita no [issue oficial Expo49378](https://github.com/expo/expo/issues/49378).
Não há prova de corrupção financeira, crash ou autoria da falha no código F06.

Patch estreito para expo-router57.0.22 em dois arquivos build: guarda a última URL
até o commit, descarta callbacks após desmontagem, mantém o alvo protegido quando
difere da rota atual e invalida bookkeeping inicial obsoleto após link mais novo.
Comparação de caminho inclui query exata; não normaliza, remove parâmetros, desliga
links ou suprime LogBox. A resolução original do estado de navegação permanece.

Persistência: patch-package8.0.1 fixo, patch genuíno versionado e postinstall com
guard de versão + --error-on-fail. Duas aplicações passaram, inclusive em fixture
limpa, com bytes idênticos. Versão57.0.23 e fonte incompatível57.0.22 falharam
explicitamente em fixtures isoladas. Doze dependências novas de ferramenta; nenhuma
versão anterior mudou. Nenhuma mudança de SDK/RN/binário.

Teste reexecutável src/lib/expo-router-linking.test.cjs carrega código real com
lifecycle controlado: RED8falhas/8controles; GREEN16/16. Abrange abandono, unmount,
StrictMode, web/iOS síncronos, Android assíncrono, parâmetros, múltiplos links,
onReady/onStateChange antes do flush e retenção de destino protegido. É harness
VM; não substitui renderer Fabric ou login real.

Bundle Android servido pelo Metro conferido com ambos os marcadores do patch.
iOS frio/quente passou com títulos, categorias e formatos distintos, sem gravar.
Android quente passou nas três criações com parâmetros financeiros conferidos no
banco e sem o aviso. Primeira abertura fria ficou no splash aos30s; log nativo
registrou conexão tardia ao ExpoCLI. Reteste frio final: stopApp → link direto da lista
Variável AND Essencial + categoria QA, linha exata e exclusões conferidas. Link quente
seguinte Não informado AND Não essencial mostrou gasto NULL, retry e primeira parcela
prevista, excluindo as linhas anteriores. Exit0 proops-f06-android-links-final-green.log;
sem aviso visível em novo runtime. O primeiro roteiro quente usou por engano o token
inexistente unknown: a validação rejeitou corretamente; corrigido para not_informed.
Não foi ensaiado logout/login protegido nativo nem build release.

Diagnóstico separado de resize do AVD: o primeiro roteiro recebeu link quente enquanto
um formulário de série já existia. Log SINGLE_TASK/result code3 e captura mostraram
aquele formulário original, não uma abertura fria incorreta. MainActivity/RN podem conservar
o Intent inicial, e o formulário mantém seu rascunho quando a mesma rota muda parâmetros.
Nenhuma mudança nativa foi feita a partir dessa evidência. Preparação corrigida para
conferir a superfície de Finanças antes de abrir um rascunho novo com título único.
Não há expo-dev-client/dev-launcher instalado no package tree; não atribuir esse caso
a um launcher que não foi comprovado.

Remoção/migração quando o upstream corrigir: patches/README.md. Não relaxar guard
nem transportar silenciosamente o patch para outra versão.
