import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, authEvents, setTokenGetter } from "./api";
import type { Config, Me } from "./types";

export type Phase = "loading" | "anon" | "mfa" | "forbidden" | "error" | "ready";

interface AuthValue {
  phase: Phase;
  me: Me | null;
  config: Config | null;
  client: SupabaseClient | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Depois do TOTP: renova o token (agora aal2) e revalida em /me. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);
export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth fora do AuthProvider");
  return v;
};

const MOCK_ME: Me = { user_id: "00000000-0000-4000-8000-000000000001", email: "gestao@proops.com.br", aal: "aal2", mfa_required: false };

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<SupabaseClient | null>(null);

  const check = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
      setPhase(m.mfa_required && m.aal !== "aal2" ? "mfa" : "ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && e.code === "mfa_required") setPhase("mfa");
      else if (e instanceof ApiError && e.status === 403) setPhase("forbidden");
      else if (e instanceof ApiError && e.status === 401) { await clientRef.current?.auth.signOut(); setPhase("anon"); }
      else { setError(e instanceof Error ? e.message : "Erro inesperado."); setPhase("error"); }
    }
  }, []);

  const boot = useCallback(async () => {
    setPhase("loading");
    setError(null);
    if (import.meta.env.VITE_MOCK) {
      setMe(MOCK_ME);
      setPhase("ready");
      return;
    }
    try {
      const cfg = await api.config();
      setConfig(cfg);
      // A sessão do painel mora na ABA (sessionStorage), não no navegador: fechou a aba, saiu. No
      // localStorage o token de atualização sobreviveria em qualquer máquina onde o painel foi aberto.
      const client = createClient(cfg.supabase_url, cfg.supabase_anon_key, {
        auth: { persistSession: true, autoRefreshToken: true, storage: window.sessionStorage },
      });
      clientRef.current = client;
      setTokenGetter(async () => (await client.auth.getSession()).data.session?.access_token ?? null);
      const { data } = await client.auth.getSession();
      if (!data.session) setPhase("anon");
      else await check();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado.");
      setPhase("error");
    }
  }, [check]);

  useEffect(() => { void boot(); }, [boot]);

  useEffect(() => {
    const onMfa = () => setPhase((p) => (p === "ready" ? "mfa" : p));
    const onUnauth = () => {
      void clientRef.current?.auth.signOut();
      qc.clear();
      setMe(null);
      setPhase("anon");
    };
    authEvents.addEventListener("mfa_required", onMfa);
    authEvents.addEventListener("unauthorized", onUnauth);
    return () => {
      authEvents.removeEventListener("mfa_required", onMfa);
      authEvents.removeEventListener("unauthorized", onUnauth);
    };
  }, [qc]);

  const value = useMemo<AuthValue>(() => ({
    phase, me, config, error, client: clientRef.current,
    async signIn(email, password) {
      const c = clientRef.current;
      if (!c) throw new Error("Painel ainda carregando.");
      const { error: e } = await c.auth.signInWithPassword({ email, password });
      if (e) throw new Error(e.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : "Não foi possível entrar. Tente de novo.");
      setPhase("loading");
      await check();
    },
    async signOut() {
      await clientRef.current?.auth.signOut();
      qc.clear();
      setMe(null);
      setPhase("anon");
    },
    async refresh() {
      await clientRef.current?.auth.refreshSession();
      qc.clear();
      await check();
    },
  }), [phase, me, config, error, qc, check]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
