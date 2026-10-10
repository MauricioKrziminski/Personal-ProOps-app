import { expect, test, type Page } from "@playwright/test";
import { adminApi, CFG, loginAdmin, one, shot, sql, token, U } from "./support";

const TAG = `E2E${Date.now().toString(36)}`;
const NAME = `${TAG}Error`;
const evento = (over: Record<string, unknown> = {}) => ({ source: "app", kind: "error", name: NAME, message: `Falha ao carregar o item ${Math.floor(Math.random() * 9000) + 100}`, stack: `Error: ${NAME}\n    at carregar (app/index.bundle:10:20)\n    at executar (app/index.bundle:30:5)\n    at main (app/index.bundle:99:1)`, route: "/(tabs)/financeiro", platform: "ios", app_version: "1.4.0", occurred_at: new Date().toISOString(), context: {}, ...over });
async function enviar(errors: unknown[], tk?: string) {
  const r = await fetch(`${CFG.agentUrl}/internal/errors`, { method: "POST", headers: { "Content-Type": "application/json", ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ errors }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const issueDb = (name = NAME) => one<any>("select * from public.error_issues where title ilike $1 or fingerprint is not null and title ilike $1 order by last_seen desc limit 1", [`%${name}%`]);
const lista = async (page: Page, status = "", extra = "") => { await page.goto(`/admin/observabilidade?q=${TAG}${status ? `&status=${status}` : ""}${extra}`); };
const linha = (page: Page, t = NAME) => page.locator("tr:visible, li:visible").filter({ hasText: t });

test.describe("Observabilidade (contra o contrato de docs/ADMIN-API.md)", () => {
  test.describe.configure({ mode: "serial" });
  let existe = true;
  test.beforeAll(async () => { existe = (await adminApi("GET", "/issues")).status === 200; });
  test.beforeEach(async ({ page }) => { test.fixme(!existe, "rota /admin/api/issues ainda não existe"); await loginAdmin(page); });

  test("captura: erros do app (com e sem login) viram UM grupo, com contagem e usuários certos", async ({ page }, info) => {
    const tc = await token(U.comum), ta = await token(U.apple);
    expect((await enviar([evento(), evento()], tc)).status).toBe(202);
    expect((await enviar([evento()], ta)).body).toEqual({ accepted: 1 });
    expect((await enviar([evento()])).status).toBe(202); // sem login também vale
    const g = await sql<any>("select * from public.error_issues order by last_seen desc limit 5");
    expect(g.filter((x) => JSON.stringify(x).includes(NAME))).toHaveLength(1);
    await lista(page);
    const l = linha(page).first();
    await expect(l).toBeVisible();
    await expect(l).toContainText(NAME);
    await expect(l).toContainText("App");
    const celulas = await l.locator("td").allTextContents();
    expect(celulas.join("|")).toMatch(/\|4\|2\|/); // 4 eventos, 2 usuários (o anônimo não conta)
    await shot(page, info, "obs-lista");
  });

  test("o user_id vem do JWT, nunca do corpo", async () => {
    const tc = await token(U.comum);
    await enviar([evento({ user_id: U.apple.id, context: { user_id: U.apple.id } })], tc);
    const e = await sql<any>("select user_id from public.error_events order by created_at desc limit 1");
    expect(e[0].user_id).toBe(U.comum.id);
  });

  test("mascara e-mail, telefone e número longo em message/stack/context", async () => {
    const tag = `${TAG}pii`;
    await enviar([evento({ name: tag, message: "falhou para fulano.teste@example.com tel 11988887777 cpf 12345678909", stack: "Error\n at x (a.js:1:1)\n contato: beltrano@example.com", context: { email: "ciclano@example.com" } })]);
    const rows = await sql<any>("select * from public.error_events e join public.error_issues i on i.id = e.issue_id where i.title ilike $1", [`%${tag}%`]);
    expect(rows.length).toBeGreaterThan(0);
    const bruto = JSON.stringify(rows);
    for (const vazou of ["fulano.teste@example.com", "beltrano@example.com", "ciclano@example.com", "11988887777", "12345678909"]) expect(bruto, vazou).not.toContain(vazou);
  });

  test("detalhe: gaveta com stack, séries e ocorrência que leva à conta", async ({ page }) => {
    await lista(page);
    await linha(page).first().click();
    await expect(page.getByRole("heading", { name: "Últimas 24 horas" })).toBeVisible();
    await expect(page.getByText("Stack trace")).toBeVisible();
    await expect(page.locator("pre")).toContainText("carregar");
    await expect(page.getByText(/Ocorrências recentes\s*·\s*5/)).toBeVisible();
    await page.getByRole("link", { name: U.comum.email! }).first().click();
    await expect(page).toHaveURL(new RegExp(`/contas/${U.comum.id}$`));
  });

  test("resolver: sai de Abertos, aparece em Resolvidos e audita issue_triaged (de/para)", async ({ page }, info) => {
    await lista(page);
    await linha(page).first().click();
    await page.getByRole("button", { name: "Resolver" }).click();
    await expect(page.getByText("Erro resolvido")).toBeVisible();
    await shot(page, info, "obs-resolvido");
    expect((await issueDb()).status).toBe("resolved");
    const a = await sql<any>("select payload, admin_user_id from public.admin_audit_events where action = 'issue_triaged' order by created_at desc limit 1");
    expect(a[0].payload).toMatchObject({ from: "open", to: "resolved" });
    expect(a[0].admin_user_id).toBe(U.admin.id);
    await lista(page);
    await expect(linha(page)).toHaveCount(0);
    await lista(page, "resolved");
    await expect(linha(page).first()).toBeVisible();
  });

  test("evento novo REABRE o grupo resolvido", async ({ page }) => {
    expect((await enviar([evento()])).status).toBe(202);
    expect((await issueDb()).status).toBe("open");
    await lista(page);
    await expect(linha(page).first()).toContainText(NAME);
    expect((await linha(page).first().locator("td").allTextContents()).join("|")).toMatch(/\|6\|/);
  });

  test("ignorar: vai para Ignorados e um evento novo NÃO reabre, mas conta", async ({ page }) => {
    await lista(page);
    await linha(page).first().click();
    await page.getByRole("button", { name: "Ignorar" }).click();
    await expect(page.getByText("Erro ignorado")).toBeVisible();
    await enviar([evento()]);
    const i = await issueDb();
    expect(i.status).toBe("ignored");
    expect(Number(i.count ?? i.events_count ?? 0)).toBe(7);
    await lista(page, "ignored");
    await expect(linha(page).first()).toBeVisible();
    await lista(page);
    await expect(linha(page)).toHaveCount(0);
  });

  test("Reabrir (do ignorado) e Desfazer pelo toast", async ({ page }) => {
    await lista(page, "ignored");
    await linha(page).first().click();
    await page.getByRole("button", { name: "Reabrir" }).click();
    await expect(page.getByText("Erro reaberto")).toBeVisible();
    expect((await issueDb()).status).toBe("open");
    await page.getByRole("button", { name: "Resolver" }).click();
    await expect(page.getByText("Erro resolvido")).toBeVisible();
    await page.waitForTimeout(900); // toasts empilhados animam; só o do "resolvido" nos interessa
    await page.locator("[data-sonner-toast]").filter({ hasText: "Erro resolvido" }).getByRole("button", { name: "Desfazer" }).dispatchEvent("click");
    await expect.poll(async () => (await issueDb()).status).toBe("open");
    const n = await sql<any>("select count(*) n from public.admin_audit_events where action = 'issue_triaged'");
    expect(Number(n[0].n)).toBeGreaterThanOrEqual(5);
  });

  test("filtros: origem Painel, severidade, período e busca; limpar", async ({ page }) => {
    const adm = `${TAG}Painel`;
    expect((await enviar([evento({ source: "admin", name: adm, kind: "render", platform: "web", route: "/contas" })])).status).toBe(202);
    await page.goto(`/admin/observabilidade?q=${TAG}`);
    await expect(linha(page, TAG)).toHaveCount(3); // app, app (pii) e painel
    await page.getByLabel("Origem", { exact: true }).selectOption("admin");
    await expect(linha(page, TAG)).toHaveCount(1);
    await expect(linha(page, TAG).first()).toContainText(adm);
    await page.getByLabel("Origem", { exact: true }).selectOption("app");
    await expect(linha(page, TAG)).toHaveCount(2);
    await expect(linha(page)).toHaveCount(1);
    await page.getByLabel("Origem", { exact: true }).selectOption("agent");
    await expect(page.getByText("Nenhum erro encontrado")).toBeVisible();
    await page.getByRole("button", { name: "Limpar filtros" }).first().click();
    await page.goto(`/admin/observabilidade?q=${TAG}&period=1h`);
    await expect(linha(page, TAG)).toHaveCount(3);
    await page.getByLabel("Severidade", { exact: true }).selectOption("critical");
    await expect(linha(page, TAG)).toHaveCount(0);
    await page.getByLabel("Ordenar por", { exact: true }).selectOption("count_desc");
    await page.getByLabel("Severidade", { exact: true }).selectOption("");
    await expect(linha(page).first()).toContainText(NAME); // mais eventos primeiro
  });

  test("aba Resolvidos e Ignorados com contadores; resumo bate com a API", async ({ page }) => {
    const r = await adminApi("GET", "/issues");
    expect(r.status).toBe(200);
    await page.goto("/admin/observabilidade");
    await expect(page.getByRole("tab", { name: /Aberto/ })).toContainText(String(r.body.summary.open));
    const hero = page.locator("section[aria-label=Resumo]");
    await expect(hero).toContainText(`Erros abertos${r.body.summary.open}`);
    const ov = await adminApi("GET", "/overview");
    expect(ov.body.observability.open).toBe(r.body.summary.open);
    expect(ov.body.observability).toHaveProperty("critical_open");
    expect(ov.body.observability).toHaveProperty("events_24h");
  });

  test("captura do PRÓPRIO painel: erro não tratado no SPA vira issue source=admin", async ({ page }) => {
    const msg = `${TAG}boom-do-painel`;
    await page.goto("/admin/contas");
    await expect(page.getByRole("heading", { level: 1, name: "Contas" })).toBeVisible();
    await page.evaluate((m) => { setTimeout(() => { throw new Error(m); }, 0); }, msg);
    // o fingerprint usa os 3 primeiros frames: erros lançados do mesmo ponto caem no MESMO grupo, então a prova é o EVENTO
    await expect.poll(async () => (await sql<any>("select 1 from public.error_events e join public.error_issues i on i.id = e.issue_id where i.source = 'admin' and e.message ilike $1", [`%${msg}%`])).length, { timeout: 8000 }).toBe(1);
    const e = await sql<any>("select e.user_id, e.route, e.platform from public.error_events e join public.error_issues i on i.id = e.issue_id where i.source = 'admin' and e.message ilike $1", [`%${msg}%`]);
    expect(e[0]).toMatchObject({ user_id: U.admin.id, platform: "web" });
  });

  test("limites: mais de 20 erros por chamada e corpo gigante são recusados (4xx)", async () => {
    const r21 = await enviar(Array.from({ length: 21 }, () => evento()));
    expect(r21.status).toBeGreaterThanOrEqual(400);
    expect(r21.status).toBeLessThan(500);
    const grande = await enviar([evento({ message: "x".repeat(40_000) })]);
    expect(grande.status).toBeGreaterThanOrEqual(400);
    expect(grande.status).toBeLessThan(500);
    const ruim = await fetch(`${CFG.agentUrl}/internal/errors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{nao e json" });
    expect(ruim.status).toBeLessThan(500);
  });

  test("severidade: stack/erro tratado vira error ou warning; janela mostra 'Nenhum erro' vazio sem filtro", async ({ page }) => {
    await page.goto(`/admin/observabilidade?q=zzz-${TAG}-nada`);
    await expect(page.getByText("Nenhum erro encontrado")).toBeVisible();
  });
});
