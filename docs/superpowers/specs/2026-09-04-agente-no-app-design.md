# Agente no app

> Especificação aprovada pelo Gabriel em 04/09/2026. Esta fase cria a quinta aba do app. Ela não
> publica código, não faz deploy e não altera produção.

## Objetivo

O Personal ProOps terá uma aba **Agente** com o fluxo esperado de um chatbot: lista de conversas,
histórico persistente, nova conversa, títulos, renomear e excluir. O app reaproveita o grafo, as
tools, os guards, os prompts, a cota e o HITL do agente Python.

O app e o WhatsApp permanecem isolados:

- o app não mostra mensagens nem memória do WhatsApp;
- o WhatsApp não recebe contexto das conversas do app;
- cada conversa do app possui sua própria memória;
- os dois canais consomem a mesma cota do workspace, com medição separada por canal.

## Decisões aprovadas

1. **Quinta aba:** o agente entra como destino principal, ao lado de Hoje, Notas, Financeiro e
   Perfil.
2. **Várias conversas:** a pessoa pode criar, consultar, renomear e excluir chats.
3. **Isolamento por canal:** o WhatsApp mantém a sessão própria; conversas do app não atravessam
   essa fronteira.
4. **Um motor:** os canais usam o mesmo grafo e as mesmas regras de execução. A borda informa a
   identidade, o canal e a sessão.
5. **Contexto limitado:** o app envia até 10 turnos recentes ao prompt. O WhatsApp passa de 3 para
   5 turnos. O código também aplica um orçamento de tamanho para evitar prompts sem limite.
6. **Histórico completo no app:** o limite do prompt não apaga mensagens da interface.
7. **Texto no app:** áudio, imagem e PDF ficam para outra fase da aba Agente. O áudio, as imagens e
   os PDFs que o WhatsApp já processa continuam funcionando.
8. **Resposta final:** a primeira versão mostra `Pensando...` e persiste a resposta pronta. Ela não
   transmite tokens parciais.

## Arquitetura

### Sessões

`public.user_sessions` passa a representar sessões dos dois canais sem misturar seus conteúdos.
A migration acrescenta um ID UUID estável e a coluna `channel`, com `whatsapp` para as linhas
existentes.

Uma sessão de WhatsApp exige telefone. Uma sessão do app exige `user_id` e `workspace_id`, deixa o
telefone nulo e recebe um `thread_id` aleatório criado pelo servidor. O banco aceita várias sessões
do app para o mesmo usuário e workspace. O app não gira `session_epoch` por inatividade: a conversa
continua quando a pessoa volta. O WhatsApp preserva a rotação atual.

`pending_actions` e `draft_actions` passam a referenciar o ID estável da sessão. As colunas de
telefone continuam disponíveis para o WhatsApp, mas ficam nulas no app. O serviço busca pendências
e rascunhos pelo ID da sessão nos dois canais. Essa mudança reaproveita o mesmo HITL sem criar uma
cópia para o app.

A chave de idempotência das tools deixa de carregar semântica exclusiva de WhatsApp. O WhatsApp
usa o ID da Meta; o app usa `app:<uuid gerado pelo cliente>`. Os dois formatos alimentam a mesma
reserva por ação.

### Mensagens do app

Uma tabela de infraestrutura guarda apenas mensagens do app. Ela contém:

- sessão e ordem monotônica;
- papel `user` ou `assistant`;
- conteúdo textual;
- payload estruturado de botões ou listas;
- referência da resposta à mensagem do usuário;
- estado `processing`, `completed` ou `failed`;
- código de erro seguro e datas de criação e conclusão.

O banco habilita RLS e não concede acesso ao cliente. O FastAPI lista e altera as conversas após
validar o JWT e a propriedade. O app nunca recebe telefone, checkpoint ou estado interno do grafo.

### Contexto do prompt

A borda monta `prompt_history` antes de chamar o grafo:

- app: até 10 pares usuário/assistente, com orçamento inicial de 12.000 caracteres;
- WhatsApp: até 5 pares, preservados no checkpoint, com orçamento inicial de 8.000 caracteres.

O corte remove primeiro as mensagens mais antigas e nunca divide uma mensagem no meio. O histórico
persistido do app permanece inteiro. Esta fase não cria resumo por IA: um resumo impreciso poderia
alterar a referência a um valor, conta ou lançamento.

### Exclusão

Excluir uma conversa remove, na mesma operação controlada pelo backend:

- mensagens do app;
- pendências e rascunhos;
- lease de processamento;
- checkpoints daquela thread;
- a sessão.

Uma confirmação recebida depois da exclusão retorna como expirada e não executa a tool.

## API

O app usa o access token da sessão Supabase no header `Authorization: Bearer`.

