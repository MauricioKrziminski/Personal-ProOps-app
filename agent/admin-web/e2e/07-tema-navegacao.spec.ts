import { expect, test } from "@playwright/test";
import { adminApi, isMobile, loginAdmin, shot, token, U } from "./support";

const ROTAS: [string, string, string][] = [["/admin/", "Visão geral", "Visão geral"], ["/admin/contas", "Contas", "Contas"], ["/admin/observabilidade", "Observabilidade", "Observabilidade"], ["/admin/auditoria", "Auditoria", "Auditoria"], ["/admin/cobranca", "Cobrança", "Cobrança"], ["/admin/sistema", "Sistema", "Sistema"]];

test.describe("Navegação, tema e hardening do SPA", () => {
  test("headers de segurança e theme.js (a CSP proíbe script inline)", async ({ request }) => {
    const r = await request.get("/admin/");
    expect(r.status()).toBe(200);
    const h = r.headers();
    expect(h["content-security-policy"]).toContain("script-src 'self'");
    expect(h["content-security-policy"]).toContain("font-src 'self' data:");
    expect(h["content-security-policy"]).toContain("connect-src 'self' http://127.0.0.1:54321");
    expect(h["x-robots-tag"]).toContain("noindex");
    expect(h["cache-control"]).toBe("no-store");
    const t = await request.get("/admin/theme.js");
    expect(t.status()).toBe(200);
    expect(t.headers()["content-type"]).toMatch(/javascript/);
    expect((await request.get("/admin/arquivo-que-nao-existe.js")).status()).toBe(404);
  });

  test("todas as páginas abrem sem erro de console, sem violação de CSP e sem rolagem horizontal", async ({ page }, info) => {
    const erros: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
    page.on("pageerror", (e) => erros.push(String(e)));
    await loginAdmin(page);
    for (const [url, titulo] of ROTAS) {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
      await page.waitForTimeout(500);
      const larg = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      expect(larg.sw, `${url} rola na horizontal`).toBeLessThanOrEqual(larg.iw);
      await shot(page, info, `pagina-${titulo.toLowerCase().replace(/\W/g, "")}`);
    }
    await page.goto(`/admin/contas/${U.apple.id}`);
    await expect(page.getByRole("heading", { level: 1, name: U.apple.email! })).toBeVisible();
    const larg = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(larg.sw, "ficha rola na horizontal").toBeLessThanOrEqual(larg.iw);
    await shot(page, info, "pagina-ficha");
    // D2 (corrigido): `font-src 'self' data:` — nenhuma violação de CSP, nem de fonte
    expect(erros.filter((e) => !/favicon/.test(e)).map((e) => e.slice(0, 160))).toEqual([]);
  });

  test("tema escuro liga, persiste ao recarregar e volta ao claro", async ({ page }, info) => {
    await loginAdmin(page);
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);
    if (isMobile(info)) { await page.getByRole("button", { name: "Mais" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Tema escuro" }).click(); }
    else await page.getByRole("button", { name: "Tema escuro" }).click();
    await expect(html).toHaveClass(/dark/);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
    await expect(html).toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem("proops-admin-theme"))).toBe("dark");
    await shot(page, info, "tema-escuro");
    await page.goto("/admin/contas");
    await expect(page.getByRole("heading", { level: 1, name: "Contas" })).toBeVisible();
    await shot(page, info, "tema-escuro-contas");
    if (isMobile(info)) { await page.getByRole("button", { name: "Mais" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Tema claro" }).click(); }
    else await page.getByRole("button", { name: "Tema claro" }).click();
    await expect(html).not.toHaveClass(/dark/);
  });

  test("desktop: sidebar com as 6 seções leva a cada página", async ({ page }, info) => {
    test.skip(isMobile(info), "só desktop");
    await loginAdmin(page);
    const nav = page.getByRole("navigation", { name: "Seções" }).first();
    await expect(nav.getByRole("link")).toHaveCount(6);
    for (const [url, rotulo, titulo] of ROTAS) {
      await nav.getByRole("link", { name: rotulo, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(url.replace(/\/$/, "") + "/?$"));
      await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
    }
  });

  test("celular: 4 abas + Mais (Cobrança, Sistema, tema, Sair)", async ({ page }, info) => {
    test.skip(!isMobile(info), "só celular");
    await loginAdmin(page);
    const nav = page.getByRole("navigation", { name: "Seções" }).last();
    await expect(nav.getByRole("link")).toHaveCount(4);
    for (const nome of ["Visão geral", "Contas", "Erros", "Auditoria"]) await expect(nav.getByRole("link", { name: nome })).toBeVisible();
    await nav.getByRole("link", { name: "Erros" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Observabilidade" })).toBeVisible();
    await nav.getByRole("button", { name: "Mais" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByRole("link")).toHaveCount(2);
    await shot(page, info, "mobile-mais");
    await dlg.getByRole("link", { name: "Cobrança" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Cobrança" })).toBeVisible();
    await nav.getByRole("button", { name: "Mais" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Sistema" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sistema" })).toBeVisible();
  });

  test("celular: ficha e menu de ações cabem na tela (folha de baixo)", async ({ page }, info) => {
    test.skip(!isMobile(info), "só celular");
    await loginAdmin(page);
    await page.goto(`/admin/contas/${U.manual.id}`);
    await page.getByRole("button", { name: "Mais ações" }).click();
    await expect(page.getByRole("menuitem", { name: "Apagar conta" })).toBeInViewport();
    await shot(page, info, "mobile-menu-acoes");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Mudar plano" }).first().click();
    const box = await page.getByRole("dialog").boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    await shot(page, info, "mobile-dialogo-plano");
  });

  const limite429 = { status: 429, headers: { "Retry-After": "1", "Content-Type": "application/json" }, body: JSON.stringify({ error: "rate_limited", message: "Muitas ações seguidas; tente em alguns segundos." }) };

  test("D4: 429 na abertura (login) é repetido com recuo e o painel abre", async ({ page }) => {
    test.setTimeout(60_000);
    let n = 0;
    await page.route("**/admin/api/me", (r) => (++n <= 2 ? r.fulfill(limite429) : r.continue()));
    await loginAdmin(page);
    expect(n).toBe(3);
  });

  test("D4: 429 persistente numa lista mostra a mensagem clara (não 'Dados inválidos')", async ({ page }, info) => {
    test.setTimeout(60_000);
    await loginAdmin(page);
    await page.route(/\/admin\/api\/accounts\?/, (r) => r.fulfill(limite429));
    await page.goto("/admin/contas");
    await expect(page.getByText("Muitas ações seguidas; tente em alguns segundos.").first()).toBeVisible({ timeout: 25_000 });
    await shot(page, info, "limite-429");
  });

  test("D4: a rajada normal de uma abertura de tela não chega ao limite do painel", async () => {
    const tk = await token(U.admin);
    const rs = await Promise.all(Array.from({ length: 40 }, () => adminApi("GET", "/overview", undefined, tk)));
    expect(rs.map((r) => r.status).filter((s) => s !== 200)).toEqual([]);
  });
});
