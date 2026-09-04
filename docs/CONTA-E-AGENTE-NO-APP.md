# Conta própria, saudação e o agente dentro do app

> Plano de execução. Escrito **antes** de começar, a pedido do dono do produto, porque as
> mudanças são grandes e precisam ser feitas e **validadas em pedaços** — não construídas inteiras
> para só então serem testadas.
>
> Status (03/09/2026): Fases 1, 2 e 3 feitas e validadas na branch `feat/conta-e-agente`.
> Cada fase abaixo tem o seu próprio "como validar", e a fase só está pronta quando ela passa —
> não quando o código compila.
>
> Status (04/09/2026): Fase 7 implementada e publicada. A validação no aparelho físico foi
> adiada pelo Gabriel até todas as fases e deploys estarem prontos; ela continua explicitamente
> pendente, não presumida.
>
> Status (04/09/2026): Fase 4 implementada, validada ponta a ponta contra o Auth local e com a
> migration `0053` aplicada no staging. O teste com OTP/WhatsApp real e aparelho físico continua
> pendente; produção não foi alterada.
>
> Status (04/09/2026): Fase 5 implementada, provada ponta a ponta contra o Postgres local (webhook
> com HMAC real e fluxo autenticado no emulador Android) e com as migrations `0055`/`0056`
> aplicadas no staging. Falta deploy do Cloud Run, aparelho físico e iOS. Produção continua na
> `0048`.

---

## 1. O que foi pedido

1. **Nome do usuário na tela Hoje**, como saudação, abaixo do header.
2. **Login com e-mail e senha**, coletando o nome. O **telefone vira opcional**; quem não
   informar pode preencher depois no Perfil para liberar o agente no WhatsApp.
3. **Header**: como o nome não vai mais para lá, decidir se a palavra "ProOps" continua ao lado
   da marca — olhando o que apps do ramo fazem hoje.
4. **O agente do WhatsApp dentro do app**: mesma arquitetura, mesma lógica, adaptado. Reaproveitar
   tudo o que já existe.
5. **Limite de conversa** com o agente: decidir se a cota do WhatsApp e a do app são a mesma.

---

## 2. O que o código já determina (as travas)

Levantado antes de decidir qualquer coisa. Cada linha aqui muda o custo de alguma fase.

| Fato | Onde | Por que importa |
|---|---|---|
| `profiles.phone` é `text unique not null` | `0001_init.sql:12` | Telefone opcional exige migration. `unique` aceita vários `NULL` no Postgres, então **tirar o `not null` basta** — não precisa de índice parcial. |
| `handle_new_user` grava `coalesce(new.phone, '')` | ⚠️ a definição VIVA é a `0029_subscriptions_and_invites.sql:218-262`, **não** a `0001_init.sql:33` — a função foi redefinida duas vezes, e `create or replace` sobre o corpo errado apagaria o que a 0029 acrescentou | ⚠️ **Bug latente.** Cadastro por e-mail tem `new.phone` nulo → grava `''`. O **segundo** cadastro por e-mail colide no `unique` e o signup falha com 23505. Tem que ser corrigido na MESMA migration que abre o e-mail, senão o app quebra no segundo usuário. |
| `profiles` não tem nome | types | Saudação e Perfil precisam de `display_name`. |
| O agente acha o usuário por `profiles.phone = any(...)` | `agent/app/db.py:176` | Quem não tem telefone simplesmente não é alcançável pelo WhatsApp — o comportamento correto, sem código novo. |
| `user_sessions` tem **árbitro em `phone`** | `agent/app/db.py:133-147` | A sessão do agente é chaveada por telefone. Uma conversa no app **não tem telefone** — é a maior adaptação da Fase 5. |
| `thread_id` sai do telefone canônico | `.claude/rules/whatsapp.md` | Idem. O app precisa da própria regra de thread. |
| `ai_events` não tinha canal nem workspace | migrations até `0053` | A Fase 6 precisou congelar os dois. Só `user_id` dupla-contava o mesmo membro em espaços diferentes. |
| `current_user` (JWT → `sub`) já existe | `agent/app/routes/internal.py:51` | É o padrão pronto para uma rota do agente chamada pelo app. Não precisa inventar autenticação. |
| "Auth: Supabase Auth **Phone OTP**" está listado como **decisão imutável** | `CLAUDE.md` | Esta mudança altera uma decisão marcada como imutável. Precisa ser reescrita lá, com a data e o motivo — senão a próxima sessão "corrige" de volta. |

---

## 3. As duas decisões que dependiam de pesquisa

### 3.1 Header: manter a marca, **tirar a palavra**

Recomendação: o quadradinho com a espiral fica; **"ProOps" sai**.

- O princípio que a literatura de design fintech repete é **não duplicar a identidade** dentro da
  mesma chrome. Hoje o header tem o símbolo *e* a palavra a 8px um do outro: duas afirmações da
  mesma coisa gastando a faixa mais nobre da tela.
- Saudação personalizada no home é o padrão recomendado para engajamento — e é exatamente o que
  a Fase 1 coloca logo abaixo. Com a saudação ali, a palavra vira redundância dupla: o app já se
  identifica pelo símbolo e já identifica *você* pelo nome.
- O símbolo sozinho é suficiente porque ele é o mesmo da splash e do ícone — a pessoa acabou de
  tocá-lo para abrir o app.

