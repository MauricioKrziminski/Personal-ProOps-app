# Handoff — Fase 7: distribuir fora da loja e atualizar dentro do app

> Escrito em 03/09/2026 para quem for continuar (outra sessão, outra ferramenta). É
> **auto-contido**: não depende de nenhuma conversa anterior. Leia inteiro antes de escrever
> código — a ordem das tarefas importa mais que o conteúdo delas, e a seção 4 explica por quê.

---

## 0. Antes de qualquer coisa

**Leia `CLAUDE.md` e todos os `.claude/rules/*.md`.** São obrigatórios e este projeto os leva a
sério. Os que mais pesam aqui: `workflow.md` (portões antes de commitar), `frontend.md` (a decisão
de plataforma mora no primitivo, nunca na tela) e `design.md`.

**Antes de usar qualquer API do Expo, leia a doc VERSIONADA:**
`https://docs.expo.dev/versions/v57.0.0/`. O `AGENTS.md` manda isso e o motivo é real — o Expo
mudou muito e memória de modelo erra aqui.

### Os dois bancos, que já causaram erro duas vezes

| ref | nome no dashboard | o que é |
|---|---|---|
| `kwriuifcwyvdrxtspjiz` | Personal ProOps app | **PRODUÇÃO** — migration **0048** |
| `utkqoiigimqzeenxkxdl` | Personal ProOps app - staging | staging — migration 0051, é o do `.env.local` |

Rode `scripts/supabase-target.sh` antes de qualquer escrita. Um hook `PreToolUse` já bloqueia
`db push` em produção; escrever lá é **pedido explícito do Gabriel**, nunca consequência de tarefa.

Produção está **três migrations atrás** (falta 0049, 0050, 0051) e a configuração do dashboard
(OTP de 6 dígitos, SMTP, templates de e-mail) **não viaja com as migrations** — tem que ser
refeita lá quando promover.

### Estado do git

Branch `feat/conta-e-agente`, ~18 commits, **não empurrada**. Commits em uma linha, conventional,
**sem co-autor**.

---

## 1. O que já está pronto (não refazer)

- **Fase 1** — `profiles.display_name` (migration 0050), saudação na Hoje, campo no Perfil.
- **Fase 2** — a palavra "ProOps" e o token `Type.wordmark` saíram do header.
- **Fase 3** — conta por e-mail e senha (migration 0051). Telas `login`, `signup`,
  `forgot-password`, `login-whatsapp`, moldura `AuthScreen`. Confirmação e recuperação por
  **código de 6 dígitos** (`verifyOtp`), nunca por link. SMTP próprio via Zoho já funcionando no
  staging. Cadastro validado ponta a ponta em aparelho.
- Correções recentes: barra de abas do Android com o conteúdo seguindo a posição e não a rota;
  cartão do Perfil que não afirma mais "conectado ao WhatsApp" sem telefone; conteúdo que não
  termina embaixo do botão flutuante.

### Pendências abertas (precisam de aparelho ou do dono)

1. Recuperação de senha com e-mail real (validada só localmente, com Mailpit).
2. As quatro telas de conta **nunca foram vistas no iOS** — o simulador não tem toque. Isso se
   resolve sozinho quando houver TestFlight.
3. Segundo cadastro por e-mail no staging (o caso do 23505 está provado no Postgres local).

---

## 2. O prazo que manda no cronograma

A **verificação de desenvolvedor do Android** passa a valer no **Brasil em 30/09/2026**: app de
desenvolvedor não verificado deixa de instalar em aparelho certificado.

O Gabriel tem conta gratuita de distribuição limitada no Android Developer Console: **apps
ilimitados, até 20 dispositivos autorizados**. O pacote `com.proops.personal` **ainda não está
registrado lá** e precisa estar antes da data.

---

## 3. O objetivo desta fase

Instalar o app no celular do dono e **atualizá-lo depois sem passar pela loja e sem mandar
arquivo à mão**. São dois mecanismos, e tratá-los como um é o erro comum:

| o que mudou | como atualiza | precisa de APK novo? |
|---|---|---|
| só JavaScript (a maioria esmagadora) | `expo-updates` + EAS Update | **não** |
| código nativo, dependência, permissão, ícone | build novo | sim |

O `eas.json` **já tem os canais** (`development` / `preview` / `production`), mas `expo-updates`
nunca foi instalado — eles estão inertes hoje.

---

## 4. ⚠️ A ordem, que é a parte que não pode errar

O pedido foi o **fluxo ideal**, não o mais fácil primeiro. Ideal aqui significa uma coisa
concreta: **tudo que toca o lado nativo entra ANTES do primeiro APK distribuído.**

Motivo: `expo-updates`, `expo-intent-launcher`, `expo-application`, a permissão de instalação e o
`FileProvider` são código nativo. Se o primeiro APK sair sem eles, não existe atualização pelo ar
para consertar isso — seria preciso mandar um APK novo à mão, que é exatamente o que a fase
existe para eliminar. Fazer "o mais fácil primeiro" aqui custa o problema inteiro de novo.

### Ordem

