export type WindowClass = 'compact' | 'medium' | 'expanded';

export const PANE_GAP = 24;

const MIN_MAIN_WIDTH = 560;
const MIN_SUPPORT_WIDTH = 320;
const MAX_SUPPORT_WIDTH = 400;

export function classifyWindow(widthDp: number): WindowClass {
  if (!Number.isFinite(widthDp) || widthDp < 600) return 'compact';
  return widthDp < 840 ? 'medium' : 'expanded';
}

export function tabletPaneWidths(containerWidthDp: number) {
  const usable = Number.isFinite(containerWidthDp)
    ? Math.max(0, containerWidthDp)
    : 0;
  const requestedSupport = Math.min(
    MAX_SUPPORT_WIDTH,
    Math.max(MIN_SUPPORT_WIDTH, usable * 0.34),
  );
  const twoPane = usable - PANE_GAP - requestedSupport >= MIN_MAIN_WIDTH;

  return {
    main: twoPane ? usable - PANE_GAP - requestedSupport : usable,
    support: twoPane ? requestedSupport : 0,
    twoPane,
  };
}

/** A library stays scan-friendly while the reading area never becomes a narrow text strip. */
export function readingPaneWidths(containerWidthDp: number) {
  const available = Number.isFinite(containerWidthDp) ? Math.max(0, containerWidthDp) : 0;
  const requestedList = Math.max(280, Math.min(360, available * 0.36));
  const twoPane = available - requestedList - PANE_GAP >= 480;

  return {
    list: twoPane ? requestedList : available,
    reading: twoPane ? available - requestedList - PANE_GAP : 0,
    twoPane,
  };
}

export function rootContentMaxWidth(windowWidthDp: number, wide: boolean) {
  return wide && classifyWindow(windowWidthDp) !== 'compact' ? 1200 : 800;
}

export function chartWidthForPane(paneWidthDp: number, horizontalInsetDp: number) {
  const pane = Number.isFinite(paneWidthDp) ? Math.max(0, paneWidthDp) : 0;
  const inset = Number.isFinite(horizontalInsetDp) ? Math.max(0, horizontalInsetDp) : 0;
  return Math.max(0, pane - inset * 2);
}

export function bottomPillInset(
  platform: string,
  hasTopBar: boolean,
  pillSpace: number,
) {
  return platform === 'android' && hasTopBar ? pillSpace : 0;
}

/**
 * O respiro no PÉ de uma rolagem de tela: a área segura de baixo + o respiro + a pílula do
 * Android nas raízes de aba. Uma conta só — o `Screen` e a raiz que rola por conta própria (Notas)
 * leem daqui. Notas tinha a sua e esquecia a área segura no iOS: a última linha ficava embaixo da
 * barra de abas e a rolagem não descia mais (25/09/2026).
 */
export function bottomScrollInset(
  platform: string,
  hasTopBar: boolean,
  safeBottom: number,
  breathing: number,
  pillSpace: number,
) {
  return safeBottom + breathing + bottomPillInset(platform, hasTopBar, pillSpace);
}
