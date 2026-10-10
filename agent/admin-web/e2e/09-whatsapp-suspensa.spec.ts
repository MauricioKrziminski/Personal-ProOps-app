import { expect, test } from "@playwright/test";
import { fakeMeta, one, sql, U } from "./support";

// Conta suspensa pelo painel: o worker não processa (nem gasta IA) e avisa UMA vez por dia.
const FONE = U.suspensa.phone!;
const estado = async () => ({
  envios: Number((await one<{ n: string }>("select count(*) n from public.whatsapp_sends where user_id = $1", [U.suspensa.id]))!.n),
  avisos: Number((await one<{ n: string }>("select count(*) n from public.alerts_sent where user_id = $1 and kind = 'conta_suspensa'", [U.suspensa.id]))!.n),
  ia: Number((await one<{ n: string }>("select count(*) n from public.ai_events where user_id = $1", [U.suspensa.id]))!.n),
});
async function mandar(texto: string) {
  const ini = (await one<{ t: string }>("select clock_timestamp()::text t"))!.t;
  const saida = fakeMeta(FONE, texto);
  expect(saida, "o webhook assinado tem que responder 200").toMatch(/^\[200\]/);
  const achar = () => one<{ id: string; wa_message_id: string; status: string }>(
    "select id, wa_message_id, status from public.messages_queue where private.canonical_whatsapp_phone(phone) = private.canonical_whatsapp_phone($1) and created_at >= $2::timestamptz order by created_at desc limit 1", [FONE, ini]);
  await expect.poll(async () => (await achar())?.status, { timeout: 30_000 }).toBe("done");
  return (await achar())!.wa_message_id;
}

test.describe("WhatsApp com conta suspensa", () => {
  test.describe.configure({ mode: "serial" });
  test("a conta do seed está suspensa e vinculada ao telefone", async () => {
    const u = await one<any>("select u.banned_until > now() b, p.phone from auth.users u join public.profiles p on p.id = u.id where u.id = $1", [U.suspensa.id]);
    expect(u).toMatchObject({ b: true, phone: FONE });
  });

  test("1ª mensagem: fila 'done', +1 envio e alerta conta_suspensa; sem gastar IA", async () => {
    const antes = await estado();
    const id = await mandar("oi, quero lançar um gasto");
    const depois = await estado();
    expect(depois.envios - antes.envios).toBe(1);
    expect(depois.avisos - antes.avisos).toBe(1);
    expect(depois.ia - antes.ia).toBe(0);
    const q = await one<any>("select status, last_error, retry_count from public.messages_queue where wa_message_id = $1", [id]);
    expect(q).toMatchObject({ status: "done", last_error: null });
    const k = await one<{ kind: string }>("select kind from public.whatsapp_sends where user_id = $1 order by created_at desc limit 1", [U.suspensa.id]);
    expect(["reply", "notice"]).toContain(k!.kind);
  });

  test("2ª mensagem no mesmo dia: fila 'done', NENHUM envio novo e nenhum alerta novo", async () => {
    const antes = await estado();
    await mandar("alguém aí?");
    const depois = await estado();
    expect(depois).toEqual(antes);
  });

  test("o envio falha sem sair de localhost (token inválido + proxy morto) e não reprocessa", async () => {
    const q = await sql<any>("select status, retry_count from public.messages_queue where phone = $1", [FONE]);
    expect(q.length).toBeGreaterThanOrEqual(2);
    for (const r of q) expect(r).toMatchObject({ status: "done", retry_count: 0 });
  });
});
