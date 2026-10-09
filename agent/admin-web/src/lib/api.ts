import type { AccountDetail, IssueDetail, IssuesPage, IssueStatus, AccountRow, AuditEvent, BillingEvent, Config, Me, Overview, Page, SystemInfo } from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let tokenGetter: () => Promise<string | null> = async () => null;
export const getToken = () => tokenGetter();
export const setTokenGetter = (fn: () => Promise<string | null>) => { tokenGetter = fn; };

/** Eventos globais que o AuthProvider escuta (401 = sessão morreu; 403 mfa_required = pedir o segundo fator). */
export const authEvents = new EventTarget();

export async function request<T>(method: "GET" | "POST", path: string, body?: unknown, auth = true): Promise<T> {
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
  try {
    res = await fetch(`/admin/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "network", "Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof data?.error === "string" ? data.error : "error";
    if (res.status === 401 && auth) authEvents.dispatchEvent(new Event("unauthorized"));
    if (res.status === 403 && code === "mfa_required") authEvents.dispatchEvent(new Event("mfa_required"));
    const fallback = res.status === 422 ? "Dados inválidos." : res.status === 404 ? "Não encontrado." : "Não foi possível concluir. Tente de novo.";
    throw new ApiError(res.status, code, typeof data?.message === "string" ? data.message : fallback);
  }
  return data as T;
}

const qs = (p: Record<string, string | number | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

export type AccountFilters = { q?: string; access?: string; plan?: string; origin?: string; sort?: string; page?: number; page_size?: number };
export type AuditFilters = { action?: string; admin_user_id?: string; target_user_id?: string; page?: number; page_size?: number };
export type BillingFilters = { q?: string; type?: string; result?: string; page?: number; page_size?: number };

export type IssueFilters = { status?: string; source?: string; severity?: string; period?: string; q?: string; sort?: string; page?: number; page_size?: number };

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
  act: <T = AccountDetail>(id: string, action: string, body: unknown = {}) => request<T>("POST", `/accounts/${id}/${action}`, body),
};
