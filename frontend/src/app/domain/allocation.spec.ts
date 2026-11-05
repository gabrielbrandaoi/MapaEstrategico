import { simulateAllocation, validateAllocationResult } from './allocation';
import {
  DEFAULT_ALLOCATION_CONFIG,
  type AllocationConfig,
  type AllocationDistribution,
  type AllocationResult,
  type TutorDistanceScore,
} from './allocation.models';
import type { Participant } from './models';

// Distâncias sintéticas no equador: oráculo geométrico, não o algoritmo de alocação.
const EARTH_RADIUS_KM = 6371.0088;

function participant(
  id: string,
  type: Participant['type'],
  eastKm: number | null = 0,
): Participant {
  return {
    id,
    type,
    name: 'Participante sintético',
    city: null,
    state: null,
    address: null,
    postalCode: null,
    location:
      eastKm === null
        ? null
        : {
            latitude: 0,
            longitude: (eastKm / EARTH_RADIUS_KM) * (180 / Math.PI),
            source: 'imported',
          },
    sourceRow: 2,
  };
}

function participants(count: number, type: Participant['type']): Participant[] {
  return Array.from({ length: count }, (_, index) =>
    participant(`${type}-${String(index + 1).padStart(3, '0')}`, type),
  );
}

function config(overrides: Partial<AllocationConfig> = {}): AllocationConfig {
  return { ...DEFAULT_ALLOCATION_CONFIG, percentualDispensa: 0, ...overrides };
}

function withCoordinates(person: Participant, latitude: number, longitude: number): Participant {
  return { ...person, location: { latitude, longitude, source: 'imported' } };
}

/** Verifica invariantes diretamente sobre entradas/saídas, sem usar o validador testado. */
function expectConsistent(
  result: AllocationResult,
  tutors: readonly Participant[],
  fellows: readonly Participant[],
): void {
  const linkedIds = result.links.map((link) => link.fellowId);
  const unassignedIds = result.unassignedFellows.map((fellow) => fellow.fellowId);
  expect(new Set(linkedIds).size).toBe(linkedIds.length);
  expect(new Set(unassignedIds).size).toBe(unassignedIds.length);
  expect([...linkedIds, ...unassignedIds].sort()).toEqual(fellows.map(({ id }) => id).sort());
  expect(result.tutors.map(({ tutorId }) => tutorId).sort()).toEqual(
    tutors.map(({ id }) => id).sort(),
  );
  expect(result.indicators.allocatedFellows).toBe(linkedIds.length);
  expect(result.indicators.unassignedFellows).toBe(unassignedIds.length);

  for (const link of result.links) {
    expect(tutors.some(({ id }) => id === link.tutorId)).toBe(true);
    expect(fellows.some(({ id }) => id === link.fellowId)).toBe(true);
    expect(Number.isFinite(link.straightLineKm)).toBe(true);
    expect(link.straightLineKm).toBeGreaterThanOrEqual(0);
    expect(link.straightLineKm).toBeLessThanOrEqual(result.config.raioMaxKm);
  }

  for (const tutor of result.tutors) {
    const count = result.links.filter(({ tutorId }) => tutorId === tutor.tutorId).length;
    expect(tutor.fellowCount).toBe(count);
    if (tutor.status === 'active') {
      expect(count).toBeGreaterThanOrEqual(result.config.minimoPorTutor);
      expect(count).toBeLessThanOrEqual(result.config.maximoPorTutor);
    } else {
      expect(count).toBe(0);
      expect(tutor.reason.trim().length).toBeGreaterThan(0);
    }
  }
  for (const status of ['active', 'dismissed', 'below-minimum'] as const) {
    const count = result.tutors.filter((tutor) => tutor.status === status).length;
    const indicator =
      status === 'active'
        ? result.indicators.activeTutors
        : status === 'dismissed'
          ? result.indicators.dismissedTutors
          : result.indicators.belowMinimumTutors;
    expect(indicator).toBe(count);
  }
  expect([...result.dismissedTutorIds].sort()).toEqual(
    result.tutors
      .filter(({ status }) => status === 'dismissed')
      .map(({ tutorId }) => tutorId)
      .sort(),
  );
  expect([...result.belowMinimumTutorIds].sort()).toEqual(
    result.tutors
      .filter(({ status }) => status === 'below-minimum')
      .map(({ tutorId }) => tutorId)
      .sort(),
  );
  for (const load of [1, 2, 3, 4] as const) {
    expect(result.indicators.tutorsByLoad[load]).toBe(
      result.tutors.filter(({ status, fellowCount }) => status === 'active' && fellowCount === load)
        .length,
    );
  }
  const rows = result.distribution.rows;
  expect(result.distribution.totalTutors).toBe(tutors.length);
  expect(rows.map(({ key }) => key)).toEqual([
    '0',
    '1',
    '2',
    '3',
    '4',
    'dismissed',
    'below-minimum',
    'total',
  ]);
  const expectedCounts = [
    result.tutors.filter(({ status }) => status !== 'active').length,
    ...([1, 2, 3, 4] as const).map(
      (load) =>
        result.tutors.filter(
          ({ status, fellowCount }) => status === 'active' && fellowCount === load,
        ).length,
    ),
    result.tutors.filter(({ status }) => status === 'dismissed').length,
    result.tutors.filter(({ status }) => status === 'below-minimum').length,
    tutors.length,
  ];
  rows.forEach((row, index) => {
    expect(row.count).toBe(expectedCounts[index]);
    expect(Number.isInteger(row.count)).toBe(true);
    expect(row.percentage).toBeCloseTo(
      tutors.length === 0 ? 0 : (expectedCounts[index] / tutors.length) * 100,
      10,
    );
    expect(row.subtotal).toBe(row.key === '0');
    expect(row.label.trim().length).toBeGreaterThan(0);
  });
  // Dados que alimentam o gráfico: não incluir o subtotal zero nem a linha total.
  const chartRows = rows.filter(({ key }) => key !== '0' && key !== 'total');
  expect(chartRows.reduce((sum, { count }) => sum + count, 0)).toBe(tutors.length);
  expect(rows[0].count).toBe(rows[5].count + rows[6].count);
  expect(rows.slice(1, 5).map(({ count }) => count)).toEqual(
    ([1, 2, 3, 4] as const).map((load) => result.indicators.tutorsByLoad[load]),
  );
  expect(rows[5].count).toBe(result.indicators.dismissedTutors);
  expect(rows[6].count).toBe(result.indicators.belowMinimumTutors);
  const distances = result.links.map(({ straightLineKm }) => straightLineKm);
  if (distances.length === 0) {
    expect(result.indicators.averageStraightLineKm).toBeNull();
    expect(result.indicators.maximumStraightLineKm).toBeNull();
  } else {
    expect(result.indicators.averageStraightLineKm).toBeCloseTo(
      distances.reduce((sum, distance) => sum + distance, 0) / distances.length,
      9,
    );
    expect(result.indicators.maximumStraightLineKm).toBeCloseTo(Math.max(...distances), 9);
  }
}

