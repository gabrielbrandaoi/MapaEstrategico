import {
  buildAllocationDistribution,
  compareAllocationDistributions,
} from './allocation-distribution';
import {
  DEFAULT_ALLOCATION_CONFIG,
  type AllocationDistribution,
  type AllocationResult,
  type TutorAllocation,
} from './allocation.models';

const KEYS = ['0', '1', '2', '3', '4', 'dismissed', 'below-minimum', 'total'] as const;

function tutor(
  tutorId: string,
  fellowCount: number,
  status: TutorAllocation['status'] = 'active',
): TutorAllocation {
  return {
    tutorId,
    status,
    fellowCount,
    reason: 'Cenário sintético',
    nearestFellowKm: status === 'active' ? 0 : null,
  };
}

function expectRows(
  distribution: AllocationDistribution,
  counts: readonly number[],
  total: number,
): void {
  expect(distribution.totalTutors).toBe(total);
  expect(distribution.rows.map(({ key }) => key)).toEqual(KEYS);
  distribution.rows.forEach((row, index) => {
    expect(row.label.trim().length).toBeGreaterThan(0);
    expect(row.count).toBe(counts[index]);
    expect(Number.isInteger(row.count)).toBe(true);
    expect(row.count).toBeGreaterThanOrEqual(0);
    expect(row.percentage).toBeCloseTo(total === 0 ? 0 : (counts[index] / total) * 100, 10);
    expect(row.subtotal).toBe(row.key === '0');
  });
  const rows = distribution.rows;
  expect(rows[0].count).toBe(rows[5].count + rows[6].count);
  expect(rows.slice(1, 7).reduce((sum, { count }) => sum + count, 0)).toBe(total);
  expect(rows[7].percentage).toBe(total === 0 ? 0 : 100);
}

// Independente do construtor testado: entradas manuais para isolar a comparação.
function manualDistribution(
  counts: readonly number[],
  totalTutors: number,
): AllocationDistribution {
  return {
    totalTutors,
    rows: KEYS.map((key, index) => ({
      key,
      label: `Faixa ${key}`,
      subtotal: key === '0',
      count: counts[index],
      percentage: totalTutors === 0 ? 0 : (counts[index] / totalTutors) * 100,
    })),
  };
}

function resultFixture(minimum: 1 | 2): AllocationResult {
  let fellowIndex = 0;
  const tutors =
    minimum === 1
      ? [tutor('a', 1), tutor('b', 3), tutor('c', 0, 'dismissed'), tutor('d', 0, 'below-minimum')]
      : [
          tutor('a', 0, 'below-minimum'),
          tutor('b', 4),
          tutor('c', 0, 'dismissed'),
          tutor('d', 0, 'below-minimum'),
        ];
  return {
    config: { ...DEFAULT_ALLOCATION_CONFIG, minimoPorTutor: minimum },
    tutors,
    links: tutors.flatMap(({ tutorId, fellowCount }) =>
      Array.from({ length: fellowCount }, () => ({
        tutorId,
        fellowId: `fellow-${fellowIndex++}`,
        straightLineKm: 0,
      })),
    ),
    unassignedFellows: [],
    dismissedTutorIds: ['c'],
    belowMinimumTutorIds: minimum === 1 ? ['d'] : ['a', 'd'],
    indicators: {
      allocatedFellows: 4,
      unassignedFellows: 0,
      activeTutors: minimum === 1 ? 2 : 1,
      dismissedTutors: 1,
      belowMinimumTutors: minimum === 1 ? 1 : 2,
      averageStraightLineKm: 0,
      maximumStraightLineKm: 0,
      tutorsByLoad: minimum === 1 ? { 1: 1, 2: 0, 3: 1, 4: 0 } : { 1: 0, 2: 0, 3: 0, 4: 1 },
    },
    distribution: manualDistribution(
      minimum === 1 ? [2, 1, 0, 1, 0, 1, 1, 4] : [3, 0, 0, 0, 1, 1, 2, 4],
      4,
    ),
  };
}

