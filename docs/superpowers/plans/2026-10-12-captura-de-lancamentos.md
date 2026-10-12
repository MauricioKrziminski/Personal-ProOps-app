# Captura de lançamentos (notificações no Android + Compartilhar) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No Android, ler as notificações dos bancos escolhidos e transformar cada compra/Pix num lançamento "a confirmar"; no Android e no iOS, receber um comprovante ou print pelo "Compartilhar" e abrir o formulário de lançamento já preenchido.

**Architecture:** Um serviço nativo (`NotificationListenerService`, módulo Expo local) guarda num arquivo só as notificações dos pacotes escolhidos; o JS as envia ao agente quando o app abre. O agente interpreta cada uma pelo MESMO caminho da voz (`finance_node` + `montar_rascunho`), concilia com o que já existe (`reconcile.conciliar`) e grava em `public.captured_notifications`. A Hoje mostra "A confirmar"; tocar abre `/finance/lancar` preenchido e salvar é o caminho normal. O Compartilhar (`expo-share-intent`) leva a imagem a `POST /internal/finance/draft/media` (ou o texto ao `/draft` que já existe) e abre o mesmo formulário.

**Tech Stack:** Supabase Postgres (migration + `supabase/tests/*.sql` via `scripts/sql-test.py`), agente Python 3.12/FastAPI (`agent/`, pytest, ruff), app Expo SDK 57 (`src/`, `node --test`), módulo Expo local em Kotlin (`modules/proops-captura`), `expo-share-intent` 8.x.

**Spec:** `docs/superpowers/specs/2026-10-12-captura-de-lancamentos-design.md`

## Global Constraints

- Tudo no **STAGING** (`utkqoiigimqzeenxkxdl`). Produção (`kwriuifcwyvdrxtspjiz`) **fora deste plano** — só com pedido do Gabriel, na ordem migration → agente → app.
- `scripts/supabase-target.sh </dev/null` antes de todo `db push`; push com `npx supabase db push --yes </dev/null`.
- Antes de criar a migration: `ls supabase/migrations | tail -1` — se houver timestamp MAIOR que `20261013120000`, renomeie a nova para depois dele.
- Dinheiro sempre `amount_cents` inteiro; texto de valor por `cents_to_brl` (agente) / `formatBRL` (app).
- Tabela nova: RLS ligada, `revoke all ... from public, anon, authenticated` e grants explícitos, gatilho `a0_exige_assinatura`, publicação `supabase_realtime`.
- Nenhum schema novo de IA e nenhum campo novo em `FinanceAction`: o intérprete é `nodes.finance_node` + `finance_draft.montar_rascunho`.
- Regex no agente só valida ESTRUTURA (há valor em reais?), nunca decide se é compra.
- O texto da notificação é DADO de terceiro: vai DENTRO do envelope `<user_input>` e nunca carrega instrução (o modelo é treinado a ignorar instrução ali). O que é instrução ("isto é uma notificação do banco X; fatura fechada não é lançamento") vai FORA do envelope, numa linha confiável que `user_turn` monta a partir de `state["origem"]` — o mesmo lugar do `corrigindo`.
- Capturas NÃO entram no badge da aba nem em `pendentesDaHoje` (badge é o que o "Seu dia" tem para resolver; `design.md` §8). O bloco "A confirmar" mostra a própria contagem.
- Commits: uma linha, conventional, **sem** `Co-Authored-By`.
- `useQuery` vem de `@/lib/consulta-em-foco`, nunca do pacote. `Platform.OS` não entra em `src/app/` (a disponibilidade vem do módulo: `capturaDisponivel()`).
- Toda rolagem nova declara `keyboardShouldPersistTaps="handled"`; todo `<Sheet>` abre com `<TaskHeader>`; `EmptyState` não compacto entra em `VAZIO_GRANDE_PERMITIDO` com o motivo.
- Pacotes de banco (conferidos na Play Store em 12/10/2026): `com.nu.production` Nubank, `com.itau` Itaú, `br.com.bb.android` Banco do Brasil, `com.bradesco` Bradesco, `br.com.gabba.Caixa` Caixa, `com.santander.app` Santander, `br.com.intermedium` Inter, `com.c6bank.app` C6 Bank, `com.picpay` PicPay, `com.mercadopago.wallet` Mercado Pago, `br.com.neon` Neon, `br.com.uol.ps.myaccount` PagBank. Teste: `com.android.shell` só em `__DEV__` (app) e com `CAPTURA_ACEITA_TESTE=true` (agente).
- Teto: 20 notificações por envio; 60 capturas interpretadas por espaço em 24 h.
- Mudança nativa: a release é **1.14.0** (MINOR). Tag é do Gabriel, depois de testar.

## Review Focus

1. **Notificação que não é lançamento mas tem valor** ("Sua fatura fechou: R$ 1.234,56", "Limite disponível R$ 800,00", "Cashback de R$ 5,00 disponível") não pode virar "a confirmar" de gasto — Task 4 (sonda com modelo real) tem esses casos e exige `nenhum`.
2. **A mesma compra notificada duas vezes** (o banco reposta a notificação) não pode aparecer duas vezes — Task 5 (dedupe por id no aparelho, janela de 5 min) e Task 2 (`external_id` único).
3. **A compra que a pessoa JÁ lançou pelo WhatsApp** não aparece na Hoje: vira `duplicate` com o lançamento achado — inclusive quando a descrição difere ("MERCADO SAO JOSE" × "mercado") e só o valor e a data batem (`near_match`/`uncertain` da cascata também viram `duplicate`) — testes em Task 2.
4. **Sem consentimento de IA, sem assinatura ou na rajada**: o envio não perde notificação (fica no aparelho até dar) e não trava o app — testes em Task 2 (403 e rajada devolvem `aceitos` só do que foi gravado) e em Task 6 (o envio para no primeiro erro sem apagar a fila).
5. **Notificação de pacote fora da lista** (alguém manda direto à API) é gravada como `ignored` sem chamar modelo, e `com.android.shell` só passa com a flag de teste — teste em Task 2.

---

### Task 1: Banco — `captured_notifications` e `kind='capture'`

**Files:**
- Create: `supabase/migrations/20261013120000_lancamentos_capturados.sql`
- Create: `supabase/tests/lancamentos_capturados.sql`

**Interfaces:**
- Produces (SQL):
  - `public.captured_notifications(id uuid, workspace_id uuid, user_id uuid, external_id text, bank text, posted_at timestamptz, texto text, status text, draft jsonb, entendido text, kind text, amount_cents bigint, occurred_at date, match_transaction_id uuid, created_at, updated_at)`; `unique (workspace_id, external_id)`.
  - `status in ('pending','duplicate','confirmed','discarded','ignored')`.
  - `authenticated`: `select` e `update (status, texto)` só; nada de insert/delete. Quem insere é o agente (papel que ignora RLS).
  - `ai_events.kind` aceita `'capture'`.

- [ ] **Step 1: Linha de base da suíte SQL inteira**

```bash
for f in supabase/tests/*.sql; do
  agent/.venv/bin/python scripts/sql-test.py "$f" </dev/null >/dev/null 2>&1 && echo "ok   $f" || echo "FAIL $f"
done | tee /tmp/sql-base.txt | grep FAIL
```

Anote as que já falhavam: não são deste plano.

- [ ] **Step 2: Escrever o teste que falha**

`supabase/tests/lancamentos_capturados.sql`:

```sql
-- Lançamentos capturados das notificações: o membro LÊ e muda só status/texto; não insere, não apaga,
-- não vê o de outro espaço; anon não vê nada; ai_events aceita kind 'capture'.
--
--     agent/.venv/bin/python scripts/sql-test.py supabase/tests/lancamentos_capturados.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000ca001';
  w uuid := '00000000-0000-0000-0000-0000000ca002';
  outro uuid := '00000000-0000-0000-0000-0000000ca003';
  w2 uuid := '00000000-0000-0000-0000-0000000ca004';
  c uuid; c2 uuid; n int;
begin
  insert into auth.users(id,email) values (u,'captura@example.invalid'), (outro,'captura2@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values (u), (outro) on conflict(id) do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Captura'), (w2,outro,'Outro');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner'), (w2,outro,'owner');

  -- o agente (postgres) insere
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,texto,status,draft,entendido,kind,amount_cents,occurred_at)
  values (w,u,'ext-00000001','Nubank',now(),'Compra de R$ 45,90 aprovada em MERCADO','pending',
          '{"tipo":"uma","params":{"kind":"expense","amount":"4590"},"perguntas":[],"entendido":"Gasto de R$ 45,90"}',
          'Gasto de R$ 45,90','expense',4590,current_date)
  returning id into c;
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
  values (w2,outro,'ext-00000002','Itaú',now(),'ignored') returning id into c2;

  -- mesmo external_id no mesmo espaço é recusado
  begin
    insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
    values (w,u,'ext-00000001','Nubank',now(),'ignored');
    raise exception 'external_id repetido passou';
  exception when unique_violation then null;
  end;

  -- pendente sem rascunho é recusado
  begin
    insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
    values (w,u,'ext-00000009','Nubank',now(),'pending');
    raise exception 'pendente sem rascunho passou';
  exception when check_violation then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.captured_notifications;
  if n <> 1 then raise exception 'membro vê % linhas (esperado 1: a do próprio espaço)', n; end if;

  update public.captured_notifications set status = 'confirmed', texto = null where id = c;
  if (select status from public.captured_notifications where id = c) <> 'confirmed' then
    raise exception 'status não mudou';
  end if;

  begin
    update public.captured_notifications set amount_cents = 1 where id = c;
    raise exception 'membro mudou amount_cents';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
    values (w,u,'ext-00000003','Nubank',now(),'ignored');
    raise exception 'membro inseriu';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.captured_notifications where id = c;
    raise exception 'membro apagou';
  exception when insufficient_privilege then null;
  end;

  update public.captured_notifications set status = 'discarded' where id = c2;
  reset role;
  if (select status from public.captured_notifications where id = c2) <> 'ignored' then
    raise exception 'membro mudou linha de outro espaço';
  end if;

  if has_table_privilege('anon', 'public.captured_notifications', 'select') then
    raise exception 'anon lê captured_notifications';
  end if;

  -- ai_events aceita kind capture
  perform 1 from pg_constraint
   where conname = 'ai_events_kind_check' and pg_get_constraintdef(oid) like '%capture%';
  if not found then raise exception 'ai_events_kind_check sem capture'; end if;

  -- gatilho de assinatura e realtime
  perform 1 from pg_trigger where tgname = 'a0_exige_assinatura'
     and tgrelid = 'public.captured_notifications'::regclass;
  if not found then raise exception 'sem a0_exige_assinatura'; end if;
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime'
     and schemaname = 'public' and tablename = 'captured_notifications';
  if not found then raise exception 'fora do realtime'; end if;
end $$;
rollback;
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `agent/.venv/bin/python scripts/sql-test.py supabase/tests/lancamentos_capturados.sql </dev/null`
Expected: FAIL com `relation "public.captured_notifications" does not exist`.

- [ ] **Step 4: Escrever a migration**

`supabase/migrations/20261013120000_lancamentos_capturados.sql`:

```sql
-- Lançamentos capturados das notificações dos bancos (Android).
-- Spec: docs/superpowers/specs/2026-10-12-captura-de-lancamentos-design.md
-- Quem INSERE é o agente (`POST /internal/captures/notifications`, papel que ignora RLS). O app só lê e
-- muda o status (confirmar/descartar) e apaga o texto da notificação ao resolver.
create table if not exists public.captured_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- id calculado no aparelho (pacote + texto + janela de 5 min): a mesma notificação não entra duas vezes
  external_id text not null check (char_length(external_id) between 8 and 128),
  bank text not null check (char_length(bank) between 1 and 128),
  posted_at timestamptz not null,
  -- o texto da notificação só enquanto o item está em aberto (o app o apaga ao resolver)
  texto text check (char_length(texto) <= 1300),
  status text not null default 'pending'
    check (status in ('pending','duplicate','confirmed','discarded','ignored')),
  -- `RascunhoOut` do agente: {tipo, params, perguntas, entendido} — o que `/finance/lancar` lê
  draft jsonb check (draft is null or jsonb_typeof(draft) = 'object'),
  entendido text,
  kind text check (kind in ('expense','income')),
  amount_cents bigint check (amount_cents > 0),
  occurred_at date,
  -- o lançamento que a conciliação achou (status duplicate)
  match_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_id),
  check (status in ('ignored','discarded','confirmed') or draft is not null)
);
create index if not exists captured_notifications_ws_status_idx
  on public.captured_notifications (workspace_id, status, posted_at desc);
create index if not exists captured_notifications_user_idx on public.captured_notifications (user_id);
create index if not exists captured_notifications_match_idx
  on public.captured_notifications (match_transaction_id) where match_transaction_id is not null;

alter table public.captured_notifications enable row level security;
drop policy if exists "workspace read" on public.captured_notifications;
create policy "workspace read" on public.captured_notifications
  for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));
drop policy if exists "workspace resolve" on public.captured_notifications;
create policy "workspace resolve" on public.captured_notifications
  for update to authenticated
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
revoke all on public.captured_notifications from public, anon, authenticated;
grant select on public.captured_notifications to authenticated;
grant update (status, texto) on public.captured_notifications to authenticated;
grant all on public.captured_notifications to service_role;