describe('simulateAllocation — contrato e limites', () => {
  it('usa explicitamente 150 km, mínimo 1, teto 4 e dispensa de 15% por padrão', () => {
    expect(DEFAULT_ALLOCATION_CONFIG).toEqual({
      raioMaxKm: 150,
      minimoPorTutor: 1,
      maximoPorTutor: 4,
      percentualDispensa: 0.15,
    });
    const tutors = participants(7, 'tutor');
    const fellows = participants(30, 'fellow');
    const result = simulateAllocation(tutors, fellows);
    expect(result.config).toEqual(DEFAULT_ALLOCATION_CONFIG);
    expect(result.dismissedTutorIds).toHaveLength(2);
    expect(result.links).toHaveLength(20);
    expectConsistent(result, tutors, fellows);
  });

  describe.each([1, 2] as const)('cenário de mínimo %i', (minimum) => {
    it.each([8, 16, 17, 200])('mantém teto 4 e unicidade com %i bolsistas', (volume) => {
      const tutors = participants(4, 'tutor');
      const fellows = participants(volume, 'fellow');
      const result = simulateAllocation(tutors, fellows, config({ minimoPorTutor: minimum }));
      expect(result.links).toHaveLength(Math.min(16, volume));
      expect(result.indicators.activeTutors).toBe(4);
      expectConsistent(result, tutors, fellows);
    });

    it('reserva o mínimo de todos os tutores antes de distribuir excedentes', () => {
      const tutors = [participant('tutor-a', 'tutor', 0), participant('tutor-b', 'tutor', 200)];
      const fellows = [
        ...Array.from({ length: minimum }, (_, index) =>
          participant(`exclusivo-a-${index}`, 'fellow', 0),
        ),
        ...Array.from({ length: minimum }, (_, index) =>
          participant(`compartilhado-${index}`, 'fellow', 100),
        ),
      ];
      const result = simulateAllocation(tutors, fellows, config({ minimoPorTutor: minimum }));
      expect(result.links).toHaveLength(minimum * 2);
      expect(result.indicators.activeTutors).toBe(2);
      expect(result.tutors.every(({ fellowCount }) => fellowCount === minimum)).toBe(true);
      expectConsistent(result, tutors, fellows);
    });

    it.each([0, 1, 2, 3, 7])('não deixa tutor com carga parcial na escassez de %i', (volume) => {
      const tutors = participants(4, 'tutor');
      const fellows = participants(volume, 'fellow');
      const result = simulateAllocation(tutors, fellows, config({ minimoPorTutor: minimum }));
      expect(result.indicators.activeTutors).toBe(Math.min(4, Math.floor(volume / minimum)));
      expectConsistent(result, tutors, fellows);
    });

    it('aplica teto 4 também com volume maior de tutores e bolsistas', () => {
      const tutors = participants(20, 'tutor');
      const fellows = participants(1000, 'fellow');
      const result = simulateAllocation(tutors, fellows, config({ minimoPorTutor: minimum }));
      expect(result.links).toHaveLength(80);
      expect(result.indicators.tutorsByLoad).toEqual({ 1: 0, 2: 0, 3: 0, 4: 20 });
      expectConsistent(result, tutors, fellows);
    });
  });

  it.each([1, 2, 3, 4])('respeita teto configurável inteiro %i', (maximum) => {
    const tutors = participants(2, 'tutor');
    const fellows = participants(12, 'fellow');
    const result = simulateAllocation(tutors, fellows, config({ maximoPorTutor: maximum }));
    expect(result.links).toHaveLength(maximum * 2);
    expectConsistent(result, tutors, fellows);
  });

  describe.each([1, 2] as const)('raio no cenário mínimo %i', (minimum) => {
    it.each([
      [130, true],
      [140, true],
      [149.999, true],
      [150, true],
      [150.001, false],
      [160, false],
    ] as const)('aplica raio inclusivo de 150 km a %s km', (km, eligible) => {
      const tutors = participants(1, 'tutor');
      const fellows = Array.from({ length: minimum }, (_, index) =>
        participant(`fellow-${index}`, 'fellow', km),
      );
      const result = simulateAllocation(tutors, fellows, config({ minimoPorTutor: minimum }));
      expect(result.links).toHaveLength(eligible ? minimum : 0);
      expect(result.unassignedFellows).toHaveLength(eligible ? 0 : minimum);
      if (eligible) expect(result.links[0].straightLineKm).toBeCloseTo(km, 8);
      expectConsistent(result, tutors, fellows);
    });
  });

  it('usa o raio configurado, sem fixar 150 internamente', () => {
    const tutors = participants(1, 'tutor');
    const fellows = [participant('fellow', 'fellow', 60)];
    expect(simulateAllocation(tutors, fellows, config({ raioMaxKm: 50 })).links).toHaveLength(0);
    expect(simulateAllocation(tutors, fellows, config({ raioMaxKm: 70 })).links).toHaveLength(1);
  });

  it('conta cada bolsista uma vez, mesmo com vários tutores elegíveis', () => {
    const tutors = participants(4, 'tutor');
    const fellows = participants(3, 'fellow');
    const result = simulateAllocation(tutors, fellows, config());
    expect(result.indicators.allocatedFellows).toBe(3);
    expect(result.links).toHaveLength(3);
    expectConsistent(result, tutors, fellows);
  });

  it('aceita identidades provisórias com nomes iguais e IDs distintos', () => {
    const tutors = participants(2, 'tutor').map((person) => ({
      ...person,
      identityUnverified: true,
    }));
    const fellows = participants(4, 'fellow').map((person) => ({
      ...person,
      identityUnverified: true,
    }));
    const result = simulateAllocation(tutors, fellows, config());
    expect(result.links).toHaveLength(4);
    expectConsistent(result, tutors, fellows);
  });
});