describe('buildAllocationDistribution — tabela e dados de gráfico', () => {
  it('mantém ordem, categorias exclusivas e subtotal zero sem duplicar o total', () => {
    const tutors = [
      tutor('one-a', 1),
      tutor('one-b', 1),
      tutor('two', 2),
      tutor('three', 3),
      tutor('four', 4),
      tutor('dismissed-a', 0, 'dismissed'),
      tutor('dismissed-b', 0, 'dismissed'),
      tutor('below-a', 0, 'below-minimum'),
      tutor('below-b', 0, 'below-minimum'),
      tutor('below-c', 0, 'below-minimum'),
    ];
    const distribution = buildAllocationDistribution(tutors);
    expectRows(distribution, [5, 2, 1, 1, 1, 2, 3, 10], 10);
    // O gráfico deve usar apenas 1..4 e os dois estados de inatividade.
    const chartRows = distribution.rows.filter(({ key }) => key !== '0' && key !== 'total');
    expect(chartRows.map(({ count }) => count)).toEqual([2, 1, 1, 1, 2, 3]);
    expect(chartRows.reduce((sum, { percentage }) => sum + percentage, 0)).toBeCloseTo(100, 10);
  });

  it('trata vazio sem NaN, Infinity ou total percentual 100 indevido', () => {
    expectRows(buildAllocationDistribution([]), [0, 0, 0, 0, 0, 0, 0, 0], 0);
  });

  it.each([1, 2, 3, 4])('conta carga ativa %i sem confundi-la com bolsistas', (load) => {
    const counts = [0, 0, 0, 0, 0, 0, 0, 1];
    counts[load] = 1;
    expectRows(buildAllocationDistribution([tutor('active', load)]), counts, 1);
  });

  it.each(['dismissed', 'below-minimum'] as const)(
    'conta estado %s também no subtotal zero',
    (status) => {
      const counts = [
        1,
        0,
        0,
        0,
        0,
        status === 'dismissed' ? 1 : 0,
        status === 'below-minimum' ? 1 : 0,
        1,
      ];
      expectRows(buildAllocationDistribution([tutor('inactive', 0, status)]), counts, 1);
    },
  );

  it('calcula percentuais sobre todos os tutores sem arredondar a contagem ou a fração', () => {
    expectRows(
      buildAllocationDistribution([tutor('a', 1), tutor('b', 2), tutor('c', 0, 'below-minimum')]),
      [1, 1, 1, 0, 0, 0, 1, 3],
      3,
    );
  });

  it('é determinístico, independente da ordem e não modifica entradas readonly', () => {
    const tutors = Object.freeze([
      Object.freeze(tutor('b', 4)),
      Object.freeze(tutor('a', 0, 'dismissed')),
      Object.freeze(tutor('c', 0, 'below-minimum')),
    ]);
    const snapshot = structuredClone(tutors);
    const baseline = buildAllocationDistribution(tutors);
    expect(buildAllocationDistribution(tutors)).toEqual(baseline);
    expect(buildAllocationDistribution([...tutors].reverse())).toEqual(baseline);
    expect(tutors).toEqual(snapshot);
  });
});

