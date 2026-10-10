import { expect, test } from "@playwright/test";
import { isMobile, loginAdmin, shot, U } from "./support";

const ROTAS: [string, string, string][] = [["/admin/", "Visão geral", "Visão geral"], ["/admin/contas", "Contas", "Contas"], ["/admin/observabilidade", "Observabilidade", "Observabilidade"], ["/admin/auditoria", "Auditoria", "Auditoria"], ["/admin/cobranca", "Cobrança", "Cobrança"], ["/admin/sistema", "Sistema", "Sistema"]];

test.describe("Navegação, tema e hardening do SPA", () => {
  test("headers de segurança e theme.js (a CSP proíbe script inline)", async ({ request }) => {
    const r = await request.get("/admin/");
    expect(r.status()).toBe(200);
    const h = r.headers();
    expect(h["content-security-policy"]).toContain("script-src 'self'");
    expect(h["content-security-policy"]).toContain("connect-src 'self' http://127.0.0.1:54321");
    expect(h["x-robots-tag"]).toContain("noindex");
    expect(h["cache-control"]).toBe("no-store");
    const t = await request.get("/admin/theme.js");
    expect(t.status()).toBe(200);
    expect(t.headers()["content-type"]).toMatch(/javascript/);
    expect((await request.get("/admin/arquivo-que-nao-existe.js")).status()).toBe(404);
  });

  test("todas as páginas abrem sem erro de console, sem violação de CSP e sem rolagem horizontal", async ({ page }, info) => {
    test.fail(true, "D4: CSP do painel bloqueia a fonte embutida (data:font/woff2) — falta font-src 'self' data: em routes/admin_web.py:_csp");
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
    const resto = erros.filter((e) => !/favicon/.test(e) && !/Loading the font 'data:/.test(e));
    expect(resto.map((e) => e.slice(0, 160))).toEqual([]);
    // D4: a CSP não tem font-src, e o Vite embute a Plus Jakarta Sans como data:font/woff2 → bloqueada.
    test.info().annotations.push({ type: "D4", description: `${erros.length - resto.length} violações de CSP por fonte data:` });
    expect.soft(erros.length - resto.length, "D4: fonte data: bloqueada pela CSP (falta font-src)").toBe(0);
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
});
