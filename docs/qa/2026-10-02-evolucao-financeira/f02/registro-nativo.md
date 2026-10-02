# F02 — registro de implementação e validação

Estado: aceite técnico concluído em 02/10/2026; F03 liberado. Branch `gabriel/financas-22-melhorias`.
Backend: somente staging `utkqoiigimqzeenxkxdl`, usuário de teste autenticado nas duas plataformas.

## Contrato implementado

Cadastro contextual de conta/cartão dentro do formulário montado. Campos compartilhados
com Contas; ações no seletor conforme o método e a finalidade do campo. O lançamento
aguarda a conclusão ou cancelamento do cadastro. Salvar bloqueado aparece desabilitado,
sem representar uma gravação que ainda não começou.

O UUID da intenção identifica a criação. Colisão de nome conserva o rascunho e mostra erro;
não adota outra conta pelo nome. Confirmação perdida congela o payload e permite verificar
a mesma intenção. Resultado tardio, campo desmontado ou método incompatível não sobrescrevem
a seleção. Replay lê a entidade atual sob RLS: arquivar, editar ou apagar não provocam
recriação nem regravação do saldo inicial.

[Contrato detalhado](contrato-de-implementacao.md).

## Banco e verificações técnicas

Migration aplicada exclusivamente no staging:
`20261002184102_create_account_idempotency.sql`, SHA-256
`690c46d399bdec8c953b365750474f8399fd1fee4fde882f8d2bbd41b2dc95c1`.
Dry run, aplicação e geração dos tipos concluídos. A migration aplicada é imutável.

SQL de contrato passou por rollback, antes e depois da aplicação: replay, conflito de
payload/operação, unicidade, cartão com inicial zero, dias, limites, pagadora, RLS,
edição/ledger/arquivamento/exclusão entre criação e replay. Concorrência real em duas sessões
confirmou bloqueio da segunda pelo primeiro backend, uma entidade por intenção e rejeição
P0001 de payload diferente. As duas entidades e recibos desse ensaio foram removidos por
UUID exato; zero resíduos confirmado. [Evidência](evidence/concurrency.json).

A fonte final passou com 1.512/1.512 testes; TypeScript e lint exit 0. Agente sem alteração
de código: Ruff exit 0 e pytest 1.219 passes, dois avisos existentes. A revisão completa
do React Doctor incluiu novos arquivos: quatro erros de sintaxe não otimizada pelo React
Compiler foram corrigidos, sem suprimir regras. Controlador do recibo separado do render
e handler de gravação por Promise: 75 testes focados exit 0, incluindo edição bloqueada,
confirmação perdida, resposta inválida, recusa de retry após resultado desconhecido e
ciclo de presença/cancelamento. React Doctor final 86/100, zero erros; 11 avisos de
complexidade dos formulários e um lookup sobre a enumeração fixa de cinco tipos. Não
foi trocada a estrutura dos formulários financeiros fora do necessário para esse cadastro.

Revisão final de replay separou regras de criação e shape atual: a API de edição tipada e
o schema permitem dias de cartão nulos, embora os formulários e o agente exijam os dias.
O acknowledgment não pode congelar a intenção quando a RPC devolve essa edição válida.
RED do hook: uma falha esperada. GREEN: 18 testes de hook/campos, incluindo resposta
perdida e dias nulos ativos/arquivados; campo ausente, string, fração e dia fora de 1–31
continuam recusados. SQL rollback confirmou entidade atual com dias nulos, enquanto criar
cartão novo sem dias continua recusado. Migration aplicada permanece inalterada. Essa
borda foi reproduzida no contrato técnico, sem atribuir reprodução a uma tela disponível.
Suíte final 1.512/1.512, TypeScript/lint exit 0; React Doctor permanece 86/100, zero erros.

## Matriz nativa executada

iOS: iPhone 17 Pro, iOS 26.5, UDID `F0BDF23C-0286-4183-97E3-3BCC61D4267D`.
Android: AVD `tudo_azul_audit_20261002`, API 36/arm64, `emulator-5574`.
Mesmo build development e Metro staging descritos no [registro geral](../README.md).

