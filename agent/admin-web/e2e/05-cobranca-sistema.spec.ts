import { expect, test, type Page } from "@playwright/test";
import { loginAdmin, secao, shot, sql } from "./support";
import { SEED } from "./seed-data";

const tipos = (page: Page) => page.locator("code:visible");
const total = (page: Page, de: number, n: number) => expect(page.getByText(`${de === 0 ? 0 : 1}–${n} de ${n}`).locator("visible=true").first()).toBeVisible();

test.describe("Cobrança", () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await page.goto("/admin/cobranca"); await expect(tipos(page)).toHaveCount(SEED.billing.total); });

  test("lista os 8 eventos do seed, do mais novo ao mais antigo, e confere com o banco", async ({ page }, info) => {
    await total(page, 1, SEED.billing.total);
    const db = await sql<{ id: string; type: string }>("select id, type from public.billing_events where id like 'e2e-bill-%' order by received_at desc, id");
    expect(db).toHaveLength(SEED.billing.total);
    expect(await tipos(page).allTextContents()).toEqual(db.map((r) => r.type));
    await expect(page.getByText("Sandbox ignorado").locator("visible=true").first()).toBeVisible();
    await expect(page.getByText("Produto desconhecido").locator("visible=true").first()).toBeVisible();
    await shot(page, info, "cobranca");
  });

  test("filtro Tipo", async ({ page }) => {
    await page.getByLabel("Tipo", { exact: true }).selectOption("RENEWAL");
    await expect(tipos(page)).toHaveCount(SEED.billing.renewal);
    await page.getByLabel("Tipo", { exact: true }).selectOption("EXPIRATION");
    await expect(tipos(page)).toHaveCount(1);
  });

  for (const [valor, n] of [["concedido", 3], ["revogado", 2], ["duplicado", 1], ["sandbox_ignorado", 1], ["produto_desconhecido", 1]] as const)
    test(`filtro Resultado=${valor} → ${n}`, async ({ page }) => {
      await page.getByLabel("Resultado", { exact: true }).selectOption(valor);
      await expect(tipos(page)).toHaveCount(n);
    });

  test("busca por e-mail da conta e por ID de usuário sem conta; tipo + resultado combinam", async ({ page }) => {
    const busca = page.getByLabel("Buscar por e-mail ou ID", { exact: true });
    await busca.fill("apple@e2e");
    await expect(tipos(page)).toHaveCount(3);
    await busca.fill("00000000-0000-4000-8000-0000000000aa");
    await expect(tipos(page)).toHaveCount(1);
    await expect(page.getByText("00000000-0000-4000-8000-0000000000aa").locator("visible=true").first()).toBeVisible();
    await busca.fill("");
    await page.getByLabel("Tipo", { exact: true }).selectOption("RENEWAL");
    await page.getByLabel("Resultado", { exact: true }).selectOption("duplicado");
    await expect(tipos(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Limpar" }).click();
    await expect(tipos(page)).toHaveCount(SEED.billing.total);
  });
});

test.describe("Sistema", () => {
  test("fila, falhas mascaradas, custo e WhatsApp do mês batem com o seed", async ({ page }, info) => {
    await loginAdmin(page);
    await page.goto("/admin/sistema");
    await expect(page.getByRole("heading", { name: "Sistema", level: 1 })).toBeVisible();
    const fila = secao(page, "Fila do WhatsApp");
    await expect(fila).toContainText(`Falhas em 24 h${SEED.failedQueue}`);
    await expect(fila).toContainText("Atenção");
    const falhas = secao(page, "Falhas recentes");
    await expect(falhas.getByText("Falhou")).toHaveCount(2);
    await expect(falhas).toContainText("e2e: timeout ao falar com # apos 240s"); // dígitos longos mascarados
    await expect(falhas).not.toContainText("5511988880099");
    await expect(secao(page, "Custo de IA")).toContainText(`US$ ${SEED.usage.costUsd.replace(".", ",")}`);
    await expect(secao(page, "WhatsApp no mês")).toContainText(`Respostas${SEED.usage.replies}`);
    await expect(secao(page, "WhatsApp no mês")).toContainText(`Avisos${SEED.usage.notices}`);
    await shot(page, info, "sistema");
    await page.getByRole("button", { name: "Atualizar" }).click();
    await expect(fila).toContainText("Aguardando");
  });
});
