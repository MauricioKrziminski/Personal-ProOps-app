// Fixtures fiéis a docs/ADMIN-API.md. Só entra no bundle com VITE_MOCK=1 (dev:mock).
import type { AccountDetail, Issue, IssueDetail, IssueEvent, IssueSeverity, IssueSource, IssueStatus, AccountRow, AuditEvent, BillingEvent, Overview, SystemInfo } from "./types";

const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const dateOnly = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

const NAMES = ["Marina Souza", "Rafael Lima", "Camila Torres", null, "João Pedro Alves", "Beatriz Nunes", "Lucas Ferreira", "Ana Clara Dias", null, "Thiago Ribeiro", "Patrícia Moura", "Felipe Castro", "Larissa Gomes", "Diego Martins", "Renata Pires"];

const ROWS: AccountRow[] = Array.from({ length: 58 }, (_, i) => {
  const kind = i % 9; // 0,1 pro | 2 family | 3 trial | 4 lapsed | 5,6 never | 7 courtesy | 8 suspended
  const name = NAMES[i % NAMES.length];
  const plan = kind <= 1 || kind === 3 || kind === 4 ? "pro" : kind === 2 ? "family" : kind === 7 ? "pro" : "free";
  const origin = kind === 0 ? "apple" : kind === 1 || kind === 4 ? "google" : kind === 7 ? "manual" : kind === 3 ? "test_store" : kind === 2 ? "apple" : null;
  const aiMax = plan === "free" ? 30 : 600;
  const waMax = plan === "free" ? 30 : 1000;
  const aiUsed = Math.min(Math.round(((i * 37) % 100) / 100 * aiMax * (i % 11 === 0 ? 1.05 : 1)), aiMax);
  return {
    user_id: uuid(i + 1), workspace_id: uuid(1000 + i), email: i === 4 ? null : `${(name ?? "conta" + i).toLowerCase().normalize("NFD").replace(/[^a-z]/g, "").slice(0, 14)}${i}@exemplo.com` /* conta antiga só com telefone */,
    name, created_at: day(3 + i * 6), last_sign_in_at: kind === 5 ? null : day((i * 5) % 45), suspended: kind === 8,
    plan: plan as AccountRow["plan"], status: kind === 4 ? "canceled" : kind === 3 ? "trialing" : kind <= 2 || kind === 7 ? "active" : "none",
    access: kind <= 3 || kind === 7 ? "subscriber" : kind === 4 ? "lapsed" : "never", is_trial: kind === 3,
    period_end: kind <= 4 || kind === 7 ? dateOnly(kind === 3 ? 2 : kind === 4 ? -5 : 18 + i) : null,
    origin: origin as AccountRow["origin"], ai_used: aiUsed, ai_max: aiMax, wa_used: Math.round(waMax * (((i * 13) % 100) / 100)), wa_max: waMax, whatsapp_linked: kind !== 6 && kind !== 5,
  };
});

const OVERVIEW: Overview = {
  accounts: { total: 1284, new_7d: 41, new_30d: 168 },
  access: { subscriber: 312, trialing: 27, lapsed: 94, never: 782, courtesy: 9, suspended: 3 },
  plans: { pro: 241, family: 71 },
  usage_month: { ai_turns: 48210, whatsapp_replies: 31877, notices: 6402, ai_cost_usd: "73.4180" },
  signups_by_month: ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month, i) => ({ month, count: [18, 22, 40, 51, 63, 88, 97, 120, 141, 176, 212, 156][i] })),
  ai_cost_by_day: Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10), usd: (1.6 + Math.sin(i / 3) * 0.7 + (i % 7 === 0 ? 1.1 : 0.3) + i * 0.02).toFixed(4) })),
  observability: { open: 0, critical_open: 0, events_24h: 0 },
  signals: { trial_ending_48h: 5, lapsed_7d: 11, near_limit: 17, inactive_subscribers_30d: 23 },
};

