import { defineConfig } from "@playwright/test";

// E2E do painel contra o ambiente LOCAL (scripts/e2e-painel.sh). Um worker só: os testes de ação
// mexem no mesmo banco, e a ordem dos arquivos (01-, 02-…) importa. O projeto `mobile` roda ANTES e
// só com os specs de leitura, para ver o seed intacto; o `desktop` roda tudo.
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8095";
const SO_DESKTOP = [/04-ficha/, /06-auditoria/, /08-observabilidade/, /09-whatsapp/, /10-mfa/];

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.artifacts/results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "./e2e/.report", open: "never" }]],
  use: { baseURL: base, locale: "pt-BR", timezoneId: "America/Sao_Paulo", trace: "retain-on-failure", screenshot: "only-on-failure", video: "off", actionTimeout: 10_000 },
  projects: [
    // Chromium com a tela e o toque de um iPhone 14 (390x844): cobre o layout mobile sem instalar WebKit.
    { name: "mobile", testIgnore: SO_DESKTOP, use: { browserName: "chromium", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  ],
});
