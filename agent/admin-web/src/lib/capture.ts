import { ApiError, getToken } from "./api";

/** Reporta erros do próprio painel para POST /internal/errors (source "admin"). Nunca lança, nunca reporta a si mesmo. */
type Kind = "error" | "unhandled_rejection" | "render";

const seen = new Set<string>();
const MAX_PER_SESSION = 20;
let sending = false;

const expected = (e: unknown) => e instanceof ApiError && (e.status === 0 || (e.status >= 400 && e.status < 500));

export async function reportError(raw: unknown, kind: Kind) {
  if (sending || seen.size >= MAX_PER_SESSION || expected(raw)) return;
  const e = raw instanceof Error ? raw : new Error(typeof raw === "string" ? raw : "Erro desconhecido");
  const stack = e.stack ?? null;
  const key = `${e.name}|${e.message}|${(stack ?? "").split("\n")[1] ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (import.meta.env.VITE_MOCK) { console.info("[capture:mock]", kind, e.name, e.message); return; }
  sending = true; // trava de loop: falha ao enviar não gera novo envio
  try {
    const token = await getToken().catch(() => null);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetch("/internal/errors", {
      method: "POST", headers, keepalive: true,
      body: JSON.stringify({ errors: [{ source: "admin", kind, name: e.name, message: e.message.slice(0, 500), stack, route: location.pathname.replace(/^\/admin/, "") || "/", platform: "web", app_version: null, occurred_at: new Date().toISOString(), context: {} }] }),
    });
  } catch { /* best-effort */ } finally { sending = false; }
}

export function installCapture() {
  addEventListener("error", (ev) => void reportError(ev.error ?? ev.message, "error"));
  addEventListener("unhandledrejection", (ev) => void reportError(ev.reason, "unhandled_rejection"));
}
