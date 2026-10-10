import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader, Section, SectionError } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { NOTICE_LEVEL_LABEL } from "@/lib/labels";
import type { AppConfig, NoticeLevel } from "@/lib/types";
import { cn, fmtDate } from "@/lib/utils";

const TITULO_MAX = 120;
const TEXTO_MAX = 1000;
const VERSAO = /^\d+\.\d+\.\d+$/;
const FIELD_LABEL: Record<string, string> = {
  min_version_ios: "Versão mínima (iOS)", min_version_android: "Versão mínima (Android)",
  latest_version_ios: "Versão mais recente (iOS)", latest_version_android: "Versão mais recente (Android)",
  store_url_ios: "Link da App Store", store_url_android: "Link da Google Play",
  notice_title: "Título do aviso", notice_body: "Texto do aviso", notice_level: "Nível do aviso", notice_until: "Aviso até",
};

type Form = Record<keyof typeof FIELD_LABEL, string>;

/** `datetime-local` (hora de Brasília, como o resto do painel) <-> ISO. */
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

const toForm = (c: AppConfig): Form => ({
  min_version_ios: c.min_version_ios ?? "", min_version_android: c.min_version_android ?? "",
  latest_version_ios: c.latest_version_ios ?? "", latest_version_android: c.latest_version_android ?? "",
  store_url_ios: c.store_url_ios ?? "", store_url_android: c.store_url_android ?? "",
  notice_title: c.notice_title ?? "", notice_body: c.notice_body ?? "", notice_level: c.notice_level ?? "", notice_until: toLocal(c.notice_until),
});
const toPayload = (f: Form) => {
  const t = (v: string) => v.trim() || null;
  return {
    min_version_ios: t(f.min_version_ios), min_version_android: t(f.min_version_android),
    latest_version_ios: t(f.latest_version_ios), latest_version_android: t(f.latest_version_android),
    store_url_ios: t(f.store_url_ios), store_url_android: t(f.store_url_android),
    notice_title: t(f.notice_title), notice_body: t(f.notice_body),
    notice_level: (f.notice_level || null) as NoticeLevel | null, notice_until: fromLocal(f.notice_until),
  };
};
const show = (k: string, v: string | null) => (v === null || v === "" ? "vazio" : k === "notice_until" ? fmtDate(v, true) : k === "notice_level" ? (NOTICE_LEVEL_LABEL[v] ?? v) : v);

function erro(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  for (const k of ["min_version_ios", "min_version_android", "latest_version_ios", "latest_version_android"] as const)
    if (f[k].trim() && !VERSAO.test(f[k].trim())) e[k] = "Use o formato 1.4.2.";
  for (const k of ["store_url_ios", "store_url_android"] as const)
    if (f[k].trim() && !/^https:\/\//.test(f[k].trim())) e[k] = "O link precisa começar com https://";
  if ((f.notice_title.trim() || f.notice_body.trim()) && !f.notice_level) e.notice_level = "Escolha o nível do aviso.";
  return e;
}

const LEVEL_STYLE: Record<string, { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: "border-sky-600/25 bg-sky-500/10" },
  warning: { icon: AlertTriangle, cls: "border-warning/40 bg-warning/10" },
  critical: { icon: OctagonAlert, cls: "border-destructive/40 bg-destructive/10" },
};

function Preview({ f }: { f: Form }) {
  const lv = LEVEL_STYLE[f.notice_level] ?? LEVEL_STYLE.info;
  const Icon = lv.icon;
  const vazio = !f.notice_title.trim() && !f.notice_body.trim();
  return (
    <div data-testid="notice-preview" aria-label="Prévia do aviso">
      {vazio ? <p className="text-sm text-muted-foreground">Sem aviso: nada aparece na Hoje.</p> : (
        <div role="note" className={cn("flex items-start gap-3 rounded-xl border p-3.5", lv.cls)}>
          <Icon className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0"><p className="break-words text-sm font-bold">{f.notice_title || "Sem título"}</p><p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{f.notice_body}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">{f.notice_level === "critical" ? "Não pode ser dispensado." : "A pessoa pode dispensar."}{f.notice_until ? ` Some em ${fmtDate(fromLocal(f.notice_until), true)}.` : " Sem prazo."}</p></div>
        </div>
      )}
    </div>
  );
}

