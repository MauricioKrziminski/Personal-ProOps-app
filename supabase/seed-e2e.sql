-- Seed do E2E do painel de admin (scripts/e2e-painel.sh) — SÓ para o Supabase LOCAL do projeto
-- `proops-e2e` (scripts/e2e/supabase/config.toml). Nunca rodar em staging nem em produção.
--
-- Pré-condição: scripts/e2e-seed.py já criou os usuários (GoTrue) com `raw_user_meta_data`
-- {"e2e":"1","slug":"<slug>"}. Este arquivo dá a cada slug o CENÁRIO (plano, uso, telefone...).
-- Os números esperados pelos testes (agent/admin-web/e2e/seed-data.ts) saem DESTA tabela:
--
--  slug         cenário                                         acesso       IA/mês  WA resp
--  nunca        nunca assinou                                   never        -       -
--  teste1       teste da loja, termina amanhã                   trialing     20      -
--  teste2       teste da loja, termina em 10 dias               trialing     -       -
--  manual       pro manual sem vencimento                       courtesy     5       -
--  familia      família (loja), 1 membro + 1 convite            subscriber   50      20 (+2 avisos)
--  apple        pro App Store, perto do limite de IA (340/400)  subscriber   340     10
--  google       pro Play Store, WA 130/150, sem entrar há 40 d  subscriber   30      130
--  encerrada    pro cancelada há 3 dias (loja)                  lapsed       -       -
--  encerrada2   pro vencida há 20 dias (loja)                   lapsed       -       -
--  suspensa     banida (banned_until), com WhatsApp             never+susp.  -       -
--  sememail     conta só com telefone (sem e-mail)              never        -       -
--  a-*          contas que os testes MODIFICAM pela UI
--  bulk01..30   preenchem a paginação (cadastros espalhados em 12 meses)
--
-- Idempotente: scripts/e2e-seed.py apaga as contas e-2-e antes (private.apagar_conta) e recria.
\set ON_ERROR_STOP on
begin;

create temp table e on commit drop as
  select u.raw_user_meta_data->>'slug' as slug, u.id as uid,
         (select w.id from public.workspaces w where w.owner_id = u.id order by w.created_at, w.id limit 1) as ws
    from auth.users u
   where u.raw_user_meta_data->>'e2e' = '1';

-- ── cadastro: datas e telefones ─────────────────────────────────────────────────────────────────────────
update public.profiles p set created_at = now() - make_interval(days => v.d)
  from (values ('manual', 90), ('apple', 60), ('google', 120), ('encerrada', 80), ('encerrada2', 100), ('familia', 45)) v(slug, d)
  join e on e.slug = v.slug where p.id = e.uid;

-- bulk01..30: 10 em 10 dias para trás (cobre os 12 meses de "Cadastros por mês")
update public.profiles p set created_at = now() - make_interval(days => 10 * substr(e.slug, 5)::int)
  from e where e.slug ~ '^bulk[0-9]+$' and p.id = e.uid;

update public.profiles p set phone = v.phone, whatsapp_verified = true
  from (values ('apple', '5511988880010'), ('suspensa', '5511988880014'), ('sememail', '5511988880015'),
               ('a-zap', '5511988880020'), ('a-del-sem', '5511988880022')) v(slug, phone)
  join e on e.slug = v.slug where p.id = e.uid;

-- contas "só com telefone": sem e-mail e sem identidade de e-mail (como as antigas do Phone OTP)
update auth.users u set email = null, phone = pr.phone, phone_confirmed_at = now()
  from e join public.profiles pr on pr.id = e.uid
 where u.id = e.uid and e.slug in ('sememail', 'a-del-sem');
delete from auth.identities i using e where i.user_id = e.uid and e.slug in ('sememail', 'a-del-sem') and i.provider = 'email';

-- último acesso: recente para quem é "ativo"; google some há 40 dias; o resto fica null (nunca entrou)
update auth.users u set last_sign_in_at = case when e.slug = 'google' then now() - interval '40 days' else now() - interval '1 day' end
  from e where u.id = e.uid and e.slug in ('manual', 'familia', 'apple', 'google', 'teste1', 'teste2', 'a-loja');

-- configuração remota do app volta ao vazio (o teste da página App parte dela)
update public.app_config set min_version_ios = null, min_version_android = null, latest_version_ios = null, latest_version_android = null,
  store_url_ios = null, store_url_android = null, notice_title = null, notice_body = null, notice_level = null, notice_until = null where id = 1;

