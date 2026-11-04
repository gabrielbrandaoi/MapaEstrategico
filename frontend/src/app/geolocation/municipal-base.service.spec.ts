import { vi } from 'vitest';
import {
  MunicipalBaseService, validarCentroides, validarContorno,
} from './municipal-base.service';

const contorno = () => ({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature', properties: { codarea: '99' },
    geometry: {
      type: 'Polygon',
      coordinates: [[[-50, -10], [-49, -10], [-49, -9], [-50, -10]]],
    },
  }],
});

describe('MunicipalBaseService (assets sintéticos, sem rede)', () => {
  it('carrega uma vez, compartilha a Promise e resolve apenas IBGE6 exato', async () => {
    const reader = vi.fn(async (path: string) => path.endsWith('.json')
      ? { '123456': [-10, -50] } : contorno());
    const base = new MunicipalBaseService(reader);
    expect(base.estado).toBe('nao-carregada');
    expect(base.resolver('123456')).toBeNull();
    const first = base.carregar();
    expect(base.carregar()).toBe(first);
    expect(base.estado).toBe('carregando');
    await first;
    await base.carregar();
    expect(base.estado).toBe('pronta');
    expect(base.falhas).toEqual([]);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(reader.mock.calls.map(call => call[0]).sort()).toEqual([
      'geo/br-ufs.geojson', 'geo/municipal-centroids.json',
    ]);
    expect(base.resolver('123456')).toMatchObject({
      latitude: -10, longitude: -50, origem: 'centroide-municipal',
    });
    expect(base.resolver('1234567')).toBeNull();
    expect(base.resolver('999999')).toBeNull();
    expect(base.resolver(' 123456')).toBeNull();
    expect(base.geojson()?.features).toHaveLength(1);
    expect(Object.isFrozen(base.resolver('123456'))).toBe(true);
  });

  it('relata base ausente e mantém Brasil/UF disponível; tenta só o recurso faltante', async () => {
    let available = false;
    const reader = vi.fn(async (path: string) => {
      if (path.endsWith('.geojson')) return contorno();
      if (!available) throw new Error('simulação');
      return { '123456': [-10, -50] };
    });
    const base = new MunicipalBaseService(reader);
    await expect(base.carregar()).resolves.toBeUndefined();
    expect(base.estado).toBe('parcial');
    expect(base.falhas).toHaveLength(1);
    expect(base.falhas[0]).toContain('Base municipal');
    expect(base.geojson()).not.toBeNull();
    expect(base.resolver('123456')).toBeNull();
    available = true;
    await base.carregar();
    expect(base.estado).toBe('pronta');
    expect(reader).toHaveBeenCalledTimes(3);
    expect(base.falhas).toEqual([]);
  });

  it('preserva centroides quando só contorno falha; ambos ausentes ficam em erro explícito', async () => {
    const base = new MunicipalBaseService(async path => {
      if (path.endsWith('.geojson')) throw new Error('indisponível');
      return { '123456': [-10, -50] };
    });
    await base.carregar();
    expect(base.estado).toBe('parcial');
    expect(base.resolver('123456')).not.toBeNull();
    expect(base.geojson()).toBeNull();
    const ausente = new MunicipalBaseService(async () => { throw new Error('indisponível'); });
    await ausente.carregar();
    expect(ausente.estado).toBe('erro');
    expect(ausente.falhas).toHaveLength(2);
  });

  it.each([
    null, [], {}, { '1234567': [-10, -50] }, { '123456': ['-10', -50] },
    { '123456': [NaN, -50] }, { '123456': [-91, -50] },
    { '123456': [-10, -181] }, { '123456': [-50, -10] },
    { '123456': [-10, -50, 0] },
  ])('rejeita asset municipal inválido/invertido (%#)', value => {
    expect(() => validarCentroides(value)).toThrow();
  });

  it('falha atomicamente quando há uma entrada inválida, sem usar base incompleta', async () => {
    const base = new MunicipalBaseService(async path => path.endsWith('.json')
      ? { '123456': [-10, -50], '234567': [Infinity, -50] } : contorno());
    await base.carregar();
    expect(base.estado).toBe('parcial');
    expect(base.resolver('123456')).toBeNull();
  });

  it('valida Polygon/MultiPolygon, fechamento e valores finitos do contorno', () => {
    const valid = contorno();
    expect(validarContorno(valid).features).toHaveLength(1);
    expect(() => validarContorno({ type: 'FeatureCollection', features: [] })).toThrow();
    valid.features[0].geometry.coordinates[0][3] = [-51, -10];
    expect(() => validarContorno(valid)).toThrow();
    expect(() => validarContorno({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-50, -10] } }],
    })).toThrow();
    const multi = contorno();
    expect(validarContorno({
      type: 'FeatureCollection',
      features: [{
        ...multi.features[0],
        geometry: { type: 'MultiPolygon', coordinates: [multi.features[0].geometry.coordinates] },
      }],
    }).features).toHaveLength(1);
  });
});