export function AppConfigPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["app-config"], queryFn: api.appConfig });
  const [f, setF] = useState<Form | null>(null);
  const [changes, setChanges] = useState<string[] | null>(null);
  useEffect(() => { if (q.data && !f) setF(toForm(q.data)); }, [q.data, f]);

  const m = useMutation({
    mutationFn: (p: ReturnType<typeof toPayload>) => api.saveAppConfig(p),
    onSuccess: async (novo) => {
      const antes = q.data ? toPayload(toForm(q.data)) : null;
      const depois = toPayload(toForm(novo));
      const diff = Object.keys(FIELD_LABEL).filter((k) => !antes || antes[k as keyof typeof antes] !== depois[k as keyof typeof depois])
        .map((k) => `${FIELD_LABEL[k]}: ${show(k, antes ? (antes[k as keyof typeof antes] as string | null) : null)} → ${show(k, depois[k as keyof typeof depois] as string | null)}`);
      setChanges(diff);
      setF(toForm(novo));
      qc.setQueryData(["app-config"], novo);
      await qc.invalidateQueries({ queryKey: ["audit"] });
      toast.success(diff.length ? "Configuração salva." : "Nada mudou.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const set = (k: string) => (e: { target: { value: string } }) => { setChanges(null); setF((p) => (p ? { ...p, [k]: e.target.value } : p)); };
  const errs = f ? erro(f) : {};
  const dirty = !!(f && q.data && JSON.stringify(toPayload(f)) !== JSON.stringify(toPayload(toForm(q.data))));
  const field = (k: keyof Form, label: string, ph: string) => (
    <div key={k}><Label htmlFor={k}>{label}</Label><Input id={k} inputMode="text" autoComplete="off" placeholder={ph} value={f![k]} onChange={set(k)} aria-invalid={!!errs[k]} />
      {errs[k] && <p className="mt-1 text-xs text-destructive" role="alert">{errs[k]}</p>}</div>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="App" subtitle="Versão mínima, links das lojas e aviso na Hoje. O app lê isto ao abrir." />
      {q.isError ? <Section title="Configuração"><SectionError error={q.error} onRetry={() => void q.refetch()} /></Section> : !f ? <div className="grid gap-5" aria-busy><Skeleton className="h-64 rounded-lg" /><Skeleton className="h-64 rounded-lg" /></div> : (
        <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (!Object.keys(errs).length) m.mutate(toPayload(f)); }}>
          <Section title="Versões e lojas" aside={<span className="text-xs text-muted-foreground">Abaixo da mínima: tela de bloqueio. Abaixo da recente: aviso dispensável.</span>}>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              {field("min_version_ios", "Versão mínima (iOS)", "1.4.0")}
              {field("min_version_android", "Versão mínima (Android)", "1.4.0")}
              {field("latest_version_ios", "Versão mais recente (iOS)", "1.5.0")}
              {field("latest_version_android", "Versão mais recente (Android)", "1.5.0")}
              {field("store_url_ios", "Link da App Store", "https://apps.apple.com/…")}
              {field("store_url_android", "Link da Google Play", "https://play.google.com/…")}
            </div>
          </Section>
          <Section title="Aviso na Hoje">
            <div className="grid gap-4 p-5 lg:grid-cols-2">
              <div className="flex flex-col gap-4">
                <div><Label htmlFor="notice_title">Título do aviso</Label><Input id="notice_title" value={f.notice_title} maxLength={TITULO_MAX} onChange={set("notice_title")} />
                  <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">{f.notice_title.length}/{TITULO_MAX}</p></div>
                <div><Label htmlFor="notice_body">Texto do aviso</Label><Textarea id="notice_body" value={f.notice_body} maxLength={TEXTO_MAX} onChange={set("notice_body")} />
                  <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">{f.notice_body.length}/{TEXTO_MAX}</p></div>
                <div><Label htmlFor="notice_level">Nível do aviso</Label>
                  <Select id="notice_level" value={f.notice_level} onChange={set("notice_level")} aria-invalid={!!errs.notice_level}><option value="">Escolha</option>{Object.entries(NOTICE_LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                  {errs.notice_level && <p className="mt-1 text-xs text-destructive" role="alert">{errs.notice_level}</p>}</div>
                <div><Label htmlFor="notice_until">Aviso até</Label><Input id="notice_until" type="datetime-local" value={f.notice_until} onChange={set("notice_until")} />
                  <p className="mt-1 text-xs text-muted-foreground">Deixe vazio para o aviso ficar sem prazo.</p></div>
              </div>
              <div><p className="mb-2 text-[13px] font-semibold">Prévia</p><Preview f={f} /></div>
            </div>
          </Section>
          {changes && (
            <div role="status" data-testid="config-changes" className="rounded-lg border bg-card p-4 text-sm">
              <p className="font-semibold">{changes.length ? "O que mudou" : "Nada mudou"}</p>
              {changes.length > 0 && <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted-foreground">{changes.map((c) => <li key={c}>{c}</li>)}</ul>}
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">{q.data?.updated_at ? `Última alteração em ${fmtDate(q.data.updated_at, true)}` : "Ainda não configurado."}</span>
            <Button type="submit" disabled={m.isPending || !dirty || Object.keys(errs).length > 0}>{m.isPending ? "Salvando…" : "Salvar"}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
