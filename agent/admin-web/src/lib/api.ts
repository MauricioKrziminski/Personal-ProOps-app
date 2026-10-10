import type { AccountDetail, AppConfig, Note, IssueDetail, IssuesPage, IssueStatus, AccountRow, AuditEvent, BillingEvent, Config, Me, Overview, Page, SystemInfo } from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Códigos 4xx da API de admin em português (têm prioridade sobre a mensagem do servidor). */
const MENSAGEM_POR_CODIGO: Record<string, string> = {
  too_many_rows: "Há contas demais para exportar. Refine os filtros (o teto é 10.000) e tente de novo.",
  no_push_tokens: "Esta conta não tem aparelho registrado para receber o aviso.",
  push_failed: "Não foi possível enviar o aviso agora. Tente de novo em instantes.",
  cannot_remove_owner: "O dono do espaço não pode ser removido.",
  invite_not_pending: "Esse convite já foi aceito ou revogado.",
};

const RETRY_429_MS = [1000, 2000, 4000];

let tokenGetter: () => Promise<string | null> = async () => null;
export const getToken = () => tokenGetter();
export const setTokenGetter = (fn: () => Promise<string | null>) => { tokenGetter = fn; };

/** Eventos globais que o AuthProvider escuta (401 = sessão morreu; 403 mfa_required = pedir o segundo fator). */
export const authEvents = new EventTarget();

export async function request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, auth = true): Promise<T> {
  if (import.meta.env.VITE_MOCK) {
    const { mock } = await import("./mock");
    return mock(method, path, body) as Promise<T>;
  }
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const t = await tokenGetter();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  let res: Response;
  // 429 numa LEITURA: tenta de novo com recuo (1 s, 2 s, 4 s). Escrita nunca repete sozinha.
  for (let tentativa = 0; ; tentativa++) {
    try {
      res = await fetch(`/admin/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, "network", "Sem conexão com o servidor. Verifique a internet e tente de novo.");
    }
    if (res.status !== 429 || method !== "GET" || tentativa >= RETRY_429_MS.length) break;
    await new Promise((r) => setTimeout(r, RETRY_429_MS[tentativa]));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof data?.error === "string" ? data.error : "error";
    if (res.status === 401 && auth) authEvents.dispatchEvent(new Event("unauthorized"));
    if (res.status === 403 && code === "mfa_required") authEvents.dispatchEvent(new Event("mfa_required"));
    const fallback = res.status === 429 ? "Muitas ações seguidas; tente em alguns segundos." : res.status === 422 ? "Dados inválidos." : res.status === 404 ? "Não encontrado." : "Não foi possível concluir. Tente de novo.";
    throw new ApiError(res.status, code, MENSAGEM_POR_CODIGO[code] ?? (typeof data?.message === "string" ? data.message : fallback));
  }
  return data as T;
}

const qs = (p: Record<string, string | number | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

export type AccountFilters = { q?: string; access?: string; signal?: string; plan?: string; origin?: string; sort?: string; page?: number; page_size?: number };
export type AuditFilters = { action?: string; admin_user_id?: string; target_user_id?: string; page?: number; page_size?: number };
export type BillingFilters = { q?: string; type?: string; result?: string; page?: number; page_size?: number };

export type IssueFilters = { status?: string; source?: string; severity?: string; period?: string; q?: string; sort?: string; page?: number; page_size?: number };

/** Baixa o CSV das contas com os filtros atuais (precisa do token, então não é um link comum). */
export async function downloadAccountsCsv(f: AccountFilters) {
  const t = await tokenGetter();
  let res: Response;
  try {
    res = await fetch(`/admin/api/accounts.csv${qs({ ...f, page: undefined, page_size: undefined })}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  } catch {
    throw new ApiError(0, "network", "Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const code = typeof data?.error === "string" ? data.error : "error";
    if (res.status === 401) authEvents.dispatchEvent(new Event("unauthorized"));
    if (res.status === 403 && code === "mfa_required") authEvents.dispatchEvent(new Event("mfa_required"));
    throw new ApiError(res.status, code, MENSAGEM_POR_CODIGO[code] ?? (typeof data?.message === "string" ? data.message : "Não foi possível exportar. Tente de novo."));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "contas.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  issues: (f: IssueFilters) => request<IssuesPage>("GET", `/issues${qs(f)}`),
  issue: (id: string) => request<IssueDetail>("GET", `/issues/${id}`),
  setIssueStatus: (id: string, status: IssueStatus) => request<IssueDetail>("POST", `/issues/${id}/status`, { status }),
  config: () => request<Config>("GET", "/config", undefined, false),
  me: () => request<Me>("GET", "/me"),
  overview: () => request<Overview>("GET", "/overview"),
  accounts: (f: AccountFilters) => request<Page<AccountRow>>("GET", `/accounts${qs(f)}`),
  account: (id: string) => request<AccountDetail>("GET", `/accounts/${id}`),
  audit: (f: AuditFilters) => request<Page<AuditEvent>>("GET", `/audit${qs(f)}`),
  billing: (f: BillingFilters) => request<Page<BillingEvent>>("GET", `/billing-events${qs(f)}`),
  system: () => request<SystemInfo>("GET", "/system"),
  notes: (id: string) => request<{ items: Note[] }>("GET", `/accounts/${id}/notes`),
  addNote: (id: string, body: string) => request<Note>("POST", `/accounts/${id}/notes`, { body }),
  deleteNote: (id: string, noteId: string) => request<{ deleted: boolean }>("DELETE", `/accounts/${id}/notes/${noteId}`),
  notify: (id: string, title: string, body: string) => request<{ sent: number }>("POST", `/accounts/${id}/notify`, { title, body }),
  appConfig: () => request<AppConfig>("GET", "/app-config"),
  saveAppConfig: (c: Omit<AppConfig, "updated_at" | "updated_by">) => request<AppConfig>("PUT", "/app-config", c),
  act: <T = AccountDetail>(id: string, action: string, body: unknown = {}) => request<T>("POST", `/accounts/${id}/${action}`, body),
};