drop trigger if exists set_updated_at on public.captured_notifications;
create trigger set_updated_at before update on public.captured_notifications
  for each row execute function extensions.moddatetime(updated_at);
drop trigger if exists a0_exige_assinatura on public.captured_notifications;
create trigger a0_exige_assinatura before insert or update or delete on public.captured_notifications
  for each row execute function private.tg_exige_assinatura();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                  and schemaname = 'public' and tablename = 'captured_notifications') then
    alter publication supabase_realtime add table public.captured_notifications;
  end if;
end $$;

-- a captura grava o seu custo em ai_events, sem contar no limite mensal (só `turn` conta)
alter table public.ai_events drop constraint if exists ai_events_kind_check;
alter table public.ai_events
  add constraint ai_events_kind_check check (kind in ('turn', 'transcription', 'import', 'capture'));
```

- [ ] **Step 5: Aplicar no staging e rodar o teste**

```bash
scripts/supabase-target.sh </dev/null && npx supabase db push --yes </dev/null
agent/.venv/bin/python scripts/sql-test.py supabase/tests/lancamentos_capturados.sql </dev/null
```
Expected: o push aplica `20261013120000`; o teste passa (sem `ERROR`).

- [ ] **Step 6: Suíte SQL inteira contra a linha de base**

Rode o laço do Step 1 de novo para `/tmp/sql-depois.txt` e `diff /tmp/sql-base.txt /tmp/sql-depois.txt`.
Expected: nenhuma linha nova com FAIL.

- [ ] **Step 7: Tipos e commit**

```bash
npx supabase gen types typescript --project-id utkqoiigimqzeenxkxdl > src/types/database.ts
git add supabase/migrations/20261013120000_lancamentos_capturados.sql supabase/tests/lancamentos_capturados.sql src/types/database.ts
git commit -m "feat(db): lançamentos capturados das notificações (captured_notifications)"
```
(Se o arquivo de tipos tiver outro caminho, `grep -rl "Database = {" src | head -1` diz qual.)

---

### Task 2: Agente — `POST /internal/captures/notifications`

**Files:**
- Modify: `agent/app/jobs/importer.py` (extrair `carregar_existentes`, usado pela importação e pela captura)
- Modify: `agent/app/config.py` (`captura_aceita_teste: bool = False`)
- Modify: `agent/.env.example` (documentar `CAPTURA_ACEITA_TESTE`)
- Modify: `agent/app/graph/prompts.py` (`user_turn` ganha `origem: str = ""`, linha confiável FORA do envelope)
- Modify: `agent/app/graph/nodes.py:~365` (`finance_node` passa `origem=state.get("origem") or ""`)
- Modify: `agent/app/graph/state.py` (`origem: str | None` no `AgentState`)
- Create: `agent/app/routes/captures.py`
- Modify: `agent/app/main.py:136` (incluir o router)
- Test: `agent/tests/test_captures.py`

**Interfaces:**
- Consumes: `finance_draft.montar_rascunho(workspace_id, texto, acoes, hoje, forma) -> RascunhoOut`, `finance_draft._CRIA`, `finance_draft._pede_forma`, `finance_draft._fuso_valido`, `nodes.finance_node(estado)`, `conversation.check_limits(sessao, kind=...)`, `db.record_ai_event(..., kind=...)`, `reconcile.conciliar`, `reconcile.Item`.
- Produces:
  - `importer.carregar_existentes(workspace_id, de: date, ate: date, account_id: str | None) -> list[Existente]`
  - `prompts.user_turn(..., origem: str = "")` — sem `origem`, a saída é IDÊNTICA à de hoje (o cache das suítes prova).
  - `POST /internal/captures/notifications` body `{timezone: str, items: [{external_id, package, title, text, posted_at}]}` (1..20) → `{aceitos: list[str], novos: int}`. `aceitos` = os `external_id` que o aparelho pode apagar (gravados agora ou já conhecidos).
  - Erros: 403 `ai_consent_required` (nada gravado do que precisava de modelo), 404 `no_workspace`.
  - `captures.BANCOS: dict[str, str]`, `captures.banco_do_pacote(pacote) -> str | None`, `captures.tem_valor(texto) -> bool`, `captures.origem_da_notificacao(banco) -> str` (a instrução, confiável), `captures.texto_da_notificacao(titulo, texto) -> str` (o dado, envelopado), `captures.MAX_POR_DIA = 60`.

Já conferido ao escrever o plano: `db.reservar_cota` só trata `kind == 'turn'` à parte (nenhuma lista de kinds no SQL além do `ai_events_kind_check`), e `consumo.abrir()` abre um contexto novo a cada `check_limits`, fechado pelo `record_ai_event` — chamar os dois uma vez POR NOTIFICAÇÃO, em sequência, na mesma requisição, é seguro.

- [ ] **Step 1: Extrair `carregar_existentes` sem mudar comportamento**

Em `agent/app/jobs/importer.py`, mova a consulta de `existentes` (hoje dentro de `_importar`, ~linhas 217-246) para uma função de módulo, aceitando conta nula:

```python
async def carregar_existentes(workspace_id, de: date, ate: date, account_id: str | None) -> list[Existente]:
    """Lançamentos candidatos à conciliação entre `de` e `ate`. Com conta, só os dela (e os sem conta);
    sem conta (captura que não sabe de qual conta veio), todos do espaço."""
    return [
        Existente(
            id=str(r["id"]), kind=r["kind"], amount_cents=int(r["amount_cents"]),
            occurred_at=r["occurred_at"], description=r["description"], merchant=r["merchant"],
            account_id=str(r["account_id"]) if r["account_id"] else None,
            counterparty_account_id=str(r["counterparty_account_id"]) if r["counterparty_account_id"] else None,
            installment_plan_id=str(r["installment_plan_id"]) if r["installment_plan_id"] else None,
            installment_no=r["installment_no"], plan_installments=r["plan_installments"],
            rollover=bool(r["rollover"]), previsto=bool(r["previsto"]),
        )
        for r in await db.fetch(
            """
            select t.id, t.kind, t.amount_cents, t.occurred_at, t.description, t.merchant,
                   t.account_id, t.counterparty_account_id, t.installment_plan_id,
                   t.installment_no, p.installments as plan_installments,
                   t.rollover_of_invoice_id is not null as rollover,
                   (t.recurring_id is not null and t.status = 'pending') as previsto
            from public.transactions t
            left join public.installment_plans p on p.id = t.installment_plan_id
            where t.workspace_id = %s
              and t.occurred_at between %s and %s
              and (%s::uuid is null or t.account_id = %s::uuid or t.account_id is null
                   or t.counterparty_account_id = %s::uuid)
            order by t.occurred_at, t.created_at
            """,
            workspace_id, de, ate, account_id, account_id, account_id,
        )
    ]
```

E em `_importar` troque o bloco por `existentes = await carregar_existentes(workspace_id, de, ate, account_id)`.

Run: `cd agent && .venv/bin/pytest -q tests -k "import or reconcil"`
Expected: PASS (nada mudou para a importação).

- [ ] **Step 2: Flag de teste**

Em `agent/app/config.py`, dentro de `Settings`, perto de `max_parses_per_hour`:

```python
    # Aceita notificações de `com.android.shell` (o `adb shell cmd notification post`) como banco de
    # teste. Só no staging: em produção um pacote de teste seria um jeito de mandar texto à IA.
    captura_aceita_teste: bool = False
```

Em `agent/.env.example`, na seção do agente:

```
# Captura de notificações: aceita o pacote de teste do adb (com.android.shell). Só staging.
CAPTURA_ACEITA_TESTE=false
```

E no `agent/.env` (staging, gitignorado) acrescente `CAPTURA_ACEITA_TESTE=true`.

- [ ] **Step 2b: A origem confiável fora do envelope**

Linha de base ANTES de mexer (sai do cache, custo zero se nada mudou): `cd agent && .venv/bin/python scripts/evaluate_answer_forms.py --secao <a seção de lançamento de gasto; liste com secoes()> --barato`. Anote o resultado.

Teste que falha, em `agent/tests/test_prompts.py` (ou no arquivo de testes de `user_turn` que já existir — `grep -rln "user_turn" agent/tests`):

```python
from app.graph.prompts import user_turn


def test_origem_vai_fora_do_envelope_e_sem_ela_nada_muda():
    sem = user_turn("Compra de R$ 1,00", "2026-10-12T10:00:00", "America/Sao_Paulo")
    com = user_turn("Compra de R$ 1,00", "2026-10-12T10:00:00", "America/Sao_Paulo", origem="ORIGEM-X")
    assert sem == user_turn("Compra de R$ 1,00", "2026-10-12T10:00:00", "America/Sao_Paulo", origem="")
    assert "ORIGEM-X" in com
    assert com.index("ORIGEM-X") < com.index("<user_input>")  # fora (antes) do envelope
```

Em `prompts.user_turn`: parâmetro `origem: str = ""` e, logo depois da linha de data/hora, `if origem: partes.append(origem)` — texto NOSSO, montado pelo código, nunca vindo do usuário. Em `nodes.finance_node` (a chamada de `user_turn` em ~365): `origem=state.get("origem") or ""`. Em `state.py`, `origem: str | None` no `AgentState`.

Depois: `.venv/bin/pytest -q tests/test_prompts.py` (PASS) e a MESMA seção do `evaluate_answer_forms.py` de novo — tem que dar o mesmo resultado (sem `origem` o turno é idêntico, então os casos saem do cache).

- [ ] **Step 3: Escrever os testes que falham**

`agent/tests/test_captures.py`:

```python
"""`POST /internal/captures/notifications`: interpreta, concilia e guarda "a confirmar". Sem rede, sem banco."""

from datetime import date
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import conversation, db
from app.config import get_settings
from app.domain.reconcile import Existente
from app.graph import nodes
from app.jobs import importer
from app.routes import captures
from app.routes import chat as chat_routes

USER = UUID("11111111-1111-1111-1111-111111111111")
WS = uuid4()
QUANDO = "2026-10-12T15:30:00+00:00"


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("SUPABASE_URL", "https://exemplo.supabase.co")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def mundo(monkeypatch):
    v = {"limite": None, "gravados": [], "eventos": [], "conhecidos": set(), "hoje": 0,
         "acoes": [{"type": "create_expense", "amount_cents": 4590, "description": "mercado"}],
         "chamadas": 0, "existentes": []}

    async def perfil(_u):
        return {"id": USER, "timezone": "America/Sao_Paulo", "workspace_id": WS}

    async def limites(_sessao, *, kind="turn"):
        assert kind == "capture"
        return v["limite"]

    async def evento(**kw):
        v["eventos"].append(kw)

    async def soltar():
        return None

    async def finance_node(estado):
        v["chamadas"] += 1
        v["ultimo_texto"] = estado["text"]
        v["ultima_origem"] = estado.get("origem")
        return {"finance_actions": v["acoes"]}

    async def montar(ws, texto, acoes, hoje, forma=None):
        from app.routes.finance_draft import RascunhoOut
        return RascunhoOut(tipo="uma", params={"kind": "expense", "amount": str(acoes[0]["amount_cents"])},
                           perguntas=[], entendido="Gasto de R$ 45,90 · mercado")

    async def fetch(sql, *args):
        if "external_id = any" in sql:
            return [{"external_id": e} for e in v["conhecidos"] if e in args[1]]
        return []

    async def fetch_one(sql, *args):
        if "count(*)" in sql:
            return {"n": v["hoje"]}
        return None

    async def execute(sql, *args):
        assert "insert into public.captured_notifications" in sql
        v["gravados"].append(args)

    async def existentes(ws, de, ate, conta):
        return v["existentes"]

    monkeypatch.setattr(db, "chat_profile", perfil)
    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "fetch_one", fetch_one)
    monkeypatch.setattr(db, "execute", execute)
    monkeypatch.setattr(db, "record_ai_event", evento)
    monkeypatch.setattr(conversation, "check_limits", limites)
    monkeypatch.setattr(conversation, "soltar_reserva", soltar)
    monkeypatch.setattr(nodes, "finance_node", finance_node)
    monkeypatch.setattr(captures.finance_draft, "montar_rascunho", montar)
    monkeypatch.setattr(importer, "carregar_existentes", existentes)
    return v


def _cliente(autenticado=True):
    app = FastAPI()
    app.include_router(captures.router)
    chat_routes.install_error_handlers(app)
    if autenticado:
        app.dependency_overrides[chat_routes.current_user] = lambda: USER
    return TestClient(app)


def _item(ext="ext-00000001", pacote="com.nu.production", texto="Compra de R$ 45,90 aprovada em MERCADO SAO JOSE"):
    return {"external_id": ext, "package": pacote, "title": "Compra aprovada", "text": texto, "posted_at": QUANDO}


def _envia(*itens, cliente=None):
    return (cliente or _cliente()).post("/internal/captures/notifications",
                                        json={"timezone": "America/Sao_Paulo", "items": list(itens)})


def test_exige_token(mundo):
    assert _envia(_item(), cliente=_cliente(autenticado=False)).status_code == 401


