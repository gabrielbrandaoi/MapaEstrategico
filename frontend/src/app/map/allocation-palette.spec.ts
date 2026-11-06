import { ALLOCATION_PALETTE, resolveCssToken } from './allocation-palette';

describe('paleta visual resolvida por tokens', () => {
  it('resolve os tokens no momento da chamada e nos getters compartilhados', () => {
    const root = document.documentElement;
    const previous = root.style.cssText;
    try {
      root.style.setProperty('--color-tutor', 'rgb(1, 2, 3)');
      root.style.setProperty('--color-dismissed', 'rgb(4, 5, 6)');
      root.style.setProperty('--color-accent', 'rgb(7, 8, 9)');
      root.style.setProperty('--color-unassigned', 'rgb(10, 11, 12)');
      root.style.setProperty('--color-fellow', 'rgb(13, 14, 15)');
      expect({ ...ALLOCATION_PALETTE }).toEqual({
        active: 'rgb(1, 2, 3)',
        dismissed: 'rgb(4, 5, 6)',
        belowMinimum: 'rgb(7, 8, 9)',
        unassigned: 'rgb(10, 11, 12)',
        minimum1: 'rgb(7, 8, 9)',
        minimum2: 'rgb(13, 14, 15)',
      });
      root.style.setProperty('--color-tutor', 'rgb(16, 17, 18)');
      expect(ALLOCATION_PALETTE.active).toBe('rgb(16, 17, 18)');
    } finally {
      root.style.cssText = previous;
    }
  });

  it('mantém fallback sem window e com tokens ausentes, inclusive em SSR', () => {
    const isolatedDocument = document.implementation.createHTMLDocument();
    expect(isolatedDocument.defaultView).toBeNull();
    expect(resolveCssToken('--color-tutor', isolatedDocument)).toBe('var(--color-tutor)');
  });
});
