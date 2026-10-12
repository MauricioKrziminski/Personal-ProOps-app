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
  observability: { open: number; critical_open: number; events_24h: number };
  versions: { platform: "ios" | "android" | "web"; version: string; users: number }[];
  signals: { trial_ending_48h: number; lapsed_7d: number; near_limit: number; inactive_subscribers_30d: number };
}

export interface AccountRow {
  user_id: string;
  workspace_id: string | null;
  email: string | null;
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
  last_app_version: string | null;
  last_seen_at: string | null;
}

export interface Page<T> { items: T[]; total: number; page: number; page_size: number }

export interface AiReport {
  id: string;
  created_at: string;
  reason: "ofensiva" | "errada" | "outra";
  note: string | null;
  content: string;
  user_id: string | null;
  email: string | null;
}

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
  profile: { phone: string | null; email_confirmed_at: string | null; onboarding_completed: boolean; banned_until: string | null; sessions: number;
    terms_version: string | null; terms_accepted_at: string | null; ai_consent_at: string | null;
    last_app_version: string | null; last_app_platform: "ios" | "android" | "web" | null; last_seen_at: string | null;
    push_tokens: number; notes_count: number;
  };
  subscription: {
    plan: string; status: string; provider: string; origin: Origin | null; external_id: string; product_id: string; environment: string;
    is_trial: boolean; current_period_end: string | null; canceled_at: string | null; store_managed: boolean;
  };
  usage: {
    current: { ai_used: number; ai_max: number; wa_used: number; wa_max: number; notices_today: number; notices_max: number; ai_cost_usd: string };
    months: { month: string; ai_turns: number; whatsapp_replies: number; ai_cost_usd: string }[];
  };
  counts: Record<"transactions" | "accounts" | "cards" | "notes" | "reminders" | "goals" | "debts" | "recurring", number>;
  members: { user_id: string; email: string | null; name: string | null; role: "owner" | "member" }[];
  invites: { id: string; phone: string; status: string; created_at: string }[];
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

export type IssueStatus = "open" | "resolved" | "ignored";
export type IssueSource = "app" | "admin" | "agent";
export type IssueSeverity = "critical" | "error" | "warning";

export interface Issue {
  id: string;
  fingerprint: string;
  source: IssueSource;
  kind: string;
  severity: IssueSeverity;
  title: string;
  message: string;
  route: string | null;
  status: IssueStatus;
  first_seen: string;
  last_seen: string;
  count: number;
  users_affected: number;
  last_app_version: string | null;
  platforms: string[];
}

export interface IssuesPage extends Page<Issue> {
  summary: { open: number; events_24h: number; users_affected_24h: number; new_24h: number; by_source_24h: Record<IssueSource, number> };
}

export interface IssueEvent {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  platform: string | null;
  app_version: string | null;
  route: string | null;
  message: string;
  context: Record<string, unknown> | null;
}

export interface IssueDetail {
  issue: Issue;
  stack: string | null;
  hourly_24h: { hour: string; count: number }[];
  daily_30d: { day: string; count: number }[];
  events: IssueEvent[];
  triage: AuditEvent[];
}

export interface Note { id: string; body: string; created_at: string; admin_user_id: string; admin_email: string | null }

export type NoticeLevel = "info" | "warning" | "critical";
export interface AppConfig {
  min_version_ios: string | null; min_version_android: string | null;
  latest_version_ios: string | null; latest_version_android: string | null;
  store_url_ios: string | null; store_url_android: string | null;
  notice_title: string | null; notice_body: string | null; notice_level: NoticeLevel | null; notice_until: string | null;
  updated_at: string | null; updated_by: string | null;
}
