/** Fit the fixed numeric area; labels and surrounding controls keep Dynamic Type. */
export function fitMoneyFieldScale(
  requestedScale: number,
  availableWidth: number,
  naturalWidth: number,
  characterCount: number,
  pixelRatio: number,
): number {
  const requested = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1;
  if (!Number.isFinite(availableWidth) || availableWidth <= 0 ||
      !Number.isFinite(naturalWidth) || naturalWidth <= 0) return requested;
  const pixels = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  // Separate native Text houses round separately. Leave one physical pixel per house,
  // plus the end caret (2dp + 3dp gap), even before focus so focusing never shrinks money.
  const rounding = Math.max(0, characterCount) / pixels;
  const usable = Math.max(0, availableWidth - 5 - rounding);
  return Math.min(requested, requested * usable / naturalWidth);
}