-- versão/uso do app, aceite dos termos, consentimento de IA e push (painel: ficha, lista e "Versões em uso").
-- google fica SEM last_seen_at de propósito: o sinal de inativos cai no login de 40 dias.
update public.profiles p set last_app_version = v.ver, last_app_platform = v.plat, last_seen_at = now() - make_interval(days => v.d)
  from (values ('apple', '1.4.2', 'ios', 2), ('familia', '1.4.2', 'android', 1), ('manual', '1.4.0', 'ios', 5)) v(slug, ver, plat, d)
  join e on e.slug = v.slug where p.id = e.uid;
update public.profiles p set terms_version = '2026-10-09', terms_accepted_at = now() - interval '3 days', ai_consent_at = now() - interval '3 days'
  from e where p.id = e.uid and e.slug = 'apple';
update public.profiles p set expo_push_token = 'ExponentPushToken[e2e-fake-token]' from e where p.id = e.uid and e.slug = 'familia';

update auth.users u set banned_until = now() + interval '100 years' from e where u.id = e.uid and e.slug = 'suspensa';

-- ── assinaturas ─────────────────────────────────────────────────────────────────────────────────────────
-- hoje = o de Brasília, a mesma régua do painel
update public.subscriptions s set
    plan = v.plan, status = v.status, provider = v.provider, external_id = v.ext, product_id = v.prod,
    environment = v.env, is_trial = v.trial,
    current_period_end = case when v.fim is null then null else (now() at time zone 'America/Sao_Paulo')::date + v.fim end,
    canceled_at = case when v.canc is null then null else now() - make_interval(days => v.canc) end
  from (values
    --        slug          plano     status      provider       external_id   produto               env           trial  fim   canc
    ('teste1',     'pro',    'trialing', 'app_store',   'e2e-ext-t1', 'proops.pro.monthly', 'production', true,   1,    null::int),
    ('teste2',     'pro',    'trialing', 'play_store',  'e2e-ext-t2', 'proops.pro.monthly', 'production', true,   10,   null),
    ('manual',     'pro',    'active',   'manual',      null,         null,                 null,         false,  null, null),
    ('familia',    'family', 'active',   'app_store',   'e2e-ext-fa', 'proops.family.yearly','production', false, 60,   null),
    ('apple',      'pro',    'active',   'app_store',   'e2e-ext-ap', 'proops.pro.monthly', 'production', false,  30,   null),
    ('google',     'pro',    'active',   'play_store',  'e2e-ext-go', 'proops.pro.monthly', 'production', false,  30,   null),
    ('encerrada',  'pro',    'canceled', 'app_store',   'e2e-ext-en', 'proops.pro.monthly', 'production', false,  -3,   3),
    ('encerrada2', 'pro',    'canceled', 'play_store',  'e2e-ext-e2', 'proops.pro.monthly', 'production', false,  -20,  20),
    ('a-loja',     'pro',    'active',   'app_store',   'e2e-ext-al', 'proops.pro.monthly', 'production', false,  30,   null)
  ) v(slug, plan, status, provider, ext, prod, env, trial, fim, canc)
  join e on e.slug = v.slug where s.workspace_id = e.ws;

-- membro de espaço de outro + convite pendente (ficha da família)
insert into public.workspace_members (workspace_id, user_id, role)
  select f.ws, m.uid, 'member' from e f, e m where f.slug = 'familia' and m.slug = 'membro'
  on conflict do nothing;
insert into public.workspace_invites (workspace_id, invited_by, phone, status)
  select f.ws, f.uid, '5511977770001', 'pending' from e f where f.slug = 'familia';

