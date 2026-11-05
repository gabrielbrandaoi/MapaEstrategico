import { InjectionToken } from '@angular/core';
import type * as L from 'leaflet';

export type LeafletModule = typeof L;

/**
 * Leaflet is published as UMD/CommonJS. Depending on the bundler, `import('leaflet')`
 * yields named exports (dev server, Vitest) or only `default` (optimized production build).
 */
export function resolverModuloLeaflet(modulo: unknown): LeafletModule {
  const candidatos: unknown[] = [modulo];
  if (typeof modulo === 'object' && modulo !== null && 'default' in modulo) {
    candidatos.push((modulo as { default: unknown }).default);
  }
  const leaflet = candidatos.find(pareceLeaflet);
  if (!leaflet) {
    throw new Error('A biblioteca de mapa (Leaflet) foi carregada em um formato inesperado.');
  }
  return leaflet;
}

function pareceLeaflet(value: unknown): value is LeafletModule {
  if (typeof value !== 'object' || value === null) return false;
  const api = value as Record<string, unknown>;
  return ['map', 'latLngBounds', 'layerGroup', 'canvas'].every((key) => typeof api[key] === 'function');
}

export type LeafletLoader = () => Promise<LeafletModule>;

export const LEAFLET_LOADER = new InjectionToken<LeafletLoader>('LEAFLET_LOADER', {
  providedIn: 'root',
  // Importing Leaflet eagerly accesses window and breaks SSR.
  factory: () => async () => resolverModuloLeaflet(await import('leaflet')),
});
