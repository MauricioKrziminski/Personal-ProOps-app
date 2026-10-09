import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, LogOut, ShieldCheck, ShieldX } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import white from "@/assets/mark-white.png";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

function Frame({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-hero p-12 text-hero-foreground lg:flex">
        <div className="flex items-center gap-3"><img src={white} alt="" className="size-10 rounded-xl" /><span className="text-lg font-extrabold tracking-tight">ProOps</span></div>
        <div>
          <p className="max-w-md text-4xl font-extrabold leading-[1.1] tracking-tight">Cada conta, cada assinatura, sob controle.</p>
          <p className="mt-4 max-w-sm text-hero-muted">Acesso restrito à equipe. Toda ação fica registrada na auditoria.</p>
        </div>
        <p className="text-xs text-hero-muted">Painel administrativo</p>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full border border-white/10" />
        <div aria-hidden className="pointer-events-none absolute -right-8 -top-8 size-96 rounded-full border border-white/10" />
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden"><Logo className="size-9 rounded-lg" /><span className="text-lg font-extrabold tracking-tight">ProOps Admin</span></div>
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

const ErrorLine = ({ text }: { text: string }) => (
  <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{text}</p>
);

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await signIn(email.trim(), password); } catch (x) { setError(x instanceof Error ? x.message : "Erro inesperado."); setBusy(false); }
  }
  return (
    <Frame title="Entrar" subtitle="Use o e-mail e a senha da sua conta de administrador.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div><Label htmlFor="email">E-mail</Label><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><Label htmlFor="password">Senha</Label><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <ErrorLine text={error} />}
        <Button type="submit" size="lg" disabled={busy}>{busy && <Loader2 className="animate-spin" />}Entrar</Button>
      </form>
    </Frame>
  );
}

export function ForbiddenPage() {
  const { signOut } = useAuth();
  return (
    <Frame title="Esta conta não é administradora" subtitle="Entre com uma conta autorizada para usar o painel.">
      <div className="flex flex-col gap-4">
        <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive"><ShieldX className="size-6" /></span>
        <Button variant="outline" size="lg" onClick={() => void signOut()}><LogOut />Sair</Button>
      </div>
    </Frame>
  );
}

export function BootError() {
  const { error } = useAuth();
  return (
    <Frame title="Não foi possível abrir o painel" subtitle={error ?? undefined}>
      <Button size="lg" onClick={() => location.reload()}>Tentar de novo</Button>
    </Frame>
  );
}

export function BootLoading() {
  return <div className="grid min-h-dvh place-items-center" role="status" aria-label="Carregando"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
}

/** TOTP: 1ª vez gera QR (enroll); depois só pede o código (challenge/verify). */
export function MfaPage() {
  const { client, refresh, signOut } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const factor = useQuery({
    queryKey: ["mfa-factor"],
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error("Cliente indisponível.");
      const { data, error: e } = await client.auth.mfa.listFactors();
      if (e) throw e;
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) return { id: verified.id, enroll: false as const };
      // sobras de tentativas anteriores abandonadas
      for (const f of data.all.filter((x) => x.factor_type === "totp" && x.status === "unverified")) await client.auth.mfa.unenroll({ factorId: f.id });
      const en = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `Admin ${new Date().toISOString().slice(0, 10)}` });
      if (en.error) throw en.error;
      return { id: en.data.id, enroll: true as const, qr: en.data.totp.qr_code, secret: en.data.totp.secret };
    },
  });

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!client || !factor.data) return;
    setBusy(true);
    setError(null);
    const { data: ch, error: ce } = await client.auth.mfa.challenge({ factorId: factor.data.id });
    const v = ce ? { error: ce } : await client.auth.mfa.verify({ factorId: factor.data.id, challengeId: ch.id, code });
    if (v.error) {
      setError("Código inválido ou expirado. Confira o app autenticador e tente de novo.");
      setCode("");
      setBusy(false);
      return;
    }
    await refresh();
  }

  const d = factor.data;
  return (
    <Frame title={d?.enroll ? "Ative a verificação em duas etapas" : "Digite o código de 6 dígitos"} subtitle={d?.enroll ? "Escaneie o QR code no Google Authenticator, Authy ou similar e digite o código gerado." : "Abra o app autenticador e informe o código atual."}>
      {factor.isPending ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : factor.isError ? (
        <div className="flex flex-col gap-3"><ErrorLine text="Não foi possível preparar a verificação." /><Button variant="outline" onClick={() => void factor.refetch()}>Tentar de novo</Button></div>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-4">
          {d?.enroll && (
            <div className="flex flex-col items-center gap-3 rounded-lg border bg-card p-4">
              <img src={d.qr} alt="QR code para o app autenticador" className="size-44 rounded-md bg-white p-2" />
              <p className="text-center text-xs text-muted-foreground">Sem câmera? Digite a chave:<br /><code className="select-all break-all font-mono text-[13px] font-semibold text-foreground">{d.secret}</code></p>
            </div>
          )}
          <div>
            <Label htmlFor="code">Código</Label>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="text-center font-mono text-xl tracking-[0.5em]" />
          </div>
          {error && <ErrorLine text={error} />}
          <Button type="submit" size="lg" disabled={busy || code.length !== 6}>{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}Verificar</Button>
          <Button type="button" variant="ghost" onClick={() => void signOut()}>Sair</Button>
        </form>
      )}
    </Frame>
  );
}
