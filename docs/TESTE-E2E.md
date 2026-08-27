# Teste ponta a ponta — roteiro completo

> Roteiro para validar as 7 fases do módulo financeiro. Escrito como um **script contínuo**
> (um "mês de finanças" de um usuário), não como lista de features soltas: bug de interação entre
> partes é o que lista de feature não pega — foi assim que apareceu o do caixa sem conta (`0028`).
>
> Tempo estimado: **60–90 min**. Faça na ordem: os blocos dependem uns dos outros.

## Antes de começar

```bash
npx tsc --noEmit && npx expo lint && npm test   # tem que estar limpo
npx expo start                                   # ou o build no device
```

Confira no app que você está logado e que o telefone do perfil é o mesmo que vai usar no WhatsApp.

### Estado inicial do banco

```sql
select
  (select count(*) from public.transactions) as transacoes,
  (select count(*) from public.accounts) as contas,
  (select count(*) from public.card_invoices) as faturas,
  (select count(*) from public.debts) as dividas,
  (select count(*) from public.assets) as bens,
  (select plan from public.subscriptions limit 1) as plano;
```

Anote os números. No fim tem um script de limpeza que devolve o banco a este estado.

### Onde rodar o SQL deste roteiro

Todo SQL daqui vai no **SQL Editor do Supabase**:
**https://supabase.com/dashboard/project/kwriuifcwyvdrxtspjiz/sql/new**

(Ou peça para o Claude rodar — ele tem acesso ao banco pelo MCP.)

### Como disparar as Edge Functions na mão

O cron roda sozinho (`finance-scheduler` no minuto 7 de cada hora, `send-alerts` às 12h UTC), mas
para testar você quer disparar na hora:

São **duas execuções separadas**. O `pg_net` é assíncrono: a primeira dispara e devolve na hora um
número (o `request_id`), sem esperar a função responder.

**1) Dispare** — devolve algo como `126389`:

```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
         || '/functions/v1/finance-scheduler',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')),
  body := '{}'::jsonb,
  timeout_milliseconds := 45000
) as request_id;
```

**2) Espere 5–10 segundos** e leia a resposta, trocando o número pelo que veio acima (sem os
sinais de maior/menor):

```sql
select status_code, left(content, 300) from net._http_response where id = 126389;
```

Vazio = ainda rodando. Rode de novo em alguns segundos.

⚠️ **Sempre passe `timeout_milliseconds`.** O padrão do `pg_net` é 5s e ele **aborta a função no
meio** — foi assim que a primeira importação gravou os itens mas perdeu a categorização.

---

## Bloco 1 — Contas e cartão (app)

| # | Ação | Esperado |
|---|---|---|
| 1.1 | Financeiro › Contas › ＋ Nova conta: "Nubank", tipo **Corrente**, saldo inicial **3.000,00** | Aparece na lista com o saldo |
| 1.2 | ＋ Nova conta: "Nu Cartão", tipo **Cartão** | Os campos mudam: some "Saldo inicial", aparecem **Fecha dia / Vence dia / Limite** |
| 1.3 | Preencher fecha **28**, vence **05**, limite **5.000,00** | Salva. Sem os dois dias o botão fica desabilitado |
| 1.4 | Abrir Financeiro › Cartões | Cartão listado, "nenhuma compra ainda neste ciclo" |

---

## Bloco 2 — O núcleo: WhatsApp → app em tempo real

Mande no WhatsApp, uma mensagem por vez, e **deixe o app aberto na aba Financeiro**.

| # | Mensagem | Esperado |
|---|---|---|
| 2.1 | `gastei 45 no mercado` | Confirmação com valor e categoria. **A tela atualiza sozinha**, sem puxar para recarregar |
| 2.2 | `recebi 5000 de salário` | Receita registrada |
| 2.3 | `mercado 200, uber 30 e recebi 500 de freela` | **Três** ações numa resposta só |
| 2.4 | Mandar um **áudio** falando um gasto | Transcreve e registra igual |
| 2.5 | `quanto gastei esse mês?` | Resumo por categoria |

**Verificar:** Contas › o saldo do Nubank **não** mudou (esses lançamentos não citaram conta), mas
o card "Sem conta" aparece com o líquido. Isso é o esperado — e é o que a `0028` corrigiu no
patrimônio e na projeção.

---

## Bloco 3 — Cartão, fatura e parcelas (o diferencial nº1)