const ev = (i: number, action: string, target: AccountRow | null, payload: Record<string, unknown> = {}): AuditEvent => ({
  id: uuid(5000 + i), created_at: day(i * 0.7), action, admin_user_id: uuid(900), admin_email: "gestao@proops.com.br",
  target_user_id: target?.user_id ?? null, target_email: target?.email ?? null, payload,
});
const AUDIT: AuditEvent[] = [
  ev(0, "plan_changed", ROWS[5], { plan: "pro", period_end: dateOnly(30) }), ev(1, "suspended", ROWS[8], { reason: "Chargeback confirmado" }),
  ev(2, "password_reset_sent", ROWS[2]), ev(3, "plan_forced", ROWS[0], { plan: "family", force: true }), ev(4, "signed_out", ROWS[3]),
  ev(5, "whatsapp_unlinked", ROWS[6]), ev(6, "reactivated", ROWS[8]), ev(7, "account_deleted", null, { email: "removida@exemplo.com" }),
  ...Array.from({ length: 22 }, (_, i) => ev(8 + i, ["plan_changed", "signed_out", "password_reset_sent", "suspended"][i % 4], ROWS[(i * 3) % ROWS.length], { reason: "Solicitação do cliente" })),
];

const BILLING: BillingEvent[] = Array.from({ length: 63 }, (_, i) => {
  const r = ROWS[(i * 5) % ROWS.length];
  return {
    id: `evt_${1000 + i}`, created_at: day(i * 0.4), type: ["INITIAL_PURCHASE", "RENEWAL", "CANCELLATION", "EXPIRATION", "BILLING_ISSUE", "TEST"][i % 6],
    provider: i % 3 ? "apple" : "google", result: i % 17 === 0 ? "error" : i % 9 === 0 ? "ignored" : "processed", app_user_id: r.user_id, email: r.email,
    product_id: i % 2 ? "proops.pro.monthly" : "proops.family.yearly", environment: i % 8 === 0 ? "sandbox" : "production",
  };
});

const SYSTEM: SystemInfo = {
  queue: { pending: 3, processing: 1, failed_24h: 2, oldest_pending_seconds: 14 },
  recent_failures: [
    { created_at: day(0.05), status: "failed", last_error: "TimeoutError: Graph API não respondeu em 10s ao enviar a resposta" },
    { created_at: day(0.4), status: "failed", last_error: "ValueError: anexo de áudio sem mime_type" },
    { created_at: day(0.9), status: "dead", last_error: "psycopg.errors.QueryCanceled: canceling statement due to statement timeout" },
  ],
  ai_cost: { last_24h_usd: "2.8140", last_7d_usd: "19.2260" },
  whatsapp_month: { replies: 31877, notices: 6402 },
};

function detail(id: string): AccountDetail {
  const a = ROWS.find((r) => r.user_id === id);
  if (!a) throw Object.assign(new Error("Conta não encontrada."), { status: 404, code: "not_found" });
  const store = a.origin === "apple" || a.origin === "google";
  return {
    account: a,
    profile: { phone: a.whatsapp_linked ? "+55 11 9•••• 4821" : null, email_confirmed_at: a.created_at, onboarding_completed: a.access !== "never", banned_until: a.suspended ? "2126-10-09T00:00:00Z" : null, sessions: a.suspended ? 0 : 2 },
    subscription: { plan: a.plan, status: a.status, provider: a.origin ?? "none", origin: a.origin, external_id: a.origin ? "rc_" + a.user_id.slice(-8) : "", product_id: a.origin ? "proops.pro.monthly" : "", environment: "production", is_trial: a.is_trial, current_period_end: a.period_end, canceled_at: a.access === "lapsed" ? day(6) : null, store_managed: store },
    usage: {
      current: { ai_used: a.ai_used, ai_max: a.ai_max, wa_used: a.wa_used, wa_max: a.wa_max, notices_today: 1, notices_max: 3, ai_cost_usd: (a.ai_used * 0.0021).toFixed(4) },
      months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month, i) => ({ month, ai_turns: 40 + i * 31 + (a.ai_used % 17), whatsapp_replies: 25 + i * 22, ai_cost_usd: (0.1 + i * 0.07).toFixed(4) })),
    },
    counts: { transactions: 412, accounts: 4, cards: 2, notes: 18, reminders: 7, goals: 3, debts: 1, recurring: 9 },
    members: [{ user_id: a.user_id, email: a.email, name: a.name, role: "owner" }, ...(a.plan === "family" ? [{ user_id: uuid(777), email: "convidado@exemplo.com", name: "Convidado", role: "member" as const }] : [])],
    invites: a.plan === "family" ? [{ phone: "+55 21 9•••• 0099", status: "pending", created_at: day(4) }] : [],
    billing_events: BILLING.slice(0, 5).map((b) => ({ id: b.id, type: b.type, result: b.result, created_at: b.created_at })),
    admin_events: AUDIT.filter((e) => e.target_user_id === id).slice(0, 10),
  };
}

