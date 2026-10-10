import { expect, test, type Page } from "@playwright/test";
import { adminApi, loginAdmin, one, shot, sql } from "./support";
import { SEED } from "./seed-data";

const kpi = (page: Page, label: string) => page.getByRole("link").filter({ has: page.getByText(label, { exact: true }) });
const kpiNum = (page: Page, label: string) => kpi(page, label).locator("p").first();

test.describe("Visão geral", () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); });

  test("os números da tela batem com o seed e com o banco", async ({ page }, info) => {
    const hero = page.locator("section", { hasText: "Contas cadastradas" });
    await expect(hero.locator("p").nth(1)).toHaveText(String(SEED.total));
    const db = await one<{ n: string; n7: string; n30: string }>(
      "select count(*) n, count(*) filter (where created_at >= now() - interval '7 days') n7, count(*) filter (where created_at >= now() - interval '30 days') n30 from public.profiles");
    expect(Number(db.n)).toBe(SEED.total);
    await expect(hero).toContainText(`+${db.n7}`);
    await expect(hero).toContainText(`+${db.n30}`);
    await expect(hero).toContainText(`Plano Pro${SEED.plans.pro}`);
    await expect(hero).toContainText(`Plano Família${SEED.plans.family}`);

    const k = SEED.access;
    for (const [label, n] of [["Assinantes ativos", k.subscriber], ["Em teste", k.trialing], ["Cortesias", k.courtesy], ["Suspensas", k.suspended], ["Encerradas", k.lapsed], ["Nunca assinaram", k.never]] as const)
      await expect(kpiNum(page, label), label).toHaveText(String(n));

    const uso = page.locator("dl").filter({ hasText: "Turnos de IA" });
    await expect(uso.locator("div", { hasText: "Turnos de IA" }).first().locator("dd")).toHaveText(String(SEED.usage.aiTurns));
    await expect(uso).toContainText(`Respostas no WhatsApp${SEED.usage.replies}`);
    await expect(uso).toContainText(`Avisos enviados${SEED.usage.notices}`);
    await expect(uso).toContainText(SEED.usage.costUsd.replace(".", ","));
    await shot(page, info, "visao-geral");
  });

  test("os sinais mostram os números do seed", async ({ page }) => {
    const s = SEED.signals;
    const sinais = page;
    for (const [label, n] of [["Teste acaba em 48 h", s.trial_ending_48h], ["Encerradas nos últimos 7 dias", s.lapsed_7d], ["Perto do limite do mês", s.near_limit], ["Assinantes sem acesso há 30 dias", s.inactive_subscribers_30d]] as const)
      await expect(sinais.getByRole("link").filter({ hasText: label }).locator("span").last(), label).toHaveText(String(n));
  });

  test("a API e a tela contam a mesma coisa (cadastros por mês somam o total)", async () => {
    const r = await adminApi("GET", "/overview");
    expect(r.status).toBe(200);
    const soma = r.body.signups_by_month.reduce((a: number, m: { count: number }) => a + m.count, 0);
    expect(soma).toBe(SEED.total); // todo cadastro cai nos 12 meses (o seed espalha até 360 dias)
    expect(r.body.signups_by_month).toHaveLength(12);
    expect(r.body.ai_cost_by_day).toHaveLength(30);
  });

  test("clicar numa distribuição abre Contas filtrada e a lista bate com o número", async ({ page }) => {
    await kpi(page, "Assinantes ativos").click();
    await expect(page).toHaveURL(/\/admin\/contas\?access=subscriber$/);
    await expect(page.getByText(`${SEED.access.subscriber} contas`)).toBeVisible();
    const emails = ["familia", "apple", "google", "a-loja"].map((s) => `${s}@e2e.proops.test`);
    for (const e of emails) await expect(page.getByText(e, { exact: true }).locator("visible=true")).toBeVisible();
  });

  // D1 (corrigido): o link do sinal usa `signal=`, o MESMO critério SQL da contagem do overview.
  const sinais: [string, number, RegExp][] = [
    ["Teste acaba em 48 h", SEED.signals.trial_ending_48h, /signal=trial_ending_48h/],
    ["Encerradas nos últimos 7 dias", SEED.signals.lapsed_7d, /signal=lapsed_7d/],
    ["Perto do limite do mês", SEED.signals.near_limit, /signal=near_limit/],
    ["Assinantes sem acesso há 30 dias", SEED.signals.inactive_subscribers_30d, /signal=inactive_subscribers_30d/],
  ];
  for (const [label, n, url] of sinais) {
    test(`sinal "${label}" abre Contas filtrada (acesso certo)`, async ({ page }) => {
      await page.getByRole("link").filter({ hasText: label }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { name: "Contas", exact: true })).toBeVisible();
    });
    test(`sinal "${label}": a lista aberta tem ${n} conta(s), o número do sinal`, async ({ page }) => {
      await page.getByRole("link").filter({ hasText: label }).click();
      await expect(page.getByText(new RegExp(`^${n} ${n === 1 ? "conta" : "contas"}$`))).toBeVisible();
      await expect(page.getByTestId("signal-chip")).toContainText(label);
    });
  }

  test("D1: o número de cada sinal é o total da lista de /accounts?signal= (API) e o chip limpa o filtro", async ({ page }) => {
    const ov = await adminApi("GET", "/overview");
    for (const k of Object.keys(SEED.signals)) {
      const l = await adminApi("GET", `/accounts?signal=${k}`);
      expect(l.body.total, k).toBe(ov.body.signals[k]);
    }
    expect((await adminApi("GET", "/accounts?signal=x")).status).toBe(422);
    await page.getByRole("link").filter({ hasText: "Perto do limite do mês" }).click();
    await expect(page.getByTestId("signal-chip")).toBeVisible();
    await page.getByRole("button", { name: "Limpar sinal" }).click();
    await expect(page.getByTestId("signal-chip")).toHaveCount(0);
    await expect(page).not.toHaveURL(/signal=/);
    await expect(page.getByText(`${SEED.total} contas`)).toBeVisible();
  });

  test("o cartão de observabilidade leva para /observabilidade", async ({ page }) => {
    await page.getByRole("link", { name: /erro|tudo calmo/i }).first().click();
    await expect(page).toHaveURL(/\/admin\/observabilidade/);
  });

  test("totais por acesso do banco batem com a visão geral", async () => {
    const r = await adminApi("GET", "/overview");
    const db = await sql<{ k: string; n: string }>(
      `select case when u.banned_until > now() then 'suspended' else 'x' end k, count(*) n from auth.users u group by 1`);
    expect(Number(db.find((x) => x.k === "suspended")?.n ?? 0)).toBe(r.body.access.suspended);
  });
});
