export const ACCESS_LABEL: Record<string, string> = {
  subscriber: "Assinante", trialing: "Em teste", lapsed: "Encerrada", never: "Nunca assinou",
  courtesy: "Cortesia", suspended: "Suspensa",
};
export const PLAN_LABEL: Record<string, string> = { free: "Free", pro: "Pro", family: "Família" };
export const ORIGIN_LABEL: Record<string, string> = {
  apple: "App Store", google: "Google Play", manual: "Manual", test_store: "Loja de teste", none: "Sem origem",
};
export const AUDIT_LABEL: Record<string, string> = {
  plan_changed: "Plano alterado", plan_forced: "Plano forçado (loja)", suspended: "Conta suspensa",
  reactivated: "Conta reativada", signed_out: "Sessões encerradas", password_reset_sent: "Código de senha enviado",
  whatsapp_unlinked: "WhatsApp desvinculado", account_deleted: "Conta apagada",
};
export const BILLING_RESULT_LABEL: Record<string, string> = {
  concedido: "Concedido", revogado: "Revogado", duplicado: "Duplicado", sandbox_ignorado: "Sandbox ignorado",
  produto_desconhecido: "Produto desconhecido", app_user_id_invalido: "Usuário inválido",
  workspace_nao_encontrado: "Conta não encontrada", compra_ja_vinculada: "Compra já vinculada",
};
export const COUNT_LABEL: Record<string, string> = {
  transactions: "Lançamentos", accounts: "Contas", cards: "Cartões", notes: "Notas", reminders: "Lembretes",
  goals: "Metas", debts: "Dívidas", recurring: "Recorrentes",
};
export const SORTS: [string, string][] = [
  ["created_desc", "Mais recentes"], ["created_asc", "Mais antigas"], ["last_sign_in_desc", "Último acesso"], ["last_sign_in_asc", "Sem acesso há mais tempo"],
  ["ai_used_desc", "Maior uso de IA"], ["email_asc", "E-mail (A–Z)"],
];
