const ALLOCATION_COLOR_TOKENS = {
  active: '--color-tutor',
  dismissed: '--color-dismissed',
  belowMinimum: '--color-accent',
  unassigned: '--color-unassigned',
  minimum1: '--color-accent',
  minimum2: '--color-fellow',
} as const;

/**
 * Resolves a root design token at read time; no DOM access on module import.
 * The var() fallback is for SSR/mocks only, never a concrete canvas color.
 * Browser canvas callers must render after the design tokens have loaded.
 */
export function resolveCssToken(
  token: `--${string}`,
  sourceDocument: Document | undefined = typeof document === 'undefined' ? undefined : document,
): string {
  const styles = sourceDocument?.defaultView?.getComputedStyle(sourceDocument.documentElement);
  return styles?.getPropertyValue(token).trim() || `var(${token})`;
}

/** Shared lazy palette: CSS design tokens are the only source of color values. */
export const ALLOCATION_PALETTE = {
  get active(): string { return resolveCssToken(ALLOCATION_COLOR_TOKENS.active); },
  get dismissed(): string { return resolveCssToken(ALLOCATION_COLOR_TOKENS.dismissed); },
  get belowMinimum(): string { return resolveCssToken(ALLOCATION_COLOR_TOKENS.belowMinimum); },
  get unassigned(): string { return resolveCssToken(ALLOCATION_COLOR_TOKENS.unassigned); },
  get minimum1(): string { return resolveCssToken(ALLOCATION_COLOR_TOKENS.minimum1); },
  get minimum2(): string { return resolveCssToken(ALLOCATION_COLOR_TOKENS.minimum2); },
} as const;
