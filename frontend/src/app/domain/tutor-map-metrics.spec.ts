import { PontoMapa, VinculoMapa } from './mapa.models';
import { RoadRoute } from './models';
import { calcularVinculos, DISTANCE_POLICY, divergenciaRelevante, resumirTutor } from './tutor-map-metrics';

function ponto(id: string, changes: Partial<PontoMapa> = {}): PontoMapa {
  return {
    id, tipo: id === 't' ? 'tutor' : 'fellow', nome: `Pessoa sintética ${id}`,
    municipio: 'Município sintético', ibge6: '000001',
    coordenada: { latitude: 0, longitude: 0, origem: 'centroide-municipal', fonte: 'fixture' },
    cpfProvisorio: true, criterios: [], alertas: [], semBolsista: false,
    ...changes,
  };
}

function vinculo(changes: Partial<VinculoMapa> = {}): VinculoMapa {
  return {
    id: 'v', tutorId: 't', bolsistaId: 'b', kmPlanilha: null,
    distanciaGeodesicaKm: null, criterio: 'Critério sintético', regra: 'Regra sintética',
    segundaRodada: false, regra50Km: false, mesmoMunicipio: false,
    divergente: false, excede50Km: false, rota: null, ...changes,
  };
}

function rota(status: RoadRoute['status'], distanceMeters: number | null): RoadRoute {
  return {
    status, distanceMeters, durationSeconds: null, provider: 'fixture',
    calculatedAt: '2026-01-01T00:00:00.000Z', profile: 'driving', message: null,
  };
}

describe('divergenciaRelevante', () => {
  it.each([
    [15, 0, false], [15.001, 0, true], [0, 0, false],
    [90, 75, false], [90.001, 75, true],
    [120, 100, false], [120.001, 100, true],
    [80, 100, false], [79.999, 100, true],
    [null, 100, false], [100, null, false], [null, null, false],
  ] as const)('compares %s and %s strictly', (planilha, geodesica, expected) => {
    expect(divergenciaRelevante(planilha, geodesica)).toBe(expected);
  });

  it.each([NaN, Infinity, -Infinity, -1])('rejects invalid distances: %s', (value) => {
    expect(() => divergenciaRelevante(value, 0)).toThrow(RangeError);
    expect(() => divergenciaRelevante(null, value)).toThrow(RangeError);
  });

  it('exposes an immutable centralized policy', () => {
    expect(Object.isFrozen(DISTANCE_POLICY)).toBe(true);
    expect(DISTANCE_POLICY.limiteRegra50Km).toBe(50);
  });
});

describe('calcularVinculos', () => {
  it('keeps duplicates, multiple candidates and long second-round relationships immutable', () => {
    const pontos = Object.freeze([
      Object.freeze(ponto('t')), Object.freeze(ponto('t2', { tipo: 'tutor' })),
      Object.freeze(ponto('b', {
        coordenada: { latitude: 0, longitude: 22.5, origem: 'importada', fonte: 'fixture' },
      })),
    ]);
    const vinculos = Object.freeze([
      Object.freeze(vinculo({ kmPlanilha: 2500, segundaRodada: true, regra50Km: true })),
      Object.freeze(vinculo({ id: 'duplicado' })),
      Object.freeze(vinculo({ id: 'outro-tutor', tutorId: 't2' })),
    ]);
    const calculados = calcularVinculos(pontos, vinculos);
    expect(calculados.map((item) => item.id)).toEqual(['v', 'duplicado', 'outro-tutor']);
    expect(calculados[0].distanciaGeodesicaKm!).toBeGreaterThan(2490);
    expect(calculados[0].distanciaGeodesicaKm!).toBeLessThan(2510);
    expect(calculados[0].excede50Km).toBe(false);
    expect(calculados[0].segundaRodada).toBe(true);
    expect(calculados[0].criterio).toBe(vinculos[0].criterio);
    expect(vinculos[0].distanciaGeodesicaKm).toBeNull();
    expect(calculados[0]).not.toBe(vinculos[0]);
  });

  it('uses coincident centroids but never overwrites different imported coordinates with zero', () => {
    const [coincidente] = calcularVinculos([ponto('t'), ponto('b')], [vinculo()]);
    expect(coincidente.distanciaGeodesicaKm).toBe(0);
    expect(coincidente.mesmoMunicipio).toBe(true);
    const [importado] = calcularVinculos([
      ponto('t'), ponto('b', {
        coordenada: { latitude: 0, longitude: 1, origem: 'importada', fonte: 'fixture' },
      }),
    ], [vinculo()]);
    expect(importado.mesmoMunicipio).toBe(true);
    expect(importado.distanciaGeodesicaKm!).toBeGreaterThan(100);
  });

  it('does not equate missing IBGE codes or rely on equal municipality names', () => {
    const [resultado] = calcularVinculos([
      ponto('t', { ibge6: null }), ponto('b', { ibge6: null }),
    ], [vinculo()]);
    expect(resultado.mesmoMunicipio).toBe(false);
  });

  it.each([
    [50, true, false, false], [50.001, true, false, true],
    [50.001, false, false, false], [2500, true, true, false],
  ] as const)('applies reported limit %s with flags %s/%s', (km, regra50Km, segundaRodada, expected) => {
    const [resultado] = calcularVinculos([ponto('t'), ponto('b')], [
      vinculo({ kmPlanilha: km, regra50Km, segundaRodada }),
    ]);
    expect(resultado.excede50Km).toBe(expected);
  });

  it('checks the geodesic limit independently of the reported distance', () => {
    const [resultado] = calcularVinculos([
      ponto('t'), ponto('b', {
        coordenada: { latitude: 0, longitude: 1, origem: 'importada', fonte: 'fixture' },
      }),
    ], [vinculo({ kmPlanilha: 0, regra50Km: true })]);
    expect(resultado.excede50Km).toBe(true);
    expect(resultado.divergente).toBe(true);
  });

  it('reports absent/invalid coordinates instead of substituting zero or stale distances', () => {
    for (const pontos of [
      [ponto('t')],
      [ponto('t'), ponto('b', { coordenada: null })],
      [ponto('t'), ponto('b', {
        coordenada: { latitude: NaN, longitude: 0, origem: 'importada', fonte: 'fixture' },
      })],
    ]) {
      const resultado = calcularVinculos(pontos, [vinculo({ distanciaGeodesicaKm: 99 })]);
      expect(resultado[0].distanciaGeodesicaKm).toBeNull();
      expect(resumirTutor(pontos[0], resultado).geodesica.ausentes).toBe(1);
      expect(resumirTutor(pontos[0], resultado).alertas.join(' ')).toContain('geodésica ausente');
    }
    expect(() => calcularVinculos([], [vinculo({ kmPlanilha: NaN })])).toThrow(RangeError);
  });
});