| Método | Rota | Uso |
|---|---|---|
| `GET` | `/internal/chat/conversations` | Lista paginada por cursor |
| `POST` | `/internal/chat/conversations` | Cria a conversa com a primeira mensagem |
| `PATCH` | `/internal/chat/conversations/{id}` | Renomeia |
| `DELETE` | `/internal/chat/conversations/{id}` | Exclui conversa e estado |
| `GET` | `/internal/chat/conversations/{id}/messages` | Carrega histórico paginado |
| `POST` | `/internal/chat/conversations/{id}/messages` | Envia texto |
| `POST` | `/internal/chat/conversations/{id}/actions/{pending_id}` | Confirma, cancela ou escolhe |

O backend valida assinatura ES256, emissor, audiência e expiração do JWT. Ele extrai `user_id` do
`sub`, deriva o workspace no servidor ao criar a conversa e confere a participação a cada turno.
As rotas não aceitam `user_id` nem `workspace_id` no corpo.

Uma busca combina ID da conversa, usuário autenticado e `channel = 'app'`. IDs de outra pessoa,
de outro canal ou de workspace sem participação retornam 404. A resposta não revela qual condição
falhou.

O cliente envia texto com até 4.000 caracteres e um UUID. Na rota de criação, a primeira mensagem
faz parte do mesmo pedido; o servidor não cria conversa vazia. O UUID também deduplica essa criação:
se a resposta HTTP se perder, repetir o pedido encontra a conversa que já nasceu.

Um retry com o mesmo UUID segue o estado da mensagem existente:

- `completed`: devolve a resposta persistida;
- `processing`: devolve o processamento em curso;
- `failed`: permite nova tentativa sem repetir uma ação concluída.

O app renova a sessão uma vez após 401. Um segundo 401 leva ao login. A configuração usa
`EXPO_PUBLIC_AGENT_URL`; nenhuma chave privilegiada entra no bundle.

## Concorrência e falhas

Cada sessão possui um lease de turno com ID e vencimento. Um update atômico adquire o lease antes
do grafo. Um segundo envio com ID diferente recebe 409 enquanto a conversa processa. O composer
fica bloqueado nesse intervalo, mas o servidor mantém a proteção para dois aparelhos.

O serviço libera o lease ao concluir ou falhar. Se o processo morrer, o vencimento permite retry.
As reservas de execução impedem que o retry duplique lançamento, exclusão, pagamento ou outra
mutação.

O backend persiste a mensagem do usuário antes do grafo e a resposta antes de responder ao HTTP.
Uma queda de rede depois da conclusão não perde a resposta. O retry consulta o registro pronto.

O app não reenvia instruções financeiras em background ao recuperar internet. Ele mantém a
mensagem com estado de erro e mostra **Tentar novamente**. Erros enviados ao cliente usam códigos
estáveis; SQL, prompts e stack traces ficam nos logs do serviço.

## Interface

### Navegação

A rota da quinta aba usa uma pilha própria:

```text
src/app/(tabs)/agent/_layout.tsx
src/app/(tabs)/agent/index.tsx
src/app/(tabs)/agent/new.tsx
src/app/(tabs)/agent/[id].tsx
```

A raiz mostra a lista de conversas. A ação **Nova conversa** abre `new` sem gravar uma linha vazia.
O primeiro envio chama `POST /internal/chat/conversations` com o texto e seu UUID; a resposta cria a
sessão e substitui a rota pelo ID real. Abrir uma linha empurra `[id]`.

O app adiciona **Agente** às três implementações da tab bar. iOS mantém `NativeTabs` e Liquid
Glass. Android mantém o `CurvedTabBar`; o cálculo passa a distribuir cinco posições. Web recebe o
mesmo destino.

### Lista de conversas

O header segue o padrão das raízes do app. Cada linha mostra título, trecho da última mensagem e
horário. A lista ordena por atividade recente, usa cursor e virtualização. O menu contextual oferece
**Renomear** e **Excluir**; exclusão passa pelo helper de confirmação destrutiva.

O título inicial usa a primeira linha da mensagem, normalizada e limitada a 48 caracteres. A pessoa
pode escolher outro título, com limite de 80 caracteres.

O estado vazio usa a marca e exemplos acionáveis:

- “Quanto gastei este mês?”
- “Registre R$ 45 no mercado”
- “O que vence esta semana?”

### Conversa

O Stack nativo mostra o título e um menu para renomear ou excluir. Mensagens do usuário ficam à
direita; respostas do agente ficam à esquerda. Respostas comuns usam texto e espaço, sem transformar
cada item em card. O renderer preserva quebras de linha, permite seleção e suporta conteúdo longo.