Fica assim: `[◫] ............ [ação] [avatar]` — e o peso do topo passa a ser da saudação.

### 3.2 Limite: **uma cota só**, com medidor por canal

Recomendação: **compartilhada**. O contador é do workspace, não do canal.

Motivos, em ordem de força:

1. **É uma assistente só.** O usuário não pensa "gastei 12 no WhatsApp e 4 no app" — ele pensa
   "usei 16". Cota por canal cria a pergunta "estou gastando no lugar errado?", que é trabalho
   que o produto empurra para o usuário sem lhe dar nada em troca.
2. **Já era uma cota única.** `plan_status` sempre contou linhas de `ai_events`; a `0054` só passou
   a atribuir corretamente workspace e canal, sem criar limites separados.
3. **É o que o mercado faz.** O ChatGPT no WhatsApp não tem login próprio: herda conta,
   permissões e limites de quem você já é. Onde há cota por canal (o limite de ~30 mensagens/dia
   do ChatGPT no WhatsApp), ela existe para quem **não tem conta** — o oposto do nosso caso.
4. **O risco de abuso não muda com o canal.** A trava de rajada por hora
   (`max_parses_per_hour`, por `user_id`) já protege o custo independentemente de onde a mensagem
   entrou.

O que **mudou**: `ai_events.channel` (`whatsapp` | `app`) agora mostra onde a cota foi gasta, e
`workspace_id` impede dupla contagem entre espaços. Não separa nada — responde "por que já
acabou?" sem alterar o teto compartilhado.

---

## 4. As fases

Ordem escolhida para que **cada fase seja utilizável sozinha** e nenhuma dependa da seguinte para
fazer sentido. Da menor para a maior.

### Fase 1 — Nome e saudação  ·  pequena  ·  ✅ FEITA E VALIDADA (03/09/2026)

Migration `0050`. `greetingBR` mora em `src/lib/dates.ts` com teste de fronteira; a saudação lê o
PRIMEIRO nome. Validada no emulador Android (preencher, salvar, ver na Hoje) e no simulador iOS
(leitura), nos temas claro e escuro.

**Fazer**
- Migration: `profiles.display_name text`.
- `useProfile` / mutation para ler e gravar.
- Hoje: saudação acima do painel — "Bom dia, Gabriel" (hora local do aparelho).
- Perfil: campo editável, e o card de identidade passa a mostrar o nome com o telefone abaixo.
- Sem nome preenchido, a saudação some por inteiro (não vira "Bom dia, ").

**Validar** — abrir a Hoje sem nome (nenhuma saudação), preencher no Perfil, voltar à Hoje e ver
o nome; conferir a virada de manhã/tarde/noite mudando o relógio do aparelho.

### Fase 2 — Header sem a palavra  ·  pequena  ·  ✅ FEITA E VALIDADA (03/09/2026)

A palavra e o token `Type.wordmark` saíram (o token não tinha outro uso). Validada nas raízes Hoje,
Notas e Financeiro, no claro e no escuro, nas duas plataformas.

`.claude/rules/design.md` §8 foi reescrita junto (a regra descrevia a palavra e o token).

**Fazer** — tirar `ProOps` e o `Type.wordmark` do `AppHeader`; ajustar o espaçamento à esquerda.

**Validar** — as quatro raízes no claro e no escuro; conferir que nada mais usa `Type.wordmark`
(se ninguém usar, o token sai junto).

### Fase 3 — Conta por e-mail e senha  ·  **a maior, e a de maior risco**  ·  ✅ FEITA (03/09/2026)

Migration `0051` aplicada no **staging** (trigger copiado da 0029, `phone` anulável, check em
`display_name`). Telas: `login` (e-mail e senha), `signup`, `forgot-password`, `login-whatsapp`
(a tela de OTP antiga, inteira), moldura `AuthScreen`. Validado **contra o Supabase LOCAL com
Mailpit**, sem tocar em produção: cadastro sem telefone, SEGUNDO cadastro sem telefone (o caso do
23505), e-mail repetido, recuperação de senha ponta a ponta com o código, senha antiga recusada
(`supabase/tests/profiles_email_signup.sql` + roteiro em Node). No emulador Android, claro e
escuro: cadastro → código → Hoje já com "Boa noite, Dev"; recuperação → código → dentro do app com
a senha nova.

**Duas decisões tomadas na execução, diferentes do texto abaixo:**
1. **Sem campo de telefone no cadastro.** `profiles.phone` é a chave pela qual o agente entrega o
   WhatsApp de alguém. Número NÃO verificado no cadastro = qualquer pessoa digita o SEU número e
   recebe os seus lançamentos — e ainda colide no `unique` com quem já tem o número. Telefone só
   entra pelo OTP do Perfil (Fase 4).
2. **Confirmação e recuperação por CÓDIGO (`verifyOtp` + `{{ .Token }}`), não por link.** Link
   exigiria deep link, allow-list de redirect e tratamento de URL; código reaproveita o
   `OtpInput`. Na recuperação a senha nova é pedida ANTES do código, porque `verifyOtp` já
   devolve sessão e o portão desmonta a tela (ver `frontend.md`).