// ---- Observabilidade ----
const ISSUE_SEEDS: [IssueSource, IssueSeverity, string, string, string | null, string[]][] = [
  ["agent", "critical", "psycopg.errors.QueryCanceled", "canceling statement due to statement timeout", "/worker/process-thread", []],
  ["app", "critical", "TypeError", "Cannot read property 'amount_cents' of undefined", "/finance/lancar", ["ios", "android"]],
  ["app", "error", "InvariantViolation", "Tried to render a Skia canvas with zero width", "/(tabs)/finance", ["android"]],
  ["agent", "error", "TimeoutError", "Graph API não respondeu em 10s ao enviar a resposta", "/whatsapp-inbound", []],
  ["admin", "error", "ApiError", "Resposta inesperada de /admin/api/overview", "/", ["web"]],
  ["app", "warning", "NetworkError", "Network request failed ao sincronizar lembretes", "/(tabs)/index", ["ios", "android"]],
  ["agent", "critical", "ValidationError", "FinanceAction: campo 'amount_cents' ausente no turno", "/worker/process-thread", []],
  ["app", "error", "RangeError", "Invalid time value ao formatar a data da fatura", "/finance/invoice", ["ios"]],
  ["admin", "warning", "ChunkLoadError", "Falha ao carregar o módulo da página de contas", "/contas", ["web"]],
  ["app", "warning", "SecureStoreError", "Could not decrypt the stored value", "/login", ["android"]],
];
const ISSUES: Issue[] = Array.from({ length: 34 }, (_, i) => {
  const [source, severity, name, message, route, platforms] = ISSUE_SEEDS[i % ISSUE_SEEDS.length];
  const n = Math.floor(i / ISSUE_SEEDS.length);
  const count = Math.max(1, Math.round(900 / (i + 1.5)) + (i % 4));
  return {
    id: uuid(5000 + i), fingerprint: (0x9e3779b1 * (i + 7)).toString(16).padStart(16, "0").slice(0, 16), source, kind: severity === "critical" ? "crash" : "error", severity,
    title: n ? `${name} #${n}` : name, message, route, status: (i % 7 === 5 ? "resolved" : i % 11 === 8 ? "ignored" : "open") as IssueStatus,
    first_seen: day(1 + i * 0.9), last_seen: day(i < 6 ? i * 0.04 : (i * 0.6) % 20), count, users_affected: Math.max(1, Math.round(count / (3 + (i % 5)))),
    last_app_version: source === "app" ? `1.${4 + (i % 2)}.${i % 3}` : source === "admin" ? "2.0.0" : null, platforms,
  };
});
const sync = () => {
  const open = ISSUES.filter((x) => x.status === "open");
  OVERVIEW.observability = { open: open.length, critical_open: open.filter((x) => x.severity === "critical").length, events_24h: 184 };
};
const STACKS: Record<string, string> = {
  agent: "Traceback (most recent call last):\n  File \"app/worker.py\", line 212, in process_thread\n    result = await graph.ainvoke(state, config)\n  File \"app/graph/nodes.py\", line 88, in finance_node\n    rows = await tools.run(action)\n  File \"app/tools/finance.py\", line 140, in run\n    await conn.execute(sql, params)\npsycopg.errors.QueryCanceled: canceling statement due to statement timeout",
  app: "TypeError: Cannot read property 'amount_cents' of undefined\n    at buildPayload (src/lib/lancar.ts:142:21)\n    at onSubmit (src/components/finance/formulario-do-lancamento.tsx:310:18)\n    at HTMLUnknownElement.callCallback (react-native/Libraries/Renderer/ReactNativeRenderer-prod.js:2891:14)\n    at invokeGuardedCallback (react-native/Libraries/Renderer/ReactNativeRenderer-prod.js:3040:7)",
  admin: "ApiError: Resposta inesperada\n    at request (assets/index-Dk3f9a.js:1:4821)\n    at async queryFn (assets/index-Dk3f9a.js:1:51233)",
};
function issueDetail(id: string): IssueDetail {
  const issue = ISSUES.find((x) => x.id === id);
  if (!issue) throw Object.assign(new Error("Erro não encontrado."), { status: 404, code: "not_found" });
  const seed = ISSUES.indexOf(issue) + 3;
  const noon = Date.now() - (Date.now() % 3600000);
  const events: IssueEvent[] = Array.from({ length: Math.min(50, issue.count) }, (_, k) => {
    const r = ROWS[(seed * 3 + k) % ROWS.length];
    const anon = issue.source === "agent" ? k % 2 === 0 : k % 6 === 5;
    return {
      id: `ev_${seed}_${k}`, created_at: new Date(Date.parse(issue.last_seen) - k * (1.3 + (seed % 5)) * 3600000).toISOString(), user_id: anon ? null : r.user_id, user_email: anon ? null : r.email,
      platform: issue.platforms.length ? issue.platforms[k % issue.platforms.length] : null, app_version: issue.last_app_version, route: issue.route, message: issue.message, context: k === 0 ? { workspace: "••••", attempt: 2 } : null,
    };
  });
  return {
    issue, stack: issue.source === "app" && issue.kind === "error" && seed % 3 === 0 ? null : STACKS[issue.source],
    hourly_24h: Array.from({ length: 24 }, (_, h) => ({ hour: new Date(noon - (23 - h) * 3600000).toISOString(), count: Math.max(0, Math.round((issue.count / 30) * (1 + Math.sin((h + seed) / 2.2)) * (h > 18 ? 1.6 : 1))) })),
    daily_30d: Array.from({ length: 30 }, (_, d) => ({ day: new Date(Date.now() - (29 - d) * 86400000).toISOString().slice(0, 10), count: Math.max(0, Math.round((issue.count / 18) * (1 + Math.cos((d + seed) / 3)) * (d > 22 ? 1.5 : 0.6))) })),
    events,
    triage: issue.status === "open" ? [] : [ev(900 + seed, "issue_triaged", null, { from: "open", to: issue.status })],
  };
}
sync();

