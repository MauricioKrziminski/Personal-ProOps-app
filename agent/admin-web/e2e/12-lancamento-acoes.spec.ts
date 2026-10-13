import { expect, test, type Page } from "@playwright/test";
import { adminApi, loginAdmin, one, secao, shot, sql, U } from "./support";

const abrir = async (page: Page, slug: string) => {
  await page.goto(`/admin/contas/${U[slug].id}`);
  await expect(page.getByRole("heading", { level: 1, name: U[slug].email ?? U[slug].name })).toBeVisible();
};
const maisAcoes = async (page: Page, item: string) => { await page.getByRole("button", { name: "Mais ações" }).click(); await page.getByRole("menuitem", { name: item }).click(); };
/** A ficha carrega com 1 aparelho de push: o item do menu só habilita assim (o seed deixa só a família com token). */
const comAparelho = (page: Page, slug: string) => page.route(new RegExp(`/admin/api/accounts/${U[slug].id}$`), async (rt) => {
  const r = await rt.fetch();
  const j = await r.json();
  j.profile.push_tokens = 1;
  await rt.fulfill({ response: r, json: j });
});
const acoes = (slug: string) => sql<{ action: string; payload: any }>("select action, payload from public.admin_audit_events where target_user_id = $1 order by created_at", [U[slug].id]);