⚠️ **Pré-requisitos no dashboard, sem os quais as telas não funcionam — não dá para fazer pelo
CLI. Fazer primeiro no STAGING (`utkqoiigimqzeenxkxdl`) e de novo em produção quando promover:**
- **Confirm email** fica em Authentication → Sign In / Providers, na seção **User Signups** da
  página principal — NÃO dentro do painel do provedor Email, que é onde a documentação da Supabase
  manda procurar. Já vem ligado.
  A forma de conferir sem caçar menu: `GET /auth/v1/settings` (público, só precisa da anon key)
  devolve `mailer_autoconfirm: false` quando a confirmação está exigida.
- Authentication → **Emails** (seção NOTIFICATIONS) → **Confirm signup** e **Reset password**:
  corpo com `{{ .Token }}` (os arquivos em `supabase/templates/` são exatamente o que colar). O
  padrão da Supabase só tem `{{ .ConfirmationURL }}`, e com ele o e-mail chega SEM o código.

  ⚠️ O menu foi renomeado (conferido no dashboard em 03/09/2026): o que a documentação da Supabase
  ainda chama de "Providers" é **Sign In / Providers**, e "Email Templates" é **Emails**. Se um
  passo daqui não existir com esse nome, é o menu que mudou de novo — procure pela seção, não pelo
  nome exato.
- ⚠️ **Email OTP length = 6** (feito no staging em 03/09/2026). O padrão do projeto era **8** e o
  `OtpInput` do app tem SEIS caixas (`LENGTH = 6` em `otp-input.tsx`, e as três telas checam
  `length < 6`). Com 8 a pessoa recebe um código que não cabe no campo e o cadastro trava sem
  mensagem de erro. **Ao promover para produção, este ajuste tem que ser refeito lá** — é
  configuração de projeto, não migration, então não viaja com o `db push`.
- Senha mínima: o app exige 8; o dashboard estava em 6. Subir para 8 alinha os dois (o app já é
  o mais estrito, então 6 no servidor não é falha de segurança, é só divergência).
- ⚠️ **SMTP → "Minimum interval per user" = 30s.** O padrão é 60 e o app libera "Reenviar" aos
  **45** (`RESEND_SECONDS`). Com 60 no servidor, o botão aparece habilitado e o reenvio é recusado
  por rate limit. 30 mantém o app como o lado mais restritivo.
- SMTP próprio: o domínio é do **Zoho** (MX `mx.zoho.com`). Endereço de domínio próprio conta
  como conta de organização, então o host é **`smtppro.zoho.com`** na porta 465, não o
  `smtp.zoho.com` (esse é para `@zoho.com`). Os dois respondem, o que torna o erro difícil de
  diagnosticar: falha de autenticação com host errado parece senha errada.
  A senha tem que ser **app-specific password** (accounts.zoho.com → Security → App passwords),
  nunca a senha da conta.
  ⚠️ **O usuário do SMTP tem que ser o MESMO endereço do remetente.** O Zoho exige que o From
  case com a conta autenticada ou um alias dela. `noreply@proops.com.br` existe como USUÁRIO
  separado (não alias de `gestao@`), então autenticar como `gestao@` e enviar como `noreply@`
  é recusado. Autentique como `noreply@`.
  ⚠️ **O host depende do PLANO, não do formato do endereço.** A doc do Zoho tabela por endereço
  ("Organization/Paid Accounts (you@yourdomain.com) → smtppro"), e isso induz ao erro: o plano
  GRATUITO também aceita domínio próprio, e nele o host é **`smtp.zoho.com`**. Foi o caso aqui
  (03/09/2026): com `smtppro` a autenticação falhava, e com `smtp` funcionou de primeira.
  Registrado também que o gratuito **dá SMTP** — só IMAP/POP é que são pagos.

  **DNS do domínio, verificado em 03/09/2026 — nada a fazer:** SPF inclui `zohomail.com`; DKIM já
  publicado no seletor `zoho._domainkey.proops.com.br` (RSA 1024, registro íntegro); DMARC em
  `p=none` com relatório para `gestao@`. O DNS mora no **Registro.br** (`a.sec.dns.br`), que é
  onde qualquer registro novo teria que entrar. DKIM em 2048 bits seria um degrau melhor que o
  1024 atual, mas não é bloqueio.

#### ⚠️ SMTP que falha NÃO dá erro — cai no remetente da Supabase (03/09/2026)

O e-mail chegava do remetente padrão (`noreply@mail.app.supabase.io`) mesmo com o custom SMTP
salvo e correto na tela. **Causa: host errado** (`smtppro.zoho.com` numa conta do plano gratuito,
que usa `smtp.zoho.com`).

O que torna isso caro de diagnosticar: **a Supabase não devolve erro quando o SMTP customizado
falha — ela envia pelo servidor dela.** O cadastro funciona, o e-mail chega, o template novo
aparece certinho, e o único sinal é o endereço do remetente. Quem não olhar o "de:" conclui que
está tudo certo.

⚠️ **Registro de um diagnóstico ERRADO, para não se repetir:** a hipótese inicial foi um incidente
aberto na Supabase naquela hora ("Project Lifecycle Actions", que desabilita configuration
changes), porque o template pegava e a config não. A hipótese era coerente e era falsa — trocar o
host aplicou na hora. **Incidente concomitante não é causa.** O teste que teria matado a dúvida em
um minuto: mudar UM campo da config e ver se o efeito aparece.

