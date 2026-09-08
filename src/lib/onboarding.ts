/** Presentation preference only; editable user metadata is never an authorization source. */
export function hasCompletedOnboarding(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.onboarding_completed === true;
}
