# Ambientes — onde eu estou e como testo em cada um

> Escrito em 07/09/2026, com tudo medido no dia. Este documento responde três perguntas:
> quantos ambientes existem, como se testa em cada um, e o que muda entre eles.

---

## 1. São TRÊS backends. E o app é uma coisa separada.

A confusão não é o número de ambientes — é que **o app e o backend são escolhas independentes**.

| backend | banco | agente | quem aponta para ele |
|---|---|---|---|
| **local** | Supabase em Docker na sua máquina | `docker compose up` em `agent/` | um `.env.local` apontando para `127.0.0.1` |
| **staging** | `utkqoiigimqzeenxkxdl` | `agente-staging` (Cloud Run) | o `.env.local` de hoje, e o perfil `staging` do EAS |
| **produção** | `kwriuifcwyvdrxtspjiz` | `agente` (Cloud Run) | o perfil `distribution`/`production` do EAS |

E o app tem **três identidades** que convivem no mesmo aparelho (`app.config.js`):

| variante | package | nome no ícone |
|---|---|---|
| `development` | `com.proops.personal.dev` | ProOps (dev) |
| `preview` / `staging` | `com.proops.personal.staging` | ProOps (staging) |
| `production` / `distribution` | `com.proops.personal` | Personal ProOps app |

⚠️ **O nome do ícone NÃO diz em qual banco você está.** "ProOps (dev)" segue o `.env.local` da
máquina — que pode apontar para local, staging ou produção. É o par variante × env, não a
variante sozinha.

**Por isso o Perfil tem um selo no rodapé** (`src/lib/environment.ts`): `STAGING`, `LOCAL`, ou o
ref quando é um banco desconhecido. Em produção ele **não aparece** — o selo existe para avisar
quando você não está no lugar de sempre. Ele é derivado do ref do Supabase que o cliente está
usando de verdade, então não tem como discordar do banco.

**Não existe um quarto ambiente.** O que existe além disso são *canais* de EAS Update
(`development`, `preview`, `staging`, `production` no `eas.json`), que decidem qual build recebe
qual atualização OTA — mas todos caem num destes três backends.

---

## 2. Como testar em cada um

### Local — para mexer no schema e no agente sem tocar em nada no ar

```bash
npx supabase start                 # sobe Postgres, Auth, Storage e o Mailpit
npx supabase db reset --local      # ⚠️ ELE PARA NA 0008 — ver abaixo
cd agent && docker compose up      # o agente Python
npx expo start --dev-client        # o app
```

⚠️ **O `db reset` para na `0008`**, que exige dois segredos no Vault. Depois que ele falhar:

```bash
docker exec -i supabase_db_app-proops psql -U postgres -d postgres -c \
  "select vault.create_secret('http://127.0.0.1:54321','project_url'); \
   select vault.create_secret('local-anon-key','anon_key');"
npx supabase migration up --local
```

- **Banco:** o do Docker. Pode apagar, resetar, quebrar.
- **E-mail:** cai no **Mailpit** — `http://127.0.0.1:54324`, ou direto na API
  (`/api/v1/messages`). O código de 6 dígitos aparece ali, nenhum e-mail sai de verdade.
  ⚠️ `SMTP_MAX_FREQUENCY=1s` por endereço: dois envios ao mesmo e-mail em menos de 1s dão 429.
- **Telefone:** `5511999990002` e `5511999990003` aceitam código fixo (`123456` / `654321`),
  declarados em `[auth.sms.test_otp]` do `supabase/config.toml`. Não custa nada e não chama a Meta.
- **No emulador Android** o host não é `127.0.0.1` e sim `10.0.2.2`: ponha
  `EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:54321` + a anon key local no `.env.local` e
  **reinicie o Metro** — env entra no bundle, não é lido em runtime.
- Testes SQL: `docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f - < supabase/tests/<arquivo>.sql`.
- **Selo no Perfil:** `LOCAL`.