describe('simulateAllocation — ranking e dispensa', () => {
  it.each([
    [1, 1],
    [6, 1],
    [7, 2],
    [20, 3],
  ])('arredonda ceil(%i tutores geolocalizados × 0,15) para %i', (count, dismissed) => {
    const tutors = participants(count, 'tutor');
    const fellows = participants(2, 'fellow');
    const result = simulateAllocation(tutors, fellows);
    expect(result.dismissedTutorIds).toHaveLength(dismissed);
    expectConsistent(result, tutors, fellows);
  });

  it.each([0, 1])('aceita percentual extremo %i e não vincula dispensados', (percentage) => {
    const tutors = participants(7, 'tutor');
    const fellows = participants(20, 'fellow');
    const result = simulateAllocation(tutors, fellows, config({ percentualDispensa: percentage }));
    expect(result.dismissedTutorIds).toHaveLength(percentage * 7);
    expect(result.links).toHaveLength(percentage === 1 ? 0 : 20);
    expectConsistent(result, tutors, fellows);
  });

  it('rankeia pela menor Haversine a qualquer bolsista, não média nem primeiro bolsista', () => {
    const tutors = [participant('tutor-a', 'tutor', 0), participant('tutor-b', 'tutor', 20)];
    const fellows = [
      participant('fellow-longe-1', 'fellow', 100),
      participant('fellow-longe-2', 'fellow', 100),
      participant('fellow-perto', 'fellow', 0),
    ];
    const result = simulateAllocation(tutors, fellows);
    expect(result.dismissedTutorIds).toEqual(['tutor-b']);
    expect(result.tutors.find(({ tutorId }) => tutorId === 'tutor-a')?.nearestFellowKm).toBe(0);
    expect(result.tutors.find(({ tutorId }) => tutorId === 'tutor-b')?.nearestFellowKm).toBeCloseTo(
      20,
      8,
    );
    expectConsistent(result, tutors, fellows);
  });

  it('dispensa em score decrescente e desempata por ID lexical crescente', () => {
    const tutors = [
      participant('tutor-z', 'tutor', 100),
      participant('tutor-b', 'tutor', 40),
      participant('tutor-a', 'tutor', 40),
      participant('tutor-c', 'tutor', 0),
    ];
    const fellows = participants(4, 'fellow');
    const result = simulateAllocation(tutors, fellows, config({ percentualDispensa: 0.5 }));
    // O corte inclui o mais distante e apenas o primeiro ID no empate.
    // A ordem de apresentação do array não faz parte da regra de seleção.
    expect([...result.dismissedTutorIds].sort()).toEqual(['tutor-a', 'tutor-z']);
    expectConsistent(result, tutors, fellows);
  });

  it('aceita score injetado para ranking sem usá-lo como distância de elegibilidade', () => {
    const tutors = [
      participant('tutor-perto', 'tutor', 0),
      participant('tutor-fora', 'tutor', 200),
      participant('tutor-dentro', 'tutor', 30),
    ];
    const fellows = participants(1, 'fellow');
    const score: TutorDistanceScore = (tutor) => (tutor.id === 'tutor-perto' ? 1000 : 0);
    const result = simulateAllocation(tutors, fellows, config({ percentualDispensa: 0.15 }), score);
    expect(result.dismissedTutorIds).toEqual(['tutor-perto']);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].tutorId).toBe('tutor-dentro');
    expect(result.links[0].straightLineKm).toBeCloseTo(30, 8);
    expectConsistent(result, tutors, fellows);
  });

  it('exclui tutores sem coordenadas do denominador e do score', () => {
    const tutors = [
      ...participants(6, 'tutor'),
      participant('tutor-sem-coordenadas', 'tutor', null),
      withCoordinates(participant('tutor-invalido', 'tutor'), 91, 0),
    ];
    const fellows = [
      ...participants(1, 'fellow'),
      participant('fellow-sem-coordenadas', 'fellow', null),
      withCoordinates(participant('fellow-invalido', 'fellow'), 0, NaN),
    ];
    const score = vi.fn<TutorDistanceScore>(() => 0);
    const result = simulateAllocation(tutors, fellows, DEFAULT_ALLOCATION_CONFIG, score);
    expect(result.dismissedTutorIds).toHaveLength(1); // ceil(6 × .15), não ceil(8 × .15).
    for (const id of ['tutor-sem-coordenadas', 'tutor-invalido']) {
      expect(result.tutors.find(({ tutorId }) => tutorId === id)).toMatchObject({
        status: 'below-minimum',
        fellowCount: 0,
        nearestFellowKm: null,
      });
    }
    expect(score).toHaveBeenCalled();
    for (const [tutor, validFellows] of score.mock.calls) {
      expect(tutors.slice(0, 6).map(({ id }) => id)).toContain(tutor.id);
      expect(validFellows.map(({ id }) => id)).toEqual(['fellow-001']);
    }
    expectConsistent(result, tutors, fellows);
  });

  it('inclui coordenadas válidas fora do raio na base ceil(15%), mas não coordenadas ausentes', () => {
    const tutors = [
      participant('tutor-perto', 'tutor'),
      ...Array.from({ length: 6 }, (_, index) =>
        participant(`tutor-longe-${index}`, 'tutor', 200 + index),
      ),
      participant('tutor-sem-coordenadas', 'tutor', null),
    ];
    const fellows = participants(4, 'fellow');
    const result = simulateAllocation(tutors, fellows);
    expect([...result.dismissedTutorIds].sort()).toEqual(['tutor-longe-4', 'tutor-longe-5']);
    expect(result.belowMinimumTutorIds).toContain('tutor-sem-coordenadas');
    expect(result.links).toHaveLength(4);
    expectConsistent(result, tutors, fellows);
  });

  it.each(['nenhum', 'nulo', 'invalido'] as const)(
    'não dispensa se não há bolsista geolocalizado: %s',
    (kind) => {
      const tutors = participants(7, 'tutor');
      const fellows =
        kind === 'nenhum'
          ? []
          : [
              kind === 'nulo'
                ? participant('fellow', 'fellow', null)
                : withCoordinates(participant('fellow', 'fellow'), Infinity, 0),
            ];
      const score = vi.fn<TutorDistanceScore>(() => 0);
      const result = simulateAllocation(tutors, fellows, DEFAULT_ALLOCATION_CONFIG, score);
      expect(result.dismissedTutorIds).toEqual([]);
      expect(result.indicators.belowMinimumTutors).toBe(7);
      expect(score).not.toHaveBeenCalled();
      expectConsistent(result, tutors, fellows);
    },
  );

  it('é determinístico entre execuções e permutações, inclusive em empates', () => {
    const tutors = participants(7, 'tutor');
    const fellows = participants(13, 'fellow');
    const originalTutors = structuredClone(tutors);
    const originalFellows = structuredClone(fellows);
    const baseline = simulateAllocation(tutors, fellows);
    expect(simulateAllocation(tutors, fellows)).toEqual(baseline);
    expect(simulateAllocation([...tutors].reverse(), [...fellows].reverse())).toEqual(baseline);
    expect(
      simulateAllocation(
        [...tutors.slice(3), ...tutors.slice(0, 3)],
        [...fellows.slice(5), ...fellows.slice(0, 5)],
      ),
    ).toEqual(baseline);
    expect(tutors).toEqual(originalTutors);
    expect(fellows).toEqual(originalFellows);
    expectConsistent(baseline, tutors, fellows);
  });
});