Achado do revisor para a Fase 4: `agent/app/jobs/alerts.py:39-46` reserva a vaga de dedupe do
dia em `alerts_sent` com canal `whatsapp` quando não há push, e depois pula se `phone` é nulo —
a vaga é consumida sem envio. Já acontecia com `''`; agora todo usuário de e-mail sem push cai
aí diariamente.

**Fazer**
- Migration, tudo junto porque um sem o outro quebra:
  - `alter table profiles alter column phone drop not null;`
  - **corrigir `handle_new_user`** para gravar `new.phone` sem o `coalesce(...,'')` — senão o
    segundo cadastro por e-mail colide no `unique`;
  - garantir que `display_name` também é preenchido no signup (metadata do Supabase);
  - `check (display_name is null or btrim(display_name) <> '')` — a Fase 1 já grava `null` para
    campo vazio, mas a partir da Fase 3 quem escreve o nome é o TRIGGER, com metadata que pode vir
    `''`. A trava tem que existir antes do primeiro escritor que não é a tela do Perfil;
  - `comment on column public.profiles.display_name`.
- Tela de cadastro: nome, e-mail, senha (+ confirmação), telefone **opcional**.
- Tela de login: e-mail e senha, com "esqueci minha senha".
- Manter o **Phone OTP funcionando** durante a transição: quem já tem conta por telefone continua
  entrando. Nada de migração forçada.
- `docs/` e `CLAUDE.md`: reescrever a decisão "Auth: Phone OTP".

**Validar** — e no pé da letra, porque aqui o erro é irreversível para o usuário:
1. cadastrar com e-mail **sem** telefone;
2. cadastrar um **segundo** usuário sem telefone (é o caso que quebra hoje);
3. entrar com uma conta antiga, de telefone, e ver os dados intactos;
4. recuperar senha ponta a ponta;
5. conferir no banco que `profiles` tem `phone` nulo e `display_name` preenchido.

> ⚠️ Fase 3 mexe em `auth` e em trigger. **`utkqoiigimqzeenxkxdl` é o STAGING**, não produção —
> esta linha dizia o contrário e induziu ao erro. Produção é `kwriuifcwyvdrxtspjiz`. Confirme com
> `scripts/supabase-target.sh` antes de qualquer `db push`.

#### O que da Fase 3 ficou EM ABERTO (03/09/2026)

- **Recuperação de senha no aparelho, com e-mail real.** Validada localmente com Mailpit; no
  staging só o cadastro foi até o fim.
- **iOS não viu nenhuma das quatro telas de conta.** O simulador não tem toque e sair da conta lá
  custaria a sessão. A moldura é a mesma da tela de WhatsApp, que já rodava no iOS.
- **Segundo cadastro por e-mail no staging.** O caso do 23505 está provado no Postgres local
  (`supabase/tests/profiles_email_signup.sql`), não contra o staging.
- ✅ **O cartão do Perfil não mente mais** (03/09/2026). Ele mostrava selo verde de verificado e
  "conectado ao WhatsApp" com o telefone em "—" para quem entrou por e-mail. Agora o selo só
  aparece com telefone verificado (que só entra por Phone OTP, na sessão), a linha diz "WhatsApp
  não conectado" em cinza, e o "—" saiu. Cinza e não `danger`: não ter WhatsApp é estado normal
  de conta de e-mail, não é erro.

### Fase 4 — Vincular o telefone depois · CÓDIGO PRONTO, SCHEMA EM STAGING (04/09/2026)

**Comportamento implementado:**

- Perfil → **Conectar o WhatsApp** abre um fluxo autenticado de telefone + OTP; quem já tem
  número vê **Trocar número do WhatsApp** e o telefone atual.
- O pedido usa `updateUser({ phone })` e a confirmação usa `verifyOtp` com
  `type: 'phone_change'`. `signInWithOtp` não é usado aqui, pois ele entraria ou criaria outra
  conta em vez de vincular a sessão aberta.
- `profiles.phone` e `whatsapp_verified` só mudam depois de o Auth gravar o telefone confirmado.
  Digitar um número, sozinho, não concede identidade do WhatsApp.
- A migration `0053_phone_link.sql` impede duas tentativas de `phone_change` ativas para o mesmo
  número. A tentativa abandonada deixa de reservar o alvo depois da janela de uma hora do OTP.
- Ao trocar o telefone, sessões do agente, confirmações, rascunhos, mensagens ainda em fila e
  checkpoints/epochs da conversa aposentada são removidos. Um "sim" antigo não pode executar no
  novo vínculo, e um telefone reciclado não herda memória de outra pessoa.
- A resposta da confirmação ainda é conferida no cliente: ID e telefone precisam pertencer à
  mesma sessão; qualquer divergência encerra a sessão local.
- O Supabase local tem dois números/OTPs fixos exclusivamente para teste. Eles não chamam a Meta
  nem a Twilio. No Expo Web, botões em carregamento usam o indicador do sistema porque o CanvasKit
  do Skia não inicializa nesse bundle; Android/iOS preservam a animação da marca.

**Evidência até aqui:**

- teste SQL transacional cobre login Phone OTP legado, privilégios dos triggers, conflito entre
  duas contas, liberação de tentativa vencida, sincronização e limpeza integral da conversa;
