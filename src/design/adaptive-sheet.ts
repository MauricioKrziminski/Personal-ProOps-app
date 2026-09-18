/** A task dialog leaves a safe margin and never stretches form fields across the tablet. */
export function tabletSheetFrame(width: number, height: number) {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  return {
    width: Math.min(720, Math.max(0, safeWidth - 48)),
    height: Math.min(840, Math.max(0, safeHeight - 64)),
  };
}