describe('resumirTutor', () => {
  it('separates three distance metrics, counts unique fellows and unions criteria/alerts', () => {
    const tutor = ponto('t', { criterios: ['Original'], alertas: ['Alerta original'] });
    const resumo = resumirTutor(tutor, [
      vinculo({ kmPlanilha: 10, distanciaGeodesicaKm: 20, rota: rota('success', 30000) }),
      vinculo({ id: 'duplicado', kmPlanilha: 30, distanciaGeodesicaKm: 40,
        rota: rota('success', 50000), divergente: true }),
      vinculo({ id: 'segundo', bolsistaId: 'b2', criterio: 'Outro', rota: rota('error', 0) }),
      vinculo({ tutorId: 'outro', bolsistaId: 'ignorado', kmPlanilha: 9999, criterio: 'Ignorado' }),
    ]);
    expect(resumo.tutor).toBe(tutor);
    expect(resumo.quantidadeBolsistas).toBe(2);
    expect(resumo.quantidadeVinculos).toBe(3);
    expect(resumo.planilha).toEqual({ amostras: 2, ausentes: 1, minimo: 10, media: 20, maximo: 30 });
    expect(resumo.geodesica).toEqual({ amostras: 2, ausentes: 1, minimo: 20, media: 30, maximo: 40 });
    expect(resumo.rodoviaria).toEqual({ amostras: 2, ausentes: 1, minimo: 30, media: 40, maximo: 50 });
    expect(resumo.criterios).toEqual(['Original', 'Critério sintético', 'Outro']);
    expect(resumo.alertas).toContain('Alerta original');
    expect(resumo.alertas.join(' ')).toContain('Divergência');
    expect(new Set(resumo.alertas).size).toBe(resumo.alertas.length);
    expect(tutor.alertas).toEqual(['Alerta original']);
  });

  it('treats non-success routes and malformed metrics as missing, not zero', () => {
    const resumo = resumirTutor(ponto('t'), [
      vinculo({ kmPlanilha: NaN, distanciaGeodesicaKm: Infinity, rota: rota('error', 0) }),
      vinculo({ kmPlanilha: -1, distanciaGeodesicaKm: -1, rota: rota('unavailable', 1000) }),
      vinculo({ rota: rota('success', NaN) }),
      vinculo({ rota: rota('success', -1) }),
      vinculo({ rota: rota('success', null) }),
      vinculo(),
    ]);
    for (const stats of [resumo.planilha, resumo.geodesica, resumo.rodoviaria]) {
      expect(stats).toEqual({ amostras: 0, ausentes: 6, minimo: null, media: null, maximo: null });
    }
    expect(resumo.alertas.length).toBeGreaterThan(0);
  });

  it('retains real zero samples and returns null statistics for an empty tutor', () => {
    const zero = resumirTutor(ponto('t'), [
      vinculo({ kmPlanilha: 0, distanciaGeodesicaKm: 0, rota: rota('success', 0) }),
    ]);
    expect(zero.rodoviaria).toEqual({ amostras: 1, ausentes: 0, minimo: 0, media: 0, maximo: 0 });
    const vazio = resumirTutor(ponto('t'), []);
    expect(vazio.quantidadeBolsistas).toBe(0);
    expect(vazio.quantidadeVinculos).toBe(0);
    expect(vazio.planilha).toEqual({ amostras: 0, ausentes: 0, minimo: null, media: null, maximo: null });
  });

  it('alerts on the 50 km rule only, never on an expected second-round exception', () => {
    const tutor = ponto('t');
    const calculados = calcularVinculos([tutor, ponto('b')], [
      vinculo({ kmPlanilha: 50.001, regra50Km: true }),
    ]);
    expect(resumirTutor(tutor, calculados).alertas.join(' ')).toContain('excede o limite');
    for (const changes of [{ regra50Km: false }, { segundaRodada: true }]) {
      const links = calcularVinculos([tutor, ponto('b')], [
        vinculo({ kmPlanilha: 2500, regra50Km: true, ...changes }),
      ]);
      expect(resumirTutor(tutor, links).alertas.join(' ')).not.toContain('excede o limite');
    }
  });
});
