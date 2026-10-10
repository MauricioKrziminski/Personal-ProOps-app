import { expect, test, type Page } from "@playwright/test";
import { adminApi, login, one, shot, token, totp, U } from "./support";

// Fase 2 do scripts/e2e-painel.sh: o agente sobe com ADMIN_REQUIRE_MFA=true.
const A = U["admin-mfa"];
const passo = () => Math.floor(Date.now() / 30_000);
async function proximoPasso() { const p = passo(); while (passo() === p) await new Promise((r) => setTimeout(r, 500)); }
const digitar = async (page: Page, codigo: string) => { await page.getByLabel("Código", { exact: true }).fill(codigo); await page.getByRole("button", { name: "Verificar" }).click(); };

test.describe("MFA (TOTP) obrigatório @mfa", () => {
  test.describe.configure({ mode: "serial" });
  let segredo = "";

  test("a API exige aal2: 403 mfa_required com senha só (admin e admin-mfa)", async () => {
    for (const u of [A, U.admin]) {
      const r = await adminApi("GET", "/overview", undefined, await token(u));
      expect(r.status, u.email!).toBe(403);
      expect(r.body).toEqual({ error: "mfa_required" });
    }
    expect((await adminApi("GET", "/me", undefined, await token(A))).body.mfa_required).toBeUndefined(); // /me também exige aal2
  });

  test("1º login: mostra QR e chave, código errado dá erro, código certo entra", async ({ page }, info) => {
    await login(page, A);
    await expect(page.getByRole("heading", { name: "Ative a verificação em duas etapas" })).toBeVisible();
    await expect(page.getByAltText("QR code para o app autenticador")).toBeVisible();
    segredo = (await page.locator("code.select-all").textContent())!.trim();
    expect(segredo).toMatch(/^[A-Z2-7]{16,}$/);
    await shot(page, info, "mfa-cadastro");
    await expect(page.getByRole("button", { name: "Verificar" })).toBeDisabled();
    await digitar(page, totp(segredo, Date.now() + 10 * 86400_000)); // código de outro dia = errado
    await expect(page.getByRole("alert")).toContainText("Código inválido ou expirado");
    await digitar(page, totp(segredo));
    await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
    const f = await one<any>("select factor_type, status from auth.mfa_factors where user_id = $1", [A.id]);
    expect(f).toMatchObject({ factor_type: "totp", status: "verified" });
    await shot(page, info, "mfa-dentro");
  });

  test("novo login: pede SÓ o código (sem QR); errado recusa; certo entra e a API aceita", async ({ page }, info) => {
    await proximoPasso(); // o GoTrue não aceita o mesmo código duas vezes
    await login(page, A);
    await expect(page.getByRole("heading", { name: "Digite o código de 6 dígitos" })).toBeVisible();
    await expect(page.getByAltText("QR code para o app autenticador")).toHaveCount(0);
    await shot(page, info, "mfa-so-codigo");
    await digitar(page, "123456".replace(/./g, (c, i) => String((Number(c) + i + 5) % 10)));
    await expect(page.getByRole("alert")).toContainText("Código inválido ou expirado");
    await digitar(page, totp(segredo));
    await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
    await page.getByRole("link", { name: "Contas", exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Contas" })).toBeVisible();
    await expect(page.locator('a[href^="/admin/contas/"]:visible').first()).toBeVisible();
  });

  test("sair no passo do código volta ao login; recarregar mantém aal2", async ({ page }) => {
    test.setTimeout(120_000);
    await proximoPasso();
    await login(page, A);
    await expect(page.getByRole("heading", { name: "Digite o código de 6 dígitos" })).toBeVisible();
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await proximoPasso();
    await login(page, A);
    await digitar(page, totp(segredo));
    await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
  });
});