def test_compra_vira_pendente_com_rascunho(mundo):
    r = _envia(_item())
    assert r.status_code == 200
    assert r.json() == {"aceitos": ["ext-00000001"], "novos": 1}
    (linha,) = mundo["gravados"]
    assert "pending" in linha and 4590 in linha
    assert mundo["eventos"][0]["kind"] == "capture"
    # a instrução e o banco vão na origem (fora do envelope); o envelope leva só a notificação
    assert "Nubank" in mundo["ultima_origem"] and "fatura fechada" in mundo["ultima_origem"].lower()
    assert "Registre" not in mundo["ultimo_texto"]
    assert "MERCADO SAO JOSE" in mundo["ultimo_texto"]


def test_sem_valor_em_reais_nao_chama_modelo(mundo):
    r = _envia(_item(texto="Seu código de acesso chegou"))
    assert r.json()["aceitos"] == ["ext-00000001"]
    assert mundo["chamadas"] == 0
    assert "ignored" in mundo["gravados"][0]


def test_pacote_fora_da_lista_e_ignorado_sem_modelo(mundo):
    _envia(_item(pacote="com.whatsapp"))
    assert mundo["chamadas"] == 0
    assert "ignored" in mundo["gravados"][0]


def test_pacote_de_teste_so_com_a_flag(mundo, monkeypatch):
    _envia(_item(pacote="com.android.shell"))
    assert mundo["chamadas"] == 0
    monkeypatch.setenv("CAPTURA_ACEITA_TESTE", "true")
    get_settings.cache_clear()
    _envia(_item(ext="ext-00000002", pacote="com.android.shell"))
    assert mundo["chamadas"] == 1


def test_modelo_sem_lancamento_vira_ignored(mundo):
    mundo["acoes"] = []
    r = _envia(_item(texto="Sua fatura fechou: R$ 1.234,56"))
    assert r.json()["aceitos"] == ["ext-00000001"]
    assert "ignored" in mundo["gravados"][0]
    assert mundo["eventos"]  # gastou modelo: grava o custo mesmo sem lançamento


def test_ja_conhecido_e_aceito_sem_gravar(mundo):
    mundo["conhecidos"] = {"ext-00000001"}
    r = _envia(_item())
    assert r.json() == {"aceitos": ["ext-00000001"], "novos": 0}
    assert mundo["gravados"] == [] and mundo["chamadas"] == 0


def test_ja_lancado_vira_duplicate_com_o_lancamento(mundo):
    achado = str(uuid4())
    mundo["existentes"] = [Existente(
        id=achado, kind="expense", amount_cents=4590, occurred_at=date(2026, 10, 12),
        description="mercado", merchant=None, account_id=None, counterparty_account_id=None,
        installment_plan_id=None, installment_no=None, plan_installments=None, rollover=False, previsto=False,
    )]
    _envia(_item())
    linha = mundo["gravados"][0]
    assert "duplicate" in linha and achado in [str(x) for x in linha]


def test_mesmo_valor_com_outro_nome_tambem_vira_duplicate(mundo):
    # "MERCADO SAO JOSE" na notificação × "pão" lançado pelo WhatsApp um dia antes: a cascata devolve
    # near_match/uncertain, e isso também sai da Hoje (vai para "Parecem já lançados")
    achado = str(uuid4())
    mundo["acoes"] = [{"type": "create_expense", "amount_cents": 4590, "description": "MERCADO SAO JOSE"}]
    mundo["existentes"] = [Existente(
        id=achado, kind="expense", amount_cents=4590, occurred_at=date(2026, 10, 11),
        description="pão", merchant=None, account_id=None, counterparty_account_id=None,
        installment_plan_id=None, installment_no=None, plan_installments=None, rollover=False, previsto=False,
    )]
    _envia(_item())
    linha = mundo["gravados"][0]
    assert "duplicate" in linha and achado in [str(x) for x in linha]


def test_sem_consentimento_responde_403_e_nao_aceita(mundo):
    mundo["limite"] = conversation.SEM_CONSENTIMENTO_IA
    r = _envia(_item())
    assert r.status_code == 403
    assert mundo["gravados"] == []


def test_rajada_para_e_devolve_o_que_gravou(mundo):
    mundo["limite"] = conversation.MUITAS
    r = _envia(_item(texto="Pix de R$ 10,00 enviado"), _item(ext="ext-00000002", texto="sem valor"))
    # o sem-valor não precisa de modelo e é gravado; o que precisava fica no aparelho
    assert r.status_code == 200
    assert r.json()["aceitos"] == ["ext-00000002"]


def test_teto_diario_deixa_no_aparelho(mundo):
    mundo["hoje"] = captures.MAX_POR_DIA
    r = _envia(_item())
    assert r.json() == {"aceitos": [], "novos": 0}
    assert mundo["chamadas"] == 0


def test_modelo_fora_do_ar_nao_aceita(mundo, monkeypatch):
    async def quebra(_e):
        raise RuntimeError("503")
    monkeypatch.setattr(nodes, "finance_node", quebra)
    r = _envia(_item())
    assert r.status_code == 200 and r.json()["aceitos"] == []


def test_tem_valor_so_estrutura():
    assert captures.tem_valor("Compra de R$ 45,90")
    assert captures.tem_valor("Pix recebido 1.200,00")
    assert not captures.tem_valor("Seu código é 123456")
    assert not captures.tem_valor("Bom dia!")
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `cd agent && .venv/bin/pytest -q tests/test_captures.py`
Expected: FAIL com `ImportError: cannot import name 'captures'`.

- [ ] **Step 5: Implementar a rota**

`agent/app/routes/captures.py`:

```python
"""Lançamentos capturados das notificações dos bancos (Android) — só INTERPRETA e guarda "a confirmar".

O aparelho manda o texto das notificações dos bancos que a pessoa escolheu. Cada uma passa pelo MESMO
intérprete da voz (`finance_node` + `montar_rascunho`), é conciliada com o que já existe e vira uma linha
em `captured_notifications`. Nada é lançado aqui: confirmar abre `/finance/lancar` preenchido.
Spec: docs/superpowers/specs/2026-10-12-captura-de-lancamentos-design.md
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import replace
from datetime import date, datetime, timedelta
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import Field

from app import conversation, db
from app.auth import current_user
from app.config import get_settings
from app.domain import atributos as dom_atributos
from app.domain.reconcile import Item, conciliar
from app.graph import nodes
from app.jobs import importer
from app.routes import finance_draft
from app.routes.chat import Corpo
from app.routes.chat import _erro_audio as _erro
from app.services import ia

log = logging.getLogger(__name__)
router = APIRouter(prefix="/internal/captures", tags=["captures"])

# Mesma lista de `src/lib/captura.ts` (pacotes conferidos na Play Store em 12/10/2026).
BANCOS = {
    "com.nu.production": "Nubank", "com.itau": "Itaú", "br.com.bb.android": "Banco do Brasil",
    "com.bradesco": "Bradesco", "br.com.gabba.Caixa": "Caixa", "com.santander.app": "Santander",
    "br.com.intermedium": "Inter", "com.c6bank.app": "C6 Bank", "com.picpay": "PicPay",
    "com.mercadopago.wallet": "Mercado Pago", "br.com.neon": "Neon", "br.com.uol.ps.myaccount": "PagBank",
}
PACOTE_DE_TESTE = "com.android.shell"
MAX_POR_ENVIO = 20
MAX_POR_DIA = 60
MARGEM_DIAS = 5
# Estrutura, não sentido: movimento de dinheiro sempre traz valor em reais.
_VALOR = re.compile(r"R\$\s*\d|\b\d{1,3}(?:\.\d{3})*,\d{2}\b")


class NotificacaoIn(Corpo):
    external_id: str = Field(min_length=8, max_length=128)
    package: str = Field(min_length=1, max_length=128)
    title: str = Field(default="", max_length=200)
    text: str = Field(min_length=1, max_length=1000)
    posted_at: datetime


class EnvioIn(Corpo):
    timezone: str = Field(min_length=1, max_length=64)
    items: list[NotificacaoIn] = Field(min_length=1, max_length=MAX_POR_ENVIO)


class EnvioOut(Corpo):
    aceitos: list[str]
    novos: int


class _Parar(Exception):
    """Rajada, cota ou modelo fora: o resto fica no aparelho para a próxima abertura."""


def banco_do_pacote(pacote: str) -> str | None:
    if pacote in BANCOS:
        return BANCOS[pacote]
    if pacote == PACOTE_DE_TESTE and get_settings().captura_aceita_teste:
        return "Teste"
    return None


def tem_valor(texto: str) -> bool:
    return bool(_VALOR.search(texto))


def origem_da_notificacao(banco: str) -> str:
    """A instrução, CONFIÁVEL: vai fora do envelope (`user_turn(origem=...)`). `banco` vem da allowlist."""
    return (
        f"O texto do usuário abaixo é uma notificação do app do banco {banco}, copiada do celular — não uma "
        "mensagem escrita pela pessoa. Crie um lançamento só se ela registrar um gasto, uma compra, um Pix "
        "ou uma transferência feita ou recebida. Fatura fechada, limite, saldo, cashback, código, compra "
        "negada e propaganda não são lançamento: nesses casos, nenhuma ação."
    )


def texto_da_notificacao(titulo: str, texto: str) -> str:
    """O DADO: vai dentro do envelope `<user_input>`, sem nenhuma instrução nossa."""
    return f"{titulo}\n{texto}".strip()


async def _gravar(ws, user_id, item: NotificacaoIn, banco: str, status: str, rascunho=None,
                  kind=None, amount_cents=None, occurred_at=None, match=None) -> None:
    await db.execute(
        """
        insert into public.captured_notifications
          (workspace_id, user_id, external_id, bank, posted_at, texto, status, draft, entendido,
           kind, amount_cents, occurred_at, match_transaction_id)
        values (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s::uuid)
        on conflict (workspace_id, external_id) do nothing
        """,
        ws, user_id, item.external_id, banco, item.posted_at,
        None if status == "ignored" else f"{item.title}\n{item.text}"[:1300],
        status, json.dumps(rascunho.model_dump()) if rascunho else None,
        rascunho.entendido if rascunho else None, kind, amount_cents, occurred_at, match,
    )


async def _duplicata(ws, kind: str, amount_cents: int, dia: date, descricao: str | None, conta: str | None):
    existentes = await importer.carregar_existentes(
        ws, dia - timedelta(days=MARGEM_DIAS), dia + timedelta(days=MARGEM_DIAS), conta)
    if conta is None:  # sem conta, qualquer conta casa
        existentes = [replace(t, account_id=None) for t in existentes]
    (v,) = conciliar([Item(0, kind, amount_cents, dia, descricao, None)], existentes,
                     conta_id=conta or "", cartao=False)
    # O nome da notificação ("MERCADO SAO JOSE") quase nunca é o que a pessoa escreveu ("mercado"):
    # mesmo valor em poucos dias e nome parecido também saem da Hoje, para ela decidir na lista.
    return v.transaction_id if v.status in ("duplicate", "near_match", "uncertain") else None


async def _interpretar(user_id, ws, item: NotificacaoIn, banco: str, fuso: str):
    sessao = {"user_id": user_id, "workspace_id": ws, "channel": "app"}
    limite = await conversation.check_limits(sessao, kind="capture")
    if limite == conversation.SEM_CONSENTIMENTO_IA:
        raise conversation.ConsentimentoNecessario()
    if limite:
        raise _Parar(limite)
    local = item.posted_at.astimezone(ZoneInfo(fuso))
    texto = texto_da_notificacao(item.title, item.text)
    estado = {"text": texto, "origem": origem_da_notificacao(banco), "timezone": fuso, "workspace_id": ws,
              "messages": None, "agora_local": local.replace(tzinfo=None).isoformat(timespec="seconds")}
    try:
        saida = await nodes.finance_node(estado)
    except Exception:  # noqa: BLE001
        log.warning("Falha ao interpretar notificação capturada")
        await conversation.soltar_reserva()
        raise _Parar("modelo") from None
    acoes = [x for x in saida.get("finance_actions", []) if x.get("type") in finance_draft._CRIA]
    await db.record_ai_event(
        user_id=user_id, workspace_id=ws, channel="app", model=ia.modelo(ia.PAPEL_PARSE),
        confidence=saida.get("confidence"), kind="capture",
        result={"finance_actions": saida.get("finance_actions", []), "llm_calls": 1, "capture": True},
    )
    if not acoes:
        return None, None, local.date()
    forma = (dom_atributos.forma_proposta(acoes[0].get("payment_method"), texto)
             if finance_draft._pede_forma(acoes[0]) else None)
    # O nome do banco entra no texto que `montar_rascunho` casa com as contas cadastradas ("Nubank" →
    # a conta/cartão Nubank, só se casar com UM registro); ele não vai ao modelo por aqui.
    rascunho = await finance_draft.montar_rascunho(ws, f"{banco}\n{texto}", acoes, local.date(), forma)
    return rascunho, acoes[0], local.date()


@router.post("/notifications", response_model=EnvioOut)
async def receber(body: EnvioIn, user_id: Annotated[UUID, Depends(current_user)]) -> EnvioOut:
    perfil = await db.chat_profile(user_id)
    if not perfil or not perfil.get("workspace_id"):
        raise _erro(404, "no_workspace", "Não achei o seu espaço.")
    ws = perfil["workspace_id"]
    fuso = finance_draft._fuso_valido(body.timezone)
    ids = [i.external_id for i in body.items]
    conhecidos = {r["external_id"] for r in await db.fetch(
        "select external_id from public.captured_notifications where workspace_id = %s and external_id = any(%s)",
        ws, ids,
    )}
    # O teto conta CHAMADAS de modelo (custo), inclusive as que concluíram "não é lançamento".
    usados = (await db.fetch_one(
        """select count(*) as n from public.ai_events
           where workspace_id = %s and kind = 'capture' and created_at > now() - interval '1 day'""",
        ws,
    ) or {"n": 0})["n"]
    aceitos = [e for e in ids if e in conhecidos]
    novos = 0
    parado = False
    for item in body.items:
        if item.external_id in conhecidos:
            continue
        banco = banco_do_pacote(item.package)
        if not banco or not tem_valor(f"{item.title} {item.text}"):
            await _gravar(ws, user_id, item, banco or item.package[:128], "ignored")
            aceitos.append(item.external_id)
            continue
        if parado or usados >= MAX_POR_DIA:
            continue  # fica no aparelho
        try:
            rascunho, acao, dia = await _interpretar(user_id, ws, item, banco, fuso)
        except _Parar:
            parado = True
            continue
        usados += 1
        if rascunho is None:
            await _gravar(ws, user_id, item, banco, "ignored")
        else:
            kind = "income" if acao["type"] == "create_income" else "expense"
            valor = int(acao.get("amount_cents") or 0) or None
            ocorreu = date.fromisoformat(acao["occurred_at"]) if acao.get("occurred_at") else dia
            conta = rascunho.params.get("conta")
            match = await _duplicata(ws, kind, valor, ocorreu, acao.get("description"), conta) if valor else None
            await _gravar(ws, user_id, item, banco, "duplicate" if match else "pending", rascunho,
                          kind, valor, ocorreu, match)
            novos += 1
        aceitos.append(item.external_id)
    return EnvioOut(aceitos=aceitos, novos=novos)
```