- Auth local real: conta de e-mail pediu o primeiro número, confirmou o OTP, trocou para o segundo
  e permaneceu com o mesmo `user.id`; outro ensaio provou que a segunda conta é bloqueada enquanto
  a primeira ainda consegue confirmar;
- fluxo da interface executado em 402×874: tela inicial, máscara, estado de código, OTP e tela de
  troca. Depois da confirmação, `auth.users.phone`, `profiles.phone` e
  `profiles.whatsapp_verified=true` foram conferidos; a conta descartável foi apagada;
- `0053` aplicada no staging `utkqoiigimqzeenxkxdl`; o histórico remoto vai até `0053` e os tipos
  gerados do staging são idênticos a `src/lib/database.types.ts`;
- 159 testes Node, 323 testes Python, TypeScript, Expo lint e lint do schema passaram. O único
  aviso do schema é o anterior em `create_installment_plan`.

**Ainda pendente:** instalar/abrir o app em aparelho físico, receber o OTP pelo template real da
Meta, provar que o número não é reconhecido antes do vínculo e passa a ser depois, trocar para
outro número e conferir `user_sessions` no ambiente remoto. Promover `0049`–`0053` para produção
exige uma decisão separada.

### Fase 5 — O agente dentro do app · CÓDIGO PRONTO, SCHEMA EM STAGING (04/09/2026)

A especificação aprovada está em
[`docs/superpowers/specs/2026-09-04-agente-no-app-design.md`](superpowers/specs/2026-09-04-agente-no-app-design.md)
e o plano de execução, com as onze tarefas, em
[`docs/superpowers/plans/2026-09-04-agente-no-app.md`](superpowers/plans/2026-09-04-agente-no-app.md).

O agente é a quinta aba, entre Financeiro e Perfil. Cada conversa do app tem sessão e memória
próprias; o app não vê o WhatsApp e o WhatsApp não vê o app. O que é compartilhado é o motor —
grafo, tools, guards, prompts — e a cota.

#### Implementado e provado localmente

- **O motor virou canal-neutro.** `agent/app/conversation.py` é o motor; `worker.py` ficou sendo o
  adaptador do WhatsApp (fila, mídia, Groq) e `app_chat.py` o do app. `run_turn` recebe o
  `prompt_history` já cortado pela borda — 10 turnos no app, 5 no WhatsApp —, e o `messages` do
  estado passou a ser vetor de SUBSTITUIÇÃO. Havia duas janelas escondidas (um reducer de 6
  mensagens dentro do grafo e um `history[-6:]` no prompt) que tornariam os 10 turnos do app
  inalcançáveis, em silêncio.
- **Schema por sessão, em expand/contract.** `0055` generaliza `user_sessions`, `pending_actions` e
  `draft_actions` para dois canais e cria `app_chat_messages`; `0056` faz o contract e renomeia
  `executed_actions.wa_message_id` para `source_message_id`. A ordem é `0055` → deploy → `0056`, e
  `supabase/tests/app_agent_chat_expand.sql` roda as queries do agente ANTERIOR contra o schema
  novo — é ele que prova que a janela entre as duas é segura.
- **API autenticada** (`agent/app/routes/chat.py`) com JWT ES256 pelo JWKS do Supabase, issuer,
  audience e `exp`/`iss`/`aud`/`sub` obrigatórios. O serviço ignora RLS, então toda leitura confere
  canal, `deleting_at` **e membership atual** no workspace — um membro removido para de ler e de
  escrever na mesma hora.
- **Serialização por lease** (300s) e idempotência pelo UUID do cliente (`app:<uuid>`). Um turno
  que rodou e não conseguiu gravar é RECUPERADO do checkpoint em vez de reexecutado; as tools não
  rodam duas vezes.
- **App:** quinta aba com lista, preview da última mensagem, nova conversa, renomear, excluir,
  histórico paginado, `Pensando…`, retry manual com o MESMO UUID e HITL com botões nativos.
- **Provas automatizadas:** 464 testes Python e 213 Node. `test_app_whatsapp_isolation.py` usa um
  dublê de grafo **com memória por thread** e foi verificado por mutação — três mutações diferentes
  (thread compartilhado entre conversas, app herdando o thread do WhatsApp, motor ignorando o
  histórico da borda) quebram os testes.
- **Ponta a ponta com HMAC real** contra o Postgres local: `registre R$ 45 no mercado` gravou o
  lançamento; `gastei 1500 reais num notebook` criou EXATAMENTE uma pendência e nenhum lançamento;
  o clique `pa:<id>:ok` retomou o mesmo thread, executou uma vez e não cobrou mensagem da cota.
- **Conferido no emulador Android** (claro e escuro), no fluxo autenticado contra o Supabase local:
  criar pela primeira mensagem com `router.replace`, `Pensando…`, resposta, título automático,
  renomear, HITL respondido virando "Confirmado", isolamento entre conversas e o medidor do Perfil
  mostrando **2 WhatsApp + 4 no app** na mesma cota.

Quatro defeitos reais saíram dessa conferência e estão corrigidos: o `paddingTop` do header contado
duas vezes na lista, a marcação `*negrito*` do WhatsApp aparecendo como asterisco no app, o sheet de
renomear sem o cabeçalho e a calha do padrão da casa, e duas asserções SQL que contavam a tabela
inteira e falhavam em banco com dado real.

