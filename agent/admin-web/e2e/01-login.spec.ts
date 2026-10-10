import { expect, test } from "@playwright/test";
import { adminApi, login, loginAdmin, shot, U } from "./support";

test.describe("Login", () => {
  test("a API recusa sem token e responde a config sem auth", async ({ request }) => {
    expect((await request.get("/admin/api/me")).status()).toBe(401);
    const cfg = await request.get("/admin/api/config");
    expect(cfg.status()).toBe(200);
    expect(Object.keys(await cfg.json()).sort()).toEqual(["revenuecat_dashboard_url", "supabase_anon_key", "supabase_url"]);
    expect((await request.get("/admin/api/rota-que-nao-existe")).status()).toBe(404);
  });

  test("senha errada mostra o erro e continua na tela de entrar", async ({ page }, info) => {
    await login(page, { email: U.admin.email, password: "senha-errada-123" });
    await expect(page.getByRole("alert")).toContainText("E-mail ou senha incorretos.");
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await shot(page, info, "login-erro");
  });

  test("conta que não é admin vê 'Esta conta não é administradora' e consegue sair", async ({ page }, info) => {
    await login(page, U.comum);
    await expect(page.getByRole("heading", { name: "Esta conta não é administradora" })).toBeVisible();
    await shot(page, info, "login-nao-admin");
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  });

  test("a API devolve 403 forbidden para quem não é admin", async () => {
    const r = await adminApi("GET", "/overview", undefined, await (await import("./support")).token(U.comum));
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: "forbidden" });
  });

  test("admin entra na Visão geral e a sessão sobrevive ao recarregar", async ({ page }, info) => {
    await loginAdmin(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
    await shot(page, info, "login-ok");
  });

  test("sair volta para a tela de entrar", async ({ page }) => {
    await loginAdmin(page);
    if (page.viewportSize()!.width < 1024) {
      await page.getByRole("button", { name: "Mais" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Sair" }).click();
    } else await page.getByRole("button", { name: "Sair" }).click();
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  });
});