O histórico carrega páginas anteriores ao chegar ao topo. Uma resposta nova acompanha o fim apenas
se a pessoa já estiver perto dele. Caso contrário, um botão leva à mensagem mais recente.

O composer fica acima da área segura e acompanha o teclado. O campo cresce até cinco linhas. O
botão de envio exige texto. Durante o turno, a tela mostra **Pensando...** com semântica de progresso
e mantém o layout estável.

Falhas aparecem na mensagem que falhou, com **Tentar novamente**. Loading inicial usa skeleton no
formato das linhas. A tela cobre estado vazio, erro de histórico e paginação sem esconder mensagens
já carregadas.

### HITL

O renderer converte o payload do agente em botões nativos. A resposta mostra o resumo congelado e
oferece **Confirmar**, **Cancelar** ou os candidatos válidos. A ação envia `pending_id` e a escolha;
o backend confirma que a pendência pertence à conversa e continua aberta.

Depois da decisão, os controles ficam desativados e mostram o resultado. Clique repetido, pendência
de outra conversa e confirmação expirada não retomam o grafo.

### Sistema visual e acessibilidade

A aba usa os tokens atuais, Hanken Grotesk, JetBrains Mono para dados e o accent verde nas ações.
Ela não introduz hex, `fontSize`, emoji de chrome ou uma segunda família visual. A regra de design
que cita quatro raízes passa a citar cinco.

Os botões possuem área mínima de 44 pontos e rótulo acessível. A tela respeita Dynamic Type,
Reduce Motion, VoiceOver e TalkBack. Claro e escuro recebem validação separada.

## Cota e auditoria

O serviço parametriza o canal ao registrar `ai_events`. Turnos do app gravam `channel = 'app'` e
o WhatsApp mantém `channel = 'whatsapp'`. Ambos usam o `workspace_id` congelado na sessão e consultam
o mesmo `plan_status`.

O limite por hora continua por usuário. A cota mensal continua por workspace. Esgotar a cota em um
canal bloqueia o outro e leva o app ao paywall.

## Testes

O trabalho seguirá ciclos RED, GREEN e REFACTOR.

### Banco

- preservar e classificar as sessões atuais como WhatsApp;
- permitir várias conversas do app por usuário;
- rejeitar sessão de WhatsApp sem telefone e sessão do app sem dono ou workspace;
- migrar pendências e rascunhos sem perder os registros existentes;
- apagar em cascata apenas o estado da conversa escolhida;
- manter tabelas de infraestrutura inacessíveis a `anon` e `authenticated`.

### Backend e grafo

- exigir JWT válido e validar emissor;
- esconder conversas de outro usuário, workspace ou canal;
- deduplicar o mesmo UUID antes e depois da resposta;
- bloquear dois envios concorrentes e recuperar lease vencido;
- provar ausência de memória entre dois chats do app;
- provar ausência de memória entre app e WhatsApp;
- carregar 10 turnos no app e 5 no WhatsApp, respeitando o orçamento;
- executar e recusar cada caminho do HITL;
- manter o áudio do WhatsApp: download, transcrição e entrada no grafo;
- registrar consumo no canal correto e aplicar a cota compartilhada.

### App

- listar, paginar, criar, renomear e excluir;
- abrir uma conversa vazia sem persistir até o primeiro envio;
- manter mensagem após falha e repetir com o mesmo UUID;
- bloquear envio vazio e concorrente;
- renderizar texto, botões, escolhas e estados resolvidos;
- preservar scroll ao receber resposta e carregar mensagens antigas;
- validar teclado, safe areas, conteúdo longo e Dynamic Type.

### Gates

- testes SQL transacionais no Supabase local;
- testes Python do agente;
- testes Node do app;
- `npx tsc --noEmit`;
- `npx expo lint`;
- lint do schema;
- export Android;
- inspeção em 402x874, Android e iOS, claro e escuro.

## Ordem de implementação

1. Migration e testes de sessão.
2. Núcleo de conversa independente da borda do WhatsApp.
3. Rotas de conversa e testes adversariais.
4. Histórico, idempotência, lease e HITL.
5. Hooks e cliente HTTP do app.
6. Quinta aba, lista e conversa.
7. Gates e validação local.
8. Migration no staging após `scripts/supabase-target.sh` e dry-run.

O trabalho não fará deploy do Cloud Run, não publicará o app, não enviará commits e não tocará
produção sem autorizações próprias.

## Fora desta fase

- áudio, voz, imagem ou PDF dentro do app;
- streaming parcial de tokens;
- memória ou histórico compartilhado com o WhatsApp;
- resumo de conversa gerado por IA;
- busca global dentro dos chats;
- exportar ou compartilhar conversa;
- mudança de cobrança ou de limites dos planos.
