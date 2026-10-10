export const ACCESS_LABEL: Record<string, string> = {
  subscriber: "Assinante", trialing: "Em teste", lapsed: "Encerrada", never: "Nunca assinou",
  courtesy: "Cortesia", suspended: "Suspensa",
};
export const SIGNAL_LABEL: Record<string, string> = {
  trial_ending_48h: "Teste acaba em 48 h", lapsed_7d: "Encerradas nos últimos 7 dias", near_limit: "Perto do limite do mês",
  inactive_subscribers_30d: "Assinantes sem acesso há 30 dias",
};
export const PLAN_LABEL: Record<string, string> = { free: "Free", pro: "Pro", family: "Família" };
export const ORIGIN_LABEL: Record<string, string> = {
  apple: "App Store", google: "Google Play", manual: "Manual", test_store: "Loja de teste", none: "Sem origem",
};
export const AUDIT_LABEL: Record<string, string> = {
  plan_changed: "Plano alterado", plan_forced: "Plano forçado (loja)", suspended: "Conta suspensa",
  reactivated: "Conta reativada", signed_out: "Sessões encerradas", password_reset_sent: "Código de senha enviado",
  whatsapp_unlinked: "WhatsApp desvinculado", issue_triaged: "Erro triado", account_deleted: "Conta apagada",
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

export const SUB_STATUS_LABEL: Record<string, string> = {
  active: "Ativa", trialing: "Em teste", past_due: "Pagamento atrasado", canceled: "Cancelada", expired: "Vencida",
};
export const INVITE_STATUS_LABEL: Record<string, string> = { pending: "Pendente", accepted: "Aceito", revoked: "Revogado" };
export const QUEUE_STATUS_LABEL: Record<string, string> = { failed: "Falhou", pending: "Pendente", processing: "Processando", done: "Concluída" };

export const ISSUE_STATUS_LABEL: Record<string, string> = { open: "Aberto", resolved: "Resolvido", ignored: "Ignorado" };
export const ISSUE_SOURCE_LABEL: Record<string, string> = { app: "App", admin: "Painel", agent: "Agente" };
export const ISSUE_SEVERITY_LABEL: Record<string, string> = { critical: "Crítico", error: "Erro", warning: "Aviso" };
export const ISSUE_PERIODS: [string, string][] = [["1h", "Última hora"], ["24h", "24 horas"], ["7d", "7 dias"], ["30d", "30 dias"]];
export const ISSUE_SORTS: [string, string][] = [["last_seen_desc", "Mais recentes"], ["count_desc", "Mais eventos"], ["users_desc", "Mais usuários"], ["first_seen_desc", "Mais novos"]];
export const PLATFORM_LABEL: Record<string, string> = { ios: "iOS", android: "Android", web: "Web" };