1. **Dependências nativas e config plugin.** `expo-updates`, `expo-intent-launcher`,
   `expo-application` (`expo-file-system` já está instalado). Um config plugin para declarar a
   permissão `REQUEST_INSTALL_PACKAGES` e o `FileProvider` — em Expo managed não existe
   `AndroidManifest.xml` para editar à mão.
2. **Keystore.** Gerar UMA vez, guardar backup **fora do repositório**, `*.jks` no `.gitignore`.
   Esta é a decisão irreversível da fase: APK assinado com chave diferente **não atualiza por
   cima**, o sistema exige desinstalar, e desinstalar apaga os dados locais.
3. **Registrar `com.proops.personal`** no Android Developer Console (prazo da seção 2).
4. **Repositório público de distribuição.** Separado, público de propósito, e o porquê está na
   seção 5.
5. **CI que builda e publica no push de tag.**
6. **O atualizador dentro do app.**
7. **EAS Update ligado nos canais**, por último, porque depende do binário do passo 1 já estar em
   campo.

---

## 5. O desenho do fluxo de APK

Arquitetura já validada em produção noutro app Android e portada para cá. **Não há código a
reaproveitar** — aquele projeto é Kotlin nativo e este é Expo. O que se leva é o desenho.

### O manifesto e as duas URLs

| papel | forma da URL | estabilidade |
|---|---|---|
| ponteiro que o app consulta | `.../releases/latest/download/update.json` | **nunca muda** |
| artefato apontado por ele | `.../releases/download/v<X.Y.Z>/<app>-<X.Y.Z>.apk` | versionada |

```json
{
  "versionCode": 123,
  "versionName": "1.2.0",
  "url": "https://.../releases/download/v1.2.0/....apk",
  "sha256": "<64 hex>",
  "notes": "texto livre"
}
```

⚠️ **Não use a API do GitHub para descobrir a versão.** Ela tem cota por IP e vários aparelhos
atrás do mesmo NAT derrubariam a checagem para todos. O caminho `latest/download` sai pelo CDN,
sem cota e sem autenticação — e é por isso que o repositório de distribuição **precisa ser
público**, mesmo com o fonte privado.

⚠️ O redirect do `latest/download` tem cache de borda de ~100 s. Logo depois de publicar, o
aparelho ainda pode ver o manifesto anterior por alguns minutos. Aceitável quando a checagem é
manual; se a checagem virar automática, saiba disso antes de caçar fantasma.

### Regras do parse

- Ignorar campos desconhecidos, para o manifesto poder crescer sem quebrar app antigo.
- Exigir `https://`, `versionCode > 0`, `versionName` não vazio, `sha256` casando `^[0-9a-fA-F]{64}$`.
- **Limitar o tamanho do corpo lido** (o JSON tem ~200 bytes; um cap de 64 KB evita que um
  endpoint errado sirva algo gigante).
- **Recusar HTML explicitamente, com teste.** É o caso real: um 404 devolve página, não JSON.
- Manifesto inválido vira falha com motivo legível, **nunca** um download.

### Download e instalação

- Streaming, calculando o SHA-256 **no mesmo laço**. Limpar o diretório de cache antes de cada
  download. Apagar o parcial em qualquer falha.
- ⚠️ **O sha256 protege contra download truncado, NÃO contra adulteração.** Quem garante
  autenticidade é a assinatura: o Android só instala por cima se a chave for a mesma. Não escreva
  comentário dizendo que o hash é segurança.
- Instalar por `FileProvider` + intent do sistema. **Não existe instalação silenciosa** sem MDM: o
  download é automático, a instalação exige um toque no instalador do Android.
- A permissão "instalar apps desconhecidos" não tem callback de resultado. Se não estiver
  concedida, abra os Ajustes, marque o estado e peça um segundo toque.

### Comparação de versão

Por `versionCode` inteiro, **estritamente maior**. Igual é o que já está instalado; menor o
Android recusa sozinho.

⚠️ Use o `autoIncrement` do EAS (`appVersionSource: "remote"`, **já configurado** no `eas.json`).
**Não** derive o `versionCode` de contagem de commits: lançar de uma branch antiga gera número
menor que o instalado e a instalação passa a ser recusada sem explicação óbvia.

### O CI

No push de tag `v*`: testes, build, **verificar a assinatura do APK** (um build sem assinatura
não pode virar release), calcular o sha256, gerar o manifesto, **validar que ele é JSON** e
publicar as duas coisas. Publicação idempotente, para reexecutar o workflow no mesmo tag
substituir os anexos em vez de falhar.

### A interface no app

Uma linha em Configurações, com um toque por etapa e o toque ignorado enquanto uma operação está
em curso (senão dois downloads do mesmo arquivo). O subtítulo da linha é o feedback:
procurar → disponível → baixando com percentual → pronto → instalar.

Ao emitir progresso, só reemita estado **quando o inteiro do percentual mudar**. Reemitir a cada
bloco são milhares de renderizações à toa.

### Duas melhorias que o original não tem, e que aqui devem entrar

- **Checar sozinho**, na volta do app ao primeiro plano. No original a checagem só acontece se
  alguém abrir Configurações e tocar, então um aparelho pode ficar meses desatualizado.