-- ── uso do mês (ai_events kind=turn; whatsapp_sends) ────────────────────────────────────────────────────
create temp table mes on commit drop as
  select (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') as ini;

insert into public.ai_events (user_id, workspace_id, model, channel, kind, estimated_cost_usd, created_at)
  select e.uid, e.ws, 'e2e-modelo', case when g % 2 = 0 then 'whatsapp' else 'app' end, 'turn', 0.01,
         greatest(now() - make_interval(mins => g), (select ini from mes))
    from (values ('apple', 340), ('google', 30), ('manual', 5), ('familia', 50), ('teste1', 20)) t(slug, n)
    join e on e.slug = t.slug, generate_series(1, t.n) g;
-- transcrição custa mas NÃO é turno (entra no custo, não em "Turnos de IA")
insert into public.ai_events (user_id, workspace_id, model, channel, kind, estimated_cost_usd, created_at)
  select e.uid, e.ws, 'e2e-whisper', 'whatsapp', 'transcription', 0.02, now() - make_interval(mins => g)
    from e, generate_series(1, 10) g where e.slug = 'apple';
-- mês passado: não entra em nada do mês
insert into public.ai_events (user_id, workspace_id, model, channel, kind, estimated_cost_usd, created_at)
  select e.uid, e.ws, 'e2e-modelo', 'app', 'turn', 0.01, now() - interval '40 days' - make_interval(mins => g)
    from e, generate_series(1, 7) g where e.slug = 'apple';

insert into public.whatsapp_sends (workspace_id, user_id, kind, created_at)
  select e.ws, e.uid, 'reply', greatest(now() - make_interval(mins => g), (select ini from mes))
    from (values ('familia', 20), ('apple', 10), ('google', 130)) t(slug, n)
    join e on e.slug = t.slug, generate_series(1, t.n) g;
insert into public.whatsapp_sends (workspace_id, user_id, kind)
  select e.ws, e.uid, 'notice' from e, generate_series(1, 2) g where e.slug = 'familia';

-- ── dados da ficha (só contagens): apple ────────────────────────────────────────────────────────────────
insert into public.accounts (user_id, workspace_id, name, type)
  select e.uid, e.ws, n, t from e, (values ('Conta E2E', 'checking'), ('Carteira E2E', 'cash')) v(n, t) where e.slug = 'apple';
insert into public.accounts (user_id, workspace_id, name, type, closing_day, due_day, credit_limit_cents)
  select e.uid, e.ws, 'Cartão E2E', 'credit_card', 5, 12, 100000 from e where e.slug = 'apple';
insert into public.notes (user_id, workspace_id, content)
  select e.uid, e.ws, 'nota e2e ' || g from e, generate_series(1, 3) g where e.slug = 'apple';
insert into public.transactions (user_id, workspace_id, kind, amount_cents, description, occurred_at)
  select e.uid, e.ws, 'expense', 1000 * g, 'gasto e2e ' || g, current_date from e, generate_series(1, 4) g where e.slug = 'apple';

-- ── cobrança ────────────────────────────────────────────────────────────────────────────────────────────
delete from public.billing_events where id like 'e2e-bill-%';
insert into public.billing_events (id, type, provider, workspace_id, result, payload, received_at)
  select v.id, v.tp, v.prov, e.ws, v.res,
         jsonb_build_object('app_user_id', coalesce(e.uid::text, v.orfao), 'product_id', v.prod, 'environment', v.env),
         now() - make_interval(days => v.dias)
    from (values
      ('e2e-bill-01', 'INITIAL_PURCHASE', 'app_store',  'apple',      'concedido',            'proops.pro.monthly', 'production', 30, null::text),
      ('e2e-bill-02', 'RENEWAL',          'app_store',  'apple',      'concedido',            'proops.pro.monthly', 'production', 1,  null),
      ('e2e-bill-03', 'INITIAL_PURCHASE', 'play_store', 'google',     'concedido',            'proops.pro.monthly', 'production', 29, null),
      ('e2e-bill-04', 'CANCELLATION',     'app_store',  'encerrada',  'revogado',             'proops.pro.monthly', 'production', 3,  null),
      ('e2e-bill-05', 'EXPIRATION',       'play_store', 'encerrada2', 'revogado',             'proops.pro.monthly', 'production', 20, null),
      ('e2e-bill-06', 'RENEWAL',          'app_store',  'apple',      'duplicado',            'proops.pro.monthly', 'production', 1,  null),
      ('e2e-bill-07', 'INITIAL_PURCHASE', 'app_store',  'a-loja',     'sandbox_ignorado',     'proops.pro.monthly', 'sandbox',    2,  null),
      ('e2e-bill-08', 'INITIAL_PURCHASE', 'app_store',  null,         'produto_desconhecido', 'x.produto.fantasma', 'production', 5,  '00000000-0000-4000-8000-0000000000aa')
    ) v(id, tp, prov, slug, res, prod, env, dias, orfao)
    left join e on e.slug = v.slug;

-- ── fila do WhatsApp: duas falhas (o /sistema lista e mascara dígitos longos) ────────────────────────────
delete from public.messages_queue where wa_message_id like 'e2e-falha-%';
insert into public.messages_queue (wa_message_id, thread_id, phone, payload, status, retry_count, last_error, created_at)
  values ('e2e-falha-1', 'e2e-thread-1', '5511988880099', '{}', 'failed', 3, 'e2e: timeout ao falar com 5511988880099 apos 240s', now() - interval '2 hours'),
         ('e2e-falha-2', 'e2e-thread-2', '5511988880098', '{}', 'failed', 3, 'e2e: erro generico', now() - interval '3 hours');

-- ── limpeza de uma execução anterior ────────────────────────────────────────────────────────────────────
delete from public.admin_audit_events;
delete from public.alerts_sent a using e where a.user_id = e.uid and a.kind = 'conta_suspensa';

commit;