Em `agent/app/main.py`, junto da linha 136:

```python
from app.routes import captures
...
app.include_router(captures.router)
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd agent && .venv/bin/pytest -q tests/test_captures.py && .venv/bin/ruff check app --select F,E9 && .venv/bin/pytest -q`
Expected: PASS em tudo.

- [ ] **Step 7: Commit**

```bash
git add agent/app/routes/captures.py agent/app/main.py agent/app/jobs/importer.py agent/app/config.py agent/.env.example agent/tests/test_captures.py agent/app/graph/prompts.py agent/app/graph/nodes.py agent/app/graph/state.py agent/tests/test_prompts.py
git commit -m "feat(agente): interpretar notificações dos bancos como lançamentos a confirmar"
```

---

### Task 3: Agente — `POST /internal/finance/draft/media` (imagem compartilhada)

**Files:**
- Modify: `agent/app/routes/finance_draft.py`
- Test: `agent/tests/test_finance_draft.py` (casos novos no fim)

**Interfaces:**
- Consumes: `nodes.finance_node(estado, config)` com `config={"configurable": {CHAVE_MIDIA: {"mime_type", "data_b64"}}}` e `estado["media"] = {"mime_type": ...}` (`agent/app/graph/state.py:73,95`).
- Produces: `POST /internal/finance/draft/media` multipart: `file` (image/jpeg|png|webp|heic|heif, ≤ 8 MB), `today` (YYYY-MM-DD), `timezone` → `RascunhoOut` (o mesmo de `/draft`). Erros: 415 `unsupported_image`, 413 `image_too_large`, 422 `invalid_image`, 422 `no_launch`, 402/429/403 iguais aos de `/draft`.

- [ ] **Step 1: Escrever os testes que falham**

No fim de `agent/tests/test_finance_draft.py`:

```python
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64


def _pede_imagem(conteudo=JPEG, mime="image/jpeg", nome="print.jpg"):
    return _cliente().post(
        "/internal/finance/draft/media",
        files={"file": (nome, conteudo, mime)},
        data={"today": HOJE, "timezone": "America/Sao_Paulo"},
    )


def test_imagem_vira_rascunho_com_a_midia_no_config(mundo, monkeypatch):
    visto = {}

    async def finance_node(estado, config=None):
        visto["estado"], visto["config"] = estado, config
        return {"finance_actions": [{"type": "create_expense", "amount_cents": 4590, "description": "pix"}]}

    monkeypatch.setattr(nodes, "finance_node", finance_node)
    r = _pede_imagem()
    assert r.status_code == 200
    assert r.json()["params"]["amount"] == "4590"
    midia = visto["config"]["configurable"]["midia_do_turno"]
    assert midia["mime_type"] == "image/jpeg" and midia["data_b64"]
    assert visto["estado"]["media"] == {"mime_type": "image/jpeg"}


def test_imagem_que_nao_e_imagem_e_recusada_sem_modelo(mundo, monkeypatch):
    async def nao_chama(*_a, **_k):
        raise AssertionError("não chama o modelo")

    monkeypatch.setattr(nodes, "finance_node", nao_chama)
    assert _pede_imagem(conteudo=b"%PDF-1.4 ...", mime="image/jpeg").status_code == 422
    assert _pede_imagem(mime="application/zip", nome="x.zip").status_code == 415


def test_imagem_grande_demais(mundo):
    assert _pede_imagem(conteudo=JPEG + b"0" * (8 * 1024 * 1024)).status_code == 413
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd agent && .venv/bin/pytest -q tests/test_finance_draft.py -k imagem`
Expected: FAIL com 404/405 (rota não existe).

- [ ] **Step 3: Implementar**

Em `agent/app/routes/finance_draft.py` acrescente os imports (`import base64`, `from fastapi import File, Form, UploadFile`, `from app.graph.state import CHAVE_MIDIA`) e, antes de `@router.post("/draft", ...)`, extraia o trecho comum (perfil + limites) para `_abrir(user_id)` e use-o nas duas rotas:

```python
MAX_IMAGEM = 8 * 1024 * 1024  # o mesmo teto da mídia do WhatsApp (`worker.MAX_MEDIA_BYTES`)
_IMAGENS = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


def _assinatura_de_imagem(b: bytes) -> bool:
    """Estrutura: os bytes são mesmo de uma imagem do tipo aceito (não um PDF com nome de foto)."""
    return (
        b.startswith(b"\xff\xd8\xff")
        or b.startswith(b"\x89PNG\r\n\x1a\n")
        or (b[:4] == b"RIFF" and b[8:12] == b"WEBP")
        or (b[4:8] == b"ftyp" and b[8:12] in {b"heic", b"heix", b"mif1", b"msf1", b"heif"})
    )


async def _abrir(user_id):
    """Perfil + cota, igual para fala e imagem: o rascunho é uma mensagem de IA do plano."""
    perfil = await db.chat_profile(user_id)
    if not perfil or not perfil.get("workspace_id"):
        raise _erro(404, "no_workspace", "Não achei o seu espaço.")
    sessao = {"user_id": user_id, "workspace_id": perfil["workspace_id"], "channel": "app"}
    limite = await conversation.check_limits(sessao)
    if limite:
        if limite == conversation.SEM_CONSENTIMENTO_IA:
            raise conversation.ConsentimentoNecessario()
        if limite == conversation.MUITAS:
            raise _erro(429, "rate_limit", "Muitas mensagens em pouco tempo. Aguarda um pouquinho.")
        raise _erro(402, "plan_limit", limite)
    return perfil


@router.post("/draft/media", response_model=RascunhoOut)
async def rascunho_da_imagem(
    user_id: Annotated[UUID, Depends(current_user)],
    file: Annotated[UploadFile, File()],
    today: Annotated[date, Form()],
    timezone: Annotated[str, Form(min_length=1, max_length=64)],
) -> RascunhoOut:
    try:
        if file.content_type not in _IMAGENS:
            raise _erro(415, "unsupported_image", "Formato de imagem não aceito.")
        dados = await file.read(MAX_IMAGEM + 1)
    finally:
        await file.close()
    if len(dados) > MAX_IMAGEM:
        raise _erro(413, "image_too_large", "A imagem é grande demais. Mande um print.")
    if not _assinatura_de_imagem(dados):
        raise _erro(422, "invalid_image", "O arquivo não é uma imagem válida.")
    perfil = await _abrir(user_id)
    fuso = _fuso_valido(timezone)
    texto = "Extraia o lançamento deste comprovante, cupom ou print de notificação."
    estado = {"text": texto, "timezone": fuso, "workspace_id": perfil["workspace_id"], "messages": None,
              "agora_local": f"{today.isoformat()}T12:00:00", "media": {"mime_type": file.content_type}}
    config = {"configurable": {CHAVE_MIDIA: {"mime_type": file.content_type,
                                             "data_b64": base64.b64encode(dados).decode()}}}
    try:
        saida = await nodes.finance_node(estado, config)
    except Exception:  # noqa: BLE001
        log.warning("Falha na interpretação do rascunho por imagem")
        await conversation.soltar_reserva()
        raise _erro(502, "draft_failed", "Não consegui ler a imagem agora. Tente de novo.") from None
    acoes = [x for x in saida.get("finance_actions", []) if x.get("type") in _CRIA]
    await db.record_ai_event(
        user_id=user_id, workspace_id=perfil["workspace_id"], channel="app",
        model=ia.modelo(ia.PAPEL_PARSE), confidence=saida.get("confidence"),
        result={"finance_actions": saida.get("finance_actions", []), "llm_calls": 1, "draft": True, "media": True},
    )
    if not acoes:
        raise _erro(422, "no_launch", "Não achei um lançamento nessa imagem.")
    return await montar_rascunho(perfil["workspace_id"], texto, acoes, today, None)
```

E troque o começo de `rascunho(...)` (as linhas que buscam o perfil e conferem o limite) por `perfil = await _abrir(user_id)`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd agent && .venv/bin/pytest -q tests/test_finance_draft.py && .venv/bin/ruff check app --select F,E9`
Expected: PASS (inclusive os testes antigos da voz).

- [ ] **Step 5: Commit**

```bash
git add agent/app/routes/finance_draft.py agent/tests/test_finance_draft.py
git commit -m "feat(agente): rascunho de lançamento a partir de imagem compartilhada"
```

---

### Task 4: Sonda com modelo real — notificação vira o lançamento certo (ou nenhum)

O pytest usa dublê e dublê sempre concorda (`workflow.md`, passo 4). O prompt do FINANCE não muda, mas a ENTRADA é nova: medir antes de confiar.

**Files:**
- Create: `agent/scripts/probe_captura_notificacao.py`

**Interfaces:**
- Consumes: `captures.origem_da_notificacao`, `captures.texto_da_notificacao`, `nodes.finance_node` (com `state["origem"]`, Task 2 Step 2b). `workspace_id: None` é seguro: `_contas_do_turno` e `_detalhes_do_turno` (`nodes.py:274,303`) devolvem `[]` sem espaço.

- [ ] **Step 1: Escrever a sonda**

```python
"""Sonda: o texto de uma notificação de banco vira o lançamento certo — ou nenhum.

Roda no Gemini GRATUITO (IA_TABELA=economica) e imprime quantas chamadas fará antes de fazer.
Textos SINTÉTICOS no formato comum dos bancos; trocar por reais (anonimizados) quando houver.

    cd agent && .venv/bin/python scripts/probe_captura_notificacao.py
"""

import asyncio
import os
import sys

os.environ.setdefault("IA_TABELA", "economica")
os.environ["LANGFUSE_PUBLIC_KEY"] = ""

from app.graph import nodes  # noqa: E402
from app.routes.captures import origem_da_notificacao, texto_da_notificacao  # noqa: E402

# (banco, título, texto, esperado) — esperado: ("expense"|"income", centavos) ou None
CASOS = [
    ("Nubank", "Compra aprovada", "Compra de R$ 45,90 APROVADA em MERCADO SAO JOSE para o cartão com final 1234.", ("expense", 4590)),
    ("Nubank", "Pix enviado", "Você enviou um Pix de R$ 120,00 para Maria Silva.", ("expense", 12000)),
    ("Nubank", "Pix recebido", "Você recebeu um Pix de R$ 1.500,00 de EMPRESA LTDA.", ("income", 150000)),
    ("Itaú", "Itaú", "Compra aprovada no cartão final 9876 de R$ 89,90 em IFOOD *RESTAURANTE em 12/10 às 13:02.", ("expense", 8990)),
    ("Inter", "Pix", "Pix de R$ 35,00 recebido de JOAO P.", ("income", 3500)),
    ("C6 Bank", "Compra no débito", "Compra no débito de R$ 12,50 em PADARIA PAO QUENTE.", ("expense", 1250)),
    ("Mercado Pago", "Você pagou", "Você pagou R$ 59,99 para Netflix.", ("expense", 5999)),
    ("Banco do Brasil", "BB", "Transferência de R$ 200,00 enviada para CONTA 12345-6.", ("expense", 20000)),
    ("Nubank", "Fatura fechada", "A fatura do seu cartão fechou no valor de R$ 1.234,56. Vence em 20/10.", None),
    ("Nubank", "Limite", "Seu limite disponível agora é de R$ 800,00.", None),
    ("PicPay", "Cashback", "Você ganhou R$ 5,00 de cashback! Use até 30/10.", None),
    ("Itaú", "Saldo", "Seu saldo em conta é R$ 3.210,00.", None),
    ("Santander", "Oferta", "Empréstimo pré-aprovado de até R$ 10.000,00. Contrate agora!", None),
    ("Bradesco", "Compra negada", "Compra de R$ 300,00 em LOJA X foi NEGADA por saldo insuficiente.", None),
    ("Nubank", "Compra aprovada", "Compra de R$ 600,00 em 3x APROVADA em MAGAZINE LUIZA.", ("expense", 60000)),
    ("Caixa", "Pagamento", "Pagamento de boleto de R$ 150,75 realizado com sucesso.", ("expense", 15075)),
]
CRIA = {"create_expense", "create_income", "create_installment_purchase", "mark_paid"}


