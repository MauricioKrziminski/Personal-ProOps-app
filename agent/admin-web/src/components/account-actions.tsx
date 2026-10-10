import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Copy, ExternalLink, KeyRound, LogOut, MessageSquareOff, MoreHorizontal, Play, Trash2, UserCog } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Confirm, Modal, DialogActions } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSep, MenuTrigger } from "@/components/ui/dropdown";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import type { AccountRow } from "@/lib/types";
import { chaveDeConfirmacao, nomeDaConta } from "@/lib/utils";

export type ActionKind = "plan" | "suspend" | "reactivate" | "signout" | "reset" | "unlink" | "delete";
export type Target = { kind: ActionKind; row: AccountRow } | null;

/** Mesmo limite de `SuspenderIn.reason` na API (admin.py, MOTIVO_MAX). */
export const MOTIVO_MAX = 300;

const isStore = (o: AccountRow["origin"]) => o === "apple" || o === "google";

export async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copiado.`);
  } catch {
    toast.error("Não foi possível copiar. Selecione e copie manualmente.");
  }
}

/** Menu "…" da conta — mesmo conteúdo na lista e no detalhe. */
export function AccountMenu({ row, onAction, withOpen, trigger }: { row: AccountRow; onAction: (k: ActionKind) => void; withOpen?: boolean; trigger?: "icon" | "button" }) {
  const nav = useNavigate();
  return (
    <Menu>
      <MenuTrigger asChild>
        {trigger === "button" ? <Button variant="outline"><MoreHorizontal />Mais ações</Button> : <Button variant="ghost" size="icon" aria-label={`Ações de ${nomeDaConta(row)}`}><MoreHorizontal /></Button>}
      </MenuTrigger>
      <MenuContent>
        {withOpen && <MenuItem onSelect={() => nav(`/contas/${row.user_id}`)}><ExternalLink />Abrir conta</MenuItem>}
        <MenuItem onSelect={() => onAction("plan")}><UserCog />Mudar plano</MenuItem>
        {row.suspended ? <MenuItem onSelect={() => onAction("reactivate")}><Play />Reativar conta</MenuItem> : <MenuItem onSelect={() => onAction("suspend")}><Ban />Suspender conta</MenuItem>}
        <MenuItem onSelect={() => onAction("signout")}><LogOut />Encerrar sessões</MenuItem>
        <MenuItem disabled={!row.email} onSelect={() => onAction("reset")}><KeyRound />{row.email ? "Enviar código de senha" : "Enviar código de senha (conta sem e-mail)"}</MenuItem>
        {row.whatsapp_linked && <MenuItem onSelect={() => onAction("unlink")}><MessageSquareOff />Desvincular WhatsApp</MenuItem>}
        <MenuSep />
        <MenuItem disabled={!row.email} onSelect={() => row.email && void copy(row.email, "E-mail")}><Copy />Copiar e-mail</MenuItem>
        <MenuItem onSelect={() => void copy(row.user_id, "ID do usuário")}><Copy />Copiar ID do usuário</MenuItem>
        {row.workspace_id && <MenuItem onSelect={() => void copy(row.workspace_id!, "ID do espaço")}><Copy />Copiar ID do espaço</MenuItem>}
        <MenuSep />
        <MenuItem destructive onSelect={() => onAction("delete")}><Trash2 />Apagar conta</MenuItem>
      </MenuContent>
    </Menu>
  );
}

const DONE: Record<ActionKind, string> = {
  plan: "Plano atualizado.", suspend: "Conta suspensa.", reactivate: "Conta reativada.", signout: "Sessões encerradas.",
  reset: "Código de recuperação enviado.", unlink: "WhatsApp desvinculado.", delete: "Conta apagada.",
};

/** Hospeda o diálogo da ação escolhida. Toda ação: confirmação, loading, toast e refetch. */
export function ActionHost({ target, onClose }: { target: Target; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<"free" | "pro" | "family">("pro");
  const [periodEnd, setPeriodEnd] = useState("");
  const [noEnd, setNoEnd] = useState(false);
  const [force, setForce] = useState(false);
  const [needForce, setNeedForce] = useState(false);
  const [email, setEmail] = useState("");

  const reset = () => { setReason(""); setPlan("pro"); setPeriodEnd(""); setNoEnd(false); setForce(false); setNeedForce(false); setEmail(""); };
  const close = () => { reset(); onClose(); };

  const m = useMutation({
    mutationFn: ({ kind, row }: { kind: ActionKind; row: AccountRow }) => {
      const id = row.user_id;
      switch (kind) {
        case "plan": return api.act(id, "plan", { plan, period_end: plan === "free" || noEnd || !periodEnd ? null : periodEnd, force });
        case "suspend": return api.act(id, "suspend", { reason: reason.trim() });
        case "reactivate": return api.act(id, "reactivate");
        case "signout": return api.act(id, "sign-out");
        case "reset": return api.act(id, "password-reset");
        case "unlink": return api.act(id, "unlink-whatsapp");
        case "delete": return api.act(id, "delete", { confirm_email: email.trim() });
      }
    },
    onSuccess: async (_d, { kind, row }) => {
      toast.success(DONE[kind]);
      if (kind === "delete") qc.removeQueries({ queryKey: ["account", row.user_id] });
      await Promise.all(["accounts", "account", "overview", "audit"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      close();
      if (kind === "delete") nav("/contas", { replace: true });
    },
    onError: (e, { kind }) => {
      if (kind === "plan" && e instanceof ApiError && e.code === "store_managed") setNeedForce(true);
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    },
  });

  if (!target) return null;
  const { kind, row } = target;
  const go = () => m.mutate({ kind, row });
  const who = <strong className="break-all text-foreground">{nomeDaConta(row)}</strong>;
  const chave = chaveDeConfirmacao(row);
  const pedeChave = row.email ? "Digite o e-mail da conta para confirmar" : "Digite o ID da conta para confirmar";

  if (kind === "plan") {
    const store = isStore(row.origin) || needForce;
    const okForce = !store || (force && email.trim().toLowerCase() === chave.toLowerCase());
    return (
      <Modal open onOpenChange={(o) => !o && close()} title="Mudar plano" description={nomeDaConta(row)}>
        <div><Label htmlFor="plan">Plano</Label>
          <Select id="plan" value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)}><option value="free">Free</option><option value="pro">Pro</option><option value="family">Família</option></Select></div>
        {plan !== "free" && (
          <div>
            <Label htmlFor="end">Vencimento</Label>
            <Input id="end" type="date" value={periodEnd} disabled={noEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            <label className="mt-2 flex min-h-10 items-center gap-2.5 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={noEnd} onChange={(e) => setNoEnd(e.target.checked)} />Sem vencimento</label>
          </div>
        )}
        {store && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="font-semibold text-warning">Assinatura gerenciada pela loja</p>
            <p className="mt-1 text-muted-foreground">A próxima notificação da {row.origin === "google" ? "Google Play" : "App Store"} sobrescreve esta mudança.</p>
            <label className="mt-3 flex min-h-10 items-center gap-2.5 font-medium"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={force} onChange={(e) => setForce(e.target.checked)} />Forçar mesmo assim</label>
            {force && <div className="mt-2"><Label htmlFor="fe">{pedeChave}</Label><Input id="fe" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={chave} /></div>}
          </div>
        )}
        <DialogActions>
          <Button variant="outline" onClick={close} disabled={m.isPending}>Cancelar</Button>
          <Button onClick={go} disabled={m.isPending || !okForce}>{m.isPending ? "Salvando…" : "Salvar plano"}</Button>
        </DialogActions>
      </Modal>
    );
  }

  if (kind === "suspend") {
    return (
      <Confirm open onOpenChange={(o) => !o && close()} destructive title="Suspender conta" confirmLabel="Suspender" busy={m.isPending} disabled={reason.trim().length < 3} onConfirm={go}
        description={<>{who} perde o acesso, as sessões são encerradas e o agente para de responder no WhatsApp (avisa 1 vez por dia).</>}>
        <div><Label htmlFor="reason">Motivo</Label><Textarea id="reason" value={reason} maxLength={MOTIVO_MAX} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: chargeback confirmado" />
          <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground" aria-live="polite" data-testid="reason-count">{reason.length}/{MOTIVO_MAX}</p></div>
      </Confirm>
    );
  }
  if (kind === "delete") {
    return (
      <Confirm open onOpenChange={(o) => !o && close()} destructive title="Apagar conta" confirmLabel="Apagar para sempre" busy={m.isPending} disabled={email.trim().toLowerCase() !== chave.toLowerCase()} onConfirm={go}
        description={<>Isto apaga {who} e todos os dados dela. <strong className="text-foreground">É definitivo e não tem volta.</strong> A assinatura na loja não é cancelada: se houver cobrança ativa, a pessoa continua sendo cobrada.</>}>
        <div><Label htmlFor="del">{pedeChave}</Label><Input id="del" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={chave} /></div>
      </Confirm>
    );
  }
  const simple: Record<"reactivate" | "signout" | "reset" | "unlink", { title: string; text: React.ReactNode; label: string }> = {
    reactivate: { title: "Reativar conta", label: "Reativar", text: <>{who} volta a entrar e a usar o WhatsApp.</> },
    signout: { title: "Encerrar sessões", label: "Encerrar sessões", text: <>{who} será desconectada de todos os aparelhos e precisará entrar de novo.</> },
    reset: { title: "Enviar código de senha", label: "Enviar código", text: <>Um código de recuperação de senha será enviado para {who}.</> },
    unlink: { title: "Desvincular WhatsApp", label: "Desvincular", text: <>O número de {who} sai da conta e a sessão do WhatsApp é encerrada. A pessoa precisará vincular de novo.</> },
  };
  const s = simple[kind];
  return <Confirm open onOpenChange={(o) => !o && close()} title={s.title} description={s.text} confirmLabel={s.label} busy={m.isPending} onConfirm={go} />;
}

