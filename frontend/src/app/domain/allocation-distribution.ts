import type {
  AllocationComparisonRow,
  AllocationDistribution,
  AllocationDistributionKey,
  AllocationResult,
  TutorAllocation,
} from './allocation.models';

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Distribuição de alocação inválida: ${message}`);
}

const ROWS: readonly (readonly [AllocationDistributionKey, string])[] = [
  ['0', 'Tutores sem bolsistas (subtotal)'],
  ['1', 'Tutores com 1 bolsista'],
  ['2', 'Tutores com 2 bolsistas'],
  ['3', 'Tutores com 3 bolsistas'],
  ['4', 'Tutores com 4 bolsistas'],
  ['dismissed', 'Tutores dispensados'],
  ['below-minimum', 'Tutores abaixo do mínimo'],
  ['total', 'Total de tutores'],
];

/**
 * Denominador: todos os tutores, inclusive sem coordenadas.
 * Zero é subtotal das duas categorias inativas, não uma categoria adicional.
 * Não arredonda percentuais; apresentação pode arredondar sem alterar o cenário.
 */
export function buildAllocationDistribution(
  tutors: readonly TutorAllocation[],
): AllocationDistribution {
  invariant(Array.isArray(tutors), 'tutores devem ser uma lista.');
  const counts: Record<AllocationDistributionKey, number> = {
    '0': 0, '1': 0, '2': 0, '3': 0, '4': 0,
    dismissed: 0, 'below-minimum': 0, total: tutors.length,
  };
  const ids = new Set<string>();
  for (const tutor of tutors) {
    invariant(
      tutor && typeof tutor.tutorId === 'string' && tutor.tutorId.trim().length > 0,
      'tutor com id inválido.',
    );
    invariant(!ids.has(tutor.tutorId), `tutor duplicado: ${tutor.tutorId}.`);
    ids.add(tutor.tutorId);
    invariant(
      Number.isInteger(tutor.fellowCount) && tutor.fellowCount >= 0 && tutor.fellowCount <= 4,
      `carga fora do teto de 4 ou inválida: ${tutor.tutorId}.`,
    );
    if (tutor.status === 'active') {
      invariant(tutor.fellowCount > 0, `tutor ativo sem bolsistas: ${tutor.tutorId}.`);
      counts[String(tutor.fellowCount) as '1' | '2' | '3' | '4']++;
    } else {
      invariant(
        tutor.status === 'dismissed' || tutor.status === 'below-minimum',
        `status inválido: ${tutor.tutorId}.`,
      );
      invariant(tutor.fellowCount === 0, `tutor inativo com bolsistas: ${tutor.tutorId}.`);
      counts[tutor.status === 'dismissed' ? 'dismissed' : 'below-minimum']++;
      counts['0']++;
    }
  }
  return Object.freeze({
    totalTutors: tutors.length,
    rows: Object.freeze(ROWS.map(([key, label]) => Object.freeze({
      key,
      label,
      count: counts[key],
      percentage: tutors.length ? (counts[key] / tutors.length) * 100 : 0,
      subtotal: key === '0',
    }))),
  });
}

/** Compartilhada pelo validador e pela comparação, sem dependência circular. */
export function validateAllocationDistribution(
  distribution: AllocationDistribution,
  tutors: readonly TutorAllocation[],
): void {
  const expected = buildAllocationDistribution(tutors);
  invariant(distribution && typeof distribution === 'object', 'distribuição ausente.');
  invariant(
    Number.isInteger(distribution.totalTutors) &&
      distribution.totalTutors === expected.totalTutors,
    'total de tutores inconsistente.',
  );
  invariant(
    Array.isArray(distribution.rows) && distribution.rows.length === ROWS.length,
    'linhas ausentes, extras ou duplicadas.',
  );
  for (let index = 0; index < expected.rows.length; index++) {
    const row = distribution.rows[index];
    const target = expected.rows[index];
    invariant(row && row.key === target.key, `chave/ordem inconsistente na linha ${index}.`);
    invariant(
      typeof row.label === 'string' && row.label.trim().length > 0,
      `rótulo ausente: ${target.key}.`,
    );
    invariant(row.subtotal === target.subtotal, `subtotal inconsistente: ${target.key}.`);
    invariant(
      Number.isInteger(row.count) && row.count === target.count,
      `contagem inconsistente: ${target.key}.`,
    );
    invariant(
      Number.isFinite(row.percentage) && row.percentage >= 0 && row.percentage <= 100 &&
        row.percentage === target.percentage,
      `percentual inconsistente: ${target.key}.`,
    );
  }
}

function validateComparisonScenario(result: AllocationResult, minimum: 1 | 2): void {
  invariant(result && typeof result === 'object', `cenário de mínimo ${minimum} ausente.`);
  const config = result.config;
  invariant(config && config.minimoPorTutor === minimum, `cenário deve ter mínimo ${minimum}.`);
  invariant(
    Number.isFinite(config.raioMaxKm) && config.raioMaxKm > 0 &&
      Number.isInteger(config.maximoPorTutor) &&
      config.maximoPorTutor >= minimum && config.maximoPorTutor <= 4 &&
      Number.isFinite(config.percentualDispensa) &&
      config.percentualDispensa >= 0 && config.percentualDispensa <= 1,
    `configuração inválida no cenário de mínimo ${minimum}.`,
  );
  validateAllocationDistribution(result.distribution, result.tutors);
  for (const tutor of result.tutors) {
    invariant(
      tutor.fellowCount <= config.maximoPorTutor &&
        (tutor.status !== 'active' || tutor.fellowCount >= minimum),
      `carga incompatível com a configuração: ${tutor.tutorId}.`,
    );
  }
}

/**
 * Compara mínimo 2 menos mínimo 1 sobre as mesmas populações e configuração.
 * Diferença percentual expressa em pontos percentuais, não variação relativa.
 * Rejeita distribuições inconsistentes, sem substituir dados por valores reconstruídos.
 */
export function compareAllocationDistributions(
  minimum1: AllocationResult,
  minimum2: AllocationResult,
): readonly AllocationComparisonRow[] {
  validateComparisonScenario(minimum1, 1);
  validateComparisonScenario(minimum2, 2);
  for (const key of ['raioMaxKm', 'maximoPorTutor', 'percentualDispensa'] as const) {
    invariant(minimum1.config[key] === minimum2.config[key], `configurações diferentes: ${key}.`);
  }
  const ids = new Set(minimum1.tutors.map((tutor) => tutor.tutorId));
  invariant(
    minimum2.tutors.length === ids.size &&
      minimum2.tutors.every((tutor) => ids.has(tutor.tutorId)),
    'os cenários devem conter os mesmos IDs de tutores.',
  );
  const fellowIds = (result: AllocationResult): readonly string[] => [
    ...result.links.map((link) => link.fellowId),
    ...result.unassignedFellows.map((fellow) => fellow.fellowId),
  ];
  const firstFellows = new Set(fellowIds(minimum1));
  const secondFellows = new Set(fellowIds(minimum2));
  invariant(
    firstFellows.size === secondFellows.size &&
      [...secondFellows].every((id) => firstFellows.has(id)),
    'os cenários devem conter os mesmos IDs de bolsistas.',
  );
  return Object.freeze(minimum1.distribution.rows.map((row, index) => {
    const other = minimum2.distribution.rows[index];
    return Object.freeze({
      key: row.key,
      label: row.label,
      subtotal: row.subtotal,
      minimum1Count: row.count,
      minimum2Count: other.count,
      countDifference: other.count - row.count,
      minimum1Percentage: row.percentage,
      minimum2Percentage: other.percentage,
      percentagePointDifference: other.percentage - row.percentage,
    });
  }));
}