É o único ambiente onde dá para testar migration e OTP à vontade.

### Staging — para testar o produto de ponta a ponta

O app aponta para staging pelo `.env.local`, que já é o padrão do repositório.

```bash
npx expo start --dev-client        # dev build, banco de staging
# ou o APK instalável, que convive com o de produção:
npx eas-cli build --platform android --profile staging
```

- **Banco:** `utkqoiigimqzeenxkxdl`. Tem dados de demonstração.
- **Cadastro por e-mail:** **funciona com código de 6 dígitos** — staging aceitou os templates.
- **Login por telefone:** **desligado** (`sms.enable_signup = false`). Nunca foi ligado ali; o
  atalho é o botão *"Entrar como teste (dev)"*, que faz login com senha.
- **Agente:** `agente-staging`, com as rotas `/internal/chat/*` no ar.
- **Selo no Perfil:** `STAGING`.

### Produção — o app de verdade

```bash
npx eas-cli build --platform android --profile distribution   # APK
```

- **Banco:** `kwriuifcwyvdrxtspjiz`. **Zerado em 07/09/2026** — 0 usuários, 0 linhas.
- **Selo no Perfil:** nenhum.
- O que ainda falta para ele ficar testável está na seção 4.

---

## 3. O que muda, na prática

| | local | staging | produção |
|---|---|---|---|
| e-mail de confirmação | Mailpit, código | **código** (6 dígitos) | link em inglês, até ter SMTP |
| remetente | Mailpit | Supabase Auth | Supabase Auth |
| login por telefone | código fixo de teste | **desligado** | ligado (Send SMS Hook) |
| dados | os que você criar | demonstração | vazio |
| migrations | as do repo | `0056` | `0048` |
| custo de um erro | zero | quase zero | é o app de verdade |

⚠️ **WhatsApp só pode ser testado num ambiente por vez.** Produção e staging compartilham o
MESMO número da Meta (`agent/.env` e `agent/.env.production` dividem `WHATSAPP_TOKEN` e
`WHATSAPP_PHONE_NUMBER_ID`). Quem decide para onde a mensagem vai é `agent_routing`, e hoje ela
está **vazia nos dois** — nenhum número roteia para o agente Python. Enquanto não houver um
segundo número, escolha um ambiente por vez.

---

## 4. O que falta para produção ficar testável no celular

Medido em 07/09/2026, nesta ordem:

1. **Migrations `0049`–`0056`.** Produção está na `0048`. Sem elas não existe
   `app_chat_messages` e a aba Agente não tem onde gravar. Runbook completo em
   `docs/PROMOVER-PRODUCAO.md` — inclui pausar a fila do Cloud Tasks e desligar o `pg_cron` legado.

2. **Deploy do agente.** `GET /internal/chat/conversations` em produção devolve **404** hoje: a
   revisão no ar não tem as rotas. Staging devolve 401, que é o certo.

3. **`EXPO_PUBLIC_AGENT_URL` no ambiente `production` do EAS.** Não existe (medido:
   `eas env:list --environment production`). Sem ela a aba Agente diz "não configurado" — o que é
   honesto enquanto o passo 2 não acontecer. Ela entra DEPOIS, senão vira 404 na cara do usuário.

4. **SMTP próprio.** Sem ele o cadastro por e-mail em produção não tem como mostrar o código
   (limite do plano free — ver `CONTA-E-AGENTE-NO-APP.md` §5c). É o que bloqueia criar a primeira
   conta.

5. **Um build novo.** O último build que terminou foi `staging`, de **05/09** — anterior a tudo
   que foi corrigido depois (teclado, corte de texto, mola da tab bar, canal de push, selo de
   ambiente, layout do login). Não existe build de `distribution` bem-sucedido recente.

Os passos 1 a 3 são o corte de produção e andam juntos. O 4 é independente. O 5 vem por último,
sempre.