#### Schema aplicado no staging

`0055` e `0056` aplicadas em `utkqoiigimqzeenxkxdl` em 04/09/2026. O histórico remoto do staging
termina em **0056** e os tipos gerados de lá estão em `src/lib/database.types.ts`. O CLI nunca saiu
do staging: o `--dry-run` e o `push` listaram só essas duas migrations.

⚠️ **O `agente-staging` fica inerte até um deploy do Cloud Run.** A `0056` é o contract e quebra a
revisão antiga de propósito. Gabriel aceitou isso explicitamente — staging é ambiente de teste. Em
produção a ordem tem de ser respeitada: `0055`, deploy, e só então `0056`.

#### Ainda pendente

- **Deploy do Cloud Run** com a revisão nova (sem ele o agente remoto não conhece o schema);
- **`EXPO_PUBLIC_AGENT_URL` e `APP_CORS_ORIGINS`** configurados nos ambientes;
- **app publicado** e testado em **aparelho físico**, com o teclado real — o emulador não
  redimensiona a janela em edge-to-edge e a tela de Notas, que é anterior a esta fase, tem o mesmo
  comportamento, então o ponto não pôde ser decidido ali;
- **iOS**: a conferência visual foi feita no Android; falta o simulador;
- **cota real entre canais** em produção e o paywall abrindo pelo app;
- **produção**: `0049`–`0056` continuam sendo decisão separada do Gabriel.

### Fase 6 — Cota compartilhada e medidor · CÓDIGO PRONTO, SCHEMA EM STAGING (04/09/2026)

**Implementado:**

- `ai_events.channel` aceita somente `whatsapp` ou `app`; os dois escritores atuais registram
  explicitamente `whatsapp`, e a Fase 5 terá de registrar `app`.
- `ai_events.workspace_id` congela qual cota consumiu a chamada. A ideia inicial de juntar
  eventos por `user_id` estava errada para família: todo membro também tem workspace próprio, e o
  mesmo uso podia aparecer nos dois espaços.
- eventos históricos foram classificados como WhatsApp e associados ao workspace padrão que era
  possível reconstruir; antes da `0054` não existia informação para inferir outro espaço.
- `plan_status` devolve total, WhatsApp e app numa única leitura. A RPC visível ao usuário escolhe
  o workspace pelo próprio JWT e só então lê o agregado como `security definer`; `_plan_status`
  continua restrita ao backend.
- o terceiro número do Perfil preserva total/limite e mostra duas linhas: uso no WhatsApp e uso no
  app. Até a Fase 5 existir, o segundo valor permanece zero.

**Evidência até aqui:** o teste SQL cria dois usuários, coloca um deles também no workspace do
outro e grava eventos nos dois espaços. O agregado retorna 2 (1 WhatsApp + 1 app) no compartilhado
e 1 no workspace próprio, sem dupla contagem. Ele também recusa canal inválido, canal ausente e
evento ativo sem workspace. Os testes Python e de contrato verificam os dois escritores. A
migration `0054` está no staging `utkqoiigimqzeenxkxdl`, e os tipos gerados de lá são idênticos ao
arquivo versionado.

**Ainda pendente:** conferir o novo rótulo do Perfil em aparelho físico; depois da Fase 5, gastar
mensagens pelo app, ver o contador `app` subir e estourar a cota por um canal para confirmar que o
outro também recusa. O código do Python e da Edge Function legada ainda depende de deploy para
gravar as novas colunas no ambiente remoto.

---

### Fase 7 — Distribuir e atualizar fora da loja · concluída (04/09/2026)

**O prazo manda no cronograma.** A verificação de desenvolvedor do Android passa a valer no
**Brasil em 30/09/2026**: app de desenvolvedor não verificado deixa de instalar em aparelho
certificado. A conta gratuita de distribuição limitada resolve — **apps ilimitados, até 20
dispositivos** — e `com.proops.personal` precisa ser registrado lá antes da data.

#### São DOIS mecanismos, e confundi-los é o erro comum

| muda o quê | como atualiza | passa pela loja? |
|---|---|---|
| só JavaScript (a maioria) | `expo-updates` + EAS Update | não |
| código nativo, dependência, permissão | APK novo | não, se for por fora |

O `expo-updates` foi instalado junto com o restante do suporte nativo antes do primeiro APK. O
canal e a branch `production` estão ativos no EAS; mudanças JavaScript compatíveis com o runtime
podem seguir por OTA. Só o que mexe em nativo precisa do fluxo de APK abaixo.

#### O fluxo de APK

Arquitetura validada em produção noutro app Android e portada para cá **sem reaproveitar código**
(aquele é Kotlin nativo; aqui é Expo). O que se leva é o desenho:

1. **Manifesto estático como asset de release**, num repositório público separado só para
   distribuição. O app lê sempre a MESMA url — `releases/latest/download/update.json` — e o
   manifesto aponta a url versionada do APK.
   ⚠️ **Não usar a API do GitHub**: ela tem cota por IP e derrubaria vários aparelhos atrás do
   mesmo NAT. O caminho `latest/download` sai pelo CDN, sem cota e sem autenticação — e por isso
   o repositório de distribuição **precisa ser público**, mesmo com o fonte privado.