| Caso | Resultado confirmado |
|---|---|
| iOS: corrente negativa criada dentro do gasto Pix | Conta `60bf2681-7cc0-48c5-b0cd-f4a8b96d3328`, inicial −34.567; gasto `1ddbe90a-d84f-4c93-8a12-237a4a91f05e`, 12.345, Pix, baixado. Saldo −46.912. |
| iOS: cartão criado dentro da compra Crédito | Conta `1788451b-0640-4793-a157-300e0e4f38cb`, inicial zero, limite 500.000, fecha 28/vence 5, pagadora igual à nova corrente. Compra `6187fecd-b511-4bee-9b9b-1bf14eabb77d`, 22.345, fatura 28/10 com vencimento 05/11; disponível 477.655. |
| iOS: cartão sem dias | Criar e usar cartão desabilitado; nenhum cadastro até informar os dias. |
| iOS: cancelar pelo Fechar da tarefa | Fecha apenas o cadastro; origem Nubank e título/45,67 permanecem. Salvar principal desabilitado enquanto o cadastro está aberto. |
| iOS: nome duplicado | Mensagem de unicidade visível, campos conservados e nenhum cadastro adotado pelo nome. Na fonte final, o nome foi corrigido integralmente pelo teclado nativo para QA F02 IOS Correção 20261002; confirmação explícita selecionou a nova conta e conservou título/45,67. |
| iOS: nome longo e fechamento após confirmação | Nome integral digitado e conferido, conta selecionada pelo rótulo completo; texto quebra sem truncar. Título/45,67 preservados; Fechar encerra o lançamento depois do recibo. |
| iOS: recorrente | Uma nova corrente selecionada; série `b1c45ab4-5701-4fe8-8af9-001d2ef67154`, 3.210/Boleto, conta `6d5891ae-1adf-455f-b2d9-daf8c9da30c4`. Mensal dia 2. |
| iOS: financiamento/cancelar | Só criação bancária compatível no seletor. Cancelar conserva origem e formulário; Fechar termina a tarefa. Nenhuma dívida criada. |
| iOS: conta da entrada | Plano `e463e30b-c137-4b59-8ef8-81f66fc7f50b`, 8.002/Boleto em Nubank, três parcelas 2.667/2.667/2.668. Entrada `291241e0-1a67-4ebe-8110-7a130ac1fb66`, 2.000/Débito, conta nova `7365d224-f7ca-4858-b671-833f4f43db36`. Total 10.002, origens independentes. |
| iOS: gesto nativo de fechar com cadastro aberto | Swipe fecha o subfluxo; lançamento, origem, título e 45,67 permanecem. Fechar seguinte encerra a tarefa. |
| iOS: edição de cartão com compra existente | Salvar os campos sem mudança conserva inicial zero, limite 500.000, compra 22.345, saldo −22.345 e disponível 477.655. Comparação antes/depois em `evidence/edit-existing-card.json`. |
| iPhone: escuro e fonte extra-extra-extra-large | Cabeçalho do cadastro, campos, orientação dos dias e bloqueio legíveis; cancelar conserva título/12,34. Tema foi conferido visualmente antes da abertura. Claro e fonte large restaurados. |
| iPad: movimento reduzido e teclado virtual | Preferência OFF → ON confirmada pela árvore nativa, app relançado; campos e ação de criar acessíveis com teclado aberto. Cancelar conserva título/12,34. OFF restaurado e iPad desligado. Estados em `evidence/ipad-reduced-motion.json`. |
| Android: corrente negativa criada dentro do gasto Pix | Conta `8d3b86e2-84d2-4536-b29e-cbc29110c134`, inicial −34.567; gasto `1ac12841-7b57-4d23-89b0-b4981d34da1c`, 12.345/Pix, baixado; saldo −46.912. Primary conferiu captura e leitura. |
| Android: cartão criado dentro da compra Crédito | Conta `fb7740f0-0158-43f4-a73d-6a50b92850a7`, inicial zero, limite 500.000, fecha 28/vence 5. Compra `8593d83c-a6f0-4bb2-b7cd-4904641c73f2`, 22.345; fatura `463e675b-b371-4b04-9fdb-04af44702ce0`, vencimento 05/11, disponível 477.655. Pagadora não informada, escolha permitida. |
| Android: cancelar, Back e nome duplicado | Cancelar cadastro e Back nativo fecham somente o editor; Nubank, título e 323,45 conservados. Nome Nubank com espaço final gera erro de unicidade e conserva campos; cancelar restaura o lançamento. Nenhuma conta desses cancelamentos. |
| Android: offline e retry | Sem conexão, campos ficam bloqueados e Verificar cadastro conserva a intenção. Leitura antes do retry: zero conta/gasto Retry. Online: conta `73ebbff1-0514-4f8e-991c-7e05a97fa425`, inicial zero; gasto `22105f92-92f7-4fec-b518-5824cc8a3589`, 42.345/Pix, saldo −42.345. Exatamente uma entidade de cada tipo. |
| Android: recorrente | Conta nova `0fba6662-d57d-4794-8273-1057ee75260f` selecionada; série `9a753cc7-3dae-4c78-ae32-3ac80ea56649`, 3.210/Boleto, mensal dia 2. Título e valor conservados antes de Criar. |
| Android: conta da entrada | Plano `d4cb7f8e-499b-4aaf-a17e-eadf09913f78`, 8.002/Boleto em Nubank, três parcelas 2.667/2.667/2.668; entrada `8c7345f1-d20e-426f-9181-ad6e28ef684d`, 2.000/Débito, conta nova `59de577c-2a76-4db9-b3ff-fa5e9c98f955`. Total 10.002, origens independentes. |
| Android: financiamento/cancelar | Só cadastro bancário compatível; Salvar bloqueado enquanto aberto. Cancelar conserva origem e financiamento, Fechar termina; nenhuma dívida criada. |
| Android: fonte ampliada/tablet/movimento reduzido | Escuro em 384 dp/fonte 1,3 e 800 dp/fonte 1,0. Campos e instrução dos dias legíveis; cadastro incompleto bloqueado e rascunho conservado ao cancelar. Movimento reduzido testado com app relançado, preferência restaurada. Ação de criar capturada integralmente depois de fechar o teclado nativo, sem cortar o texto em fonte 1,3. Dimensões, densidade, fonte, tema Sistema, handwriting padrão, movimento e conectividade originais restaurados. |
| Fonte final: confirmação e fechamento nas duas plataformas | Cartões `cef4f9e6-7ab8-416e-bc18-e9f17610678d` (iOS) e `876a0efd-0829-4bba-806e-0402d27d76b2` (Android), inicial/limite zero, fecha 31/vence 1. Rótulo completo selecionado, 12,34 conservado; fechamento sem gravar o gasto. Android exit 0. iOS retomado sem novo cadastro: título/valor/seleção conferidos, Fechar do cabeçalho encerrou a tarefa, exit 0. |

