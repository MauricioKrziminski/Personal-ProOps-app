import { expect, test, type Page } from "@playwright/test";
import { loginAdmin, shot, U } from "./support";
import { SEED } from "./seed-data";

const links = (page: Page) => page.locator('a[href^="/admin/contas/"]:visible');
const total = (page: Page, n: number) => expect(page.getByText(new RegExp(`^${n} ${n === 1 ? "conta" : "contas"}$`))).toBeVisible();
const selecione = async (page: Page, rotulo: string, valor: string) => { await page.getByLabel(rotulo, { exact: true }).selectOption(valor); };

test.describe("Contas", () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await page.goto("/admin/contas"); await total(page, SEED.total); });

  test("lista 25 por página e pagina no servidor (52 = 25 + 25 + 2)", async ({ page }, info) => {
    await expect(links(page)).toHaveCount(25);
    await expect(page.getByText("1–25 de 52")).toBeVisible();
    await shot(page, info, "contas-lista");
    await page.getByRole("button", { name: "Próxima página" }).click();
    await expect(page.getByText("26–50 de 52")).toBeVisible();
    await expect(page).toHaveURL(/page=2/);
    await page.getByRole("button", { name: "Próxima página" }).click();
    await expect(page.getByText("51–52 de 52")).toBeVisible();
    await expect(links(page)).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Próxima página" })).toBeDisabled();
    await page.getByRole("button", { name: "Página anterior" }).click();
    await expect(page.getByText("26–50 de 52")).toBeVisible();
  });

  test("busca por e-mail, por nome e sem resultado; limpar filtros", async ({ page }) => {
    const busca = page.getByLabel("Buscar por e-mail, nome ou telefone");
    await busca.fill("apple@e2e");
    await total(page, 1);
    await expect(links(page).first()).toContainText("apple@e2e.proops.test");
    await busca.fill("Gustavo");
    await total(page, 1);
    await expect(links(page).first()).toContainText("google@e2e.proops.test");
    await busca.fill("zzz-nada");
    await expect(page.getByText("Nenhuma conta encontrada")).toBeVisible();
    await page.getByRole("button", { name: "Limpar filtros" }).first().click();
    await total(page, SEED.total);
    await expect(busca).toHaveValue("");
  });

  test("busca trata % e _ como texto (não como curinga)", async ({ page }) => {
    await page.getByLabel("Buscar por e-mail, nome ou telefone").fill("%");
    await expect(page.getByText("Nenhuma conta encontrada")).toBeVisible();
  });

  const acessos: [string, number][] = [["subscriber", SEED.access.subscriber], ["trialing", SEED.access.trialing], ["lapsed", SEED.access.lapsed], ["never", SEED.access.never], ["courtesy", SEED.access.courtesy], ["suspended", SEED.access.suspended]];
  for (const [v, n] of acessos) test(`filtro Acesso=${v} → ${n}`, async ({ page }) => {
    await selecione(page, "Acesso", v);
    await total(page, n);
    await expect(page).toHaveURL(new RegExp(`access=${v}`));
  });

  const planos: [string, number][] = [["pro", SEED.plans.pro], ["family", SEED.plans.family], ["free", SEED.total - SEED.plans.pro - SEED.plans.family]];
  for (const [v, n] of planos) test(`filtro Plano=${v} → ${n}`, async ({ page }) => { await selecione(page, "Plano", v); await total(page, n); });

  const origens: [string, number][] = [["apple", 5], ["google", 3], ["manual", 1], ["test_store", 0], ["none", SEED.total - 9]];
  for (const [v, n] of origens) test(`filtro Origem=${v} → ${n}`, async ({ page }) => {
    await selecione(page, "Origem", v);
    if (n === 0) await expect(page.getByText("Nenhuma conta encontrada")).toBeVisible(); else await total(page, n);
  });

  test("filtros combinam (Origem=apple + Acesso=subscriber → familia, apple, a-loja)", async ({ page }) => {
    await selecione(page, "Origem", "apple");
    await selecione(page, "Acesso", "subscriber");
    await total(page, 3);
  });

  test("ordenações: maior uso de IA, e-mail A–Z, mais antigas", async ({ page }) => {
    await selecione(page, "Ordenar por", "ai_used_desc");
    await expect(links(page).first()).toContainText("apple@e2e.proops.test");
    await selecione(page, "Ordenar por", "email_asc");
    await expect(links(page).first()).toContainText("a-del@e2e.proops.test");
    await selecione(page, "Ordenar por", "created_asc");
    await expect(links(page).first()).toContainText("bulk30@e2e.proops.test");
  });

  test("mexer em filtro volta para a página 1", async ({ page }) => {
    await page.getByRole("button", { name: "Próxima página" }).click();
    await expect(page).toHaveURL(/page=2/);
    await selecione(page, "Plano", "free");
    await expect(page).not.toHaveURL(/page=/);
  });

  test("conta SEM e-mail aparece pelo nome e abre a ficha", async ({ page }) => {
    await page.getByLabel("Buscar por e-mail, nome ou telefone").fill("Pedro Sem Email");
    await total(page, 1);
    const l = links(page).first();
    await expect(l).toContainText("Pedro Sem Email");
    await expect(l).not.toContainText("@");
    await l.click();
    await expect(page).toHaveURL(new RegExp(`/contas/${U.sememail.id}$`));
    await expect(page.getByRole("heading", { name: "Pedro Sem Email" })).toBeVisible();
  });

  test("link da lista abre a ficha da conta certa", async ({ page }) => {
    await page.getByLabel("Buscar por e-mail, nome ou telefone").fill("familia@");
    await total(page, 1);
    await links(page).first().click();
    await expect(page).toHaveURL(new RegExp(`/contas/${U.familia.id}$`));
  });

  test("URL com filtros é compartilhável (abre já filtrada)", async ({ page }) => {
    await page.goto("/admin/contas?access=lapsed&sort=email_asc");
    await total(page, SEED.access.lapsed);
    await expect(page.getByLabel("Acesso", { exact: true })).toHaveValue("lapsed");
  });
});