async def main() -> int:
    print(f"{len(CASOS)} chamadas ao modelo (parse).")
    erros = 0
    for banco, titulo, texto, esperado in CASOS:
        estado = {"text": texto_da_notificacao(titulo, texto), "origem": origem_da_notificacao(banco),
                  "timezone": "America/Sao_Paulo", "workspace_id": None, "messages": None,
                  "agora_local": "2026-10-12T13:05:00"}
        saida = await nodes.finance_node(estado)
        acoes = [a for a in saida.get("finance_actions", []) if a.get("type") in CRIA]
        obtido = None
        if acoes:
            a = acoes[0]
            obtido = ("income" if a["type"] == "create_income" else "expense", a.get("amount_cents"))
        ok = obtido == esperado
        erros += not ok
        print(("ok   " if ok else "FALHA"), banco, "|", texto[:60], "→", obtido, "" if ok else f"(esperado {esperado})")
    print(f"\n{len(CASOS) - erros}/{len(CASOS)}")
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

- [ ] **Step 2: Rodar**

Run: `cd agent && .venv/bin/python scripts/probe_captura_notificacao.py`
Expected: `16/16`. Saída 1 = falhou: NÃO mexer no prompt do FINANCE por isso (ele alcança todas as seções da suíte). Ajuste a frase de `origem_da_notificacao` (é só da captura, fora do envelope), rode a sonda de novo e, se a frase mudar, rode também `pytest -q tests/test_captures.py`. Aceite só com 16/16 em duas rodadas seguidas. Se o modelo responder `429`/`503` (cota), espere e rode de novo — não conte como resultado.

Depois, UMA rodada na tabela de PRODUÇÃO (o parse em produção é Claude Haiku, não o Lite das suítes): rode com a variável que seleciona a tabela de produção (`IA_TABELA` sem `economica` — confira o nome do valor em `ia.MODELOS`/`ia.py`). São 16 chamadas no Haiku, centavos de dólar no workspace `staging` da Anthropic. Expected: `16/16` também.

- [ ] **Step 3: Commit**

```bash
git add agent/scripts/probe_captura_notificacao.py agent/app/routes/captures.py
git commit -m "test(agente): sonda de notificações de banco com modelo real"
```

---

### Task 5: Módulo nativo `modules/proops-captura` (Android)

**Files:**
- Create: `modules/proops-captura/expo-module.config.json`
- Create: `modules/proops-captura/index.ts`
- Create: `modules/proops-captura/android/build.gradle`
- Create: `modules/proops-captura/android/src/main/AndroidManifest.xml`
- Create: `modules/proops-captura/android/src/main/java/expo/modules/proopscaptura/Captura.kt`
- Create: `modules/proops-captura/android/src/main/java/expo/modules/proopscaptura/CapturaService.kt`
- Create: `modules/proops-captura/android/src/main/java/expo/modules/proopscaptura/ProOpsCapturaModule.kt`
- Test: `modules/proops-captura/module.test.js`

**Interfaces:**
- Produces (JS, `modules/proops-captura/index.ts`):
  - `capturaDisponivel(): boolean` — `false` fora do Android (módulo ausente).
  - `acessoConcedido(): boolean`
  - `abrirAjustes(): void`
  - `estadoDaCaptura(): { ativa: boolean; pacotes: string[] }`
  - `configurarCaptura(ativa: boolean, pacotes: string[]): void`
  - `notificacoesPendentes(): NotificacaoCapturada[]` com `type NotificacaoCapturada = { id: string; package: string; title: string; text: string; posted_at: number }` (ms desde a época)
  - `removerPendentes(ids: string[]): void`

- [ ] **Step 1: Escrever o teste que falha**

`modules/proops-captura/module.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const raiz = __dirname;
const kt = (nome) => fs.readFileSync(path.join(raiz, 'android/src/main/java/expo/modules/proopscaptura', nome), 'utf8');

test('registra o módulo só no Android', () => {
  const config = JSON.parse(fs.readFileSync(path.join(raiz, 'expo-module.config.json'), 'utf8'));
  assert.deepEqual(config.platforms, ['android']);
  assert.deepEqual(config.android.modules, ['expo.modules.proopscaptura.ProOpsCapturaModule']);
});

test('declara o listener protegido pela permissão do sistema', () => {
  const manifesto = fs.readFileSync(path.join(raiz, 'android/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(manifesto, /android:name="expo\.modules\.proopscaptura\.CapturaService"/);
  assert.match(manifesto, /android:permission="android\.permission\.BIND_NOTIFICATION_LISTENER_SERVICE"/);
  assert.match(manifesto, /android\.service\.notification\.NotificationListenerService/);
});

test('o serviço filtra por pacote escolhido e só grava com a captura ligada', () => {
  const fonte = kt('Captura.kt');
  assert.match(fonte, /if \(!ativa\(ctx\) \|\| sbn\.packageName !in pacotes\(ctx\)\) return/);
  assert.match(fonte, /FLAG_GROUP_SUMMARY/);
  assert.match(fonte, /MAX_PENDENTES/);
  assert.match(fonte, /300_000/); // janela de 5 min no id
});

test('o serviço não fala com a rede', () => {
  for (const nome of ['Captura.kt', 'CapturaService.kt', 'ProOpsCapturaModule.kt']) {
    assert.doesNotMatch(kt(nome), /HttpURLConnection|OkHttp|java\.net\.URL|WorkManager/);
  }
});

test('expõe as funções que o app usa', () => {
  const fonte = kt('ProOpsCapturaModule.kt');
  for (const f of ['acessoConcedido', 'abrirAjustes', 'estado', 'configurar', 'pendentes', 'remover']) {
    assert.match(fonte, new RegExp(`Function\\("${f}"\\)`));
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test modules/proops-captura/module.test.js`
Expected: FAIL com `ENOENT`.

- [ ] **Step 3: Escrever o módulo**

`modules/proops-captura/expo-module.config.json`:

```json
{
  "platforms": ["android"],
  "android": { "modules": ["expo.modules.proopscaptura.ProOpsCapturaModule"] }
}
```

`modules/proops-captura/android/build.gradle`:

```groovy
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = 'expo.modules.proopscaptura'
version = '1.0.0'

android {
  namespace "expo.modules.proopscaptura"
  defaultConfig {
    versionCode 1
    versionName '1.0.0'
  }
}
```

`modules/proops-captura/android/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application>
    <!-- Lê as notificações dos bancos ESCOLHIDOS no app (Perfil → Lançar pelas notificações).
         Só o sistema liga neste serviço (BIND_NOTIFICATION_LISTENER_SERVICE), e só depois de a
         pessoa conceder "Acesso a notificações" nas configurações. -->
    <service
      android:name="expo.modules.proopscaptura.CapturaService"
      android:label="ProOps"
      android:exported="true"
      android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
      <intent-filter>
        <action android:name="android.service.notification.NotificationListenerService" />
      </intent-filter>
    </service>
  </application>
</manifest>
```

`Captura.kt`:

```kotlin
package expo.modules.proopscaptura

import android.app.Notification
import android.content.Context
import android.content.SharedPreferences
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * A fila local das notificações capturadas. O serviço grava; o JS lê, envia ao agente e remove o que
 * o agente aceitou. Nada aqui fala com a rede: sem token no nativo (spec, decisão 5).
 */
object Captura {
  private const val PREFS = "proops_captura"
  private const val ARQUIVO = "captura-pendentes.json"
  // ponytail: teto da fila local; passou disso, as mais antigas saem (o app ficou semanas fechado)
  private const val MAX_PENDENTES = 200

  private fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  fun ativa(ctx: Context): Boolean = prefs(ctx).getBoolean("ativa", false)
  fun pacotes(ctx: Context): Set<String> = prefs(ctx).getStringSet("pacotes", emptySet()) ?: emptySet()

  fun configurar(ctx: Context, ativa: Boolean, pacotes: List<String>) {
    prefs(ctx).edit().putBoolean("ativa", ativa).putStringSet("pacotes", pacotes.toSet()).apply()
    if (!ativa) gravar(ctx, emptyList())
  }

  @Synchronized
  fun registrar(ctx: Context, sbn: StatusBarNotification) {
    if (!ativa(ctx) || sbn.packageName !in pacotes(ctx)) return
    val n = sbn.notification ?: return
    if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    val ex = n.extras ?: return
    val titulo = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty().take(200)
    val texto = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))
      ?.toString().orEmpty().take(1000)
    if (texto.isBlank()) return
    // ponytail: a mesma notificação reposta em até 5 min é uma só; duas compras idênticas na mesma
    // janela também viram uma (raro; a pessoa lança a segunda à mão)
    val id = sha256("${sbn.packageName}|$titulo|$texto|${sbn.postTime / 300_000}")
    val atuais = ler(ctx)
    if (atuais.any { it.optString("id") == id }) return
    val nova = JSONObject()
      .put("id", id).put("package", sbn.packageName).put("title", titulo)
      .put("text", texto).put("posted_at", sbn.postTime)
    gravar(ctx, (atuais + nova).takeLast(MAX_PENDENTES))
  }

  @Synchronized
  fun pendentes(ctx: Context): List<JSONObject> = ler(ctx)

  @Synchronized
  fun remover(ctx: Context, ids: Set<String>) {
    gravar(ctx, ler(ctx).filter { it.optString("id") !in ids })
  }

  private fun arquivo(ctx: Context) = File(ctx.filesDir, ARQUIVO)

  private fun ler(ctx: Context): List<JSONObject> {
    val f = arquivo(ctx)
    if (!f.exists()) return emptyList()
    return try {
      val arr = JSONArray(f.readText())
      (0 until arr.length()).map { arr.getJSONObject(it) }
    } catch (e: Exception) {
      emptyList() // arquivo corrompido: recomeça vazio em vez de travar a captura
    }
  }

  private fun gravar(ctx: Context, itens: List<JSONObject>) {
    val tmp = File(ctx.filesDir, "$ARQUIVO.tmp")
    tmp.writeText(JSONArray(itens).toString())
    tmp.renameTo(arquivo(ctx))
  }

  private fun sha256(s: String): String =
    MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}
```

`CapturaService.kt`:

```kotlin
package expo.modules.proopscaptura

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

class CapturaService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      Captura.registrar(applicationContext, sbn)
    } catch (e: Exception) {
      Log.w("ProOpsCaptura", "não consegui registrar a notificação", e)
    }
  }
}
```

`ProOpsCapturaModule.kt`:

```kotlin
package expo.modules.proopscaptura

import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ProOpsCapturaModule : Module() {
  private val ctx get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ProOpsCaptura")

    Function("acessoConcedido") {
      val nome = ComponentName(ctx, CapturaService::class.java).flattenToString()
      val ligados = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners").orEmpty()
      ligados.split(":").any { it == nome }
    }

    Function("abrirAjustes") {
      val detalhe = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(
          Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
          ComponentName(ctx, CapturaService::class.java).flattenToString(),
        )
      } else {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      }
      try {
        ctx.startActivity(detalhe.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (e: Exception) {
        ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    Function("estado") {
      mapOf("ativa" to Captura.ativa(ctx), "pacotes" to Captura.pacotes(ctx).toList())
    }

    Function("configurar") { ativa: Boolean, pacotes: List<String> ->
      Captura.configurar(ctx, ativa, pacotes)
    }

    Function("pendentes") {
      Captura.pendentes(ctx).map {
        mapOf(
          "id" to it.optString("id"), "package" to it.optString("package"),
          "title" to it.optString("title"), "text" to it.optString("text"),
          "posted_at" to it.optLong("posted_at"),
        )
      }
    }

    Function("remover") { ids: List<String> ->
      Captura.remover(ctx, ids.toSet())
    }
  }
}
```

`modules/proops-captura/index.ts`:

```ts
import { requireOptionalNativeModule } from 'expo-modules-core';

export type NotificacaoCapturada = { id: string; package: string; title: string; text: string; posted_at: number };

type Nativo = {
  acessoConcedido(): boolean;
  abrirAjustes(): void;
  estado(): { ativa: boolean; pacotes: string[] };
  configurar(ativa: boolean, pacotes: string[]): void;
  pendentes(): NotificacaoCapturada[];
  remover(ids: string[]): void;
};

// Só existe no Android: no iOS nenhum app lê notificação de outro (spec).
const nativo = requireOptionalNativeModule<Nativo>('ProOpsCaptura');

export const capturaDisponivel = () => nativo != null;
export const acessoConcedido = () => nativo?.acessoConcedido() ?? false;
export const abrirAjustes = () => nativo?.abrirAjustes();
export const estadoDaCaptura = () => nativo?.estado() ?? { ativa: false, pacotes: [] };
export const configurarCaptura = (ativa: boolean, pacotes: string[]) => nativo?.configurar(ativa, pacotes);
export const notificacoesPendentes = (): NotificacaoCapturada[] => nativo?.pendentes() ?? [];
export const removerPendentes = (ids: string[]) => { if (ids.length) nativo?.remover(ids); };
```