describe('simulateAllocation — coordenadas, vazios e indicadores', () => {
  it.each([
    [NaN, 0],
    [Infinity, 0],
    [-Infinity, 0],
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
    [0, NaN],
    [0, Infinity],
  ])('não aloca coordenadas inválidas (%s, %s) em nenhum extremo', (latitude, longitude) => {
    const tutors = [
      participant('tutor-valido', 'tutor'),
      withCoordinates(participant('tutor-invalido', 'tutor'), latitude, longitude),
    ];
    const fellows = [
      participant('fellow-valido', 'fellow'),
      withCoordinates(participant('fellow-invalido', 'fellow'), latitude, longitude),
    ];
    const result = simulateAllocation(tutors, fellows, config());
    expect(result.links.map(({ fellowId, tutorId }) => [tutorId, fellowId])).toEqual([
      ['tutor-valido', 'fellow-valido'],
    ]);
    expect(result.belowMinimumTutorIds).toContain('tutor-invalido');
    expect(result.unassignedFellows.map(({ fellowId }) => fellowId)).toEqual(['fellow-invalido']);
    expectConsistent(result, tutors, fellows);
  });

  it.each([
    [0, 0],
    [0, 3],
    [3, 0],
  ])('trata entrada vazia: %i tutores, %i bolsistas', (tutorCount, fellowCount) => {
    const tutors = participants(tutorCount, 'tutor');
    const fellows = participants(fellowCount, 'fellow');
    const result = simulateAllocation(tutors, fellows, config());
    expect(result.links).toEqual([]);
    expect(result.unassignedFellows).toHaveLength(fellowCount);
    expect(result.indicators.tutorsByLoad).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
    expectConsistent(result, tutors, fellows);
  });

  it('mantém nulos sem coordenadas como não alocados, sem convertê-los em (0,0)', () => {
    const tutors = [participant('tutor-valido', 'tutor'), participant('tutor-nulo', 'tutor', null)];
    const fellows = [participant('fellow-nulo', 'fellow', null)];
    const result = simulateAllocation(tutors, fellows, config());
    expect(result.links).toEqual([]);
    expect(result.indicators.belowMinimumTutors).toBe(2);
    expectConsistent(result, tutors, fellows);
  });

  it('explica todos os bolsistas não alocados quando estão fora do raio', () => {
    const tutors = participants(3, 'tutor');
    const fellows = [
      participant('fellow-a', 'fellow', 151),
      participant('fellow-b', 'fellow', 500),
    ];
    const result = simulateAllocation(tutors, fellows, config());
    expect(result.links).toEqual([]);
    expect(result.indicators.belowMinimumTutors).toBe(3);
    expect(result.unassignedFellows.every(({ reason }) => reason.trim().length > 0)).toBe(true);
    expectConsistent(result, tutors, fellows);
  });

  it('calcula média e máximo em KM de linha reta, sem fabricar dados rodoviários', () => {
    const tutors = participants(1, 'tutor');
    const fellows = [participant('fellow-a', 'fellow', 10), participant('fellow-b', 'fellow', 30)];
    const result = simulateAllocation(tutors, fellows, config());
    expect(result.links.map(({ straightLineKm }) => straightLineKm).sort((a, b) => a - b)).toEqual([
      expect.closeTo(10, 8),
      expect.closeTo(30, 8),
    ]);
    expect(result.indicators.averageStraightLineKm).toBeCloseTo(20, 8);
    expect(result.indicators.maximumStraightLineKm).toBeCloseTo(30, 8);
    expect(result.indicators.tutorsByLoad).toEqual({ 1: 0, 2: 1, 3: 0, 4: 0 });
    for (const link of result.links) {
      expect(link).not.toHaveProperty('route');
      expect(link).not.toHaveProperty('distanceMeters');
      expect(link).not.toHaveProperty('durationSeconds');
    }
    expectConsistent(result, tutors, fellows);
  });

  it('usa Haversine também fora do equador, não graus como distância plana', () => {
    const tutors = [withCoordinates(participant('tutor', 'tutor'), 60, 0)];
    const fellows = [withCoordinates(participant('fellow', 'fellow'), 60, 1)];
    // Para mesma latitude: a = cos(latitude)^2 × sin(deltaLongitude/2)^2.
    const a = Math.cos(Math.PI / 3) ** 2 * Math.sin(Math.PI / 360) ** 2;
    const expectedKm = 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const result = simulateAllocation(tutors, fellows, config());
    expect(result.links).toHaveLength(1);
    expect(result.links[0].straightLineKm).toBeCloseTo(expectedKm, 8);
    expect(result.links[0].straightLineKm).toBeGreaterThan(55);
    expect(result.links[0].straightLineKm).toBeLessThan(56);
    expectConsistent(result, tutors, fellows);
  });

  it('não usa score de ranking para média ou máximo de distância', () => {
    const score: TutorDistanceScore = () => 999;
    const result = simulateAllocation(
      participants(1, 'tutor'),
      [participant('fellow', 'fellow', 10)],
      config(),
      score,
    );
    expect(result.links[0].straightLineKm).toBeCloseTo(10, 8);
    expect(result.indicators.averageStraightLineKm).toBeCloseTo(10, 8);
    expect(result.indicators.maximumStraightLineKm).toBeCloseTo(10, 8);
  });

  it('não depende de fetch nem de um provedor de rotas', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Rede proibida neste teste de domínio');
    });
    try {
      const result = simulateAllocation(
        participants(2, 'tutor'),
        participants(4, 'fellow'),
        config(),
      );
      expect(result.links).toHaveLength(4);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});

