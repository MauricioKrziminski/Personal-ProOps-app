import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import { alertChannels } from "./alert-channels.ts";

test("os dois canais habilitados entregam duas vezes", () => {
  assert.deepEqual(
    alertChannels({
      alerts_push_enabled: true,
      alerts_whatsapp_enabled: true,
      expo_push_token: "ExponentPushToken[token]",
      phone: "5535999999999",
    }),
    ["push", "whatsapp"],
  );
});

test("capacidade ausente não ativa fallback pago", () => {
  assert.deepEqual(
    alertChannels({
      alerts_push_enabled: true,
      alerts_whatsapp_enabled: false,
      expo_push_token: null,
      phone: "5535999999999",
    }),
    [],
  );
});

test("nenhuma preferência não entrega mesmo com capacidades disponíveis", () => {
  assert.deepEqual(
    alertChannels({
      alerts_push_enabled: false,
      alerts_whatsapp_enabled: false,
      expo_push_token: "ExponentPushToken[token]",
      phone: "5535999999999",
    }),
    [],
  );
});

test("o emissor usa template próprio e nunca o texto dos lembretes", () => {
  const source = readFileSync(new URL("../send-alerts/index.ts", import.meta.url), "utf8");
  assert.match(source, /WA_ALERT_TEMPLATE/);
  assert.doesNotMatch(source, /WA_REMINDER_TEMPLATE/);
});
