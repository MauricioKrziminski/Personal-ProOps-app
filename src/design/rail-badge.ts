export function railBadge(count: number): { visual: string; accessible: string } | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const pending = Math.floor(count);
  if (pending === 0) return null;
  return {
    visual: pending > 9 ? '9+' : String(pending),
    accessible: `${pending} ${pending === 1 ? 'pendente' : 'pendentes'}`,
  };
}
