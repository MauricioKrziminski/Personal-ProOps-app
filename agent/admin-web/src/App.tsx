import { lazy, type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { Shell } from "@/components/shell";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { BootError, BootLoading, ForbiddenPage, LoginPage, MfaPage } from "@/pages/auth";

const lazyPage = <K extends string>(load: () => Promise<Record<K, ComponentType>>, k: K) => lazy(async () => ({ default: (await load())[k] }));
const OverviewPage = lazyPage(() => import("@/pages/overview"), "OverviewPage");
const AccountsPage = lazyPage(() => import("@/pages/accounts"), "AccountsPage");
const AccountDetailPage = lazyPage(() => import("@/pages/account-detail"), "AccountDetailPage");
const ObservabilityPage = lazyPage(() => import("@/pages/observability"), "ObservabilityPage");
const AuditPage = lazyPage(() => import("@/pages/audit"), "AuditPage");
const BillingPage = lazyPage(() => import("@/pages/billing"), "BillingPage");
const SystemPage = lazyPage(() => import("@/pages/system"), "SystemPage");

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } } });

function Gate() {
  const { phase } = useAuth();
  if (phase === "loading") return <BootLoading />;
  if (phase === "anon") return <LoginPage />;
  if (phase === "mfa") return <MfaPage />;
  if (phase === "forbidden") return <ForbiddenPage />;
  if (phase === "error") return <BootError />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<OverviewPage />} />
        <Route path="contas" element={<AccountsPage />} />
        <Route path="contas/:id" element={<AccountDetailPage />} />
        <Route path="observabilidade" element={<ObservabilityPage />} />
        <Route path="auditoria" element={<AuditPage />} />
        <Route path="cobranca" element={<BillingPage />} />
        <Route path="sistema" element={<SystemPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Toasts() {
  const { mode } = useTheme();
  return <Toaster theme={mode} position="top-center" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-sans)" } }} />;
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <BrowserRouter basename="/admin">
            <Gate />
          </BrowserRouter>
          <Toasts />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
