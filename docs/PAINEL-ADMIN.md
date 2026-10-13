# Painel de admin — onde mora, como se entra, como se opera

Desde 13/10/2026 o painel `/admin` é um **serviço próprio do Cloud Run** (`painel` em produção, `painel-staging`),
com a MESMA imagem do agente e `SERVICO=admin`. O agente público (`agente`, `agente-staging`) sobe com
`SERVICO=agente` e responde 404 em toda rota `/admin*`. Contrato da API: `docs/ADMIN-API.md`.

## Por que assim

O agente precisa ser público (a Meta não manda token), então o painel dentro dele tinha a página de login aberta
para a internet inteira. O padrão para ferramenta interna é a página nem ser alcançável sem antes passar pelo
login da empresa. Três camadas, cada uma sozinha já barra um desconhecido:

1. **IAP (Identity-Aware Proxy)**: o serviço não é público. Sem login Google de um e-mail da política do IAP a
   requisição não chega ao container.
2. **O container confere a assinatura do IAP** (`x-goog-iap-jwt-assertion`, ES256 do Google, `aud` do serviço) e o
   e-mail contra `ADMIN_IAP_EMAILS`. Se o IAP for desligado por engano, o painel continua fechado. No Cloud Run, o
   serviço recusa subir sem essa configuração.
3. **Supabase**: e-mail, senha e TOTP (aal2), e o id em `ADMIN_USER_IDS`. A sessão fica no `sessionStorage`
   (fechou a aba, saiu). Toda ação é auditada.

O painel tem a própria conta de serviço (`painel-runner`, `painel-staging-runner`), que só lê a URL do banco. Ele
não tem as chaves de IA nem do WhatsApp, e o webhook, o worker e os crons não existem nele (404).

## Endereço

| para lembrar | onde o painel está de verdade |
|---|---|
| `https://admin.proops.com.br` | `https://painel-wwm7xruoyq-rj.a.run.app/admin` (produção) |
| `https://admin-staging.proops.com.br` | `https://painel-staging-wwm7xruoyq-rj.a.run.app/admin` |

O nome curto é um **atalho**: o Firebase Hosting responde 302 para o run.app (`scripts/atalho-painel.sh`), e a barra
do navegador termina no endereço do Google. Nada fica entre o navegador e o painel: o login do Google (IAP) e as
três camadas continuam no run.app. Sem custo fixo. DNS no Registro.br: um CNAME por nome (`admin` →
`proops-painel.web.app`, `admin-staging` → `proops-painel-staging.web.app`); `./scripts/atalho-painel.sh status`
diz o que falta e quando o certificado HTTPS ficou ativo.

Por que não o domínio "de verdade" na barra: a região `southamerica-east1` não tem *domain mapping* do Cloud Run, e o
caminho oficial é um load balancer global, com custo fixo mensal, que **não convive com o IAP direto** (o IAP
passaria para o load balancer, e o `aud` conferido mudaria para `/projects/<n>/global/backendServices/<id>`).
Firebase Hosting como PROXY (rewrite) exigiria o serviço público, o que anula o IAP; como redirecionamento, não.

## Primeira vez (uma vez por projeto): o cliente OAuth do IAP

A conta Google do projeto é um Gmail (`gestao.proops@gmail.com`), fora da organização do GCP. O cliente OAuth que o
Google gerencia só atende contas da organização (medido: "Error code 604"). Por isso o IAP precisa de um cliente
próprio, e o Google **não deixa criar cliente OAuth por linha de comando**. No console, logado como
`gestao.proops@gmail.com`, projeto `personal-proops-agent`:

1. **Google Auth Platform → Branding**: nome "ProOps Painel", e-mail de suporte `gestao.proops@gmail.com`.
2. **Audience**: *External*, e deixe em **Testing**. Em **Test users**, adicione SÓ os e-mails de
   `ADMIN_IAP_EMAILS`. Em Testing, só os usuários de teste conseguem autorizar: é mais uma lista fechada.
3. **Clients → Create client → Web application**, nome "IAP painel". Crie, copie o **Client ID**, edite e acrescente
   em *Authorized redirect URIs*:
   `https://iap.googleapis.com/v1/oauth/clientIds/<CLIENT_ID>:handleRedirect`
