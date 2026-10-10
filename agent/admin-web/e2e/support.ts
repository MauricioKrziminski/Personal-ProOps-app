import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { Pool } from "pg";

const RAIZ = path.resolve(import.meta.dirname, "../../..");
export const CFG = JSON.parse(readFileSync(path.join(RAIZ, "scripts/e2e/.e2e-config.json"), "utf8")) as {
  apiUrl: string; anonKey: string; serviceKey: string; dbUrl: string; agentUrl: string; mailpitUrl: string; adminIds: string[];
  users: Record<string, { id: string; email: string | null; password: string; name: string; phone?: string }>;
};
export const U = CFG.users;

// ── guarda: este suite só roda contra localhost ──────────────────────────────────────────────────────────
for (const url of [CFG.apiUrl, CFG.agentUrl, CFG.dbUrl.replace(/^postgresql:\/\/[^@]*@/, "http://")]) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error(`E2E recusado: ${url} não é local`);
}

// ── banco (consulta direta para conferir o EFEITO da UI) ─────────────────────────────────────────────────
const pool = new Pool({ connectionString: CFG.dbUrl, max: 2 });
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, params)).rows as T[];
}
export const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await sql<T>(text, params))[0];

// ── UI ───────────────────────────────────────────────────────────────────────────────────────────────────
export async function login(page: Page, u: { email: string | null; password: string }) {
  await page.goto("/admin/");
  await page.getByLabel("E-mail").fill(u.email!);
  await page.getByLabel("Senha").fill(u.password);
  await page.getByRole("button", { name: "Entrar" }).click();
}
export async function loginAdmin(page: Page) {
  await login(page, U.admin);
  await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
}

/** Screenshot de sucesso para conferência visual (e2e/.artifacts/shots/<projeto>-<nome>.png). */
export async function shot(page: Page, info: TestInfo, nome: string) {
  await page.waitForTimeout(400); // fim de animação/gráfico
  await page.screenshot({ path: path.join(import.meta.dirname, ".artifacts/shots", `${info.project.name}-${nome}.png`), fullPage: false });
}
export const isMobile = (info: TestInfo) => info.project.name === "mobile";

/** Texto de um card pelo título (h2) — a ficha e a visão geral são feitas de seções. */
export const secao = (page: Page, titulo: string) => page.getByRole("heading", { name: titulo, exact: true }).locator("xpath=../..");

// ── API direta (token de senha) ──────────────────────────────────────────────────────────────────────────
export async function token(u: { email: string | null; password: string }): Promise<string> {
  const r = await fetch(`${CFG.apiUrl}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: CFG.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: u.email, password: u.password }) });
  if (!r.ok) throw new Error(`login ${u.email}: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token as string;
}
export async function adminApi<T = any>(method: string, p: string, body?: unknown, tk?: string): Promise<{ status: number; body: T }> {
  const t = tk ?? (await token(U.admin));
  const r = await fetch(`${CFG.agentUrl}/admin/api${p}`, { method, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as T };
}

// ── Mailpit ──────────────────────────────────────────────────────────────────────────────────────────────
export async function mailpitFor(email: string, depoisDe: number): Promise<{ id: string; text: string; subject: string } | null> {
  for (let i = 0; i < 20; i++) {
    const r = await (await fetch(`${CFG.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const msgs = (r.messages ?? []).filter((m: any) => new Date(m.Created).getTime() >= depoisDe);
    if (msgs.length) {
      const full = await (await fetch(`${CFG.mailpitUrl}/api/v1/message/${msgs[0].ID}`)).json();
      return { id: msgs[0].ID, text: `${full.Text ?? ""} ${full.HTML ?? ""}`, subject: full.Subject };
    }
    await new Promise((s) => setTimeout(s, 500));
  }
  return null;
}

// ── TOTP (RFC 6238, SHA-1, 30 s, 6 dígitos) sem dependência ─────────────────────────────────────────────
function base32(s: string): Buffer {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "")) bits += A.indexOf(c).toString(2).padStart(5, "0");
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

// ── WhatsApp assinado (scripts/fake_meta.py) ────────────────────────────────────────────────────────────
export function fakeMeta(phone: string, texto: string): string {
  return execFileSync(path.join(RAIZ, "agent/.venv/bin/python"), [path.join(RAIZ, "agent/scripts/fake_meta.py"), "--phone", phone, "--url", CFG.agentUrl, texto], {
    env: { PATH: process.env.PATH ?? "", WHATSAPP_APP_SECRET: "e2e-app-secret", AGENT_URL: CFG.agentUrl }, encoding: "utf8", timeout: 60_000, cwd: path.join(RAIZ, "scripts/e2e"),
  });
}
export const uid = () => randomUUID();
