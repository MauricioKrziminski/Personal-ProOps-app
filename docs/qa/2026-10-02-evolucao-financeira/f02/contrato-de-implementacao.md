# F02 — Cadastro de origem no contexto

Estado: aceite técnico concluído em 02/10/2026, depois do F01 (`e527c14f`).
Alvo: branch `gabriel/financas-22-melhorias`; staging `utkqoiigimqzeenxkxdl`.

## Experiência e responsabilidades

A ação Criar conta/Criar cartão aparece dentro do seletor de origem, conforme os tipos
compatíveis com o método atual. O cadastro abre inline no mesmo formulário, usando a
rolagem e o mecanismo de teclado existentes. O lançamento permanece montado: título,
valor, categoria, método, datas, entrada e rolagem não são reinicializados. Cancelar fecha
somente o cadastro. Enquanto ele estiver aberto, salvar o lançamento aguarda sua conclusão.
Nenhum Modal dentro de Modal, rota paralela ou segunda versão dos campos.

`AccountFormFields` contém os campos reais extraídos de Contas: nome/tipo, saldo atual e
sinal, ou limite/ciclo/fechamento/rotativo/pagadora. A tela Contas mantém seu Sheet e cabeçalho;
o host contextual controla apresentação, tentativa, resultado e seleção. Tokens, fontes,
Field/SelectField/MoneyField, Presenca/TrocaSuave e botões existentes governam a composição.
O seletor recebe ações, sem tratar uma ação de criação como UUID de conta.

## Domínio e persistência

- `account-form.ts`: inicialização, validação e payload único. Centavos inteiros seguros;
  saldo negativo permitido só em corrente. Editar saldo bancário preserva o ajuste atual
  do inicial pela diferença, sem alterar os lançamentos. Criar cartão grava inicial zero;
  editar cartão conserva o inicial original, sem converter dívida negativa em crédito.
- A unicidade atual de nome por workspace permanece. Nome igual gera erro controlado e
  conserva ambos os rascunhos; não identifica a tentativa nem adota entidade existente.
- `create_account(p_input,p_request_id)`: criação atômica e idempotente; JSON allowlist,
  autor/workspace do servidor, dias 1–31 obrigatórios no cartão, valores seguros, pagadora
  ativa/bancária no mesmo workspace. Edição continua no caminho atual.
- Recibo da intenção usa os helpers F01 sem modificar a migration aplicada. Guarda somente
  o UUID criado. Replay devolve a entidade atual sob RLS, com disponibilidade explícita:
  ativa, arquivada ou indisponível. Não recria apagada, desarquiva ou regrava saldo inicial.
  A leitura aceita dias explicitamente nulos em cartão editado pela API existente; criar
  cartão continua exigindo ambos os dias. Campo ausente ou dia inválido não é confirmação.
- Perda de confirmação conserva UUID e payload original da tentativa. Não gerar nova
  intenção por alteração de nome enquanto o resultado anterior for desconhecido. Campos
  do cadastro ficam bloqueados até verificar a tentativa; erro SQL inicial com rollback conhecido
  libera correção. Depois de qualquer envio sem confirmação, uma recusa SQL no retry não
  prova que o envio anterior não foi gravado: a intenção continua congelada até um recibo válido. Duplo toque não abre nem confirma duas criações.
- Seleção acontece depois da confirmação, somente se o subfluxo ainda estiver ativo e a
  origem continuar compatível com o método/campo atual. Resultado tardio de uma tarefa
  cancelada atualiza consultas, sem sobrescrever o rascunho ou navegar.

## Prova e gates

RED/GREEN de valores fracionários/overflow, cartão sem dias, saldo bancário negativo,
edição de cartão com dívida, callback tardio, alteração de método, erro conhecido versus
confirmação perdida, retry e nova criação deliberada. SQL: replay, payload conflitante,
colisão de nome, ledger alterado entre confirmação/retry, rename/archive/delete,
pagadora e workspace inválidos; concorrência real por duas sessões quando possível.

Depois de typecheck/lint/Node/SQL verdes, aplicar somente a nova migration no staging e
gerar tipos. Executar iOS/Android: criação e seleção de conta/cartão, cancelamento, volta
nativa, teclado, erro de rede/retry, campos preservados, nome longo/igual, cartão sem dias,
saldo negativo e resultado arquivado/incompatível. Conferir UUID único e efeitos
financeiros por leitura. Capturar claro/escuro, fonte ampliada, movimento reduzido e
composição pertinente. F03 só inicia após esse aceite.

Execução, resultados e limites: [registro nativo](registro-nativo.md).