2. **Manifesto** com `versionCode`, `versionName`, `url`, `sha256` e notas. Parse validado
   (recusar HTML é caso de teste real: um 404 devolve página, não JSON) e corpo limitado, para um
   endpoint errado não servir um corpo gigante.
3. **CI no push de tag** `v*`: testes, build, **verificar a assinatura do APK**, calcular o
   sha256, gerar o manifesto, validar que é JSON e publicar os dois.
4. **No app:** baixar em streaming calculando o sha256 no mesmo laço, apagar o parcial em falha,
   e instalar por `FileProvider` + intent. O sha256 protege contra download truncado, **não**
   contra adulteração: quem garante autenticidade é a assinatura, porque o Android só instala por
   cima se a chave for a mesma.
5. **Comparação por `versionCode` inteiro, estritamente maior.** Igual é o que já está instalado;
   menor o Android recusa sozinho.

#### O que o port precisa que o original não precisava

- `expo-updates`, `expo-intent-launcher` e `expo-application` (todos existem no SDK 57);
  `expo-file-system` já está instalado.
- Um **config plugin** para o `FileProvider` e a permissão `REQUEST_INSTALL_PACKAGES` — em Expo
  managed não há `AndroidManifest.xml` para editar à mão.
- `versionCode` vindo do **`autoIncrement` do EAS** (`appVersionSource: remote`, já configurado) e
  não de contagem de commits, que quebra ao lançar de branch antiga.

#### Duas melhorias sobre o original, apontadas pelo próprio levantamento

- **Verificar sozinho.** Lá a checagem só acontece se alguém abrir Configurações e tocar, então um
  aparelho pode ficar meses parado. Aqui a checagem entra no foreground do app.
- **Mostrar as notas da versão.** O campo existe no manifesto e nunca é exibido.

#### iOS fica de fora

Este fluxo é Android. No iOS não existe instalar APK: teste em aparelho é TestFlight, e é por lá
que as quatro telas de conta finalmente serão vistas no iOS.

#### Evidência da execução

- Projeto `@solutions.proops/app-ProOps`, ID
  `8313579c-3979-4ecd-ba6a-4dc0bf702f05`; pacote `com.proops.personal` registrado no Android
  Developer Console com a mesma chave usada pelo EAS.
- Build Android `a3b78e54-741c-4ace-8b81-f0b3f0c21774`: versão `1.0.0`, `versionCode 2`, runtime
  `45fe29691e4bf3768c1902730ff93c5a444b13e5`.
- Release pública `v1.0.0` em `almeidagabriel01/Personal-ProOps-app-releases`, contendo somente o
  APK e o manifesto. O APK publicado foi baixado de volta e teve pacote, versão, assinatura e
  SHA-256 conferidos.
- EAS Update Android publicado por último no canal/branch `production`: grupo
  `b7c6b563-66ab-444d-978d-2d4e77d6a04b`, update
  `01a06ce9-4bd2-7e96-9393-0de8ad931831`, com runtime idêntico ao binário.
- O run `33876944826` do GitHub Actions passou typecheck, lint e testes, mas atingiu o timeout de
  90 minutos depois de esperar cerca de 68 minutos na fila da Expo. A build EAS continuou e foi
  concluída; a primeira release foi terminada de forma manual e verificada. O pipeline agora usa
  timeout de 180 minutos.
- O manifesto do APK é inspecionado por `aapt2 dump badging`: o `apkanalyzer` usado localmente
  gerou um erro SAX em metadado válido do Expo SDK 57. O parser substituto tem testes próprios.
- Validação automatizada e emulador concluídos. Instalação, permissão de fontes desconhecidas e
  atualização no aparelho físico continuam pendentes pela decisão explícita do Gabriel de testar
  tudo junto no fim.

---

### Fase 8 — Canais dos avisos proativos automáticos · CÓDIGO/SCHEMA PRONTOS, TEMPLATE APROVADO (04/09/2026)

Código e schema estão implementados; a liberação remota dos canais ainda não está concluída.
O template Utility foi aprovado na WABA de teste. App, Cloud Run, secrets e Edge Function ainda
não foram publicados/configurados com esta fase porque esses deploys exigem autorização separada.

**Decisão do Gabriel:** avisos inferidos pelo sistema — por exemplo saldo projetado negativo,
orçamento estourando, fatura/conta vencendo e fim de teste — não podem interromper o usuário sem
um controle visível para ativar e desativar esse comportamento.

Eles são diferentes dos lembretes que a própria pessoa criou em `public.reminders`. A mensagem
observada, “Saldo vai ficar negativo”, era um aviso proativo, mas usava a frase “Você pediu para
ser lembrado disso”; essa frase é incorreta quando foi o sistema que decidiu avisar.

**Comportamento implementado:**

- oferecer duas preferências independentes no Perfil: **avisos financeiros por push** e **avisos
  financeiros pelo WhatsApp**;
- aceitar os quatro estados: somente push, somente WhatsApp, ambos ou nenhum. Com os dois canais
  desligados, nenhum aviso automático pode sair;
- iniciar os dois canais desligados para perfis atuais e novos. Cada pessoa escolhe os canais no
  app antes de receber avisos automáticos;
- tratar `expo_push_token` como capacidade do aparelho, não como preferência de alertas.
  Desligar avisos financeiros por push não pode apagar o token nem interromper um lembrete pessoal
  configurado para push;