test.describe("Lançamento: ações que gravam", () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await page.goto("/admin/contas"); });

  test("Exportar CSV baixa com o filtro atual e audita", async ({ page }) => {
    await page.getByLabel("Acesso", { exact: true }).selectOption("lapsed");
    const n = (await adminApi("GET", "/accounts?access=lapsed")).body.total as number;
    await expect(page.getByText(new RegExp(`^${n} contas?$`))).toBeVisible();
    const antes = (await sql("select 1 from public.admin_audit_events where action = 'accounts_exported'")).length;
    // Fórmula na planilha: o nome de uma encerrada começa com "=" e o CSV tem que neutralizá-lo com "'".
    const nomeOriginal = U.encerrada.name;
    await sql("update public.profiles set display_name = '=1+1' where id = $1", [U.encerrada.id]);
    let txt: string;
    try {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar CSV" }).click()]);
      expect(dl.suggestedFilename()).toMatch(/^contas-\d{4}-\d{2}-\d{2}\.csv$/);
      txt = await (await import("node:fs")).promises.readFile((await dl.path())!, "utf8");
    } finally {
      await sql("update public.profiles set display_name = $2 where id = $1", [U.encerrada.id, nomeOriginal]);
    }
    expect(txt.trim().split("\n")).toHaveLength(n + 1); // cabeçalho + as encerradas
    expect(txt.charCodeAt(0), "BOM UTF-8 no início (o Excel abre com acento certo)").toBe(0xfeff);
    const [cabecalho, ...linhas] = txt.slice(1).trim().split("\r\n");
    expect(cabecalho).toBe("user_id,email,name,created_at,last_sign_in_at,last_seen_at,last_app_version,plan,status,access,is_trial,period_end,origin,ai_used,ai_max,wa_used,wa_max,whatsapp_linked,suspended,contact_ok");
    const celulas = linhas.find((l) => l.startsWith(`${U.encerrada.id},`))!.split(",");
    expect(celulas[1]).toBe(U.encerrada.email); // célula conhecida do seed
    expect(celulas[2], "fórmula neutralizada: começa com apóstrofo").toBe("'=1+1");
    expect(celulas[9]).toBe("lapsed");
    await expect(page.getByText("CSV exportado.")).toBeVisible();
    await expect.poll(async () => (await sql("select 1 from public.admin_audit_events where action = 'accounts_exported'")).length).toBe(antes + 1);
  });

  test("página App: valida, mostra prévia, salva e diz o que mudou", async ({ page }, info) => {
    await page.goto("/admin/app");
    await expect(page.getByRole("heading", { level: 1, name: "App" })).toBeVisible();
    const salvar = page.getByRole("button", { name: "Salvar", exact: true });
    await expect(salvar).toBeDisabled();
    await page.getByLabel("Versão mínima (iOS)").fill("abc");
    await expect(page.getByText("Use o formato 1.4.2.")).toBeVisible();
    await expect(salvar).toBeDisabled();
    await page.getByLabel("Versão mínima (iOS)").fill("1.3.0");
    await page.getByLabel("Versão mais recente (Android)").fill("1.5.0");
    await page.getByLabel("Link da App Store").fill("http://x");
    await expect(page.getByText("O link precisa começar com https://")).toBeVisible();
    await page.getByLabel("Link da App Store").fill("https://apps.apple.com/app/proops");
    await page.getByLabel("Título do aviso").fill("Manutenção hoje");
    await page.getByLabel("Texto do aviso").fill("O assistente fica fora do ar das 22h às 23h.");
    await expect(page.getByText("Escolha o nível do aviso.")).toBeVisible();
    await page.getByLabel("Nível do aviso").selectOption("warning");
    const prev = page.getByTestId("notice-preview");
    await expect(prev).toContainText("Manutenção hoje");
    await expect(prev).toContainText("A pessoa pode dispensar");
    await shot(page, info, "app-previa");
    await salvar.click();
    const mudou = page.getByTestId("config-changes");
    await expect(mudou).toContainText("Versão mínima (iOS): vazio → 1.3.0");
    await expect(mudou).toContainText("Nível do aviso: vazio → Atenção");
    const row = await one<any>("select * from public.app_config where id = 1");
    expect(row.min_version_ios).toBe("1.3.0");
    expect(row.notice_level).toBe("warning");
    expect(row.latest_version_android).toBe("1.5.0");
    const ev = await one<any>("select payload from public.admin_audit_events where action = 'app_config_changed' order by created_at desc limit 1");
    expect(ev.payload.changes.min_version_ios).toEqual({ from: null, to: "1.3.0" });
    // recarrega: persiste; crítico não dispensa (texto da prévia)
    await page.reload();
    await expect(page.getByLabel("Versão mínima (iOS)")).toHaveValue("1.3.0");
    await page.getByLabel("Nível do aviso").selectOption("critical");
    await expect(page.getByTestId("notice-preview")).toContainText("Não pode ser dispensado");
  });

  test("auditoria mostra a ação nova em português", async ({ page }) => {
    await page.goto("/admin/auditoria");
    await expect(page.locator("main").getByText("Configuração do app alterada").locator("visible=true").first()).toBeVisible();
  });

  test("notas internas: adicionar e apagar com confirmação", async ({ page }) => {
    await abrir(page, "manual");
    const notas = secao(page, "Notas internas");
    await expect(notas.getByRole("button", { name: "Adicionar nota" })).toBeDisabled();
    await notas.getByLabel("Nova nota").fill("Pediu extensão de cortesia.");
    await notas.getByRole("button", { name: "Adicionar nota" }).click();
    await expect(notas.getByTestId("note")).toHaveCount(1);
    await expect(notas.getByTestId("note")).toContainText("Pediu extensão de cortesia.");
    expect(Number((await one<any>("select count(*)::int as n from public.admin_account_notes where user_id = $1", [U.manual.id])).n)).toBe(1);
    await notas.getByRole("button", { name: "Apagar nota" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar" }).click();
    await expect(notas.getByTestId("note")).toHaveCount(1);
    await notas.getByRole("button", { name: "Apagar nota" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Apagar", exact: true }).click();
    await expect(notas.getByText("Nenhuma nota")).toBeVisible();
    const a = (await acoes("manual")).map((x) => x.action);
    expect(a).toContain("note_added");
    expect(a).toContain("note_deleted");
    expect(JSON.stringify(await acoes("manual"))).not.toContain("Pediu extensão");
  });

  test("convite pendente: revogar", async ({ page }) => {
    await abrir(page, "familia");
    const gente = secao(page, "Membros e convites");
    await gente.getByRole("button", { name: "Revogar" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Revogar" }).click();
    await expect(page.getByText("Convite revogado.")).toBeVisible();
    await expect(gente.getByRole("button", { name: "Revogar" })).toHaveCount(0);
    expect((await one<any>("select i.status from public.workspace_invites i join public.workspaces w on w.id = i.workspace_id where w.owner_id = $1 and i.phone = '5511977770001'", [U.familia.id])).status).toBe("revoked");
    expect((await acoes("familia")).map((x) => x.action)).toContain("invite_revoked");
  });

  test("membro: Remover (e o dono não tem o botão)", async ({ page }) => {
    await abrir(page, "familia");
    const gente = secao(page, "Membros e convites");
    await expect(gente.getByRole("button", { name: "Remover" })).toHaveCount(1); // só o membro
    await gente.getByRole("button", { name: "Remover" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remover" }).click();
    await expect(page.getByText("Membro removido.")).toBeVisible();
    await expect(gente.getByRole("button", { name: "Remover" })).toHaveCount(0);
    await expect(gente).not.toContainText(U.membro.email!);
    expect((await acoes("familia")).map((x) => x.action)).toContain("member_removed");
  });

  test("notificação: contadores, 409 sem token e envio com token (Expo fora = mensagem, nada sai)", async ({ page }, info) => {
    // 409 pela API (sem token); a UI nunca oferece o item aí, então conferimos o contrato direto
    const r = await adminApi("POST", `/accounts/${U.apple.id}/notify`, { title: "a", body: "b" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("no_push_tokens");
    // a UI traduz o 409 mesmo quando o item estava habilitado (token sumiu entre abrir e enviar)
    await comAparelho(page, "teste2");
    await abrir(page, "teste2");
    await maisAcoes(page, "Enviar notificação");
    await page.route(/\/admin\/api\/accounts\/.*\/notify/, (rt) => rt.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "no_push_tokens", message: "x" }) }));
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByRole("button", { name: "Enviar", exact: true })).toBeDisabled();
    await dlg.getByLabel("Título").fill("t".repeat(70));
    await dlg.getByLabel("Texto").fill("x".repeat(200));
    await expect(dlg.getByTestId("title-count")).toHaveText("60/60");
    await expect(dlg.getByTestId("body-count")).toHaveText("180/180");
    await shot(page, info, "notificar");
    await dlg.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.getByText("Esta conta não tem aparelho registrado para receber o aviso.")).toBeVisible();
    await page.unroute(/\/admin\/api\/accounts\/.*\/notify/);
    await page.keyboard.press("Escape");
    // com token (familia): o agente tenta o Expo, que não existe no E2E (proxy morto) -> 502 em português; sem push real
    await abrir(page, "familia");
    await maisAcoes(page, "Enviar notificação");
    const d2 = page.getByRole("dialog");
    await d2.getByLabel("Título").fill("Olá");
    await d2.getByLabel("Texto").fill("Teste do painel");
    await d2.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.getByText("Não foi possível enviar o aviso agora. Tente de novo em instantes.")).toBeVisible();
    expect((await acoes("familia")).map((x) => x.action)).not.toContain("push_sent");
  });


  test("celular (390px): notas, convite e notificação cabem na tela", async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await comAparelho(page, "a-loja");
    await abrir(page, "a-loja");
    const notas = secao(page, "Notas internas");
    await notas.getByLabel("Nova nota").fill("Nota no celular.");
    await notas.getByRole("button", { name: "Adicionar nota" }).click();
    await expect(notas.getByTestId("note")).toHaveCount(1);
    await notas.getByRole("button", { name: "Apagar nota" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Apagar", exact: true }).click();
    await expect(notas.getByText("Nenhuma nota")).toBeVisible();
    await maisAcoes(page, "Enviar notificação");
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Título").fill("Olá");
    await dlg.getByLabel("Texto").fill("Teste");
    await expect(dlg.getByRole("button", { name: "Enviar", exact: true })).toBeVisible();
    await shot(page, info, "notificar-celular");
    await page.keyboard.press("Escape");
    await page.goto("/admin/app");
    await expect(page.getByRole("heading", { level: 1, name: "App" })).toBeVisible();
    const larg = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(larg.sw, "App rola na horizontal").toBeLessThanOrEqual(larg.iw);
    await shot(page, info, "app-celular");
  });
});