const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const fail = (status: number, code: string, message: string) => { throw Object.assign(new Error(message), { status, code, mock: true }); };

function page<T>(items: T[], q: URLSearchParams, size = 25) {
  const ps = Math.min(100, Number(q.get("page_size")) || size);
  const p = Math.max(1, Number(q.get("page")) || 1);
  return { items: items.slice((p - 1) * ps, p * ps), total: items.length, page: p, page_size: ps };
}

export async function mock(method: string, path: string, body?: unknown): Promise<unknown> {
  await wait();
  try {
    return route(method, path, (body ?? {}) as Record<string, unknown>);
  } catch (e) {
    const x = e as { status?: number; code?: string; message: string };
    const { ApiError } = await import("./api");
    throw new ApiError(x.status ?? 500, x.code ?? "error", x.message);
  }
}

function route(method: string, path: string, body: Record<string, unknown>): unknown {
  const [p, qs = ""] = path.split("?");
  const q = new URLSearchParams(qs);
  if (p === "/me") return { user_id: uuid(900), email: "gestao@proops.com.br", aal: "aal2", mfa_required: false };
  if (p === "/overview") return OVERVIEW;
  if (p === "/issues") {
    const all = ISSUES;
    const st = q.get("status") || "open";
    const per = { "1h": 1 / 24, "24h": 1, "7d": 7, "30d": 30 }[q.get("period") || "7d"] ?? 7;
    const s = q.get("q")?.toLowerCase();
    let r = all.filter((x) => x.status === st && Date.now() - Date.parse(x.last_seen) <= per * 86400000);
    if (q.get("source")) r = r.filter((x) => x.source === q.get("source"));
    if (q.get("severity")) r = r.filter((x) => x.severity === q.get("severity"));
    if (s) r = r.filter((x) => `${x.title} ${x.message} ${x.route ?? ""}`.toLowerCase().includes(s));
    const key: Record<string, (a: Issue, b: Issue) => number> = {
      last_seen_desc: (a, b) => b.last_seen.localeCompare(a.last_seen), count_desc: (a, b) => b.count - a.count,
      users_desc: (a, b) => b.users_affected - a.users_affected, first_seen_desc: (a, b) => b.first_seen.localeCompare(a.first_seen),
    };
    const rec = all.filter((x) => Date.now() - Date.parse(x.last_seen) < 86400000);
    const by = (k: IssueSource) => rec.filter((x) => x.source === k).reduce((n, x) => n + Math.ceil(x.count / 6), 0);
    const summary = { open: all.filter((x) => x.status === "open").length, events_24h: by("app") + by("admin") + by("agent"), users_affected_24h: rec.reduce((n, x) => n + Math.ceil(x.users_affected / 4), 0), new_24h: all.filter((x) => Date.now() - Date.parse(x.first_seen) < 2 * 86400000).length, by_source_24h: { app: by("app"), admin: by("admin"), agent: by("agent") } };
    return { ...page(r.sort(key[q.get("sort") ?? "last_seen_desc"] ?? key.last_seen_desc), q), summary };
  }
  const im = p.match(/^\/issues\/([^/]+)(?:\/(status))?$/);
  if (im) {
    if (im[2]) {
      const it = ISSUES.find((x) => x.id === im[1]);
      if (!it) fail(404, "not_found", "Erro não encontrado.");
      it!.status = body.status as IssueStatus; sync();
    }
    return issueDetail(im[1]);
  }
  if (p === "/system") return SYSTEM;
  if (p === "/audit") {
    let r = AUDIT;
    if (q.get("action")) r = r.filter((e) => e.action === q.get("action"));
    if (q.get("target_user_id")) r = r.filter((e) => e.target_user_id === q.get("target_user_id"));
    return page(r, q, 50);
  }
  if (p === "/billing-events") {
    let r = BILLING;
    if (q.get("type")) r = r.filter((e) => e.type === q.get("type"));
    if (q.get("result")) r = r.filter((e) => e.result === q.get("result"));
    const s = q.get("q")?.toLowerCase();
    if (s) r = r.filter((e) => e.email?.includes(s) || e.app_user_id?.includes(s));
    return page(r, q, 50);
  }
  if (p === "/accounts" && method === "GET") {
    let r = [...ROWS];
    const s = q.get("q")?.toLowerCase();
    if (s) r = r.filter((a) => (a.email ?? "").includes(s) || a.name?.toLowerCase().includes(s));
    const acc = q.get("access");
    if (acc) r = r.filter((a) => (acc === "suspended" ? a.suspended : acc === "trialing" ? a.is_trial : acc === "courtesy" ? a.origin === "manual" && a.access === "subscriber" : acc === "subscriber" ? a.access === "subscriber" && !a.is_trial : a.access === acc));
    if (q.get("plan")) r = r.filter((a) => a.plan === q.get("plan"));
    const o = q.get("origin");
    if (o) r = r.filter((a) => (o === "none" ? !a.origin : a.origin === o));
    const sort = q.get("sort") ?? "created_desc";
    const cmp: Record<string, (a: AccountRow, b: AccountRow) => number> = {
      created_desc: (a, b) => b.created_at.localeCompare(a.created_at), created_asc: (a, b) => a.created_at.localeCompare(b.created_at),
      last_sign_in_desc: (a, b) => (b.last_sign_in_at ?? "").localeCompare(a.last_sign_in_at ?? ""), ai_used_desc: (a, b) => b.ai_used - a.ai_used,
      email_asc: (a, b) => (a.email ?? "").localeCompare(b.email ?? ""),
      last_sign_in_asc: (a, b) => (a.last_sign_in_at ?? "").localeCompare(b.last_sign_in_at ?? ""),
    };
    return page(r.sort(cmp[sort] ?? cmp.created_desc), q);
  }
  const m = p.match(/^\/accounts\/([^/]+)(?:\/([a-z-]+))?$/);
  if (m) {
    const [, id, act] = m;
    if (!act) return detail(id);
    const row = ROWS.find((r) => r.user_id === id)!;
    if (act === "plan") {
      if (body.plan !== "free" && (row.origin === "apple" || row.origin === "google") && !body.force) fail(409, "store_managed", "Esta assinatura é gerenciada pela loja. Confirme para forçar o plano (a próxima notificação da loja sobrescreve).");
      row.plan = body.plan as AccountRow["plan"];
      row.origin = "manual";
      row.access = body.plan === "free" ? "lapsed" : "subscriber";
    }
    if (act === "suspend") row.suspended = true;
    if (act === "reactivate") row.suspended = false;
    if (act === "unlink-whatsapp") row.whatsapp_linked = false;
    if (act === "delete") {
      if (String(body.confirm_email).toLowerCase() !== row.email) fail(409, "email_mismatch", "O e-mail digitado não confere com o da conta.");
      ROWS.splice(ROWS.indexOf(row), 1);
      return { deleted: true };
    }
    return detail(id);
  }
  fail(404, "not_found", "Rota não encontrada.");
}
