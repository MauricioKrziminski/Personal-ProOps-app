/**
 * O "Compartilhar" do iOS abre o app com `<scheme da variante>://dataUrl=…`: não é rota, é o aviso do
 * `expo-share-intent` (que lê a URL pelo `expo-linking`, não pela rota). Na abertura vai para `/`
 * (a raiz decide login ou app); com o app aberto, a navegação fica onde está.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (!path.includes('dataUrl=')) return path;
  return initial ? '/' : null;
}
