/** Números do seed (supabase/seed-e2e.sql) ANTES de qualquer ação da UI. Mudou o seed, mude aqui. */
export const SEED = {
  total: 52,
  access: { subscriber: 4, trialing: 2, lapsed: 2, never: 43, courtesy: 1, suspended: 1 },
  plans: { pro: 6, family: 1 },
  usage: { aiTurns: 445, replies: 160, notices: 2, costUsd: "4.65" },
  signals: { trial_ending_48h: 1, lapsed_7d: 1, near_limit: 2, inactive_subscribers_30d: 1 },
  billing: { total: 8, renewal: 2, concedido: 3, revogado: 2 },
  failedQueue: 2,
} as const;
