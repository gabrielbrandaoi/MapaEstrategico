import * as L from 'leaflet';
import { resolverModuloLeaflet } from './leaflet-loader';

describe('resolverModuloLeaflet', () => {
  it('accepts a namespace with named exports (dev server / Vitest interop)', () => {
    expect(resolverModuloLeaflet(L)).toBe(L);
  });

  it('accepts a namespace exposing Leaflet only as default (optimized production build)', () => {
    const leaflet = { ...L };
    const resolved = resolverModuloLeaflet({ default: leaflet });
    expect(resolved).toBe(leaflet);
    expect(typeof resolved.map).toBe('function');
  });

  it('rejects modules that are not Leaflet with a clear message', () => {
    expect(() => resolverModuloLeaflet({ default: {} })).toThrowError(/formato inesperado/);
    expect(() => resolverModuloLeaflet(null)).toThrowError(/formato inesperado/);
  });
});
