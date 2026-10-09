import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useDebounced } from "./hooks";

/** Filtros na URL (link compartilhável; os "Sinais" da visão geral apontam para cá). Mexer em filtro volta para a página 1. */
export function useUrlState() {
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";
  const set = (patch: Record<string, string>) =>
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v && !(k === "page" && v === "1")) n.set(k, v); else n.delete(k); }
      if (!("page" in patch)) n.delete("page");
      return n;
    }, { replace: true });
  return { get, set };
}

/** Caixa de busca com debounce que grava `q` na URL. */
export function useSearchBox(url: ReturnType<typeof useUrlState>) {
  const [text, setText] = useState(url.get("q"));
  const dq = useDebounced(text);
  const { set } = url;
  useEffect(() => { set({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  return [text, setText] as const;
}
