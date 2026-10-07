# Custos, limites e preço dos planos (07/10/2026)

> **Recomendação, não decisão.** Preço e limite são do dono do produto. O que está aqui é a conta
> com números medidos (fatura do GCP, banco de produção) e preços lidos nas páginas oficiais em
> 07/10/2026. **Substitui a proposta de 14/09/2026** em `PROXIMAS-FASES.md` → Fase 6, que ficou
> errada por uma razão só: o WhatsApp passou a cobrar a resposta do bot.
>
> A conta é reproduzível: `python3 scripts/modelo-de-custo.py`. Mudou um preço de fornecedor,
> muda a premissa lá e roda de novo.

## 1. O que mudou e derruba a proposta anterior

**Desde 01/10/2026 a Meta cobra a resposta dentro da janela de 24h.** Texto da página oficial:
*"Effective October 1, 2026, Meta will charge for service messages, which have not been charged
since November 2024"*, e o utility enviado dentro da janela também passa a ser cobrado. O preço
de service é o mesmo de utility e authentication no país: **US$ 0,0068 por mensagem entregue no
Brasil** (≈ R$ 0,042 pagando em dólar, R$ 0,035 na tabela em BRL). Sem faixa de volume.
([non-template-messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages),
[pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing))

Consequência: **cada turno pelo WhatsApp custa ~7× um turno no chat do app.** A IA deixou de ser
o custo principal.

| R$ por turno | pior caso | uso real |
|---|---|---|
| chat no app (IA + Cloud Run + áudio) | 0,0106 | 0,0062 |
| WhatsApp (o mesmo + 1,2 a 1,5 resposta entregue) | **0,0738** | **0,0568** |

Na proposta de 14/09 o `pro` de R$ 19,90 tinha 1.000 turnos de IA, todos podendo ir pelo
WhatsApp. **Hoje esse teto custa R$ 75/mês para um assinante que paga R$ 19,90.** O "lucrativo no
assinante nº 1" deixou de valer.

O que **não** mudou: a janela de 24h continua com 24h, mensagem recebida continua grátis, a janela
de 72h de quem chega por anúncio Click-to-WhatsApp continua grátis, e só se paga mensagem
**entregue**.

## 2. O que existe hoje (medido)

### Fatura real do GCP (export de faturamento, só projetos do ProOps)

| SKU | 14–30/09 | 01–07/10 | mês cheio, estimado |
|---|---|---|---|
| Gemini — projeto "Personal ProOps app" (chave paga) | R$ 9,97 | R$ 9,85 | **quase tudo teste**, ver abaixo |
| Secret Manager (24 versões ativas) | R$ 4,65 | R$ 0,25 | **~R$ 6,50** — o maior fixo do GCP |
| Artifact Registry (169 imagens, ~6,5 GiB) | R$ 1,90 | R$ 0,65 | ~R$ 4 e **subindo a cada deploy** |
| Cloud Scheduler (3 jobs) | R$ 0,91 | R$ 0,25 | ~R$ 1,80 |
| Cloud Storage (fontes do `--source`) | R$ 0,26 | R$ 0,11 | ~R$ 0,50 |
| Cloud Run (CPU + memória) | R$ 2,05 | R$ 0,88 | ~R$ 4 — **hoje 100% coberto pela camada grátis** |
| **total fixo do GCP** | | | **~R$ 20/mês** sem camada grátis (medido 25–30/09: R$ 19,06 bruto, R$ 14,80 líquido) |

- **A camada grátis é por CONTA de faturamento**, e essa conta tem outros projetos. Não conte com
  ela: a tabela acima já está sem.
- **O Gemini da fatura é teste, não usuário.** Produção registrou 68 turnos em setembro e 4 em
  outubro (`ai_events`), o que dá centavos. Os picos de 21/09 (R$ 7,04) e de 05–07/10 (R$ 9,75)
  são suítes de avaliação **na chave paga** — o projeto `gen-lang-client-0373931877` é o da
  produção, e a memória de 21/09 dizia que avaliação iria para o projeto grátis. Isso é vazamento
  operacional a fechar, e é por isso que a fatura não serve de base por usuário.
