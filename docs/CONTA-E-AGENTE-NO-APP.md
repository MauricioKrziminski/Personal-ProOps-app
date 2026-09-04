# Conta própria, saudação e o agente dentro do app

> Plano de execução. Escrito **antes** de começar, a pedido do dono do produto, porque as
> mudanças são grandes e precisam ser feitas e **validadas em pedaços** — não construídas inteiras
> para só então serem testadas.
>
> Status (03/09/2026): Fases 1, 2 e 3 feitas e validadas na branch `feat/conta-e-agente`.
> Cada fase abaixo tem o seu próprio "como validar", e a fase só está pronta quando ela passa —
> não quando o código compila.

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
| `ai_events` **não tem coluna de canal** | types | O limite mensal conta linhas dessa tabela (`plan_status`). Um canal novo **já compartilha a cota** por construção; separar é que daria trabalho. |
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
2. **É o que já acontece.** `plan_status` conta `ai_events`, que não distingue canal. Compartilhar
   é o comportamento atual; separar exigiria coluna, dois contadores e duas mensagens de recusa.
3. **É o que o mercado faz.** O ChatGPT no WhatsApp não tem login próprio: herda conta,
   permissões e limites de quem você já é. Onde há cota por canal (o limite de ~30 mensagens/dia
   do ChatGPT no WhatsApp), ela existe para quem **não tem conta** — o oposto do nosso caso.
4. **O risco de abuso não muda com o canal.** A trava de rajada por hora
   (`max_parses_per_hour`, por `user_id`) já protege o custo independentemente de onde a mensagem
   entrou.

O que **muda**: acrescentar `ai_events.channel` (`whatsapp` | `app`) para **mostrar** onde a cota
foi gasta. Não separa nada — responde "por que já acabou?", que hoje é uma pergunta sem resposta.

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
- Authentication → **Sign In / Providers** (seção CONFIGURATION) → linha do provedor Email:
  **Confirm email ligado** (decisão do dono, 03/09/2026).
- Authentication → **Emails** (seção NOTIFICATIONS) → **Confirm signup** e **Reset password**:
  corpo com `{{ .Token }}` (os arquivos em `supabase/templates/` são exatamente o que colar). O
  padrão da Supabase só tem `{{ .ConfirmationURL }}`, e com ele o e-mail chega SEM o código.

  ⚠️ O menu foi renomeado (conferido no dashboard em 03/09/2026): o que a documentação da Supabase
  ainda chama de "Providers" é **Sign In / Providers**, e "Email Templates" é **Emails**. Se um
  passo daqui não existir com esse nome, é o menu que mudou de novo — procure pela seção, não pelo
  nome exato.
- ⚠️ **Email OTP length = 6.** O padrão do projeto estava em **8** e o `OtpInput` do app tem
  SEIS caixas (`LENGTH = 6` em `otp-input.tsx`, e as três telas checam `length < 6`). Com 8 a
  pessoa recebe um código que não cabe no campo e o cadastro trava sem mensagem de erro.
- Senha mínima: o app exige 8; o dashboard estava em 6. Subir para 8 alinha os dois (o app já é
  o mais estrito, então 6 no servidor não é falha de segurança, é só divergência).
- ⚠️ **SMTP → "Minimum interval per user" = 30s.** O padrão é 60 e o app libera "Reenviar" aos
  **45** (`RESEND_SECONDS`). Com 60 no servidor, o botão aparece habilitado e o reenvio é recusado
  por rate limit. 30 mantém o app como o lado mais restritivo.
- SMTP próprio: o domínio é do **Zoho** (MX `mx.zoho.com`), host `smtp.zoho.com` ou
  `smtppro.zoho.com` conforme o plano, porta 465. A senha tem que ser **app-specific password**
  do Zoho, não a senha da conta. O SPF do domínio já inclui `zohomail.com`.

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

### Fase 4 — Vincular o telefone depois  ·  média

**Fazer**
- Perfil → "Conectar o WhatsApp": pede o telefone e verifica por OTP (o fluxo do OTP já existe,
  muda só a entrada).
- Enquanto não houver telefone, o Perfil explica o que está desligado — e o restante do app
  funciona normalmente.
