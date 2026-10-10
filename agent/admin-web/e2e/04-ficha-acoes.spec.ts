import { expect, test, type Page } from "@playwright/test";
import { adminApi, CFG, loginAdmin, mailpitFor, one, secao, shot, sql, U } from "./support";

const brt = (diasDepois = 0) => new Date(Date.now() + diasDepois * 86400000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const abrir = async (page: Page, slug: string) => {
  await page.goto(`/admin/contas/${U[slug].id}`);
  await expect(page.getByRole("heading", { level: 1, name: U[slug].email ?? U[slug].name })).toBeVisible();
};
const maisAcoes = async (page: Page, item: string) => { await page.getByRole("button", { name: "Mais ações" }).click(); await page.getByRole("menuitem", { name: item }).click(); };
const audit = (slug: string) => sql<{ action: string; payload: any; admin_user_id: string }>("select action, payload, admin_user_id from public.admin_audit_events where target_user_id = $1 order by created_at", [U[slug].id]);
const sub = (slug: string) => one<any>("select s.* from public.subscriptions s join public.workspaces w on w.id = s.workspace_id where w.owner_id = $1 order by w.created_at limit 1", [U[slug].id]);

test.describe("Ficha da conta: leitura", () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); });

  test("apple: seções, contagens, uso, assinatura da loja e cobrança do seed", async ({ page }, info) => {
    await abrir(page, "apple");
    for (const h of ["Assinatura", "Uso", "Dados", "Membros e convites", "Histórico de cobrança", "Auditoria da conta"]) await expect(page.getByRole("heading", { name: h, exact: true })).toBeVisible();
    await expect(page.getByText("Assinatura gerenciada pela loja")).toBeVisible();
    // D5: origem normalizada (a mesma da lista), nunca o provider cru "app_store"
    await expect(secao(page, "Assinatura").locator("dt:text-is('Origem') + dd")).toHaveText("App Store");
    await expect(page.getByText("app_store", { exact: true })).toHaveCount(0);
    const det = await adminApi("GET", `/accounts/${U.apple.id}`);
    const lista = await adminApi("GET", `/accounts?q=${U.apple.email}`);
    expect(det.body.subscription.origin).toBe("apple");
    expect(det.body.subscription.origin).toBe(lista.body.items[0].origin);
    const dados = page.locator("dl").filter({ hasText: "Lançamentos" }).first();
    for (const [k, v] of [["Lançamentos", 4], ["Contas", 2], ["Cartões", 1], ["Notas", 3], ["Metas", 0]] as const)
      await expect(dados.locator("div").filter({ has: page.getByText(k, { exact: true }) }).first().locator("dd")).toHaveText(String(v));
    await expect(page.getByText("340").first()).toBeVisible();
    await expect(page.getByText("/ 400").first()).toBeVisible();
    await expect(page.getByText("5511988880010")).toBeVisible();
    const cobr = secao(page, "Histórico de cobrança");
    await expect(cobr.locator("code")).toHaveCount(3);
    await expect(cobr).toContainText("INITIAL_PURCHASE");
    await expect(cobr).toContainText("Duplicado");
    await shot(page, info, "ficha-apple");
  });

  test("D6: gráfico de uso em ordem cronológica (mais antigo à esquerda)", async ({ page }) => {
    await abrir(page, "apple");
    const api = (await adminApi("GET", `/accounts/${U.apple.id}`)).body.usage.months.map((m: any) => m.month as string);
    const esperado = [...api].sort().map((ym) => ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(ym.slice(5)) - 1] + "/" + ym.slice(2, 4));
    const ticks = page.locator("[role=img] .recharts-cartesian-axis-tick-value").filter({ hasText: /^[a-z]{3}\/\d{2}$/ });
    await expect(ticks).toHaveCount(6);
    expect(await ticks.allTextContents()).toEqual(esperado);
  });

  test("familia: dono, membro e convite pendente", async ({ page }) => {
    await abrir(page, "familia");
    const gente = secao(page, "Membros e convites");
    await expect(gente).toContainText(U.familia.email!);
    await expect(gente).toContainText(U.membro.email!);
    await expect(gente).toContainText("Dono");
    await expect(gente).toContainText("5511977770001");
    await expect(gente).toContainText("Pendente");
  });

  test("conta sem e-mail: título é o nome e o menu não oferece copiar e-mail", async ({ page }) => {
    await page.goto(`/admin/contas/${U.sememail.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Pedro Sem Email" })).toBeVisible();
    await page.getByRole("button", { name: "Mais ações" }).click();
    await expect(page.getByRole("menuitem", { name: "Copiar e-mail" })).toHaveAttribute("aria-disabled", "true");
  });

  test("conta inexistente mostra 'Conta não encontrada'", async ({ page }) => {
    await page.goto("/admin/contas/00000000-0000-4000-8000-000000000123");
    await expect(page.getByText("Conta não encontrada")).toBeVisible();
  });

  test("copiar e-mail, ID do usuário e ID do espaço vão para a área de transferência", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await abrir(page, "manual");
    const ws = (await one<{ id: string }>("select id from public.workspaces where owner_id = $1", [U.manual.id]))!.id;
    for (const [item, toast, esperado] of [["Copiar e-mail", "E-mail copiado.", U.manual.email!], ["Copiar ID do usuário", "ID do usuário copiado.", U.manual.id], ["Copiar ID do espaço", "ID do espaço copiado.", ws]] as const) {
      await maisAcoes(page, item);
      await expect(page.getByText(toast)).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(esperado);
    }
  });
});

test.describe("Ficha da conta: ações (serial, mexem no banco)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ page, context }) => { await context.grantPermissions(["clipboard-read", "clipboard-write"]); await loginAdmin(page); });

  test("mudar plano para Pro COM vencimento", async ({ page }, info) => {
    await abrir(page, "a-plano");
    await page.getByRole("button", { name: "Mudar plano" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Plano").selectOption("pro");
    await dlg.getByLabel("Vencimento", { exact: true }).fill(brt(30));
    await shot(page, info, "acao-plano-dialogo");
    await dlg.getByRole("button", { name: "Salvar plano" }).click();
    await expect(page.getByText("Plano atualizado.")).toBeVisible();
    const s = await sub("a-plano");
    expect(s).toMatchObject({ plan: "pro", status: "active", provider: "manual", is_trial: false });
    expect(String(s.current_period_end.toISOString?.().slice(0, 10) ?? s.current_period_end)).toContain(brt(30).slice(0, 10));
    const a = await audit("a-plano");
    expect(a.map((x) => x.action)).toEqual(["plan_changed"]);
    expect(a[0].admin_user_id).toBe(U.admin.id);
    await expect(page.getByText("Manual").first()).toBeVisible();
  });

  test("mudar plano para Família SEM vencimento", async ({ page }) => {
    await abrir(page, "a-plano");
    await page.getByRole("button", { name: "Mudar plano" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Plano").selectOption("family");
    await dlg.getByLabel("Sem vencimento").check();
    await expect(dlg.getByLabel("Vencimento", { exact: true })).toBeDisabled();
    await dlg.getByRole("button", { name: "Salvar plano" }).click();
    await expect(page.getByText("Plano atualizado.")).toBeVisible();
    expect(await sub("a-plano")).toMatchObject({ plan: "family", status: "active", current_period_end: null });
  });

  test("data de vencimento no passado é recusada e nada muda", async ({ page }) => {
    await abrir(page, "a-plano");
    const antes = await sub("a-plano");
    await page.getByRole("button", { name: "Mudar plano" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Plano").selectOption("pro");
    await dlg.getByLabel("Vencimento", { exact: true }).fill(brt(-1));
    await dlg.getByRole("button", { name: "Salvar plano" }).click();
    await expect(page.getByText("A data de fim já passou.")).toBeVisible();
    await expect(dlg).toBeVisible();
    expect(await sub("a-plano")).toMatchObject({ plan: antes.plan, status: antes.status });
    expect((await audit("a-plano")).length).toBe(2);
  });

  test("plano Free cancela a assinatura manual", async ({ page }) => {
    await abrir(page, "a-plano");
    await page.getByRole("button", { name: "Mudar plano" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Plano").selectOption("free");
    await expect(dlg.getByLabel("Vencimento", { exact: true })).toHaveCount(0);
    await dlg.getByRole("button", { name: "Salvar plano" }).click();
    await expect(page.getByText("Plano atualizado.")).toBeVisible();
    expect(await sub("a-plano")).toMatchObject({ plan: "free", status: "canceled", provider: "manual" });
  });

  test("assinatura da loja: API recusa sem force (409 store_managed)", async () => {
    const r = await adminApi("POST", `/accounts/${U["a-loja"].id}/plan`, { plan: "family", period_end: null, force: false });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("store_managed");
    expect((await sub("a-loja")).provider).toBe("app_store");
  });

  test("assinatura da loja: UI exige forçar + digitar o e-mail certo", async ({ page }, info) => {
    await abrir(page, "a-loja");
    await page.getByRole("button", { name: "Mudar plano" }).first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByText("Assinatura gerenciada pela loja")).toBeVisible();
    const salvar = dlg.getByRole("button", { name: "Salvar plano" });
    await expect(salvar).toBeDisabled();
    await dlg.getByLabel("Forçar mesmo assim").check();
    await expect(salvar).toBeDisabled();
    await dlg.getByLabel("Digite o e-mail da conta para confirmar").fill("outro@e2e.proops.test");
    await expect(salvar).toBeDisabled();
    await dlg.getByLabel("Plano").selectOption("family");
    await dlg.getByLabel("Digite o e-mail da conta para confirmar").fill(U["a-loja"].email!.toUpperCase());
    await shot(page, info, "acao-plano-loja");
    await expect(salvar).toBeEnabled();
    await salvar.click();
    await expect(page.getByText("Plano atualizado.")).toBeVisible();
    expect(await sub("a-loja")).toMatchObject({ plan: "family", provider: "manual" });
    const a = await audit("a-loja");
    expect(a.map((x) => x.action)).toEqual(["plan_forced"]);
    expect(a[0].payload).toMatchObject({ from_provider: "app_store", to_plan: "family" });
  });

  test("suspender exige motivo; grava banned_until e apaga as sessões; reativar limpa", async ({ page }, info) => {
    const antes = await one<{ n: string }>("select count(*) n from auth.sessions where user_id = $1", [U["a-susp"].id]);
    expect(Number(antes!.n)).toBeGreaterThanOrEqual(2);
    await abrir(page, "a-susp");
    await expect(page.locator("div").filter({ hasText: /^Sessões ativas/ }).last()).toContainText(antes!.n);
    await page.getByRole("button", { name: "Suspender", exact: true }).click();
    const dlg = page.getByRole("alertdialog");
    const ok = dlg.getByRole("button", { name: "Suspender", exact: true });
    await expect(ok).toBeDisabled();
    await dlg.getByLabel("Motivo").fill("ab");
    await expect(ok).toBeDisabled();
    await dlg.getByLabel("Motivo").fill("chargeback confirmado e2e");
    await ok.click();
    await expect(page.getByText("Conta suspensa.", { exact: true }).first()).toBeVisible();
    const u = await one<{ banned: boolean; far: boolean; s: string }>("select banned_until > now() banned, banned_until > now() + interval '50 years' far, (select count(*) from auth.sessions where user_id = id) s from auth.users where id = $1", [U["a-susp"].id]);
    expect(u).toMatchObject({ banned: true, far: true });
    expect(Number(u!.s)).toBe(0);
    await expect(page.getByRole("button", { name: "Reativar" })).toBeVisible();
    await expect(page.getByText(/Conta suspensa\. Sem acesso/)).toBeVisible();
    await shot(page, info, "ficha-suspensa");
    expect((await audit("a-susp")).at(-1)).toMatchObject({ action: "suspended", payload: { reason: "chargeback confirmado e2e" } });

    // a conta suspensa não consegue mais entrar
    const r = await fetch(`${CFG.apiUrl}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: CFG.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: U["a-susp"].email, password: U["a-susp"].password }) });
    expect(r.status).toBeGreaterThanOrEqual(400);

    await page.getByRole("button", { name: "Reativar" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Reativar" }).click();
    await expect(page.getByText("Conta reativada.")).toBeVisible();
    expect((await one<any>("select banned_until from auth.users where id = $1", [U["a-susp"].id]))!.banned_until).toBeNull();
    expect((await audit("a-susp")).map((x) => x.action)).toEqual(["suspended", "reactivated"]);
  });

  test("D3: motivo de até 300 caracteres é gravado; a tela corta no limite da API e mostra o contador", async ({ page }) => {
    await abrir(page, "a-susp");
    await page.getByRole("button", { name: "Suspender", exact: true }).click();
    const dlg = page.getByRole("alertdialog");
    await dlg.getByLabel("Motivo").fill("x".repeat(350)); // a tela corta em 300
    await expect(dlg.getByTestId("reason-count")).toHaveText("300/300");
    await dlg.getByRole("button", { name: "Suspender", exact: true }).click();
    await expect(page.getByText("Conta suspensa.", { exact: true }).first()).toBeVisible();
    expect((await audit("a-susp")).at(-1)!.payload.reason).toHaveLength(300);
    expect((await adminApi("POST", `/accounts/${U["a-susp"].id}/suspend`, { reason: "y".repeat(301) })).status).toBe(422);
    // desfaz para os testes seguintes (reativar é auditado, mas a ordem dos testes seguintes só olha o fim)
    await adminApi("POST", `/accounts/${U["a-susp"].id}/reactivate`, {});
  });

  test("encerrar sessões apaga auth.sessions e audita", async ({ page }) => {
    const antes = await one<{ n: string }>("select count(*) n from auth.sessions where user_id = $1", [U["a-reset"].id]);
    expect(Number(antes!.n)).toBeGreaterThanOrEqual(2);
    await abrir(page, "a-reset");
    await maisAcoes(page, "Encerrar sessões");
    await page.getByRole("alertdialog").getByRole("button", { name: "Encerrar sessões" }).click();
    await expect(page.getByText("Sessões encerradas.")).toBeVisible();
    expect(Number((await one<{ n: string }>("select count(*) n from auth.sessions where user_id = $1", [U["a-reset"].id]))!.n)).toBe(0);
    expect((await audit("a-reset")).map((x) => x.action)).toEqual(["signed_out"]);
  });

  test("enviar código de senha: o e-mail chega no Mailpit com o código e ele vale", async ({ page }) => {
    const desde = Date.now() - 2000;
    await abrir(page, "a-reset");
    await maisAcoes(page, "Enviar código de senha");
    await page.getByRole("alertdialog").getByRole("button", { name: "Enviar código" }).click();
    await expect(page.getByText("Código de recuperação enviado.")).toBeVisible();
    const m = await mailpitFor(U["a-reset"].email!, desde);
    expect(m, "e-mail no Mailpit").not.toBeNull();
    const code = /(\d{6})/.exec(m!.text.replace(/<[^>]+>/g, " "))?.[1];
    expect(code).toBeTruthy();
    const v = await fetch(`${CFG.apiUrl}/auth/v1/verify`, { method: "POST", headers: { apikey: CFG.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ type: "recovery", email: U["a-reset"].email, token: code }) });
    expect(v.status).toBe(200);
    expect((await audit("a-reset")).map((x) => x.action)).toEqual(["signed_out", "password_reset_sent"]);
  });

  test("D8: conta SEM e-mail: a ação vem desabilitada com o motivo; a API responde 409 no_email e não audita", async ({ page }) => {
    await page.goto(`/admin/contas/${U.sememail.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Mais ações" }).click();
    const item = page.getByRole("menuitem", { name: /Enviar código de senha/ });
    await expect(item).toHaveAttribute("aria-disabled", "true");
    await expect(item).toContainText("conta sem e-mail");
    const r = await adminApi("POST", `/accounts/${U.sememail.id}/password-reset`, {});
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "no_email" });
    expect((await audit("sememail")).length).toBe(0);
  });

  test("desvincular WhatsApp limpa o telefone e some do menu", async ({ page }) => {
    await abrir(page, "a-zap");
    await expect(page.getByText("5511988880020")).toBeVisible();
    await maisAcoes(page, "Desvincular WhatsApp");
    await page.getByRole("alertdialog").getByRole("button", { name: "Desvincular" }).click();
    await expect(page.getByText("WhatsApp desvinculado.")).toBeVisible();
    expect(await one<any>("select phone, whatsapp_verified from public.profiles where id = $1", [U["a-zap"].id])).toMatchObject({ phone: null, whatsapp_verified: false });
    await expect(page.getByText("Sem WhatsApp")).toBeVisible();
    await page.getByRole("button", { name: "Mais ações" }).click();
    await expect(page.getByRole("menuitem", { name: "Desvincular WhatsApp" })).toHaveCount(0);
    expect((await audit("a-zap")).map((x) => x.action)).toEqual(["whatsapp_unlinked"]);
  });

  test("não dá para suspender nem apagar a própria conta (409 self_target)", async ({ page }) => {
    await abrir(page, "admin");
    await page.getByRole("button", { name: "Suspender", exact: true }).click();
    const dlg = page.getByRole("alertdialog");
    await dlg.getByLabel("Motivo").fill("teste de si mesmo");
    await dlg.getByRole("button", { name: "Suspender", exact: true }).click();
    await expect(page.getByText("Você não pode fazer isso na sua própria conta.")).toBeVisible();
    expect((await one<any>("select banned_until from auth.users where id = $1", [U.admin.id]))!.banned_until).toBeNull();
  });

  test("apagar conta: exige digitar o e-mail (sem caixa), apaga do banco e audita só ids", async ({ page }) => {
    await abrir(page, "a-del");
    await maisAcoes(page, "Apagar conta");
    const dlg = page.getByRole("alertdialog");
    const ok = dlg.getByRole("button", { name: "Apagar para sempre" });
    await expect(ok).toBeDisabled();
    await dlg.getByLabel("Digite o e-mail da conta para confirmar").fill("errado@e2e.proops.test");
    await expect(ok).toBeDisabled();
    await dlg.getByLabel("Digite o e-mail da conta para confirmar").fill(U["a-del"].email!.toUpperCase());
    await ok.click();
    await expect(page.getByText("Conta apagada.")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/contas$/);
    expect(await one("select 1 from auth.users where id = $1", [U["a-del"].id])).toBeUndefined();
    expect(await one("select 1 from public.profiles where id = $1", [U["a-del"].id])).toBeUndefined();
    expect(await one("select 1 from public.workspaces where owner_id = $1", [U["a-del"].id])).toBeUndefined();
    const a = await audit("a-del");
    expect(a.map((x) => x.action)).toEqual(["account_deleted"]);
    expect(JSON.stringify(a[0].payload)).not.toContain("@");
    await page.goto(`/admin/contas/${U["a-del"].id}`);
    await expect(page.getByText("Conta não encontrada")).toBeVisible();
  });

  test("apagar conta SEM e-mail pede o ID", async ({ page }) => {
    await page.goto(`/admin/contas/${U["a-del-sem"].id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Dora Sem Email" })).toBeVisible();
    await maisAcoes(page, "Apagar conta");
    const dlg = page.getByRole("alertdialog");
    await expect(dlg.getByLabel("Digite o ID da conta para confirmar")).toBeVisible();
    await dlg.getByLabel("Digite o ID da conta para confirmar").fill(U["a-del-sem"].id);
    await dlg.getByRole("button", { name: "Apagar para sempre" }).click();
    await expect(page.getByText("Conta apagada.")).toBeVisible();
    expect(await one("select 1 from auth.users where id = $1", [U["a-del-sem"].id])).toBeUndefined();
    expect((await audit("a-del-sem")).map((x) => x.action)).toEqual(["account_deleted"]);
  });

  test("menu da lista: abrir conta e copiar ID", async ({ page }) => {
    await page.goto("/admin/contas?q=manual@e2e");
    await page.getByRole("button", { name: `Ações de ${U.manual.email}` }).click();
    await page.getByRole("menuitem", { name: "Copiar ID do usuário" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(U.manual.id);
    await page.getByRole("button", { name: `Ações de ${U.manual.email}` }).click();
    await page.getByRole("menuitem", { name: "Abrir conta" }).click();
    await expect(page).toHaveURL(new RegExp(`/contas/${U.manual.id}$`));
  });
});