describe('simulateAllocation — entradas inválidas', () => {
  it.each([null, NaN, Infinity, -1])(
    'rejeita escore de ranking indisponível ou inválido: %s',
    (value) => {
      expect(() =>
        simulateAllocation(
          participants(2, 'tutor'),
          participants(2, 'fellow'),
          config(),
          () => value,
        ),
      ).toThrow();
    },
  );

  it.each([
    { maximoPorTutor: 0 },
    { maximoPorTutor: -1 },
    { maximoPorTutor: 1.5 },
    { maximoPorTutor: 5 },
    { maximoPorTutor: Infinity },
    { maximoPorTutor: NaN },
    { minimoPorTutor: 0 },
    { minimoPorTutor: 3 },
    { minimoPorTutor: 1.5 },
    { minimoPorTutor: 2, maximoPorTutor: 1 },
    { raioMaxKm: 0 },
    { raioMaxKm: -1 },
    { raioMaxKm: NaN },
    { raioMaxKm: Infinity },
    { raioMaxKm: -Infinity },
    { percentualDispensa: -0.01 },
    { percentualDispensa: 1.01 },
    { percentualDispensa: NaN },
    { percentualDispensa: Infinity },
  ])('rejeita configuração inválida mesmo com entradas vazias: %j', (invalid) => {
    // Cast intencional: testa a fronteira de execução contra dados externos inválidos.
    const invalidConfig = { ...config(), ...invalid } as AllocationConfig;
    expect(() => simulateAllocation([], [], invalidConfig)).toThrow();
    expect(() =>
      simulateAllocation(participants(2, 'tutor'), participants(4, 'fellow'), invalidConfig),
    ).toThrow();
  });

  it.each(['tutor', 'fellow', 'ambos'] as const)('rejeita IDs duplicados: %s', (kind) => {
    const tutor = participant('id-duplicado', 'tutor');
    const fellow = participant(kind === 'ambos' ? tutor.id : 'fellow', 'fellow');
    const tutors = kind === 'tutor' ? [tutor, { ...tutor }] : [tutor];
    const fellows = kind === 'fellow' ? [fellow, { ...fellow }] : [fellow];
    expect(() => simulateAllocation(tutors, fellows, config())).toThrow();
  });
});

