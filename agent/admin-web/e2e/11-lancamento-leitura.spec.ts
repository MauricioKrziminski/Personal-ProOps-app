import { expect, test, type Page } from "@playwright/test";
import { loginAdmin, secao, shot, U } from "./support";

const abrir = async (page: Page, slug: string) => {
  await page.goto(`/admin/contas/${U[slug].id}`);
  await expect(page.getByRole("heading", { level: 1, name: U[slug].email ?? U[slug].name })).toBeVisible();
};

test.describe("Lista de contas: telefone, CSV, versão do app", () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await page.goto("/admin/contas"); });

  test("busca por telefone (placeholder novo) acha a conta", async ({ page }) => {
    const busca = page.getByPlaceholder("e-mail, nome ou telefone", { exact: false });
    await expect(busca).toBeVisible();
    await busca.fill("5511988880010");
    await expect(page.getByText(/^1 conta$/)).toBeVisible();
    await expect(page.locator('a[href^="/admin/contas/"]:visible').first()).toContainText("apple@");
  });

  test("versão do app e último uso na linha; ordem por último uso", async ({ page }, info) => {
    await page.getByLabel("Buscar por e-mail, nome ou telefone").fill("apple@e2e");
    await expect(page.getByText(/^1 conta$/)).toBeVisible();
    await expect(page.locator("main").getByText("1.4.2").locator("visible=true").first()).toBeVisible();
    await expect(page.locator("main").getByText("há 2 d").locator("visible=true").first()).toBeVisible();
    await page.getByLabel("Buscar por e-mail, nome ou telefone").fill("");
    await page.getByLabel("Ordenar por", { exact: true }).selectOption("last_seen_desc");
    await expect(page).toHaveURL(/sort=last_seen_desc/);
    await expect(page.locator('a[href^="/admin/contas/"]:visible').first()).toContainText("familia@");
    await shot(page, info, "contas-versao");
  });

  test("CSV acima do teto vira mensagem em português (422 too_many_rows)", async ({ page }) => {
    await page.route("**/admin/api/accounts.csv*", (r) => r.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "too_many_rows", message: "x" }) }));
    await page.getByRole("button", { name: "Exportar CSV" }).click();
    await expect(page.getByText(/Há contas demais para exportar/)).toBeVisible();
  });
});


test.describe("Visão geral e App", () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); });

  test("versões em uso por plataforma", async ({ page }, info) => {
    const bloco = page.getByTestId("versions");
    await expect(bloco).toBeVisible();
    await expect(bloco.locator('[data-platform="ios"]')).toContainText("1.4.2");
    await expect(bloco.locator('[data-platform="ios"]')).toContainText("1.4.0");
    await expect(bloco.locator('[data-platform="android"]')).toContainText("1.4.2");
    await shot(page, info, "visao-versoes");
  });

});

test.describe("Ficha: app, notas, membros, convites, notificação", () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); });

  test("bloco de app e consentimento", async ({ page }, info) => {
    await abrir(page, "apple");
    const b = secao(page, "App e consentimento");
    await expect(b).toContainText("Versão 2026-10-09");
    await expect(b.locator("dt:text-is('IA autorizada') + dd")).not.toHaveText("Não");
    await expect(b.locator("dt:text-is('Versão do app') + dd")).toHaveText("1.4.2 · iOS");
    await expect(b.locator("dt:text-is('Tokens de push') + dd")).toHaveText("0");
    await abrir(page, "google");
    const g = secao(page, "App e consentimento");
    await expect(g).toContainText("Ainda não aceitou");
    await expect(g.locator("dt:text-is('IA autorizada') + dd")).toHaveText("Não");
    await expect(g.locator("dt:text-is('Último uso do app') + dd")).toHaveText("Nunca");
    await shot(page, info, "ficha-app");
  });

  test("notificação: desabilitada sem aparelho", async ({ page }) => {
    await abrir(page, "apple");
    await page.getByRole("button", { name: "Mais ações" }).click();
    await expect(page.getByRole("menuitem", { name: /Enviar notificação/ })).toHaveAttribute("aria-disabled", "true");
  });

});
