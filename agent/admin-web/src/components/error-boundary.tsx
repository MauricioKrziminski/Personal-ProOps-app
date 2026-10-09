import { Component, type ReactNode } from "react";
import { useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionError } from "@/components/states";
import { reportError } from "@/lib/capture";

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { void reportError(error, "render"); }
  render() {
    if (!this.state.error) return this.props.children;
    return <Card><SectionError error={new Error("Esta tela quebrou. O erro já foi registrado.")} onRetry={() => this.setState({ error: null })} /><div className="-mt-4 pb-5 text-center"><Button variant="ghost" size="sm" onClick={() => location.assign("/admin/")}>Ir para a visão geral</Button></div></Card>;
  }
}

/** Zera o erro ao trocar de rota. */
export const RouteBoundary = ({ children }: { children: ReactNode }) => <Boundary key={useLocation().pathname}>{children}</Boundary>;