- **Custo real de IA por turno em produção: US$ 0,00113** (média de `ai_events.estimated_cost_usd`,
  ~4.100 tokens de entrada), 25% acima dos US$ 0,00090 de setembro: os prompts cresceram.
- **Artifact Registry continua sem retenção.** O item de 15/09 não foi feito: eram 88 imagens,
  hoje são 169.
- **Banco de produção: 28 MB** de 500 MB. Armazenamento não é variável de preço.

### Produção hoje

- 5 workspaces (2 `pro`, 3 `free`), 5 perfis, 3 com telefone.
- ⚠️ **O número de WhatsApp de produção é o "Test Number" da Meta** (`verified_name: Test Number`).
  Para lançar falta: número próprio, verificação do negócio e **forma de pagamento na WABA**, sem a
  qual a resposta (agora cobrada) deixa de ser entregue.

### Para lançar (uma vez, ou fixo antes do primeiro assinante)

| item | custo |
|---|---|
| Google Play, conta de desenvolvedor | US$ 25, uma vez (~R$ 155) |
| Apple Developer Program | US$ 99/ano (~R$ 615) |
| Supabase Pro, a partir do 1º assinante pago | US$ 25/mês (~R$ 155) |
| número de WhatsApp próprio (chip/linha) e verificação do negócio na Meta | a linha é sua; a verificação não tem taxa |
| GCP fixo | ~R$ 17/mês |
| contador (CNPJ no Simples) | o seu número — fora do modelo |
| **total para começar** | **~R$ 770 na entrada (Google + 1º ano da Apple) + ~R$ 172/mês** (Supabase + GCP), mais o contador |

## 3. Preço unitário de cada fornecedor (lido em 07/10/2026)