- Trocar o telefone precisa invalidar a sessão do agente (`user_sessions` é chaveada por
  telefone) para o "sim" de uma confirmação pendente não cair na conversa errada.

**Validar** — conta sem telefone: mandar mensagem daquele número no WhatsApp e **não** ser
reconhecido; vincular; mandar de novo e ser reconhecido; conferir `user_sessions`.

### Fase 5 — O agente dentro do app  ·  grande

O grafo, as tools, os guards, a política de HITL e os prompts são **reaproveitados sem cópia**. O
que muda é a borda.

| Camada | WhatsApp | No app |
|---|---|---|
| Entrada | webhook → `messages_queue` → Cloud Tasks (debounce 3s) | `POST /chat` direto, autenticado pelo JWT (`current_user`, já existe) |
| Quem é o usuário | resolvido pelo telefone | vem do `sub` do JWT — **mais simples e mais seguro** |
| Sessão / thread | `user_sessions`, árbitro em `phone` | precisa de thread por **usuário**, não por telefone — ver abaixo |
| Resposta | `send_text` / `send_interactive` | corpo da resposta HTTP (ou stream) |
| HITL | botões da Meta | os mesmos `pending_actions`, desenhados como botões na tela |
| Mídia | `download_media` da Meta | upload direto |
| Idempotência | `wa_message_id` | id de mensagem gerado pelo cliente |

**A decisão estrutural desta fase** é a sessão. `user_sessions` tem `phone` como árbitro e
`not null`. Dois caminhos:

- **(a)** generalizar a tabela: `phone` nulo permitido, chave passa a ser `(user_id, canal)`;
- **(b)** tabela separada para o app.

Prefiro **(a)**: é a mesma conversa, com a mesma memória — e (b) faria o usuário perder o contexto
ao trocar de canal, que é exatamente o que ele não espera de "a mesma assistente".

**Validar, em etapas** — não construir tudo antes de testar:
1. `POST /chat` respondendo a "gastei 45 no mercado" com o lançamento criado (sem UI, por `curl`);
2. a mesma rota exigindo JWT e recusando o de outro usuário;
3. tela de chat com histórico;
4. HITL: pedir para apagar algo e confirmar pelos botões da tela;
5. **teste cruzado**: começar no WhatsApp, continuar no app, e a conversa saber do que se falava.

### Fase 6 — Cota compartilhada e medidor  ·  pequena

**Fazer**
- `ai_events.channel` (`whatsapp` | `app`), preenchida nos dois caminhos.
- `_check_limits` continua exatamente como está — **é isto que faz a cota ser compartilhada**, e
  não código novo.
- Perfil: a estatística de mensagens de IA passa a mostrar a divisão por canal.
- A mensagem de recusa cita o canal certo ("você usou as N mensagens do plano").

**Validar** — gastar mensagens no app e ver o contador do Perfil subir; estourar a cota no app e
conferir que o **WhatsApp também recusa** (é o teste que prova que a cota é uma só).

---

## 5. O que este plano NÃO faz

Registrado para não virar escopo por engano:

- **Não migra** quem já entra por telefone. Os dois caminhos convivem.
- **Não separa** cota por canal (decisão 3.2), só passa a mostrar a divisão.
- **Não** põe login social (Google/Apple). É outra decisão, com outra fila de trabalho.
- **Não** faz o agente do app falar por voz nem receber áudio na Fase 5 — o STT existe no worker
  e pode entrar depois, sem mexer no grafo.

## 5b. Estado dos dois bancos (03/09/2026)

| ambiente | ref | migration |
|---|---|---|
| produção | `kwriuifcwyvdrxtspjiz` | **0048** |
| staging | `utkqoiigimqzeenxkxdl` | 0051 |

Produção está **três migrations atrás**: `0049` (alertas/pastas, da sessão anterior), `0050`
(nome) e `0051` (conta por e-mail). Promover é decisão do Gabriel — nenhuma delas foi para lá.

## 6. Ordem de execução

1 → 2 → 3 → 4 → 6 → 5.

A Fase 6 vem **antes** da 5 de propósito: `ai_events.channel` e o medidor são o instrumento que
mostra se o agente do app está funcionando e quanto ele custa. Construir o chat sem o medidor é
ficar sem o número justamente na fase em que ele mais importa.