| # | Ação | Esperado |
|---|---|---|
| 3.1 | WhatsApp: `parcelei uma geladeira de 3600 em 12x no nu cartão` | Confirma "12x de ~R$ 300,00" |
| 3.2 | Financeiro › Cartões | Fatura com **R$ 300** (só a 1ª parcela), limite usado **R$ 3.600**, "vence em X dias" |
| 3.3 | Tocar no cartão → fatura | Lista a parcela **(1/12)**, data de fechamento e vencimento |
| 3.4 | Lançamentos › avançar 1 mês `›` | Parcela **(2/12)** com selo **⏳ previsto** e o vencimento |
| 3.5 | Avançar mais meses | Parcelas 3/12, 4/12… cada uma no seu mês |
| 3.6 | WhatsApp: `quanto tá a fatura do nu cartão?` | Valor, vencimento, limite disponível |
| 3.7 | Fatura › escolher "Nubank" em *Pagar com* › **Paguei** | Fatura vira **Paga**; volta o limite |
| 3.8 | Contas | Saldo do Nubank caiu **exatamente** o valor da fatura |
| 3.9 | Cartões | Agora mostra a **próxima** fatura em aberto |

**O ponto:** o gasto do cartão contou **uma vez só**. O pagamento entrou como transferência, não
como despesa nova. Confira em Lançamentos que não há duplicidade.

---

## Bloco 4 — Recorrentes e projeção (o diferencial nº2)

| # | Ação | Esperado |
|---|---|---|
| 4.1 | WhatsApp: `todo dia 5 pago 1200 de aluguel` | Cria série recorrente, avisa a próxima data |
| 4.2 | Financeiro › Recorrentes | Série ativa, "todo dia 5" em português |
| 4.3 | **Disparar o `finance-scheduler`** (SQL do topo) | Retorno com `created` > 0 |
| 4.4 | Rodar de novo | `created: 0` — idempotente, não duplica |
| 4.5 | Lançamentos › meses à frente | Aluguel aparece como **⏳ previsto** nos próximos 3 meses |
| 4.6 | Financeiro › **Projeção** | Gráfico dia a dia; degraus onde caem fatura e aluguel |
| 4.7 | Trocar 30 / 90 dias / 6 meses | Gráfico refaz |
| 4.8 | Ler "A pagar nos próximos 30 dias" | Fatura e aluguel listados, com data |
| 4.9 | WhatsApp: `quanto vai sobrar no fim do mês?` | Saldo projetado + menor saldo do período |
| 4.10 | Projeção › simulador: **3.000,00** em **10x** | Diz se dá ou não, com o dia do pior saldo |
| 4.11 | WhatsApp: `posso comprar um celular de 3000 em 10x?` | **Mesma resposta** do simulador |
| 4.12 | No card "A pagar", tocar **paguei** no aluguel | Sai da lista de previstos; vira efetivado |
| 4.13 | WhatsApp: `paguei a conta de luz` | Deve dizer que **não achou** — não existe essa conta prevista |

**O ponto de 4.6:** a saída do cartão tem que cair no **dia do vencimento da fatura**, não no dia
da compra. É o que separa projeção certa de projeção de mentira.

---

## Bloco 5 — Correção conversacional (o diferencial nº3)

| # | Mensagem | Esperado |
|---|---|---|
| 5.1 | `gastei 45 na padaria` | Registra |
| 5.2 | `na verdade foi 54` | **Corrige** o lançamento — não cria outro |
| 5.3 | `muda pra restaurante` | Troca a categoria do mesmo lançamento |
| 5.4 | `gastei 30 no posto` e depois `gastei 30 na farmácia` | Dois lançamentos de mesmo valor |
| 5.5 | `muda o de 30 pra transporte` | **Pergunta qual dos dois** em vez de chutar |
| 5.6 | `muda o do posto pra transporte` | Aí sim corrige o certo |
| 5.7 | `apaga a nota do mercado` (crie uma antes) | Apaga a **nota**, não o lançamento |
| 5.8 | Financeiro › **Atividade da IA** | Cada mensagem, o que entendeu, **confiança %**, modelo e tokens |
| 5.9 | Tocar **desfazer** num item que criou lançamento | Some do extrato |

---

## Bloco 6 — Ingestão inteligente (o substituto do Open Finance)

| # | Ação | Esperado |
|---|---|---|
| 6.1 | WhatsApp: mandar **foto de um cupom fiscal** | Lê valor, estabelecimento e data; registra |
| 6.2 | Mandar foto **com legenda** ("almoço de ontem") | Usa a legenda como contexto |
| 6.3 | Mandar um **PDF de fatura** | Extrai os lançamentos (respeitando o teto de 10 por mensagem) |
| 6.4 | Mandar um arquivo **não suportado** (ex.: .docx) | Responde que não consegue ler — sem quebrar |
| 6.5 | Salvar o CSV de exemplo (abaixo) e importar em Financeiro › **Importar extrato** | Tela de revisão com 5 linhas |
| 6.6 | Conferir as categorias sugeridas | ifood→restaurante, posto→transporte, mercado→mercado, salário→salário |
| 6.7 | Tocar numa linha → trocar categoria | Muda a sugestão |
| 6.8 | Segurar uma linha | Descarta |
| 6.9 | **Confirmar todos** | Viram lançamentos com origem "importado" |
| 6.10 | Importar **o mesmo arquivo de novo** | Linhas marcadas **⚠️ já existe no extrato** |
| 6.11 | WhatsApp: `sempre que eu falar ifood põe em restaurante` | Cria a regra |
| 6.12 | WhatsApp: `gastei 40 no ifood` | Cai em **restaurante** mesmo se a IA sugeriria outra |
| 6.13 | Financeiro › **Regras** | Regra listada com "aplicada 1x" |