| fornecedor | preço | fonte |
|---|---|---|
| **WhatsApp** service, utility, authentication (BR) | US$ 0,0068 por mensagem entregue (R$ 0,035 em BRL) | Meta, links da §1 |
| WhatsApp marketing (BR) | US$ 0,0625 — **o app não deve mandar nenhum** | terceiros (Engagelab, SleekFlow) |
| **Claude Haiku 5.5** (`claude-haiku-5-5`) | US$ 0,10 entrada · 0,50 saída · 0,01 cache lido · 0,125 cache gravado (por 1M, prompt ≤ 100k) · Batch −50% | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Gemini 3.1 Flash-Lite (hoje) | US$ 0,25 / 1,50 | [ai.google.dev pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Gemini 3.7 Flash (portão, hoje) | US$ 0,75 / 3,75 → **1,50 / 7,50 em 01/01/2027** | idem |
| Groq `whisper-large-v3-turbo` | US$ 0,04 por hora de áudio, mínimo de 10 s por áudio | [Groq STT](https://console.groq.com/docs/speech-to-text) |
| Supabase Pro | US$ 25/mês (8 GB, 100k MAU, backup diário de 7 dias) | [supabase.com/pricing](https://supabase.com/pricing) |
| Langfuse | Hobby grátis (50k unidades/mês, 30 dias); Core US$ 29 (100k, depois US$ 8 por 100k) | [langfuse.com/pricing](https://langfuse.com/pricing) |
| Expo (EAS Update) | grátis até 1.000 MAU; Starter US$ 19 + US$ 0,005 por MAU acima de 3.000 | [expo.dev/pricing](https://expo.dev/pricing) |
| RevenueCat | grátis até US$ 2.500 de receita/mês; depois 1% | [revenuecat.com/pricing](https://www.revenuecat.com/pricing/) |
| Google Play | 15% em assinatura · US$ 25 uma vez | [Play Console](https://support.google.com/googleplay/android-developer/answer/112622) |
| Apple (Brasil, desde 18/06/2026) | 10% (Small Business Program) **+ 5% do IAP = 15%**; sem o programa, 21% + 5% · US$ 99/ano | terceiros ([Appcharge](https://appcharge.com/blog/apple-brazil-framework-is-now-live-what-publishers-need-to-know)) — **confirmar no App Store Connect** |
| Imposto (Simples) | 6% (Anexo III, fator R ≥ 28%) a 15,5% (Anexo V) | contador |
| IOF em cartão internacional | 3,5% | Decreto 12.499/2025 |

## 4. Custo por usuário por mês

Premissas pessimistas (todas em `scripts/modelo-de-custo.py`): dólar a R$ 6,20, nenhuma camada
grátis, 1,5 resposta entregue por turno de WhatsApp (a pergunta do SIM e o resultado), portão em
30% dos turnos, 30% dos turnos com 1 min de áudio, +20% por imagem e retentativa.

| perfil | turnos/mês | custo |
|---|---|---|
| usuário típico | 150 (90 pelo WhatsApp) + 4 templates | **R$ 5,65** |
| família ativa (2,5 pessoas) | 375 | R$ 14,13 |
| trial de 7 dias no teto | 60 (40 respostas no WhatsApp) | R$ 2,45 |

Template proativo (OTP, lembrete, aviso) custa o mesmo R$ 0,042. Push é grátis e continua sendo o
padrão.

## 5. Claude Haiku 5.5 no lugar do Gemini

| R$ de IA por turno | pior caso | uso real |
|---|---|---|
| Gemini (Lite + portão no Flash) | 0,0185 | 0,0070 |
| **Claude Haiku 5.5** | **0,0081** | **0,0037** |

- **Fica pela metade**, e o motivo maior é o portão: hoje ele roda no Flash, que **dobra de preço
  em 01/01/2027**; no Haiku custa ~1/10.
- **Os US$ 200 de crédito pagam 150 mil a 330 mil turnos de IA.** Com 100 assinantes (~15 mil
  turnos/mês) isso é **10 a 20 meses de IA grátis**. Confira a validade dos créditos no Console: se
  expirarem antes, vale o que expirar primeiro.
- **O que a troca exige** (é migração, não troca de chave):
  - O `CLAUDE.md` diz *"Não usar Claude API"* e *"Gemini"* como decisão imutável — atualizar junto
    com a migração.
  - Trocar `langchain-google-genai` pelo cliente da Anthropic nos papéis de `services/gemini.py`
    e refazer a tabela de preço de lá (`ai_events.estimated_cost_usd` lê dela).
  - Haiku 5.5 **pensa por padrão** (esforço `medium`) e o raciocínio é cobrado como saída: usar
    esforço `low` (ou desligar o raciocínio, permitido até `high`) no roteador e no parse.
  - **Cache de prompt** a partir de 512 tokens, cache lido a 0,1× — o prompt fixo de ~2.000 tokens
    entra inteiro. É o que leva do "pior" ao "real" da tabela.
  - Recusa por classificador de segurança **não tem fallback automático** no Haiku: o fallback
    atual (reserva no Flash) precisa de um equivalente.
  - O few-shot por embedding (`gemini-embedding-2`) não tem par na Anthropic: fica no Gemini (custo
    desprezível) ou sai.
  - **Avaliação completa com o modelo novo antes de produção** — é troca de modelo de um papel,
    a regra de `workflow.md` manda a suíte inteira, sem `--barato`.

## 6. Limites e preço recomendados

**O limite passa a ter dois números: turnos de IA no total e RESPOSTAS ENVIADAS pelo WhatsApp.**
Não é uma quarta dimensão de produto: é o limite de IA de sempre mais o canal que tem custo.

**O do WhatsApp conta resposta enviada, não turno de IA**, porque é a unidade que a Meta cobra. O
que não vira turno também é cobrado: o resultado do clique no SIM, a saudação, `SEM_CONTA`,
`NAO_LI`, `GRANDE_DEMAIS` e a própria mensagem de limite. Contando turno (`ai_events`), quem
estourou o teto continuaria gerando uma resposta paga a cada mensagem. A contagem é de cada envio
ao telefone (`try_send`/`try_send_interactive`), e com ela o fator de 1,2 a 1,5 resposta por
turno deixa de ser premissa: o medidor mede o custo.

**Estourou o WhatsApp, o agente continua no app.** O WhatsApp manda **uma vez por dia** "seu
limite do mês pelo WhatsApp acabou — continue pelo app" com o link, e depois para de responder
por ali até virar o mês. O chat do app segue até o total. Assim o teto de WhatsApp pode ser baixo
sem trancar ninguém.

| | sem assinatura | **Pro** | **Família** |
|---|---|---|---|
| preço | — | **R$ 24,90/mês · R$ 239,90/ano** | **R$ 49,90/mês · R$ 479,90/ano** |
| membros | 1 | 1 | 5 |
| turnos de IA/mês (app + WhatsApp) | 0 | **400** | **1.000** |
| respostas pelo WhatsApp/mês | 0 | **150** (~3 conversas/dia) | **300** |
| avisos e lembretes pelo WhatsApp | 0 | 1 por dia | 2 por dia |
| importar extrato | não | sim | sim |
| ver e exportar o próprio dado | sim | sim | sim |
| trial de 7 dias | — | 60 turnos, 40 respostas no WhatsApp | igual |

O `docs/IN-APP-PURCHASE.md` já registra o Pro em R$ 24,90/R$ 249,00 e a Família em
R$ 39,90/R$ 399,00. A conta mantém os R$ 24,90 do Pro. Os R$ 39,90 da Família não fecham com 300
respostas no WhatsApp: a margem no teto fica negativa. Os R$ 19,90 de 14/09 também não fecham.

### Margem (loja 15%; imposto de 6% a 15,5%)

| plano | líquido/mês | custo no TETO | margem no teto | margem no uso real |
|---|---|---|---|---|
| Pro mensal | 17,31 – 19,67 | 11,82 | **32% – 40%** | 67% – 71% |
| Pro anual | 13,89 – 15,79 | 11,82 | **15% – 25%** | 59% – 64% |
| Família mensal | 34,68 – 39,42 | 25,77 | **26% – 35%** | 59% – 64% |
| Família anual | 27,79 – 31,59 | 25,77 | **7% – 18%** | 49% – 55% |

**Nenhum plano fica negativo nem com todos os tetos estourados e o imposto mais caro.** O anual
da Família é o mais apertado: se o contador fechar no Anexo V, baixe o WhatsApp dela para 270
respostas ou suba o anual.

⚠️ **O "uso real" fica perto do teto do WhatsApp, não longe dele.** O usuário típico do modelo
manda ~108 respostas pelo WhatsApp num teto de 150 (72%), e a família típica ~270 num teto de 300.
Para quem usa o produto pelo WhatsApp, a margem esperada está mais perto da coluna do TETO do que
da do uso real. A coluna do uso real vale para quem divide o uso com o chat do app.

### Escala (uso real, imposto 15,5%, mix 60% Pro mensal · 30% Pro anual · 10% Família)

| assinantes | receita líquida | variável | fixo | resultado |
|---|---|---|---|---|
| 10 | R$ 180 | R$ 65 | R$ 223 | **−R$ 108** |
| **19** | | | | **equilíbrio** |
| 100 | R$ 1.802 | R$ 650 | R$ 403 | **R$ 749 (42%)** |
| 1.000 | R$ 18.020 | R$ 6.499 | R$ 1.493 | **R$ 10.027 (56%)** |
| 10.000 | R$ 180.196 | R$ 64.992 | R$ 9.258 | **R$ 105.947 (59%)** |

O fixo inclui GCP (R$ 17), Supabase Pro, Apple, Langfuse Core a partir de 100 assinantes (com
excedente a 1.000+), Expo Starter a partir de 1.000, compute maior do Supabase a 10.000 e
RevenueCat 1% acima de US$ 2.500. **Não inclui o contador nem o domínio e o e-mail.** Some esses
valores, que são seus, ao fixo e divida por R$ 11,52 (a contribuição por assinante) para ter o
novo ponto de equilíbrio.

## 6b. Resultado total do mês no PIOR caso (07/10/2026)

Regra do dono do produto: **só o plano mais barato e o pior caso em tudo**, e taxa de publicação
das lojas fora da conta. Todo assinante é **Pro anual** (R$ 239,90 = R$ 19,99/mês, a menor receita
por pessoa) e **gasta o limite inteiro todo mês**: 400 turnos de IA, 150 respostas e 30 avisos
pelo WhatsApp. Loja 15%, imposto 15,5%, dólar a R$ 6,20, nenhuma camada grátis do GCP, Cloud Run
a US$ 0,0004 por turno.

| por assinante/mês | R$ |
|---|---|
| preço | 19,99 |
| − loja − imposto | − 6,10 |
| **líquido** | **13,89** |
| WhatsApp (150 respostas + 30 avisos) | − 7,59 |
| Cloud Run + áudio | − 1,49 |
| IA (Haiku, 400 turnos) | − 3,24 → **R$ 0 enquanto couber nos US$ 200/mês da Anthropic** |
| **sobra** | **4,82 com os créditos · 1,57 depois deles** |

Fixo: **GCP R$ 20** (fatura de 25–30/09, sem camada grátis); Supabase Pro (R$ 155) a partir de 100
assinantes; Expo Starter acima de 1.000; RevenueCat 1% acima de US$ 2.500. Langfuse com amostragem
(sem ela, o Hobby estoura com ~15 assinantes no limite e o Core custa R$ 180).

| assinantes | receita bruta | fixo | IA paga | **resultado do mês** |
|---|---|---|---|---|
| 1 | 20 | 20 | 0 | −15 |
| 3 | 60 | 20 | 0 | −6 |
| **5** | 100 | 20 | 0 | **+4 — empata aqui** |
| 10 | 200 | 20 | 0 | +28 |
| 20 | 400 | 20 | 0 | +76 |
| 50 | 1.000 | 20 | 0 | +221 |
| 100 | 1.999 | 175 | 0 | +307 |
| 300 | 5.998 | 175 | 0 | +1.270 |
| 500 | 9.996 | 175 | 382 | +1.852 |
| 1.000 | 19.992 | 375 | 2.004 | +2.439 |

Os créditos cobrem a IA de até ~380 assinantes no limite. **Depois disso a sobra cai para ~R$ 1,57
por assinante (8% do preço)**, que é o ponto fraco do pior caso. Duas coisas pioram isso:
- **Apple fora do Small Business Program** (21% + 5% em vez de 15%): o líquido cai para R$ 11,69 e,
  depois dos créditos, **cada assinante dá prejuízo de R$ 0,63**. A inscrição é obrigatória.
- Trial que não converte: até R$ 2,45 cada.

Os R$ 249,00/ano que estão em `IN-APP-PURCHASE.md` acrescentam R$ 0,53 por assinante. Um teto de
120 respostas pelo WhatsApp acrescenta R$ 1,27.

## 7. API não oficial do WhatsApp (Baileys, Evolution, Z-API)

**Não recomendo.** O custo por mensagem some (Evolution é open source, gateways cobram ~R$ 99/mês
por número), mas:

- **Viola os Termos do WhatsApp.** O risco de banimento do número é do dono, e bot que responde
  em volume e manda lembrete proativo é exatamente o padrão que derruba conta. Banido o número,
  **todo usuário perde o canal no mesmo dia**, e o vínculo do app (`profiles.phone`) aponta para
  um número morto.
- O produto guarda dado financeiro e vende assinatura em loja. Canal que pode sumir sem aviso é
  risco de reembolso em massa e de review negativo.
- O custo que ela "economiza" é **R$ 0,042 por resposta**, que os limites da §6 já pagam com
  margem.
- O `CLAUDE.md` traz *"nunca Baileys/não-oficial"* como decisão imutável, pelo mesmo motivo.

**O que reduz o custo do WhatsApp sem sair da API oficial, na ordem de impacto:**

1. **O chat do app como canal principal do agente** (já existe e custa 1/7). O WhatsApp fica como
   atalho, com o teto separado da §6.
2. **Uma resposta por turno.** A Meta cobra por mensagem entregue. O worker já manda uma por lote
   e o debounce junta mensagens seguidas. O que sobra é a confirmação, que custa uma segunda
   mensagem: aumentar o que dispensa o SIM reduz o custo direto.
3. **Faturar a WABA em BRL** (R$ 0,035 em vez de US$ 0,0068 + IOF ≈ R$ 0,042), −17%. É
   obrigatório até 30/06/2027 de qualquer forma.
4. **Push para todo aviso proativo**, com WhatsApp opcional e no máximo 1 por dia.
   **Lembrete hoje não tem teto por usuário** (`jobs/reminders.py`): cada ocorrência com canal
   `whatsapp`/`both` é um template pago, e falha que a Meta aceitou pode ser cobrada de novo.
5. **Telegram como canal extra** (API oficial e grátis por mensagem) para quem quiser — menos
   gente usa no Brasil, então é complemento, não troca.

Upside não contado: **1.000 mensagens de service grátis por número por mês**, citadas de forma
consistente por provedores (BSPs), inclusive brasileiros. A página da Meta não confirma, então o
modelo usa zero.

## 8. Riscos e o que não está confirmado

| item | risco | o que fazer |
|---|---|---|
| **"AI Provider" no Brasil** | desde 11/03/2026 a Meta cobra à parte quem oferece IA como funcionalidade **principal**. O ProOps usa IA como meio (lança gasto, lembrete) — pela redação, fica fora | conferir a categoria no painel de analytics da WABA (`AI_BOT` × service) quando houver tráfego real; nunca apresentar o bot como "assistente de IA" genérico |
| tabela oficial da Meta (CSV/PDF) | os US$ 0,0068 vêm do texto da própria Meta e de terceiros; o CSV não abriu | conferir no painel de billing da WABA depois do 1º mês |
| comissão da Apple no Brasil | fonte de terceiros | conferir no App Store Connect e se inscrever no Small Business Program |
| imposto | Anexo III × V depende do fator R | contador |
| créditos da Claude | validade não conferida | Console da Anthropic |
| Langfuse | ~9 observações por turno: a camada grátis acaba perto de 5 mil turnos/mês (~35 usuários) | amostrar traces (10%) antes de pagar o Core |
| templates cadastrados | a categoria aprovada na Meta não está no repo | conferir que lembrete e aviso são **utility**; se virar marketing, custa 9× |

## 9. O que fazer, por ordem

1. **WABA de produção**: número próprio, verificação do negócio, forma de pagamento (o Test
   Number não serve para lançar) e, quando der, cobrança em BRL.
2. **Chave paga do Gemini fora das suítes de avaliação** (o vazamento de 21/09 e 05–07/10).
3. **Retenção no Artifact Registry** (últimas 10 imagens) e limpeza dos segredos sem uso.
4. **Supabase Free + backup diário próprio** até o primeiro limite do Free (§6b); Pro depois. Sem o backup
   próprio, nada de assinante pago no Free: o dado é financeiro.
5. **Limite de respostas pelo WhatsApp** em `private.plan_limits` + `plan_status_for`, contado
   em cada envio ao telefone (não em `ai_events`), com o "continue pelo app" uma vez por dia e
   silêncio depois. É código e migration, a fazer quando o preço for decidido.
6. **Teto diário de templates de WhatsApp** por usuário (lembretes e avisos).
7. **Migração para o Claude Haiku 5.5** (§5), com a suíte de avaliação inteira.
8. **Preço na loja**: App Store Connect e Play Console, com os valores da §6. Nenhum preço entra
   no código.