Leitura final limitada ao F02: 13 contas, 11 registros principais/parcelas, duas séries,
dois planos e duas entradas; zero taxa/dívida/pagamento de dívida. As contas do smoke final
aparecem uma vez cada e não têm lançamento associado. [Snapshot](evidence/snapshot-final.json).

## Falhas de teste e limites atuais

Interrupções do driver e seletores incorretos não foram contados como passes. No iOS,
a ausência do título Nova conta fora da tela não prova a confirmação: o teste passou a
aguardar o rótulo completo da conta selecionada. O recorrente novo confirma em Criar;
o teste foi retomado sem recriar a conta. Cancelar o cadastro pode deixar a origem acima
da área visível: a prova rolou até o campo. Deep link para o mesmo formulário já aberto
não recomeça o estado; os testes fecham a tarefa anterior primeiro.

No smoke final iOS, o seletor genérico Fechar tocou o botão da mensagem de sucesso,
que compartilha esse rótulo com o cabeçalho. A asserção de saída falhou e não foi contada
como pass. Depois de ler a árvore nativa, a execução retomou a conta já confirmada,
conferiu título/12,34 e fechou pelo cabeçalho; nenhum cadastro foi repetido.

No Android, a configuração temporária de handwriting foi desativada para obter Gboard.
ASCII por tecla estava lento no Maestro; Unicode usa o IME do próprio driver. Nenhum adb
input foi utilizado. Um hideKeyboard com teclado já fechado acionou Back no teste de série;
a tentativa não gravou dados e o comando foi retirado antes de retomar. Dimensões/densidade,
fonte, tema, handwriting e movimento foram restaurados; leitura final em `evidence/android-settings-restored.json`.

O recibo local vive na instância do hook. Cancelar o editor mantém a intenção; fechar a rota
ou encerrar o app não persiste o payload local para retomada. O servidor conserva o recibo
e a unicidade do nome. Este incremento não certifica recuperação automática após encerramento
do processo; esse comportamento não deve ser apresentado como executado.

Offline/retry nativo foi executado no Android; a mesma borda no iOS não foi executada
nativamente. Perda de confirmação e replay nas duas plataformas compartilham o hook
verificado por testes de transporte, SQL e concorrência; esses testes não substituem
uma execução offline do sistema iOS.

O teclado virtual iPhone foi observado durante a correção: campo de nome acima do teclado e cabeçalho acessível; a ação de criar foi alcançada por rolagem após editar. O teste teve de apagar o texto a partir do final: eraseText no cursor intermediário conserva o sufixo, como edição normal. No iPad, a ação de criar também foi capturada integralmente acima do teclado. No Android, o ensaio complementar fecha o teclado pela ação nativa antes de conferir a ação integral: bounds que caem sob o IME não bastam como prova visual.

Capturas de retorno à tela Hoje, fora do caso, permanecem somente no diretório privado de
execução. A documentação reúne os formulários de QA e snapshots limitados às entidades
F02, sem usuário/workspace ou credenciais. O aviso de rede do LogBox aparece em parte das
capturas development após o teste offline; não é tratado como interface da versão release.

Capturas já conferidas e provas complementares ficam em [captures](captures/).
Nenhuma validação em aparelho físico, release ou produção foi executada.

Aceite da primary: contrato, fonte final, códigos de saída, capturas, persistência e
limites conferidos. F03 pode iniciar; publicação permanece fora deste aceite.