describe('compareAllocationDistributions — mínimo 2 menos mínimo 1', () => {
  it('rejeita populações diferentes mesmo com a mesma quantidade de bolsistas alocados', () => {
    const minimum2 = resultFixture(2);
    expect(() => compareAllocationDistributions(resultFixture(1), {
      ...minimum2,
      links: minimum2.links.map((link, index) =>
        index === 0 ? { ...link, fellowId: 'outro-bolsista' } : link),
    })).toThrow(/mesmos IDs de bolsistas/);
  });

  it('inclui bolsistas sem tutor na população comparada', () => {
    const minimum1 = resultFixture(1);
    const minimum2 = resultFixture(2);
    const unassignedFellows = [{ fellowId: 'sem-tutor', reason: 'Sem vaga no cenário sintético' }];
    const withUnassigned = {
      ...minimum2,
      unassignedFellows,
      indicators: { ...minimum2.indicators, unassignedFellows: 1 },
    };
    expect(() => compareAllocationDistributions(minimum1, withUnassigned))
      .toThrow(/mesmos IDs de bolsistas/);
    expect(() => compareAllocationDistributions({
      ...minimum1,
      unassignedFellows,
      indicators: { ...minimum1.indicators, unassignedFellows: 1 },
    }, withUnassigned)).not.toThrow();
  });

  it('compara todas as linhas em contagem e pontos percentuais, não variação relativa', () => {
    const minimum1 = resultFixture(1);
    const minimum2 = resultFixture(2);
    const snapshots = structuredClone([minimum1, minimum2]);
    const rows = compareAllocationDistributions(minimum1, minimum2);
    expect(rows.map(({ key }) => key)).toEqual(KEYS);
    const counts1 = [2, 1, 0, 1, 0, 1, 1, 4];
    const counts2 = [3, 0, 0, 0, 1, 1, 2, 4];
    rows.forEach((row, index) => {
      expect(row.label.trim().length).toBeGreaterThan(0);
      expect(row.subtotal).toBe(row.key === '0');
      expect(row.minimum1Count).toBe(counts1[index]);
      expect(row.minimum2Count).toBe(counts2[index]);
      expect(row.countDifference).toBe(counts2[index] - counts1[index]);
      expect(row.minimum1Percentage).toBe(counts1[index] * 25);
      expect(row.minimum2Percentage).toBe(counts2[index] * 25);
      expect(row.percentagePointDifference).toBe((counts2[index] - counts1[index]) * 25);
    });
    expect([minimum1, minimum2]).toEqual(snapshots);
  });

  it('aceita os mesmos IDs de tutores em ordem diferente', () => {
    const minimum1 = resultFixture(1);
    const minimum2 = resultFixture(2);
    expect(
      compareAllocationDistributions(minimum1, {
        ...minimum2,
        tutors: [...minimum2.tutors].reverse(),
      }),
    ).toEqual(compareAllocationDistributions(minimum1, minimum2));
  });

  it('compara populações vazias com todos os deltas e percentuais zero', () => {
    const empty = (minimum: 1 | 2): AllocationResult => ({
      ...resultFixture(minimum),
      tutors: [],
      links: [],
      dismissedTutorIds: [],
      belowMinimumTutorIds: [],
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
      distribution: manualDistribution([0, 0, 0, 0, 0, 0, 0, 0], 0),
    });
    const rows = compareAllocationDistributions(empty(1), empty(2));
    expect(rows.map(({ key }) => key)).toEqual(KEYS);
    for (const row of rows) {
      expect([
        row.minimum1Count,
        row.minimum2Count,
        row.countDifference,
        row.minimum1Percentage,
        row.minimum2Percentage,
        row.percentagePointDifference,
      ]).toEqual([0, 0, 0, 0, 0, 0]);
    }
  });

  it.each([
    [1, 1],
    [2, 2],
    [2, 1],
  ] as const)('rejeita ordem/cenários incompatíveis: mínimo %i versus %i', (first, second) => {
    expect(() =>
      compareAllocationDistributions(resultFixture(first), resultFixture(second)),
    ).toThrow();
  });

  it.each([{ raioMaxKm: 149 }, { maximoPorTutor: 3 }, { percentualDispensa: 0 }])(
    'rejeita configurações diferentes além do mínimo: %j',
    (changes) => {
      const minimum1 = resultFixture(1);
      // Teto 3 é válido para o primeiro cenário: a única incompatibilidade é entre configs.
      expect(() =>
        compareAllocationDistributions(
          {
            ...minimum1,
            config: { ...minimum1.config, ...changes },
          },
          resultFixture(2),
        ),
      ).toThrow();
    },
  );

  it('rejeita IDs distintos mesmo com igual número de tutores e mesma distribuição', () => {
    const minimum2 = resultFixture(2);
    // Troca apenas o ID de um tutor inativo; os demais invariantes continuam válidos.
    expect(() =>
      compareAllocationDistributions(resultFixture(1), {
        ...minimum2,
        tutors: minimum2.tutors.map((row) =>
          row.tutorId === 'd' ? { ...row, tutorId: 'other' } : row,
        ),
        belowMinimumTutorIds: ['a', 'other'],
      }),
    ).toThrow();
  });

  it('não depende de fetch', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Rede proibida neste teste de domínio');
    });
    try {
      buildAllocationDistribution([tutor('a', 1)]);
      compareAllocationDistributions(resultFixture(1), resultFixture(2));
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