- [ ] **Step 4: Rodar e ver passar; compilar no Android**

```bash
node --test modules/proops-captura/module.test.js
npx expo prebuild --platform android --clean </dev/null && (cd android && ./gradlew :app:assembleDebug -q)
```
Expected: os 5 testes passam; o build compila. Confira o manifesto mesclado:
`grep -rn "CapturaService" android/app/build/intermediates/merged_manifests/ | head -3` — deve aparecer com `BIND_NOTIFICATION_LISTENER_SERVICE`.

- [ ] **Step 5: Commit**

```bash
git add modules/proops-captura
git commit -m "feat(app): módulo Android que guarda notificações dos bancos escolhidos"
```

---

### Task 6: App — lista de bancos, API e hooks

**Files:**
- Create: `src/lib/captura.ts`
- Test: `src/lib/captura.test.ts`
- Modify: `src/lib/agent-api.ts` (duas funções)
- Create: `src/hooks/use-capturas.ts`

**Interfaces:**
- Consumes: `NotificacaoCapturada` e funções do módulo (Task 5); `POST /internal/captures/notifications` (Task 2); `POST /internal/finance/draft/media` (Task 3); `hrefDoRascunho`, `FinanceDraft` (`src/lib/voice-draft.ts`).
- Produces:
  - `BANCOS: readonly { pacote: string; nome: string }[]`, `PACOTE_TESTE = 'com.android.shell'`, `bancosDisponiveis(dev: boolean)`
  - `paraEnvio(fila: Capturada[]): NotificacaoIn[]` (converte `posted_at` para ISO)
  - `enviarFila(deps: { pendentes, remover, enviar }): Promise<number>` — lotes de 20, remove só os `aceitos`, para no primeiro erro; devolve quantos removeu.
  - `hrefDaCaptura(c: { id: string; draft: FinanceDraft })` — `hrefDoRascunho` + `captura: id`.
  - `agent-api.ts`: `enviarNotificacoes(items, timezone) -> Promise<{ aceitos: string[]; novos: number }>`, `rascunhoDaImagem(uri, today, timezone) -> Promise<FinanceDraft>`.
  - `use-capturas.ts`: `Captura` (tipo), `useCapturas()` (lista `pending` + `duplicate`), `useResolverCaptura()` (`{ id, status: 'confirmed' | 'discarded' | 'pending' }`), `useEnviarCapturas()` (envia ao abrir e ao voltar ao primeiro plano).

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/captura.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { BANCOS, PACOTE_TESTE, bancosDisponiveis, enviarFila, hrefDaCaptura, paraEnvio } from './captura.ts';

const n = (id: string) => ({ id, package: 'com.nu.production', title: 'Compra', text: 'R$ 1,00', posted_at: Date.UTC(2026, 9, 12, 15, 30) });

test('a lista de bancos é a mesma do agente (12 pacotes) e o de teste só em dev', () => {
  assert.equal(BANCOS.length, 12);
  assert.ok(BANCOS.some((b) => b.pacote === 'com.nu.production' && b.nome === 'Nubank'));
  assert.ok(!bancosDisponiveis(false).some((b) => b.pacote === PACOTE_TESTE));
  assert.ok(bancosDisponiveis(true).some((b) => b.pacote === PACOTE_TESTE));
});

test('a lista do app é IGUAL à do agente', async () => {
  const fs = await import('node:fs');
  const py = fs.readFileSync(new URL('../../agent/app/routes/captures.py', import.meta.url), 'utf8');
  for (const b of BANCOS) assert.ok(py.includes(`"${b.pacote}": "${b.nome}"`), `${b.pacote} divergiu`);
});

test('paraEnvio troca o id pelo external_id e a data por ISO', () => {
  const [x] = paraEnvio([n('a'.repeat(64))]);
  assert.equal(x.external_id, 'a'.repeat(64));
  assert.equal(x.posted_at, '2026-10-12T15:30:00.000Z');
});

test('enviarFila manda em lotes de 20 e remove só o aceito', async () => {
  const fila = Array.from({ length: 25 }, (_, i) => n(`id-${String(i).padStart(6, '0')}`));
  const removidos: string[] = [];
  const lotes: number[] = [];
  const total = await enviarFila({
    pendentes: () => fila,
    remover: (ids) => { removidos.push(...ids); },
    enviar: async (itens) => { lotes.push(itens.length); return { aceitos: itens.slice(1).map((i) => i.external_id) }; },
  });
  assert.deepEqual(lotes, [20, 5]);
  assert.equal(total, 23);
  assert.ok(!removidos.includes('id-000000'));
});

test('enviarFila para no primeiro erro sem apagar nada daquele lote', async () => {
  const removidos: string[] = [];
  await assert.rejects(enviarFila({
    pendentes: () => [n('id-000001')],
    remover: (ids) => { removidos.push(...ids); },
    enviar: async () => { throw new Error('403'); },
  }));
  assert.deepEqual(removidos, []);
});

test('hrefDaCaptura leva o id da captura ao formulário', () => {
  const href = hrefDaCaptura({ id: 'c1', draft: { tipo: 'uma', params: { kind: 'expense', amount: '4590' }, perguntas: [], entendido: 'x' } });
  assert.equal(href.pathname, '/finance/lancar');
  assert.equal(href.params.captura, 'c1');
  assert.equal(href.params.amount, '4590');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/lib/captura.test.ts`
Expected: FAIL com `Cannot find module './captura.ts'`.

- [ ] **Step 3: Implementar `src/lib/captura.ts`**

```ts
/**
 * Captura de lançamentos pelas notificações dos bancos (Android). Puro: a lista de bancos, o envio da
 * fila local ao agente e o link do "a confirmar" para o formulário.
 * Spec: docs/superpowers/specs/2026-10-12-captura-de-lancamentos-design.md
 */
import { hrefDoRascunho, type FinanceDraft } from './voice-draft.ts';

/** Mesma lista de `agent/app/routes/captures.py` (pacotes conferidos na Play Store em 12/10/2026). */
export const BANCOS = [
  { pacote: 'com.nu.production', nome: 'Nubank' },
  { pacote: 'com.itau', nome: 'Itaú' },
  { pacote: 'br.com.bb.android', nome: 'Banco do Brasil' },
  { pacote: 'com.bradesco', nome: 'Bradesco' },
  { pacote: 'br.com.gabba.Caixa', nome: 'Caixa' },
  { pacote: 'com.santander.app', nome: 'Santander' },
  { pacote: 'br.com.intermedium', nome: 'Inter' },
  { pacote: 'com.c6bank.app', nome: 'C6 Bank' },
  { pacote: 'com.picpay', nome: 'PicPay' },
  { pacote: 'com.mercadopago.wallet', nome: 'Mercado Pago' },
  { pacote: 'br.com.neon', nome: 'Neon' },
  { pacote: 'br.com.uol.ps.myaccount', nome: 'PagBank' },
] as const;

/** `adb shell cmd notification post` publica como este pacote: só para testar em desenvolvimento. */
export const PACOTE_TESTE = 'com.android.shell';

export function bancosDisponiveis(dev: boolean): { pacote: string; nome: string }[] {
  return dev ? [...BANCOS, { pacote: PACOTE_TESTE, nome: 'Teste (adb)' }] : [...BANCOS];
}

export type Capturada = { id: string; package: string; title: string; text: string; posted_at: number };
export type NotificacaoIn = { external_id: string; package: string; title: string; text: string; posted_at: string };

export function paraEnvio(fila: Capturada[]): NotificacaoIn[] {
  return fila.map((c) => ({
    external_id: c.id, package: c.package, title: c.title, text: c.text,
    posted_at: new Date(c.posted_at).toISOString(),
  }));
}

const LOTE = 20;

/** Envia a fila em lotes; apaga do aparelho só o que o agente ACEITOU. Erro para tudo (fica para depois). */
export async function enviarFila(deps: {
  pendentes: () => Capturada[];
  remover: (ids: string[]) => void;
  enviar: (itens: NotificacaoIn[]) => Promise<{ aceitos: string[] }>;
}): Promise<number> {
  const itens = paraEnvio(deps.pendentes());
  let removidos = 0;
  for (let i = 0; i < itens.length; i += LOTE) {
    const { aceitos } = await deps.enviar(itens.slice(i, i + LOTE));
    deps.remover(aceitos);
    removidos += aceitos.length;
  }
  return removidos;
}

export function hrefDaCaptura(c: { id: string; draft: FinanceDraft }) {
  const href = hrefDoRascunho(c.draft);
  return { ...href, params: { ...href.params, captura: c.id } };
}
```

- [ ] **Step 4: API**

Em `src/lib/agent-api.ts`, depois de `createFinanceDraft`:

```ts
/** Notificações de banco capturadas no aparelho (Android): o agente interpreta e guarda "a confirmar". */
export function enviarNotificacoes(items: NotificacaoIn[], timezone: string) {
  return agentFetch<{ aceitos: string[]; novos: number }>('/internal/captures/notifications', {
    method: 'POST',
    body: JSON.stringify({ timezone, items }),
  });
}

/** O rascunho de lançamento de uma imagem compartilhada (comprovante, print): só interpreta. */
export async function rascunhoDaImagem(uri: string, today: string, timezone: string) {
  const file = new File(uri);
  if (!file.exists || file.size === 0) {
    throw new AgentApiError(422, 'invalid_image', 'A imagem chegou vazia. Tente compartilhar de novo.');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new AgentApiError(413, 'image_too_large', 'A imagem é grande demais. Mande um print.');
  }
  const body = new FormData();
  body.append('file', file);
  body.append('today', today);
  body.append('timezone', timezone);
  return agentFetch<FinanceDraft>('/internal/finance/draft/media', { method: 'POST', body });
}
```

Com `import type { NotificacaoIn } from './captura';` no topo e o tipo `FinanceDraft` que `createFinanceDraft` já usa.

- [ ] **Step 5: Hooks `src/hooks/use-capturas.ts`**

```ts
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { capturaDisponivel, estadoDaCaptura, notificacoesPendentes, removerPendentes } from '../../modules/proops-captura';
import { useRealtimeInvalidate } from '@/hooks/use-items';
import { useSession } from '@/hooks/use-session';
import { enviarNotificacoes } from '@/lib/agent-api';
import { enviarFila } from '@/lib/captura';
import { useQuery } from '@/lib/consulta-em-foco';
import { supabase } from '@/lib/supabase';
import type { FinanceDraft } from '@/lib/voice-draft';

export type Captura = {
  id: string; bank: string; posted_at: string; status: 'pending' | 'duplicate';
  draft: FinanceDraft; entendido: string | null; amount_cents: number | null;
  occurred_at: string | null; match_transaction_id: string | null;
};

const CHAVE = ['captured_notifications'];

/** O que está "a confirmar" (e o que parece já lançado), do mais recente para o mais antigo. */
export function useCapturas() {
  useRealtimeInvalidate('captured_notifications', CHAVE);
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('captured_notifications')
        .select('id, bank, posted_at, status, draft, entendido, amount_cents, occurred_at, match_transaction_id')
        .in('status', ['pending', 'duplicate'])
        .order('posted_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Captura[];
    },
  });
}

