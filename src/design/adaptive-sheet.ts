/** As bordas que o sistema ocupa (barra de status, barra de navegação ou de tarefas, recortes). */
export interface Bordas {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const SEM_BORDAS: Bordas = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * O quadro do diálogo de tarefa no tablet: margem segura DENTRO da área segura, e nunca esticado
 * pela tela toda. A área segura entra porque a barra de tarefas do tablet (a do Galaxy Tab, a do
 * Android 12L+ em tela grande) é inset de baixo: medido sem ela, o diálogo descia por trás da
 * barra e a última linha do formulário ficava inalcançável (26/09/2026).
 */
export function tabletSheetFrame(width: number, height: number, bordas: Bordas = SEM_BORDAS) {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width - bordas.left - bordas.right) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height - bordas.top - bordas.bottom) : 0;
  return {
    width: Math.min(720, Math.max(0, safeWidth - 48)),
    height: Math.min(840, Math.max(0, safeHeight - 64)),
  };
}

/**
 * Do fundo do diálogo até a base da janela. Ele é centrado na área segura, então o vão de baixo
 * é a borda do sistema mais metade da sobra — a parte do teclado que cai FORA do diálogo.
 */
export function abaixoDoDialogo(width: number, height: number, bordas: Bordas = SEM_BORDAS) {
  const safeHeight = Number.isFinite(height) ? Math.max(0, height - bordas.top - bordas.bottom) : 0;
  return bordas.bottom + (safeHeight - tabletSheetFrame(width, height, bordas).height) / 2;
}