CSV de exemplo (salve como `extrato-teste.csv`):

```csv
Data;Descricao;Valor
26/08/2026;IFOOD *RESTAURANTE SP;-45,90
25/08/2026;POSTO SHELL COMBUSTIVEL;-199,00
24/08/2026;SUPERMERCADO ZAFFARI;-320,55
20/08/2026;SALARIO EMPRESA XYZ;5.000,00
18/08/2026;UBER *TRIP;-23,40
```

⚠️ Se o plano estiver **Free**, 6.5 vai retornar erro dizendo que importação é do Pro. Isso é o
comportamento certo — troque o plano no Bloco 9 e volte aqui.

---

## Bloco 7 — Orçamento, metas e dívidas

| # | Ação | Esperado |
|---|---|---|
| 7.1 | Orçamentos › ＋: categoria **lazer**, limite **500,00**, marcar **↩︎ Acumula sobra** | Salva |
| 7.2 | WhatsApp: `gastei 450 em lazer` | 90% do limite |
| 7.3 | Dashboard | Card **⚠️ Orçamentos no limite** com 🟡 |
| 7.4 | `gastei mais 100 em lazer` | Passa de 100%, vira 🔴 |
| 7.5 | Orçamentos › navegar `‹` para o mês passado | Mostra o limite valendo naquele mês |
| 7.6 | Criar orçamento **mercado 800** com **📅 Só este mês** | Card mostra "· só este mês" |
| 7.7 | Metas › ＋: "Viagem", alvo **3.000** | Criada |
| 7.8 | ＋ Aportar **500** | Barra em 16% |
| 7.9 | **ver extrato** | Aporte listado com data |
| 7.10 | WhatsApp: `coloca 200 na meta da viagem` | Total vira 700 |
| 7.11 | Dívidas › ＋: "Empréstimo", saldo **10.000**, juros **2**, parcelas **12**, vence **10** | Criada |
| 7.12 | Tocar na dívida | Próxima parcela ≈ **R$ 945,60**, dizendo quanto é **juro** |
| 7.13 | **Paguei esta parcela** | Saldo cai **menos** que a parcela (juros do mês) |
| 7.14 | Cadastrar uma **2ª dívida** em conflito: "Cartão", saldo **1.000**, juros **0,5**, 6 parcelas | Com uma dívida só o seletor de estratégia nem aparece — não há ordem para escolher |
| 7.15 | Alternar **Mais juros** / **Menor saldo** | A ordem **inverte**: por juros o empréstimo (2%) vem primeiro; por saldo, o cartão (R$ 1.000) |

---

## Bloco 8 — Patrimônio e relatórios

| # | Ação | Esperado |
|---|---|---|
| 8.1 | Financeiro › **Patrimônio** › ＋: "Tesouro Selic", Investimento, **25.000** | Cadastrado |
| 8.2 | ＋: "Carro", Veículo, **40.000** | Cadastrado |
| 8.3 | Ler o card do topo | Em conta + Investimentos + Outros bens − Dívidas e faturas = **líquido** |
| 8.4 | Conferir "Em conta" | Inclui os lançamentos **sem conta** do Bloco 2 (o bug da `0028`) |
| 8.5 | Tocar num bem → novo valor | Vira marcação de hoje no histórico |
| 8.6 | WhatsApp: `meu tesouro selic tá em 27 mil` | Atualiza |
| 8.7 | **Disparar o `finance-scheduler`** | `snapshots` > 0 |
| 8.8 | Ler o card **Saúde financeira** | Score 0–100 com as 4 parcelas explicadas |
| 8.9 | Financeiro › **Relatórios** | Ano em números, gastos por categoria |
| 8.10 | Conferir **Saldos em 31/12** | Contas + bens |
| 8.11 | **Exportar CSV** | Share sheet com o conteúdo |
| 8.12 | Trocar para o ano anterior | Estado vazio decente |
| 8.13 | WhatsApp: `qual meu patrimônio?` | Composição (precisa do 8.7 antes) |

---

## Bloco 9 — Plano, família e limites