- **Mostrar as notas da versão.** O campo existe no manifesto e nunca é exibido.

### iOS fica de fora

Não existe instalar APK no iOS. Teste em aparelho lá é TestFlight — e é por lá que as quatro
telas de conta finalmente serão vistas no iOS, fechando a pendência 2 da seção 1.

---

## 6. Como verificar (receitas que custaram caro)

- **Android:** `adb shell input tap|swipe|text` funciona. `input text` **não** decodifica
  percent-encoding — use aspas: `adb shell "input text 'texto com espaço'"`.
- **iOS:** `xcrun simctl` **não tem toque nem rolagem**. Navegue por deep link:
  `xcrun simctl openurl booted "appproops://finance"`, com o app já aberto.
- **Não julgue animação no emulador Android** — ele entrega ~100% de frames janky. Só aparelho
  físico serve para isso. Mas defeito de ESTADO (ícone errado, rótulo errado) o emulador mostra
  bem: toque e capture um quadro logo em seguida.
- **Portões antes de commitar:** `npx tsc --noEmit`, `npx expo lint`, `npm test` (119 testes).
  Mexeu em `agent/` → `.venv/bin/pytest`.
- **Ícone novo** exige entrada no mapa de `src/components/ui/icon.tsx`, senão `icon-map.test.ts`
  quebra e o Android cai num glyph genérico. **Cor nova** exige par claro+escuro em
  `constants/theme.ts`, senão `anti-slop.test.ts` quebra. Nome de SF Symbol inválido só aparece
  no `tsc` — confira antes de assumir que existe.

---

## 7. Decisão de modelo de negócio, PENDENTE do dono

### O que o mercado faz (levantado em 03/09/2026)

| app | teste | plano gratuito permanente |
|---|---|---|
| Organizze (BR) | 7 dias, **sem pedir cartão** | não existe |
| Mobills (BR) | 7 dias | sim, limitado |
| Monarch (EUA) | 7 dias | não existe |
| Copilot (EUA) | ~30 dias | não existe |
| YNAB (EUA) | 34 dias | não existe |

**7 dias é o padrão do Brasil**, que é o mercado deste app. Os 30 dias aparecem só em apps
americanos de sincronização bancária, onde o valor leva um ciclo inteiro para aparecer. Aqui não:
o momento de "entendi" é mandar uma mensagem no WhatsApp e ver o lançamento aparecer organizado,
e isso acontece em trinta segundos, não em trinta dias. **7 dias.**

**Depois do teste, o mercado TRANCA**, não deixa em somente leitura. O que os bons fazem é
prometer **retenção de dados**: o YNAB guarda tudo por 30 dias e restaura intacto se a pessoa
assinar nesse prazo. É o que evita o problema de "sequestro de dados" sem dar produto de graça.
Somente leitura não é o padrão e não precisa ser inventado aqui.

O Gabriel levantou trocar o **plano gratuito permanente** por **teste grátis e depois pagar**.
Isto está **em aberto** — não implemente sem confirmação dele. O que já se sabe:

- Hoje o código tem plano `free` com teto mensal de mensagens de IA, mais `pro` e `family`.
  Limites em `private.plan_limits`, produtos em `src/lib/billing.ts` (e uma cópia literal em
  `supabase/functions/_shared/billing.ts` que um teste obriga a manter igual).
- `TRIAL_DAYS = 7` hoje. `subscriptions` já tem `is_trial` e `current_period_end`.
- Cobrança é **só In-App Purchase** (App Store + Play) via RevenueCat. Isso é decisão firme e não
  está em discussão.

Se a mudança for aprovada, ela toca: `plan_limits`, `plan_status`, o gate de IA em
`_check_limits` (`agent/app/worker.py`), a tela de paywall e o Perfil.

### O ponto que falta o dono decidir, e que precisa ser explicado a ele

Existem dois jeitos de rodar o teste grátis, e a diferença é grande:

- **Sem cartão** (o que o Organizze faz): a pessoa usa 7 dias e, no fim, aparece a tela de
  assinatura. Ela precisa decidir e agir. Mais gente começa o teste, menos gente converte.
- **Oferta introdutória da loja**: a pessoa assina no dia zero pela App Store / Play com os 7
  primeiros dias grátis. O cartão já fica registrado e a cobrança acontece sozinha no oitavo dia,
  a menos que ela cancele. Menos gente começa, muito mais gente converte.

**Recomendação: oferta introdutória**, e o motivo aqui não é só conversão. Neste app **usuário
gratuito custa dinheiro todo mês** (Gemini, Cloud Run, WhatsApp). Sem cartão, qualquer um queima
7 dias de custo e recomeça com outro e-mail, quantas vezes quiser. Com cartão, esse abuso some.

⚠️ **O Codex deve explicar isso ao Gabriel em português claro antes de implementar** — ele pediu
explicitamente essa explicação e ainda não confirmou.

---

## 8. Onde está escrito o resto

`docs/CONTA-E-AGENTE-NO-APP.md` é o plano vivo, com as seis fases originais, o que cada uma
validou, os erros de diagnóstico registrados para não se repetirem, e a Fase 7 detalhada.