- quando os dois canais estiverem ligados, entregar o mesmo aviso nos dois e registrar o canal
  real em `alerts_sent`;
- a preferência precisa ser respeitada no produtor/cron, antes de criar ou enviar a mensagem;
- desligar avisos automáticos não pode apagar nem impedir lembretes pessoais criados pelo usuário;
- os avisos pelo WhatsApp precisam usar um template Utility próprio, configurado por
  `WA_ALERT_TEMPLATE`, como `personal_proops_alert`. Nunca reutilizar `WA_REMINDER_TEMPLATE`, pois
  ele afirma que a pessoa pediu o lembrete;
- criar e aprovar o novo template na Meta antes de liberar a chave do WhatsApp no app.

**Escopo técnico entregue:** a migration `0052_alert_channels.sql` mantém o booleano antigo apenas
para compatibilidade com o APK `v1.0.0` e adiciona as duas preferências. `_alerts_to_send()`, os
emissores Deno/Python, o Perfil e o histórico usam os canais explícitos. Os tipos de alerta, o
cron e os lembretes pessoais em `public.reminders` foram preservados.

**Evidência até aqui:**

- `0052` aplicada no local e no staging `utkqoiigimqzeenxkxdl`; produção permaneceu em `0048`;
- teste SQL transacional cobre defaults desligados, os quatro estados, capacidade ausente e
  dedupe independente por canal;
- testes Python cobrem ambos, nenhum, canal sem capacidade, falha independente, ausência de
  histórico fantasma e teto de quatro alertas lógicos;
- histórico combina push + WhatsApp numa única linha visível, sem misturar workspaces;
- tipos gerados diretamente do staging são idênticos a `src/lib/database.types.ts`;
- template `personal_proops_alert`, ID `1052311597692142`, submetido como `UTILITY`/`pt_BR` na WABA
  de teste `1280843510763871`; status confirmado depois na Graph API: `APPROVED`.

**Ainda pendente:** configurar `WA_ALERT_TEMPLATE`, fazer o deploy do Python no Cloud Run de
staging e da Edge Function legada onde ainda for necessária, publicar o app e testar os quatro
estados em aparelho, duas entregas com “ambos” e regressão de lembrete pessoal. Produção exige
pedido explícito separado.

**Validar ponta a ponta:** testar os quatro estados de canal; confirmar que nenhum aviso sai com
ambos desligados; confirmar duas entregas com ambos ligados; verificar o texto do template real no
WhatsApp; criar um lembrete pessoal e confirmar que ele continua chegando pelo canal escolhido.

### Decisão de produto — teste grátis pela oferta introdutória da loja · aprovada (04/09/2026)

O plano gratuito permanente será substituído, em uma fase própria de cobrança, por uma oferta
introdutória de 7 dias da App Store / Play Store: a pessoa assina no dia zero, não é cobrada nos
sete primeiros dias e passa a ser cobrada no oitavo se não cancelar. O Gabriel escolheu esse
modelo depois de comparar com o teste sem cartão. A decisão está registrada; **nenhuma regra de
cobrança foi implementada na Fase 7**.

Razão da escolha: o teste sem cartão reduz a barreira para começar, mas exige uma nova decisão de
compra no final e permite repetir o período com outras contas. A oferta da loja começa com menos
pessoas, porém tende a converter melhor e vincula o teste à elegibilidade controlada pela loja,
o que reduz abuso de custos recorrentes de Gemini, Cloud Run e WhatsApp.

## 5. O que este plano NÃO faz

Registrado para não virar escopo por engano:

- **Não migra** quem já entra por telefone. Os dois caminhos convivem.
- **Não separa** cota por canal (decisão 3.2), só passa a mostrar a divisão.
- **Não** põe login social (Google/Apple). É outra decisão, com outra fila de trabalho.
- **Não** faz o agente **do app** falar por voz nem receber áudio na Fase 5. O WhatsApp já baixa o
  áudio e o transcreve com Groq; esse caminho continua e ganha teste de regressão.

## 5b. Estado dos dois bancos (04/09/2026)

| ambiente | ref | migration |
|---|---|---|
| produção | `kwriuifcwyvdrxtspjiz` | **0048** |
| staging | `utkqoiigimqzeenxkxdl` | 0054 |

Produção está **seis migrations atrás**: `0049` (alertas/pastas), `0050` (nome), `0051` (conta
por e-mail), `0052` (canais dos avisos), `0053` (vínculo verificado de telefone) e `0054` (consumo
de IA por workspace/canal). Promover é decisão do Gabriel — nenhuma delas foi para lá.

## 6. Ordem de execução

1 → 2 → 3 → 4 → 6 → 5. As Fases 1–4 e 6 já foram executadas; a próxima desta sequência é a Fase 5.

A Fase 6 veio **antes** da 5 de propósito: `ai_events.channel` e o medidor são o instrumento que
mostra se o agente do app está funcionando e quanto ele custa. Construir o chat sem o medidor é
ficar sem o número justamente na fase em que ele mais importa.

A Fase 8 fica fora desta sequência e já foi implementada antes da Fase 4 por ser uma correção de
consentimento. O template foi aprovado; faltam os deploys autorizados e a validação remota.