/** Confirmar/descartar apaga o texto da notificação: ele só existe enquanto o item está em aberto. */
export function useResolverCaptura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'confirmed' | 'discarded' | 'pending' }) => {
      const { error } = await supabase
        .from('captured_notifications')
        .update(status === 'pending' ? { status } : { status, texto: null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

/** Envia a fila local ao abrir o app e ao voltar ao primeiro plano. Falha fica para a próxima vez. */
export function useEnviarCapturas() {
  const userId = useSession().session?.user.id;
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId || !capturaDisponivel()) return;
    let enviando = false;
    const enviar = async () => {
      if (enviando || !estadoDaCaptura().ativa) return;
      enviando = true;
      try {
        const n = await enviarFila({
          pendentes: notificacoesPendentes,
          remover: removerPendentes,
          enviar: (itens) => enviarNotificacoes(itens, Intl.DateTimeFormat().resolvedOptions().timeZone),
        });
        if (n) void qc.invalidateQueries({ queryKey: CHAVE });
      } catch {
        // sem rede, sem consentimento ou cota: a fila continua no aparelho
      } finally {
        enviando = false;
      }
    };
    void enviar();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void enviar(); });
    return () => sub.remove();
  }, [userId, qc]);
}
```

Confira os caminhos de `useSession` e `useRealtimeInvalidate` copiando os imports de `src/hooks/use-consentimento.ts` e `src/hooks/use-items.ts`.

- [ ] **Step 6: Rodar e ver passar**

Run: `node --test src/lib/captura.test.ts && npx tsc --noEmit && npx expo lint`
Expected: PASS e limpos.

- [ ] **Step 7: Commit**

```bash
git add src/lib/captura.ts src/lib/captura.test.ts src/lib/agent-api.ts src/hooks/use-capturas.ts
git commit -m "feat(app): enviar notificações capturadas e ler o que está a confirmar"
```

---

### Task 7: App — telas (Perfil, ajustes da captura, Hoje, lista, formulário)

**Files:**
- Create: `src/app/captura-notificacoes.tsx` (ajustes)
- Create: `src/app/finance/capturas.tsx` (lista)
- Create: `src/components/feed/capturas-da-hoje.tsx` (bloco da Hoje)
- Modify: `src/app/_layout.tsx` (registrar as duas rotas; montar `useEnviarCapturas()` no componente que já está dentro da sessão)
- Modify: `src/app/(tabs)/profile/index.tsx:490-496` (linha "Lançar pelas notificações")
- Modify: `src/app/(tabs)/today/index.tsx` (bloco `capturasBlock` nas duas listas de blocos)
- Modify: `src/app/finance/lancar.tsx` (param `captura`)
- Modify: `src/lib/anti-slop.test.ts` (`VAZIO_GRANDE_PERMITIDO` para `finance/capturas.tsx`)
- Modify: `src/components/ui/icon.tsx` (só se algum ícone usado faltar no mapa)
- Test: `src/lib/captura-ui.test.ts`

**Interfaces:**
- Consumes: Task 5 (módulo), Task 6 (`bancosDisponiveis`, `hrefDaCaptura`, `useCapturas`, `useResolverCaptura`, `useEnviarCapturas`).
- Produces: rotas `/captura-notificacoes` e `/finance/capturas`; param `captura` em `/finance/lancar`.

- [ ] **Step 1: Teste de contrato que falha**

`src/lib/captura-ui.test.ts` (lê os arquivos, no padrão do `anti-slop.test.ts`):

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ler = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('salvar no formulário confirma a captura que o abriu', () => {
  const lancar = ler('app/finance/lancar.tsx');
  assert.match(lancar, /p\.captura/);
  assert.match(lancar, /status: 'confirmed'/);
});

test('o Perfil só mostra a captura onde o módulo existe (sem Platform.OS na tela)', () => {
  const perfil = ler('app/(tabs)/profile/index.tsx');
  assert.match(perfil, /capturaDisponivel\(\)/);
  assert.match(perfil, /Lançar pelas notificações/);
});

test('a tela de ajustes explica o que é lido antes de pedir o acesso', () => {
  const tela = ler('app/captura-notificacoes.tsx');
  assert.match(tela, /nunca saem do aparelho/);
  assert.match(tela, /abrirAjustes/);
});

test('a Hoje mostra só o que está pendente, nunca o duplicado', () => {
  assert.match(ler('components/feed/capturas-da-hoje.tsx'), /status === 'pending'/);
});

test('o envio da fila é montado uma vez, dentro da sessão', () => {
  assert.match(ler('app/_layout.tsx'), /useEnviarCapturas\(\)/);
});
```

Run: `node --test src/lib/captura-ui.test.ts`
Expected: FAIL (`ENOENT` ou sem casamento).

- [ ] **Step 2: Formulário — param `captura`**

Em `src/app/finance/lancar.tsx`, no `onSalvo` (~linha 169), antes de `if (!criarOutro) return router.back();`:

```tsx
    // Veio de "A confirmar" (captura de notificação): o lançamento salvo confirma a captura.
    if (doAplicar && p.captura) resolverCaptura.mutate({ id: p.captura, status: 'confirmed' });
```

Com `const resolverCaptura = useResolverCaptura();` junto dos outros hooks do componente e `captura?: string` no tipo dos params (o mesmo objeto `p` que já lê `perguntas`). As `perguntas` do rascunho já aparecem no topo (`perguntasDoParam(p.perguntas)`): nada mais muda no formulário.

- [ ] **Step 3: Tela de ajustes `src/app/captura-notificacoes.tsx`**

Antes de escrever, abra `src/app/consentimento.tsx` e a seção "Finanças" do Perfil e copie os nomes EXATOS de props de `Section`, `Row`, `Note` e `Interruptor` (`src/components/ui/switch-row.tsx:40`). O esqueleto:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { Stack } from 'expo-router';

import { abrirAjustes, acessoConcedido, configurarCaptura, estadoDaCaptura } from '../../modules/proops-captura';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/ui/note';
import { Row } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Section } from '@/components/ui/section';
import { Interruptor } from '@/components/ui/switch-row';
import { bancosDisponiveis } from '@/lib/captura';

export default function CapturaNotificacoes() {
  const [estado, setEstado] = useState(estadoDaCaptura);
  const [acesso, setAcesso] = useState(acessoConcedido);
  const reler = useCallback(() => { setEstado(estadoDaCaptura()); setAcesso(acessoConcedido()); }, []);
  // voltar das configurações do Android traz o app ao primeiro plano: relê o acesso
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') reler(); });
    return () => sub.remove();
  }, [reler]);

  const gravar = (ativa: boolean, pacotes: string[]) => { configurarCaptura(ativa, pacotes); reler(); };
  const ligar = (ativa: boolean) => {
    // primeira vez: liga com todos os bancos marcados; a pessoa desmarca o que não usa
    const pacotes = estado.pacotes.length ? estado.pacotes : bancosDisponiveis(__DEV__).map((b) => b.pacote);
    gravar(ativa, pacotes);
    if (ativa && !acessoConcedido()) abrirAjustes();
  };
  const alternar = (pacote: string, marcado: boolean) =>
    gravar(estado.ativa, marcado ? [...estado.pacotes, pacote] : estado.pacotes.filter((p) => p !== pacote));

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Lançar pelas notificações' }} />
      <Note icon="lock">
        O ProOps lê só as notificações dos bancos que você marcar e monta lançamentos *a confirmar*. As
        outras notificações nunca saem do aparelho, e nada é lançado sem você confirmar.
      </Note>
      <Section>
        <Row title="Ler notificações dos bancos"
          trailing={<Interruptor value={estado.ativa} onValueChange={ligar} accessibilityLabel="Ler notificações dos bancos" />} />
        {estado.ativa ? (
          <Row title="Acesso às notificações"
            subtitle={acesso ? 'Concedido' : 'Não concedido: toque para liberar nas configurações do Android.'}
            onPress={acesso ? undefined : abrirAjustes} />
        ) : null}
      </Section>
      {estado.ativa ? (
        <Section title="Bancos">
          {bancosDisponiveis(__DEV__).map((b) => (
            <Row key={b.pacote} title={b.nome}
              trailing={<Interruptor value={estado.pacotes.includes(b.pacote)} onValueChange={(v) => alternar(b.pacote, v)} accessibilityLabel={b.nome} />} />
          ))}
        </Section>
      ) : null}
      {estado.ativa ? (
        <Section>
          <Note icon="battery.25">Se as compras pararem de aparecer, libere o ProOps da economia de bateria.</Note>
          <Button label="Ajustes de bateria" variant="secondary"
            onPress={() => { void IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS); }} />
        </Section>
      ) : null}
    </Screen>
  );
}
```

Ícones `lock` e `battery.25`: confira em `src/components/ui/icon.tsx`; o que faltar ganha a entrada no mapa SF → Material (`design.md` §4).

- [ ] **Step 4: Perfil**

Em `src/app/(tabs)/profile/index.tsx`, na seção "Finanças" (linhas 490-496), depois de "Importações":

```tsx
{capturaDisponivel() ? (
  <Row title="Lançar pelas notificações" icon="bell.badge" onPress={() => router.push('/captura-notificacoes')} />
) : null}
```

Com `import { capturaDisponivel } from '<caminho relativo até>/modules/proops-captura';` (o mesmo estilo de `src/hooks/use-lock.tsx:37`).

- [ ] **Step 5: Bloco da Hoje `src/components/feed/capturas-da-hoje.tsx`**

Antes, leia um uso real de `BlockHeader` com `action` e de `Deslizavel` (`grep -rn "<Deslizavel" src | head -3`) e do `toast` com ação "Desfazer", e ajuste os nomes. Esqueleto:

```tsx
import { router } from 'expo-router';

import { BlockHeader } from '@/components/ui/block-header';
import { Deslizavel } from '@/components/ui/deslizavel';
import { Row } from '@/components/ui/row';
import { toast } from '@/components/ui/toast';
import { useCapturas, useResolverCaptura } from '@/hooks/use-capturas';
import { hrefDaCaptura } from '@/lib/captura';
import { formatDateBR } from '@/lib/dates';

const NA_HOJE = 3;

/** "A confirmar": compras e Pix lidos das notificações. Some quando não há nada pendente. */
export function CapturasDaHoje() {
  const capturas = useCapturas();
  const resolver = useResolverCaptura();
  if (!capturas.isSuccess) return null; // bloco que pode não existir não desenha esqueleto (design.md §7)
  const pendentes = capturas.data.filter((c) => c.status === 'pending');
  if (!pendentes.length) return null;
  const descartar = (id: string) =>
    resolver.mutate({ id, status: 'discarded' }, {
      onSuccess: () => toast({ message: 'Descartado.', action: { label: 'Desfazer', onPress: () => resolver.mutate({ id, status: 'pending' }) } }),
      onError: () => toast({ message: 'Não deu para descartar. Tente de novo.', tone: 'error' }),
    });
  return (
    <>
      <BlockHeader title="A confirmar" voice="app" count={pendentes.length}
        action={pendentes.length > NA_HOJE ? { label: 'Ver todos', onPress: () => router.push('/finance/capturas') } : undefined} />
      {pendentes.slice(0, NA_HOJE).map((c) => (
        <Deslizavel key={c.id} actions={[
          { label: 'Lançar', icon: 'checkmark', arrasto: 'direita', onPress: () => router.push(hrefDaCaptura(c)) },
          { label: 'Descartar', icon: 'trash', arrasto: 'esquerda', desfaz: true, onPress: () => descartar(c.id) },
        ]}>
          <Row title={c.entendido ?? c.draft.entendido} subtitle={`${c.bank} · ${formatDateBR(c.posted_at.slice(0, 10))}`}
            onPress={() => router.push(hrefDaCaptura(c))} />
        </Deslizavel>
      ))}
    </>
  );
}
```

Os lados seguem `design.md` §6: direita é a ação rápida, esquerda tira da lista.

Em `src/app/(tabs)/today/index.tsx`: `const capturasBlock = <Bloco key="capturas"><CapturasDaHoje /></Bloco>;` e acrescente `capturasBlock` logo DEPOIS de `diaBlock` na lista final (~597) e no slot equivalente do layout de tablet (~587-592). Siga o aviso do arquivo sobre `Fragment` com `null` (vão de 24dp): se o `Bloco` vazio abrir vão, renderize `capturasBlock` só quando `useCapturas()` tiver pendentes.

- [ ] **Step 6: Lista `src/app/finance/capturas.tsx`**

`Screen` com duas seções:

- **"A confirmar"** (status `pending`): a mesma linha e as mesmas ações do bloco da Hoje, 20 por vez com `useAosPoucos` + `VerMais`.
- **"Parecem já lançados"** (status `duplicate`): a linha diz o que é ("Gasto de R$ 23,40 · Nubank") e o subtítulo "Parece já estar no app"; menu com "Lançar mesmo assim" (abre `hrefDaCaptura`) e "Descartar".

Vazio: `EmptyState` grande ("Nada a confirmar", dica "As compras dos bancos que você marcou aparecem aqui"). É a única coisa da tela, então entra em `VAZIO_GRANDE_PERMITIDO` (`anti-slop.test.ts`) com esse motivo.

Registre em `src/app/_layout.tsx`:

```tsx
<Stack.Screen name="captura-notificacoes" options={{ title: 'Lançar pelas notificações' }} />
<Stack.Screen name="finance/capturas" options={{ title: 'A confirmar' }} />
```

E monte o envio uma vez, no componente do layout raiz que já roda com sessão (onde vivem os outros efeitos de sessão): `useEnviarCapturas();`.

- [ ] **Step 7: Rodar tudo**

Run: `node --test src/lib/captura-ui.test.ts && npx tsc --noEmit && npx expo lint && npm test`
Expected: PASS, código de saída 0 no `npm test` (olhe o código, não a contagem).

- [ ] **Step 8: Commit**

```bash
git add src/app/captura-notificacoes.tsx src/app/finance/capturas.tsx src/components/feed/capturas-da-hoje.tsx src/app/_layout.tsx "src/app/(tabs)/profile/index.tsx" "src/app/(tabs)/today/index.tsx" src/app/finance/lancar.tsx src/lib/anti-slop.test.ts src/lib/captura-ui.test.ts src/components/ui/icon.tsx
git commit -m "feat(app): a confirmar na Hoje e ajustes da leitura de notificações"
```

---

### Task 8: Compartilhar — prova de convivência com os widgets e integração

**Files:**
- Modify: `package.json`, `package-lock.json` (`expo-share-intent`)
- Modify: `app.config.js` (plugin por variante)
- Modify: `app.config.test.js` (prende as opções)
- Create: `src/app/+native-intent.tsx` (só se o Step 6 provar que precisa)
- Create: `src/app/compartilhado.tsx`
- Modify: `src/app/_layout.tsx` (`ShareIntentProvider`, rota `compartilhado`)

**Interfaces:**
- Consumes: `rascunhoDaImagem` (Task 6), `createFinanceDraft` (existente), `hrefDoRascunho`.
- Produces: rota `/compartilhado`.

- [ ] **Step 1: Instalar e ler a doc da versão instalada**

```bash
npx expo install expo-share-intent
node -p "require('expo-share-intent/package.json').version"
```
Expected: `8.x`. Leia `node_modules/expo-share-intent/README.md` inteiro (opções do plugin, `ShareIntentProvider`, `useShareIntentContext`, integração com expo-router) antes do próximo passo: os nomes abaixo vêm da README de 12/10/2026 e valem só se baterem com a instalada.

- [ ] **Step 2: Teste do config que falha**

Em `app.config.test.js`, no padrão dos testes que já montam a config por variante:

```js
test('compartilhar: imagem e texto, App Group da própria variante (o mesmo dos widgets)', () => {
  for (const variante of ['development', 'preview', 'production']) {
    const cfg = configDa(variante); // o helper que o arquivo já usa para montar a config por variante
    const share = cfg.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-share-intent');
    assert.ok(share, `sem expo-share-intent em ${variante}`);
    const op = share[1];
    assert.deepEqual(op.androidIntentFilters, ['text/*', 'image/*']);
    assert.equal(op.iosActivationRules.NSExtensionActivationSupportsImageWithMaxCount, 1);
    assert.equal(op.iosActivationRules.NSExtensionActivationSupportsText, true);
    assert.equal(op.iosAppGroupIdentifier, `group.${cfg.ios.bundleIdentifier}`);
  }
});
```

Run: `node --test app.config.test.js`
Expected: FAIL (`sem expo-share-intent`).

- [ ] **Step 3: Plugin no `app.config.js`**

Na lista `plugins`, depois do bloco de `expo-widgets`:

```js
      /*
        Compartilhar comprovante/print para o ProOps (12/10/2026). O App Group é o MESMO dos widgets
        (`group.${id}`): um grupo por variante, nunca o de produção no app de dev.
      */
      [
        'expo-share-intent',
        {
          iosActivationRules: { NSExtensionActivationSupportsText: true, NSExtensionActivationSupportsImageWithMaxCount: 1 },
          androidIntentFilters: ['text/*', 'image/*'],
          iosAppGroupIdentifier: `group.${id}`,
        },
      ],