// Oráculo manual: não chama nem simulação nem o construtor de distribuição.
function manualDistribution(
  counts: readonly [number, number, number, number, number, number],
): AllocationDistribution {
  const [one, two, three, four, dismissed, below] = counts;
  const totalTutors = counts.reduce((sum, count) => sum + count, 0);
  const rowCounts = [dismissed + below, one, two, three, four, dismissed, below, totalTutors];
  const keys = ['0', '1', '2', '3', '4', 'dismissed', 'below-minimum', 'total'] as const;
  return {
    totalTutors,
    rows: keys.map((key, index) => ({
      key,
      label: key,
      count: rowCounts[index],
      percentage: totalTutors === 0 ? 0 : (rowCounts[index] / totalTutors) * 100,
      subtotal: key === '0',
    })),
  };
}

// Resultado manual: testar o validador não depende de simulateAllocation acertar.
function validResult(): AllocationResult {
  return {
    config: config(),
    links: [{ tutorId: 'tutor-a', fellowId: 'fellow-a', straightLineKm: 10 }],
    unassignedFellows: [],
    tutors: [
      {
        tutorId: 'tutor-a',
        status: 'active',
        reason: 'Mínimo completo',
        fellowCount: 1,
        nearestFellowKm: 10,
      },
    ],
    dismissedTutorIds: [],
    belowMinimumTutorIds: [],
    distribution: manualDistribution([1, 0, 0, 0, 0, 0]),
    indicators: {
      allocatedFellows: 1,
      unassignedFellows: 0,
      activeTutors: 1,
      dismissedTutors: 0,
      belowMinimumTutors: 0,
      averageStraightLineKm: 10,
      maximumStraightLineKm: 10,
      tutorsByLoad: { 1: 1, 2: 0, 3: 0, 4: 0 },
    },
  };
}

