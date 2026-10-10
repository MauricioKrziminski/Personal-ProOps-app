import { Activity, Bug, CreditCard, LayoutDashboard, LogOut, Moon, MoreHorizontal, ScrollText, Smartphone, Sun, Users, type LucideIcon } from "lucide-react";
import { Suspense, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { RouteBoundary } from "@/components/error-boundary";
import { Logo } from "@/components/brand";
import { Modal } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Fonte única da navegação (sidebar no desktop, abas no celular). A ordem importa: as 4 primeiras ficam visíveis. */
export const SECTIONS: { to: string; label: string; short?: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard, end: true },
  { to: "/contas", label: "Contas", icon: Users },
  { to: "/observabilidade", label: "Observabilidade", short: "Erros", icon: Bug },
  { to: "/auditoria", label: "Auditoria", icon: ScrollText },
  { to: "/cobranca", label: "Cobrança", icon: CreditCard },
  { to: "/app", label: "App", icon: Smartphone },
  { to: "/sistema", label: "Sistema", icon: Activity },
];
const VISIBLE = 4;

function ThemeButton({ className }: { className?: string }) {
  const { mode, toggle } = useTheme();
  return (
    <button onClick={toggle} className={cn("flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground", className)}>
      {mode === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
      {mode === "dark" ? "Tema claro" : "Tema escuro"}
    </button>
  );
}

export function Shell() {
  const { me, signOut } = useAuth();
  const [more, setMore] = useState(false);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-card px-3 py-5 lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <Logo className="size-8 rounded-lg" />
          <div className="leading-tight"><p className="font-extrabold tracking-tight">ProOps</p><p className="text-xs font-medium text-muted-foreground">Admin</p></div>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Seções">
          {SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => cn("flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors", isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
              <s.icon className="size-[18px]" />{s.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1 border-t pt-3">
          <ThemeButton />
          <button onClick={() => void signOut()} className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"><LogOut className="size-[18px]" />Sair</button>
          <p className="truncate px-3 pt-1 text-xs text-muted-foreground" title={me?.email}>{me?.email}</p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2.5 border-b bg-background/85 px-4 backdrop-blur lg:hidden">
          <Logo className="size-7 rounded-md" /><span className="font-extrabold tracking-tight">ProOps</span><span className="text-xs font-medium text-muted-foreground">Admin</span>
        </header>
        <main className="mx-auto w-full max-w-[1280px] px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8"><Suspense fallback={<div className="h-40" role="status" aria-label="Carregando" />}><RouteBoundary><Outlet /></RouteBoundary></Suspense></main>
      </div>

      <nav aria-label="Seções" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {SECTIONS.slice(0, VISIBLE).map((s) => (
          <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold", isActive ? "text-foreground" : "text-muted-foreground")}>
            {({ isActive }) => (<><span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", isActive && "bg-primary text-primary-foreground")}><s.icon className="size-[18px]" /></span>{s.short ?? s.label}</>)}
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted-foreground">
          <span className="grid h-7 w-12 place-items-center"><MoreHorizontal className="size-[18px]" /></span>Mais
        </button>
      </nav>

      <Modal open={more} onOpenChange={setMore} title="Mais">
        <div className="-mx-2 flex flex-col">
          {SECTIONS.slice(VISIBLE).map((s) => (
            <NavLink key={s.to} to={s.to} onClick={() => setMore(false)} className="flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-semibold hover:bg-accent"><s.icon className="size-[18px]" />{s.label}</NavLink>
          ))}
          <ThemeButton className="h-12 text-foreground" />
          <button onClick={() => void signOut()} className="flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-semibold hover:bg-accent"><LogOut className="size-[18px]" />Sair</button>
          <p className="truncate px-3 pt-2 text-xs text-muted-foreground">{me?.email}</p>
        </div>
      </Modal>
    </div>
  );
}