| # | Ação | Esperado |
|---|---|---|
| 9.1 | Perfil › **Plano e família** | Plano **Free**, consumo do mês, "sem importação de extrato" |
| 9.2 | Tentar importar extrato | Bloqueia dizendo que é do Pro |
| 9.3 | Tocar em **Pro** | Vira Pro; limites sobem |
| 9.4 | Importar de novo | Funciona |
| 9.5 | Convidar um telefone qualquer | Aparece em "Convites pendentes" |
| 9.6 | **revogar** | Some |
| 9.7 | No **Free**, tentar convidar | Botão bloqueado, com o motivo escrito |
| 9.8 | **Cancelar assinatura** | Alerta explicando que nada é apagado; confirma e marca "cancelado" |
| 9.9 | Tocar num plano de novo | Reativa |

---

## Bloco 10 — Alertas proativos

Com orçamento estourado (7.4) e fatura em aberto, dispare o `send-alerts` (mesmo SQL do topo,
trocando o nome da função):

| # | Verificação | Esperado |
|---|---|---|
| 10.1 | Resposta da função | `{ candidatos: N, enviados: X, pulados: Y }` |
| 10.2 | `select kind, ref, sent_on from public.alerts_sent order by created_at desc;` | Uma linha por alerta |
| 10.3 | **Disparar de novo** | `enviados: 0` — dedupe do dia funcionando |
| 10.4 | Ver o texto em `_alerts_to_send()` | Toda mensagem termina numa **ação** |

⚠️ Sem push configurado (decisão registrada em `docs/PUSH-NOTIFICATIONS.md`), o envio tenta
template WhatsApp. Se `personal_proops_reminder` ainda estiver **PENDING** na Meta, o envio falha
e o alerta fica marcado como enviado assim mesmo — de propósito, para não virar loop.

---

## Bloco 11 — Design e regressão

Passe por **todas** as telas em **dark e light** (a regra do projeto exige, e é a única
verificação que só você pode fazer):

`(tabs)`: Notas · Lembretes · Financeiro · Perfil
`finance/`: transactions · transaction-form · cards · invoice/[id] · forecast · accounts ·
goals · budgets · debts · net-worth · reports · recurring · import · rules · ai-activity · plan

Em cada uma, confirmar:

- [ ] **Loading** — skeleton/spinner, não tela em branco
- [ ] **Empty** — emoji + título + dica acionável
- [ ] **Error** — desligue o wi-fi e entre: card de erro com "Tentar de novo"
- [ ] Texto legível nos dois temas (sem cinza em cinza)
- [ ] Animação de entrada escalonada nas listas
- [ ] Haptics em salvar/apagar
- [ ] Nada cortado em tela pequena; nada esticado em tablet

**Regressão do que já existia:** notas (criar/apagar), lembretes (criar/pausar/apagar), login/logout.

---

## Limpeza

```sql
-- ⚠️ CONFIRA o workspace antes de rodar. Apaga TODOS os dados de teste.
do $$
declare ws uuid := public._default_workspace('<SEU_USER_ID>');
begin
  delete from public.import_batches where workspace_id = ws;
  delete from public.transactions   where workspace_id = ws;
  delete from public.card_invoices  where workspace_id = ws;
  delete from public.installment_plans where workspace_id = ws;
  delete from public.recurring_transactions where workspace_id = ws;
  delete from public.categorization_rules  where workspace_id = ws;
  delete from public.goal_contributions where workspace_id = ws;
  delete from public.goals   where workspace_id = ws;
  delete from public.budgets where workspace_id = ws;
  delete from public.debts   where workspace_id = ws;
  delete from public.assets  where workspace_id = ws;
  delete from public.accounts where workspace_id = ws;
  delete from public.alerts_sent where workspace_id = ws;
  delete from public.net_worth_snapshots where workspace_id = ws;
  update public.subscriptions set plan = 'free', status = 'active' where workspace_id = ws;
end $$;
```

`ai_events` e `messages_raw` ficam de propósito: são o histórico de auditoria do teste.

## Onde olhar quando algo falhar

| Sintoma | Onde |
|---|---|
| Mensagem não virou nada | `messages_raw` (chegou?) → `jobs.last_error` → `ai_events.result` |
| IA entendeu errado | `ai_events` (confiança baixa = escalou pro Pro?) ou tela Atividade da IA |
| Recorrente não materializou | Logs do `finance-scheduler`; conferir `dtstart`/`materialized_until` |
| Fatura na data errada | `select * from private.invoice_window(<fecha>, <vence>, '<data>')` |
| Projeção estranha | `select * from public.cash_flow_forecast(90) where in_cents > 0 or out_cents > 0` |
| Importação sem categoria | Timeout do `pg_net`? Ver a nota do topo |
