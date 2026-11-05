import { DEFAULT_ALLOCATION_CONFIG } from './allocation.models';
import {
  buildAllocationDistribution,
  validateAllocationDistribution,
} from './allocation-distribution';
import type {
  AllocationConfig,
  AllocationIndicators,
  AllocationLink,
  AllocationResult,
  TutorAllocation,
  TutorDistanceScore,
  UnassignedFellow,
} from './allocation.models';
import { haversineKm, isValidLocation } from './distance';
import type { Participant } from './models';

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Alocação inválida: ${message}`);
  }
}

function validateConfig(config: AllocationConfig): void {
  invariant(config && typeof config === 'object', 'configuração ausente.');
  invariant(
    Number.isFinite(config.raioMaxKm) && config.raioMaxKm > 0,
    'raio deve ser finito e maior que zero.',
  );
  invariant(
    config.minimoPorTutor === 1 || config.minimoPorTutor === 2,
    'mínimo por tutor deve ser 1 ou 2.',
  );
  invariant(
    Number.isInteger(config.maximoPorTutor) &&
      config.maximoPorTutor >= config.minimoPorTutor &&
      config.maximoPorTutor <= 4,
    'máximo por tutor deve ser inteiro, entre o mínimo e 4.',
  );
  invariant(
    Number.isFinite(config.percentualDispensa) &&
      config.percentualDispensa >= 0 &&
      config.percentualDispensa <= 1,
    'percentual de dispensa deve estar entre 0 e 1.',
  );
}

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// O limite é inclusivo: tolerância apenas para erro de ponto flutuante do Haversine.
function withinRadius(distance: number, radius: number): boolean {
  return distance <= radius ||
    distance - radius <= Number.EPSILON * Math.max(distance, radius) * 8;
}

function validId(id: string): boolean {
  return typeof id === 'string' && id.trim().length > 0;
}

function orderedParticipants(
  participants: readonly Participant[],
  type: Participant['type'],
): Participant[] {
  invariant(Array.isArray(participants), `coleção de ${type} deve ser uma lista.`);
  const ids = new Set<string>();
  for (const participant of participants) {
    invariant(participant && participant.type === type, `tipo esperado: ${type}.`);
    invariant(validId(participant.id), `id de ${type} deve ser texto não vazio.`);
    invariant(!ids.has(participant.id), `id duplicado na coleção de ${type}: ${participant.id}.`);
    ids.add(participant.id);
  }
  // Identidades provisórias permanecem distintas: somente o id identifica cada registro.
  return [...participants].sort((a, b) => lexical(a.id, b.id));
}

function geolocated(participant: Participant): boolean {
  return !!participant.location && isValidLocation(participant.location);
}

function nearestDistance(tutor: Participant, fellows: readonly Participant[]): number | null {
  let nearest: number | null = null;
  for (const fellow of fellows) {
    if (!tutor.location || !fellow.location) continue;
    const distance = haversineKm(tutor.location, fellow.location);
    if (distance !== null && (nearest === null || distance < nearest)) nearest = distance;
  }
  return nearest;
}

function indicatorsFor(
  links: readonly AllocationLink[],
  tutors: readonly TutorAllocation[],
  unassignedCount: number,
): AllocationIndicators {
  const tutorsByLoad: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const tutor of tutors) {
    if (tutor.status === 'active') tutorsByLoad[tutor.fellowCount as 1 | 2 | 3 | 4]++;
  }
  let total = 0;
  let maximum = 0;
  for (const link of links) {
    total += link.straightLineKm;
    maximum = Math.max(maximum, link.straightLineKm);
  }
  return {
    allocatedFellows: links.length,
    unassignedFellows: unassignedCount,
    activeTutors: tutors.filter((tutor) => tutor.status === 'active').length,
    dismissedTutors: tutors.filter((tutor) => tutor.status === 'dismissed').length,
    belowMinimumTutors: tutors.filter((tutor) => tutor.status === 'below-minimum').length,
    averageStraightLineKm: links.length ? total / links.length : null,
    maximumStraightLineKm: links.length ? maximum : null,
    tutorsByLoad: Object.freeze(tutorsByLoad),
  };
}

/**
 * Cenário exploratório, sem agenda/região confirmadas. Elegibilidade: coordenadas e raio
 * geodésico; preferência: distância; atribuição: vínculo único e limites de carga.
 * Objetivo heurístico: completar mínimos antes do excedente e favorecer menores km.
 * Não garante ótimo global, não calcula estrada, ida/volta nem circuito multiparada.
 * Entradas são preservadas; empates lexicais e snapshot congelado tornam o cenário reproduzível
 * (um score externo também precisa ser puro/determinístico).
 */
export function simulateAllocation(
  tutors: readonly Participant[],
  fellows: readonly Participant[],
  config: AllocationConfig = DEFAULT_ALLOCATION_CONFIG,
  score?: TutorDistanceScore,
): AllocationResult {
  validateConfig(config);
  invariant(score === undefined || typeof score === 'function', 'score deve ser uma função.');
  const snapshot = Object.freeze({ ...config });
  const orderedTutors = orderedParticipants(tutors, 'tutor');
  const orderedFellows = orderedParticipants(fellows, 'fellow');
  const tutorIds = new Set(orderedTutors.map((tutor) => tutor.id));
  for (const fellow of orderedFellows) {
    invariant(!tutorIds.has(fellow.id), `id duplicado entre tutor e bolsista: ${fellow.id}.`);
  }
  const validFellows = orderedFellows.filter(geolocated);
  const validTutors = orderedTutors.filter(geolocated);
  const nearest = new Map(
    orderedTutors.map((tutor) => [
      tutor.id,
      geolocated(tutor) ? nearestDistance(tutor, validFellows) : null,
    ]),
  );
  const ranking = validTutors.map((tutor) => {
    const value = validFellows.length
      ? score ? score(tutor, validFellows) : nearest.get(tutor.id)!
      : null;
    invariant(
      value === null || (Number.isFinite(value) && value >= 0),
      `score do tutor ${tutor.id} deve ser distância finita não negativa ou null.`,
    );
    invariant(
      !validFellows.length || value !== null,
      `score indisponível para o tutor ${tutor.id} com bolsistas geolocalizados.`,
    );
    return { tutorId: tutor.id, value };
  });
  ranking.sort((a, b) => {
    if (a.value === null && b.value !== null) return 1;
    if (b.value === null && a.value !== null) return -1;
    return (a.value !== null && b.value !== null ? b.value - a.value : 0) ||
      lexical(a.tutorId, b.tutorId);
  });
  const dismissedCount = validFellows.length
    ? Math.ceil(validTutors.length * snapshot.percentualDispensa)
    : 0;
  const dismissed = new Set(ranking.slice(0, dismissedCount).map((entry) => entry.tutorId));
  const eligible = new Map<string, AllocationLink[]>();
  for (const tutor of validTutors) {
    const candidates: AllocationLink[] = [];
    for (const fellow of validFellows) {
      const distance = haversineKm(tutor.location!, fellow.location!);
      if (distance !== null && withinRadius(distance, snapshot.raioMaxKm)) {
        candidates.push({
          tutorId: tutor.id,
          fellowId: fellow.id,
          // Normaliza apenas o ruído numérico na fronteira; nunca emite km acima do raio.
          straightLineKm: Math.min(distance, snapshot.raioMaxKm),
        });
      }
    }
    eligible.set(tutor.id, candidates.sort(
      (a, b) => a.straightLineKm - b.straightLineKm || lexical(a.fellowId, b.fellowId),
    ));
  }
  const links: AllocationLink[] = [];
  const assigned = new Set<string>();
  const loads = new Map<string, number>();
  const pending = new Set(validTutors.filter((tutor) => !dismissed.has(tutor.id)).map((t) => t.id));

  // Bundle = mínimo completo dos candidatos livres mais próximos. A cada reserva,
  // recalcula escassez (quantidade de candidatos restantes), soma dos km e id do tutor.
  while (pending.size) {
    const bundles = [...pending].map((tutorId) => {
      const available = eligible.get(tutorId)!.filter((link) => !assigned.has(link.fellowId));
      const bundle = available.slice(0, snapshot.minimoPorTutor);
      return {
        tutorId, available: available.length, bundle,
        distance: bundle.reduce((sum, link) => sum + link.straightLineKm, 0),
      };
    }).filter((entry) => entry.bundle.length === snapshot.minimoPorTutor);
    bundles.sort((a, b) => a.available - b.available ||
      a.distance - b.distance || lexical(a.tutorId, b.tutorId));
    const selected = bundles[0];
    if (!selected) break;
    pending.delete(selected.tutorId);
    loads.set(selected.tutorId, selected.bundle.length);
    for (const link of selected.bundle) {
      links.push(link);
      assigned.add(link.fellowId);
    }
  }

  // Excedente somente entre tutores já ativos, em ordem global de proximidade.
  const surplus = [...loads.keys()].flatMap((id) => eligible.get(id)!).sort(
    (a, b) => a.straightLineKm - b.straightLineKm ||
      lexical(a.tutorId, b.tutorId) || lexical(a.fellowId, b.fellowId),
  );
  for (const link of surplus) {
    const load = loads.get(link.tutorId)!;
    if (!assigned.has(link.fellowId) && load < snapshot.maximoPorTutor) {
      links.push(link);
      assigned.add(link.fellowId);
      loads.set(link.tutorId, load + 1);
    }
  }
  links.sort((a, b) => lexical(a.tutorId, b.tutorId) || lexical(a.fellowId, b.fellowId));
  const tutorResults: TutorAllocation[] = orderedTutors.map((tutor) => {
    const fellowCount = loads.get(tutor.id) ?? 0;
    const status = dismissed.has(tutor.id) ? 'dismissed' : fellowCount ? 'active' : 'below-minimum';
    const reason = !geolocated(tutor) ? 'Tutor sem coordenadas válidas; mínimo não atendido.'
      : status === 'dismissed' ? `Entre os ${snapshot.percentualDispensa * 100}% mais distantes do bolsista mais próximo, por distância geodésica.`
      : status === 'active' ? 'Mínimo completo atendido, respeitando raio e capacidade.'
      : !validFellows.length ? 'Sem bolsistas com coordenadas válidas para atender ao mínimo.'
      : !eligible.get(tutor.id)?.length ? 'Nenhum bolsista dentro do raio; mínimo não atendido.'
      : 'Bolsistas disponíveis insuficientes para reservar o mínimo completo.';
    return {
      tutorId: tutor.id,
      status,
      reason,
      fellowCount,
      // Métrica geográfica real, independente da preferência injetada no ranking.
      nearestFellowKm: nearest.get(tutor.id)!,
    };
  });
  const unassignedFellows: UnassignedFellow[] = orderedFellows
    .filter((fellow) => !assigned.has(fellow.id))
    .map((fellow) => {
      const candidates = validTutors.filter((tutor) =>
        eligible.get(tutor.id)!.some((link) => link.fellowId === fellow.id));
      const retained = candidates.filter((tutor) => !dismissed.has(tutor.id));
      const active = retained.filter((tutor) => loads.has(tutor.id));
      const reason = !geolocated(fellow) ? 'Bolsista sem coordenadas válidas.'
        : !validTutors.length ? 'Nenhum tutor com coordenadas válidas.'
        : !candidates.length ? 'Nenhum tutor dentro do raio máximo.'
        : !retained.length ? 'Todos os tutores candidatos foram dispensados.'
        : active.length && active.every((tutor) => loads.get(tutor.id)! >= snapshot.maximoPorTutor)
          ? 'Sem capacidade nos tutores ativos candidatos.'
          : 'Não foi possível completar o mínimo dos tutores candidatos.';
      return { fellowId: fellow.id, reason };
    });
  const result: AllocationResult = Object.freeze({
    config: snapshot,
    links: Object.freeze(links.map((link) => Object.freeze(link))),
    unassignedFellows: Object.freeze(unassignedFellows.map((fellow) => Object.freeze(fellow))),
    tutors: Object.freeze(tutorResults.map((tutor) => Object.freeze(tutor))),
    dismissedTutorIds: Object.freeze([...dismissed]),
    belowMinimumTutorIds: Object.freeze(tutorResults.filter((t) => t.status === 'below-minimum').map((t) => t.tutorId)),
    indicators: Object.freeze(indicatorsFor(links, tutorResults, unassignedFellows.length)),
    distribution: buildAllocationDistribution(tutorResults),
  });
  validateAllocationResult(result);
  return result;
}

/** Valida também resultados externos; nenhum estado parcial abaixo do mínimo é aceito. */
export function validateAllocationResult(result: AllocationResult): void {
  invariant(result && typeof result === 'object', 'resultado ausente.');
  validateConfig(result.config);
  invariant(
    Array.isArray(result.links) && Array.isArray(result.tutors) &&
      Array.isArray(result.unassignedFellows) && Array.isArray(result.dismissedTutorIds) &&
      Array.isArray(result.belowMinimumTutorIds),
    'coleções do resultado devem ser listas.',
  );
  const tutors = new Map<string, TutorAllocation>();
  for (const tutor of result.tutors) {
    invariant(tutor && validId(tutor.tutorId), 'tutor com id inválido.');
    invariant(!tutors.has(tutor.tutorId), `tutor duplicado: ${tutor.tutorId}.`);
    invariant(
      ['active', 'dismissed', 'below-minimum'].includes(tutor.status),
      `status inválido do tutor ${tutor.tutorId}.`,
    );
    invariant(
      Number.isInteger(tutor.fellowCount) && tutor.fellowCount >= 0 &&
        tutor.fellowCount <= result.config.maximoPorTutor,
      `carga inválida do tutor ${tutor.tutorId}.`,
    );
    invariant(
      tutor.nearestFellowKm === null ||
        (Number.isFinite(tutor.nearestFellowKm) && tutor.nearestFellowKm >= 0),
      `distância ao bolsista mais próximo inválida: ${tutor.tutorId}.`,
    );
    invariant(typeof tutor.reason === 'string' && tutor.reason.trim(), 'motivo do tutor ausente.');
    tutors.set(tutor.tutorId, tutor);
  }
  const fellows = new Set<string>();
  const loads = new Map<string, number>();
  const nearestLinked = new Map<string, number>();
  for (const link of result.links) {
    invariant(link && validId(link.fellowId) && validId(link.tutorId), 'vínculo com id inválido.');
    invariant(!tutors.has(link.fellowId), `id duplicado entre tutor e bolsista: ${link.fellowId}.`);
    invariant(tutors.has(link.tutorId), `tutor do vínculo não existe: ${link.tutorId}.`);
    invariant(!fellows.has(link.fellowId), `bolsista com vínculo duplicado: ${link.fellowId}.`);
    invariant(
      Number.isFinite(link.straightLineKm) && link.straightLineKm >= 0 &&
        link.straightLineKm <= result.config.raioMaxKm,
      `distância do vínculo inválida ou fora do raio: ${link.fellowId}.`,
    );
    fellows.add(link.fellowId);
    loads.set(link.tutorId, (loads.get(link.tutorId) ?? 0) + 1);
    nearestLinked.set(link.tutorId, Math.min(
      nearestLinked.get(link.tutorId) ?? Infinity, link.straightLineKm,
    ));
  }
  for (const tutor of tutors.values()) {
    const count = loads.get(tutor.tutorId) ?? 0;
    invariant(count === tutor.fellowCount, `carga diverge dos vínculos: ${tutor.tutorId}.`);
    invariant(
      tutor.status === 'active' ? count >= result.config.minimoPorTutor : count === 0,
      `mínimo/status inconsistente ou tutor dispensado com vínculos: ${tutor.tutorId}.`,
    );
    if (count) {
      invariant(
        tutor.nearestFellowKm !== null &&
          withinRadius(tutor.nearestFellowKm, nearestLinked.get(tutor.tutorId)!),
        `distância mais próxima inconsistente: ${tutor.tutorId}.`,
      );
    }
  }
  for (const fellow of result.unassignedFellows) {
    invariant(fellow && validId(fellow.fellowId), 'bolsista não alocado com id inválido.');
    invariant(!tutors.has(fellow.fellowId), `id duplicado entre tutor e bolsista: ${fellow.fellowId}.`);
    invariant(!fellows.has(fellow.fellowId), `bolsista repetido/alocado: ${fellow.fellowId}.`);
    invariant(typeof fellow.reason === 'string' && fellow.reason.trim(), 'motivo do bolsista ausente.');
    fellows.add(fellow.fellowId);
  }
  for (const [ids, status] of [
    [result.dismissedTutorIds, 'dismissed'],
    [result.belowMinimumTutorIds, 'below-minimum'],
  ] as const) {
    const unique = new Set(ids);
    invariant(unique.size === ids.length, `ids duplicados no status ${status}.`);
    invariant(
      ids.every((id) => tutors.get(id)?.status === status) &&
        result.tutors.filter((tutor) => tutor.status === status).length === ids.length,
      `lista de tutores inconsistente com status ${status}.`,
    );
  }
  const expected = indicatorsFor(result.links, result.tutors, result.unassignedFellows.length);
  invariant(result.indicators && result.indicators.tutorsByLoad, 'indicadores ausentes.');
  for (const key of [
    'allocatedFellows', 'unassignedFellows', 'activeTutors', 'dismissedTutors',
    'belowMinimumTutors', 'averageStraightLineKm', 'maximumStraightLineKm',
  ] as const) {
    invariant(result.indicators[key] === expected[key], `indicador inconsistente: ${key}.`);
  }
  for (const load of [1, 2, 3, 4] as const) {
    invariant(
      result.indicators.tutorsByLoad[load] === expected.tutorsByLoad[load],
      `indicador de carga ${load} inconsistente.`,
    );
  }
  validateAllocationDistribution(result.distribution, result.tutors);
}