4. Guarde o **Client secret** no seu gerenciador de senhas (não vai para o repositório nem para o `.env`).

Depois, aplique UMA vez, para a região inteira (os dois painéis herdam; o Google não devolve o segredo, só o hash,
então depois disso o JSON baixado pode ser apagado — se um dia precisar de novo, gere outro segredo no console):

```bash
ARQ="$(ls -t ~/Downloads/client_secret_*.json | head -1)"
export IAP_OAUTH_CLIENT_ID="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["web"]["client_id"])' "$ARQ")"
export IAP_OAUTH_CLIENT_SECRET="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["web"]["client_secret"])' "$ARQ")"
CLOUDSDK_CORE_ACCOUNT=gestao.proops@gmail.com PROOPS_PROD_OK=1 ./scripts/setup-gcp.sh iap-oauth </dev/null
unset IAP_OAUTH_CLIENT_ID IAP_OAUTH_CLIENT_SECRET
rm "$ARQ"
```

A "dica de conta" do IAP (abrir já com o e-mail escolhido) não serve aqui: ela só aceita domínio do Google
Workspace ("Invalid hosted domain" com Gmail). A tela de escolher conta é conforto, não segurança; um perfil do
Chrome só com `gestao.proops@gmail.com` a evita.

## Subir e atualizar

O painel usa a imagem que o agente do mesmo ambiente estiver servindo: rode **depois** do deploy do agente. Depois
de criado, o `deploy`/`staging` do agente já o leva junto para a imagem nova (`acompanhar_painel`), para ele nunca
ficar numa imagem que a retenção do Artifact Registry apagaria.

```bash
CLOUDSDK_CORE_ACCOUNT=gestao.proops@gmail.com ./scripts/setup-gcp.sh painel-staging
CLOUDSDK_CORE_ACCOUNT=gestao.proops@gmail.com PROOPS_PROD_OK=1 ./scripts/setup-gcp.sh painel </dev/null
```

Variáveis lidas do `.env` do ambiente (`agent/.env` no staging, `agent/.env.production` em produção):

| variável | o quê |
|---|---|
| `ADMIN_USER_IDS` | ids (`auth.users.id`) dos admins no Supabase daquele ambiente |
| `ADMIN_IAP_EMAILS` | contas Google que o IAP deixa entrar; o script SINCRONIZA a política (tira quem saiu da lista) |
| `ADMIN_REQUIRE_MFA` | `true` obrigatório em produção (o script recusa sem) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | do projeto Supabase do ambiente (a anon key é pública) |

Tirar alguém: remova o e-mail de `ADMIN_IAP_EMAILS` e o id de `ADMIN_USER_IDS` e rode o subcomando de novo.

## Conta de admin

Use uma conta do Supabase **só para o painel** (um e-mail que você não usa como cliente do app), com TOTP. A conta
de cliente fica com sessão em celular, e um celular perdido não deve carregar poder de admin.

## Contas de serviço por ambiente (13/10/2026)

Antes, staging e produção rodavam com a mesma `agente-runner`, com acesso ao PROJETO inteiro: ler qualquer
segredo, invocar qualquer serviço e enfileirar em qualquer fila. Comprometer o staging era ler a `database-url` de
produção. Hoje:

| conta | alcança |
|---|---|
| `agente-runner` | segredos sem sufixo, a fila `whatsapp-debounce`, invocar `agente` |
| `agente-staging-runner` | segredos `-staging`, `whatsapp-debounce-staging`, invocar `agente-staging`, o job `backup-banco-staging` |
| `painel-runner` / `painel-staging-runner` | só `database-url` / `database-url-staging` |

`restringir_sa` dá as permissões recurso a recurso (os segredos já em `criar_sa`, ANTES do deploy) e, se a conta
ainda tiver os papéis amplos do projeto, espera a propagação do IAM (`IAM_PROPAGACAO_S`, 180 s) antes de tirá-los.
Se outro serviço ou job ainda roda com a mesma conta, ele NÃO tira nada e diz qual — por isso o staging
(`staging` e `backup-staging`) migra antes da produção. No staging, logo depois da permissão na fila, o
`create_task` foi recusado por alguns segundos.
