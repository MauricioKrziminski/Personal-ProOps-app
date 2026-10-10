import { expect, test, type Page } from "@playwright/test";
import { loginAdmin, shot, sql, U } from "./support";

const linhas = (page: Page) => page.locator("p", { hasText: /^Por / });
const ROTULO: Record<string, string> = { plan_changed: "Plano alterado", plan_forced: "Plano forçado (loja)", suspended: "Conta suspensa", reactivated: "Conta reativada", signed_out: "Sessões encerradas", password_reset_sent: "Código de senha enviado", whatsapp_unlinked: "WhatsApp desvinculado", account_deleted: "Conta apagada" };

test.describe("Auditoria (depois das ações do 04)", () => {
  let porAcao: Record<string, number>; let n = 0;
  test.beforeAll(async () => {
    const r = await sql<{ action: string; n: string }>("select action, count(*) n from public.admin_audit_events group by 1");
    porAcao = Object.fromEntries(r.map((x) => [x.action, Number(x.n)]));
    n = r.reduce((a, x) => a + Number(x.n), 0);
  });
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await page.goto("/admin/auditoria"); });

  test("lista TODAS as ações feitas (uma linha por evento do banco)", async ({ page }, info) => {
    expect(n).toBe(13); // 11 do fluxo do 04 + suspender/reativar do teste do motivo longo (D3)
    await expect(linhas(page)).toHaveCount(n);
    await expect(page.getByText(`1–${n} de ${n}`)).toBeVisible();
    for (const a of Object.keys(porAcao)) await expect(page.getByText(ROTULO[a], { exact: true }).locator("visible=true").first(), a).toBeVisible();
    await expect(linhas(page).first()).toContainText(U.admin.email!);
    await shot(page, info, "auditoria");
  });

  test("a mais recente vem primeiro e mostra o motivo da suspensão no detalhe", async ({ page }) => {
    const ult = await sql<{ action: string }>("select action from public.admin_audit_events order by created_at desc limit 1");
    await expect(page.locator("span.text-xs, div").filter({ hasText: ROTULO[ult[0].action] }).first()).toBeVisible();
    await expect(page.getByText("“chargeback confirmado e2e”")).toBeVisible();
  });

  for (const a of ["plan_changed", "suspended", "signed_out", "account_deleted"]) test(`filtro Ação=${a}`, async ({ page }) => {
    await page.getByLabel("Ação", { exact: true }).selectOption(a);
    await expect(linhas(page)).toHaveCount(porAcao[a]);
    await expect(page).toHaveURL(new RegExp(`action=${a}`));
  });

  test("filtro por ID da conta mostra só a conta e o link abre a ficha", async ({ page }) => {
    await page.getByLabel("ID da conta").fill(U["a-plano"].id);
    const db = await sql<{ n: string }>("select count(*) n from public.admin_audit_events where target_user_id = $1", [U["a-plano"].id]);
    await expect(linhas(page)).toHaveCount(Number(db[0].n));
    await linhas(page).first().getByRole("link", { name: U["a-plano"].email! }).click();
    await expect(page).toHaveURL(new RegExp(`/contas/${U["a-plano"].id}$`));
    await expect(page.getByRole("heading", { name: "Auditoria da conta" })).toBeVisible();
    await page.getByRole("link", { name: "Ver tudo" }).click();
    await expect(page).toHaveURL(new RegExp(`/auditoria\\?target_user_id=${U["a-plano"].id}`));
  });

  test("evento de conta apagada mostra o ID (a conta não existe mais) e abrir dá 'Conta não encontrada'", async ({ page }) => {
    await page.getByLabel("Ação", { exact: true }).selectOption("account_deleted");
    await page.getByRole("link", { name: U["a-del"].id }).click();
    await expect(page.getByText("Conta não encontrada")).toBeVisible();
  });

  test("Limpar volta à lista completa", async ({ page }) => {
    await page.getByLabel("Ação", { exact: true }).selectOption("suspended");
    await page.getByRole("button", { name: "Limpar" }).click();
    await expect(linhas(page)).toHaveCount(n);
  });
});