describe('validateAllocationResult — defesa final de invariantes', () => {
  it('aceita resultado válido construído independentemente da simulação', () => {
    expect(() => validateAllocationResult(validResult())).not.toThrow();
  });

  it('aceita resultado vazio consistente com distâncias nulas', () => {
    const empty: AllocationResult = {
      config: config(),
      links: [],
      unassignedFellows: [],
      tutors: [],
      dismissedTutorIds: [],
      belowMinimumTutorIds: [],
      distribution: manualDistribution([0, 0, 0, 0, 0, 0]),
      indicators: {
        allocatedFellows: 0,
        unassignedFellows: 0,
        activeTutors: 0,
        dismissedTutors: 0,
        belowMinimumTutors: 0,
        averageStraightLineKm: null,
        maximumStraightLineKm: null,
        tutorsByLoad: { 1: 0, 2: 0, 3: 0, 4: 0 },
      },
    };
    expect(() => validateAllocationResult(empty)).not.toThrow();
  });

  it('aceita link no limite inclusivo de 150 km', () => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        links: [{ ...base.links[0], straightLineKm: 150 }],
        tutors: [{ ...base.tutors[0], nearestFellowKm: 150 }],
        indicators: {
          ...base.indicators,
          averageStraightLineKm: 150,
          maximumStraightLineKm: 150,
        },
      }),
    ).not.toThrow();
  });

  it('rejeita o mesmo par duplicado', () => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        links: [base.links[0], base.links[0]],
        tutors: [{ ...base.tutors[0], fellowCount: 2 }],
        distribution: manualDistribution([0, 1, 0, 0, 0, 0]),
        indicators: {
          ...base.indicators,
          allocatedFellows: 2,
          tutorsByLoad: { 1: 0, 2: 1, 3: 0, 4: 0 },
        },
      }),
    ).toThrow();
  });

  it('rejeita o mesmo bolsista em dois tutores diferentes', () => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        links: [base.links[0], { ...base.links[0], tutorId: 'tutor-b' }],
        tutors: [base.tutors[0], { ...base.tutors[0], tutorId: 'tutor-b' }],
        distribution: manualDistribution([2, 0, 0, 0, 0, 0]),
        indicators: {
          ...base.indicators,
          allocatedFellows: 2,
          activeTutors: 2,
          tutorsByLoad: { 1: 2, 2: 0, 3: 0, 4: 0 },
        },
      }),
    ).toThrow();
  });

  it('rejeita carga 5 mesmo que IDs e contagem de links sejam coerentes', () => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        links: Array.from({ length: 5 }, (_, index) => ({
          ...base.links[0],
          fellowId: `fellow-${index}`,
        })),
        tutors: [{ ...base.tutors[0], fellowCount: 5 }],
        indicators: { ...base.indicators, allocatedFellows: 5 },
      }),
    ).toThrow();
  });

  it('rejeita carga 3 quando o teto configurado é 2, mesmo abaixo do teto absoluto 4', () => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        config: config({ maximoPorTutor: 2 }),
        links: Array.from({ length: 3 }, (_, index) => ({
          ...base.links[0],
          fellowId: `fellow-${index}`,
        })),
        tutors: [{ ...base.tutors[0], fellowCount: 3 }],
        distribution: manualDistribution([0, 0, 1, 0, 0, 0]),
        indicators: {
          ...base.indicators,
          allocatedFellows: 3,
          tutorsByLoad: { 1: 0, 2: 0, 3: 1, 4: 0 },
        },
      }),
    ).toThrow();
  });

  it.each([150.001, -1, NaN, Infinity])('rejeita distância de link inválida: %s', (km) => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        links: [{ ...base.links[0], straightLineKm: km }],
        indicators: { ...base.indicators, averageStraightLineKm: km, maximumStraightLineKm: km },
      }),
    ).toThrow();
  });

  it.each(['dismissed', 'below-minimum'] as const)('rejeita link com status %s', (status) => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        tutors: [{ ...base.tutors[0], status }],
        dismissedTutorIds: status === 'dismissed' ? ['tutor-a'] : [],
        belowMinimumTutorIds: status === 'below-minimum' ? ['tutor-a'] : [],
        indicators: {
          ...base.indicators,
          activeTutors: 0,
          dismissedTutors: status === 'dismissed' ? 1 : 0,
          belowMinimumTutors: status === 'below-minimum' ? 1 : 0,
          tutorsByLoad: { 1: 0, 2: 0, 3: 0, 4: 0 },
        },
      }),
    ).toThrow();
  });

  it('rejeita tutor ativo com carga parcial abaixo do mínimo 2', () => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({ ...base, config: config({ minimoPorTutor: 2 }) }),
    ).toThrow();
  });

  it('rejeita tutor ativo sem nenhum link', () => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        links: [],
        tutors: [{ ...base.tutors[0], fellowCount: 0 }],
        indicators: {
          ...base.indicators,
          allocatedFellows: 0,
          averageStraightLineKm: null,
          maximumStraightLineKm: null,
          tutorsByLoad: { 1: 0, 2: 0, 3: 0, 4: 0 },
        },
      }),
    ).toThrow();
  });

  it('rejeita bolsista simultaneamente vinculado e não alocado', () => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        unassignedFellows: [{ fellowId: 'fellow-a', reason: 'Sem vaga' }],
        indicators: { ...base.indicators, unassignedFellows: 1 },
      }),
    ).toThrow();
  });

  it.each([undefined, null])('rejeita distribuição ausente: %s', (distribution) => {
    const corrupted = { ...validResult(), distribution } as unknown as AllocationResult;
    expect(() => validateAllocationResult(corrupted)).toThrow();
  });

  it.each([
    ['contagem divergente', { count: 2 }],
    ['contagem fracionária', { count: 0.5 }],
    ['contagem negativa', { count: -1 }],
    ['contagem NaN', { count: NaN }],
    ['percentual divergente', { percentage: 99 }],
    ['percentual arredondado indevidamente', { percentage: 99.99 }],
    ['percentual não finito', { percentage: Infinity }],
    ['subtotal indevido', { subtotal: true }],
  ])('rejeita distribuição fraudada: %s', (_scenario, changes) => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        distribution: {
          ...base.distribution,
          rows: base.distribution.rows.map((row) =>
            row.key === '1' ? { ...row, ...changes } : row,
          ),
        },
      }),
    ).toThrow();
  });

  it('rejeita totalTutors divergente sem outras alterações', () => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        distribution: { ...base.distribution, totalTutors: 2 },
      }),
    ).toThrow();
  });

  it.each(['ausente', 'duplicada', 'extra', 'invertida'] as const)(
    'rejeita estrutura de linhas %s',
    (kind) => {
      const base = validResult();
      const rows = [...base.distribution.rows];
      if (kind === 'ausente') rows.pop();
      if (kind === 'duplicada') rows[2] = rows[1];
      if (kind === 'extra') rows.push(rows[1]);
      if (kind === 'invertida') rows.reverse();
      expect(() =>
        validateAllocationResult({
          ...base,
          distribution: { ...base.distribution, rows },
        }),
      ).toThrow();
    },
  );

  it.each(['0', 'total'] as const)('rejeita subtotal/total %s fraudado', (key) => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        distribution: {
          ...base.distribution,
          rows: base.distribution.rows.map((row) =>
            row.key === key ? { ...row, count: row.count + 1 } : row,
          ),
        },
      }),
    ).toThrow();
  });

  it.each([
    [0, 1, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 0, 1],
  ] as const)(
    'rejeita redistribuição com totais e percentuais coerentes, mas carga/estado falsos: %j',
    (...counts) => {
      expect(() =>
        validateAllocationResult({
          ...validResult(),
          distribution: manualDistribution(counts),
        }),
      ).toThrow();
    },
  );

  it('rejeita zero marcado como categoria comum em vez de subtotal', () => {
    const base = validResult();
    expect(() =>
      validateAllocationResult({
        ...base,
        distribution: {
          ...base.distribution,
          rows: base.distribution.rows.map((row) =>
            row.key === '0' ? { ...row, subtotal: false } : row,
          ),
        },
      }),
    ).toThrow();
  });
});