```

Run: `node --test app.config.test.js`
Expected: PASS.

- [ ] **Step 4: PROVA — a extensão de compartilhar convive com a dos widgets num build iOS**

```bash
APP_VARIANT=development npx expo prebuild --platform ios --clean </dev/null
ls ios | grep -i -E "share|widget"
```
Expected: dois targets de extensão (widgets e share). Depois, um build de desenvolvimento no EAS para iOS (`eas build -p ios --profile development`), que é quem registra as credenciais do target novo.

**Se o EAS recusar dois targets de extensão** (a README avisa de "um target de extensão na configuração de credenciais"): leia `extra.eas.build.experimental.ios.appExtensions` gerado pelos dois plugins e tente declarar os dois. Não resolvendo, troque a opção do plugin para `disableIOS: true`, ajuste o teste do Step 2 (iOS sem as regras), registre no spec que o iOS ficou para depois e siga só com o Android. Anote o resultado no commit.

- [ ] **Step 5: Tela `src/app/compartilhado.tsx`**

Recebe o compartilhado (pelo contexto do pacote), mostra o que chegou e monta o lançamento com UM toque — nada é gravado aqui:

```tsx
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/ui/note';
import { Screen } from '@/components/ui/screen';
import { AgentApiError, createFinanceDraft, rascunhoDaImagem } from '@/lib/agent-api';
import { localISODate } from '@/lib/dates';
import { hrefDoRascunho } from '@/lib/voice-draft';

const IMAGEM = /^image\/(jpeg|png|webp|heic|heif)$/;

export default function Compartilhado() {
  const { shareIntent, resetShareIntent } = useShareIntentContext();
  const [montando, setMontando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const arquivo = shareIntent?.files?.find((f) => IMAGEM.test(f.mimeType ?? ''));
  const texto = (shareIntent?.text ?? '').trim();
  const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nada = !arquivo && !texto;

  const montar = async () => {
    setMontando(true);
    setErro(null);
    try {
      const r = arquivo
        ? await rascunhoDaImagem(arquivo.path, localISODate(), fuso)
        : await createFinanceDraft(texto, localISODate(), fuso);
      resetShareIntent();
      router.replace(hrefDoRascunho(r));
    } catch (e) {
      setErro(e instanceof AgentApiError ? e.message : 'Não consegui montar o lançamento. Tente de novo.');
    } finally {
      setMontando(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Lançar o que chegou' }} />
      {arquivo ? <Image source={{ uri: arquivo.path }} style={styles.imagem} contentFit="contain" /> : null}
      {texto ? <ThemedText>{texto}</ThemedText> : null}
      {nada ? <Note icon="exclamationmark.triangle" tone="warning">Compartilhe uma imagem ou um texto.</Note> : null}
      {erro ? <Note icon="exclamationmark.triangle" tone="warning">{erro}</Note> : null}
      <Button label="Montar lançamento" loading={montando} disabled={nada} onPress={montar} block />
    </Screen>
  );
}

const styles = StyleSheet.create({ imagem: { width: '100%', aspectRatio: 0.6 } });
```

Copie os imports de `ThemedText`, `Note` (`tone`), `Button` (`block`, `loading`) e `localISODate` de uma tela existente (`src/components/finance/lancar-por-voz.tsx` usa quase todos). Se o `IA_SEM_CONSENTIMENTO` vier, mostre o mesmo aviso que a folha da voz mostra (`lancar-por-voz.tsx`).

Em `src/app/_layout.tsx`: envolva a árvore com `<ShareIntentProvider>` (fora do `Stack.Protected`, para o intent sobreviver ao login) e, no componente com sessão, quando `hasShareIntent` ficar verdadeiro, `router.push('/compartilhado')`. Registre `<Stack.Screen name="compartilhado" options={{ title: 'Lançar o que chegou' }} />` dentro do grupo protegido por sessão.

- [ ] **Step 6: Deep link do plugin**

Rode no Android (Step 7) e veja se o expo-router reclama de rota inexistente ao abrir pelo Compartilhar (a URL do plugin é `appproops://dataUrl=...`). Se reclamar, crie `src/app/+native-intent.tsx`:

```tsx
/** O "Compartilhar" abre o app com `appproops://dataUrl=…`: não é rota, é o aviso do pacote. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return path.includes('dataUrl=') ? '/compartilhado' : path;
}
```

Se não reclamar, não crie o arquivo.

- [ ] **Step 7: Conferir no Android (emulador `proops_verify`)**

```bash
npx expo run:android --variant debug </dev/null
adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "Pix de R\$ 35,00 enviado para Joao" com.proops.personal.dev
```
Expected: abre "Lançar o que chegou" com o texto; "Montar lançamento" abre o formulário com R$ 35,00 e o título preenchido. Depois, uma imagem: `adb push <print-de-comprovante>.png /sdcard/Download/` e compartilhar pelo app Arquivos → mesma tela com a imagem → formulário preenchido.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json app.config.js app.config.test.js src/app/compartilhado.tsx src/app/_layout.tsx
git add src/app/+native-intent.tsx 2>/dev/null || true
git commit -m "feat(app): receber comprovante ou print pelo Compartilhar"
```

---

### Task 9: Documentos e privacidade

**Files:**
- Modify: `agent/app/static/legal/privacidade.html`
- Modify: `docs/AGENTE-PARIDADE-COM-O-APP.md`
- Modify: `.claude/rules/finance.md` (seção curta "Captura de lançamentos")
- Modify: `.claude/rules/frontend.md` (rotas novas)
- Modify: `agent/tests/test_legal.py` (só se ele prender o texto da política)

- [ ] **Step 1: Política de privacidade**

Na lista do que é tratado (linha ~11 de `privacidade.html`), acrescente:

```html
<li><strong>Notificações dos bancos (Android, opcional):</strong> se você ligar "Lançar pelas notificações",
o app lê só as notificações dos bancos que você marcar para montar lançamentos a confirmar. As demais
notificações nunca saem do aparelho. O texto lido fica guardado só até você confirmar ou descartar o
lançamento, e é interpretado pelos mesmos provedores de IA listados abaixo.</li>
<li><strong>Imagens e textos compartilhados:</strong> comprovantes e prints que você compartilha com o app
são enviados para interpretação e não ficam guardados.</li>
```

Run: `cd agent && .venv/bin/pytest -q tests/test_legal.py`
Expected: PASS.

- [ ] **Step 2: Paridade e regras**

`docs/AGENTE-PARIDADE-COM-O-APP.md`: duas linhas novas, no molde da "Lançar por voz (F16)": "Captura de notificações (confirmar/descartar)" — fora do agente, porque a origem é o aparelho; o lançamento confirmado é o mesmo do formulário. "Compartilhar → rascunho" — rota só interpreta, sem mutação.

`.claude/rules/finance.md`, nova seção curta no fim:

```markdown
## Captura de lançamentos — notificações e Compartilhar (12/10/2026)

Spec `2026-10-12-captura-de-lancamentos-design.md`. **Nada é lançado sozinho**: a notificação do banco
(Android) vira `captured_notifications` com o rascunho do MESMO intérprete da voz, e confirmar abre
`/finance/lancar` preenchido. Regex só confere se há valor em reais. O que já está lançado vira
`duplicate` pela cascata da importação (`reconcile.conciliar`). A captura não conta no limite mensal
(`ai_events.kind = 'capture'`), teto de 60 por espaço por dia. Lista de bancos em DOIS lugares
(`src/lib/captura.ts` e `agent/app/routes/captures.py`, presas por `captura.test.ts`).
```

`.claude/rules/frontend.md`, em "Telas e rotas novas": `/captura-notificacoes` (Perfil, só onde o módulo existe), `/finance/capturas` e `/compartilhado`.

- [ ] **Step 3: Commit**

```bash
git add agent/app/static/legal/privacidade.html docs/AGENTE-PARIDADE-COM-O-APP.md .claude/rules/finance.md .claude/rules/frontend.md
git add agent/tests/test_legal.py 2>/dev/null || true
git commit -m "docs: captura de lançamentos na privacidade, na paridade e nas regras"
```

---

### Task 10: Verificação ponta a ponta no staging e versão 1.14.0

**Files:**
- Modify: `app.json` (`expo.version` → `1.14.0`)

- [ ] **Step 1: Portão verde**

```bash
npx tsc --noEmit && npx expo lint && npm test
(cd agent && .venv/bin/ruff check app --select F,E9 && .venv/bin/pytest -q)
```
Expected: tudo com código de saída 0.

- [ ] **Step 2: Agente no staging**

`./scripts/setup-gcp.sh staging </dev/null` (com `CAPTURA_ACEITA_TESTE=true` no `agent/.env`). Confirme a rota: `curl -s -o /dev/null -w '%{http_code}' -X POST <url-staging>/internal/captures/notifications` → `401` (sem JWT).

- [ ] **Step 3: Notificação de teste no emulador `proops_verify`**

1. Dev client do Android (`npx expo run:android`), entrar com `dev@proops.local` ("Entrar como teste (dev)").
2. Perfil → "Lançar pelas notificações" → ligar → conceder o acesso nas configurações → marcar "Teste (adb)".
3. `adb shell cmd notification post -S bigtext -t "Compra aprovada" teste1 "Compra de R\$ 45,90 APROVADA em MERCADO SAO JOSE"`
4. Trazer o app ao primeiro plano.

Expected: a Hoje mostra "A confirmar · 1" com "Gasto de R$ 45,90 · …"; tocar abre o formulário com R$ 45,90; salvar cria o lançamento e o item some da Hoje. Repetir o mesmo `post` em menos de 5 min não cria outro. `adb shell cmd notification post -t "Fatura" teste2 "Sua fatura fechou: R\$ 1.234,56"` não aparece em "A confirmar".

- [ ] **Step 4: Duplicata**

Pelo Agente do staging, "gastei 23,40 na padaria" (com SIM); depois `adb shell cmd notification post -t "Compra" teste3 "Compra de R\$ 23,40 em PADARIA"`.
Expected: não aparece na Hoje; aparece em `/finance/capturas` → "Parecem já lançados".

- [ ] **Step 5: Compartilhar no iPhone do Gabriel**

Build de desenvolvimento iOS no aparelho. Num comprovante de Pix do app do banco → Compartilhar → ProOps.
Expected: abre "Lançar o que chegou" com a imagem; "Montar lançamento" abre o formulário preenchido. (Se a Task 8, Step 4, desligou o iOS, pule e registre.)

- [ ] **Step 6: Limpeza**

Apague os lançamentos e as capturas de teste **pelos IDs anotados** neste passo (nunca por filtro de texto), com `psycopg` no `DATABASE_URL` do `agent/.env`, conferindo que o host é o do staging.

- [ ] **Step 7: Versão**

`app.json`: `"version": "1.14.0"`.

```bash
git add app.json
git commit -m "chore: v1.14.0"
```

A tag `v1.14.0` e o push são do Gabriel, depois de testar. Produção, quando ele pedir: migration `20261013120000` → agente (`PROOPS_PROD_OK=1 ./scripts/setup-gcp.sh deploy </dev/null`, com `CAPTURA_ACEITA_TESTE` ausente ou `false` em `agent/.env.production`) → app; e o registro em `docs/HISTORICO-DE-MIGRATIONS.md`.
