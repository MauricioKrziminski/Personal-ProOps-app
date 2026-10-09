export type Access = "subscriber" | "trialing" | "lapsed" | "never" | "courtesy" | "suspended";
export type Plan = "free" | "pro" | "family";
export type Origin = "apple" | "google" | "manual" | "test_store";

export interface Overview {
  accounts: { total: number; new_7d: number; new_30d: number };
  access: Record<Access, number>;
  plans: { pro: number; family: number };
  usage_month: { ai_turns: number; whatsapp_replies: number; notices: number; ai_cost_usd: string };
  signups_by_month: { month: string; count: number }[];
  ai_cost_by_day: { day: string; usd: string }[];
  signals: { trial_ending_48h: number; lapsed_7d: number; near_limit: number; inactive_subscribers_30d: number };
}

export interface AccountRow {
  user_id: string;
  workspace_id: string | null;
  email: string;
  name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  suspended: boolean;
  plan: Plan;
  status: string;
  access: "subscriber" | "never" | "lapsed";
  is_trial: boolean;
  period_end: string | null;
  origin: Origin | null;
  ai_used: number;
  ai_max: number;
  wa_used: number;
  wa_max: number;
  whatsapp_linked: boolean;
}

export interface Page<T> { items: T[]; total: number; page: number; page_size: number }

export interface AuditEvent {
  id: string;
  created_at: string;
  action: string;
  admin_user_id: string;
  admin_email: string | null;
  target_user_id: string | null;
  target_email: string | null;
  payload: Record<string, unknown> | null;
}

export interface BillingEvent {
  id: string;
  created_at: string;
  type: string;
  provider: string | null;
  result: string;
  app_user_id: string | null;
  email: string | null;
  product_id: string | null;
  environment: string | null;
}

export interface AccountDetail {
  account: AccountRow;
  profile: { phone: string | null; email_confirmed_at: string | null; onboarding_completed: boolean; banned_until: string | null; sessions: number };
  subscription: {
    plan: string; status: string; provider: string; external_id: string; product_id: string; environment: string;
    is_trial: boolean; current_period_end: string | null; canceled_at: string | null; store_managed: boolean;
  };
  usage: {
    current: { ai_used: number; ai_max: number; wa_used: number; wa_max: number; notices_today: number; notices_max: number; ai_cost_usd: string };
    months: { month: string; ai_turns: number; whatsapp_replies: number; ai_cost_usd: string }[];
  };
  counts: Record<"transactions" | "accounts" | "cards" | "notes" | "reminders" | "goals" | "debts" | "recurring", number>;
  members: { user_id: string; email: string; name: string | null; role: "owner" | "member" }[];
  invites: { phone: string; status: string; created_at: string }[];
  billing_events: { id: string; type: string; result: string; created_at: string }[];
  admin_events: AuditEvent[];
}

export interface SystemInfo {
  queue: { pending: number; processing: number; failed_24h: number; oldest_pending_seconds: number };
  recent_failures: { created_at: string; status: string; last_error: string }[];
  ai_cost: { last_24h_usd: string; last_7d_usd: string };
  whatsapp_month: { replies: number; notices: number };
}

export interface Me { user_id: string; email: string; aal: "aal1" | "aal2"; mfa_required: boolean }
export interface Config { supabase_url: string; supabase_anon_key: string; revenuecat_dashboard_url: string }
