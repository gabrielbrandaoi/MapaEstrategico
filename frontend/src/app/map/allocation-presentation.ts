import { simulateAllocation } from '../domain/allocation';
import {
  DEFAULT_ALLOCATION_CONFIG,
  type AllocationResult,
} from '../domain/allocation.models';
import type { Participant } from '../domain/models';
import type { PontoMapa, VinculoMapa } from '../domain/mapa.models';

export interface SimulationScenario {
  readonly minimum: 1 | 2;
  readonly result: AllocationResult | null;
  readonly error: string | null;
  readonly minimumKm: number | null;
}

/** Boundary to the domain: failures remain failures, never an empty successful allocation. */
export function simulationScenarios(
  participants: readonly Participant[],
): readonly SimulationScenario[] {
  const tutors = participants.filter((participant) => participant.type === 'tutor');
  const fellows = participants.filter((participant) => participant.type === 'fellow');
  return ([1, 2] as const).map((minimum) => {
    try {
      const result = simulateAllocation(tutors, fellows, {
        ...DEFAULT_ALLOCATION_CONFIG,
        minimoPorTutor: minimum,
      });
      return {
        minimum,
        result,
        error: null,
        minimumKm: result.links.reduce<number | null>(
          (smallest, link) => smallest === null
            ? link.straightLineKm : Math.min(smallest, link.straightLineKm),
          null,
        ),
      };
    } catch (error: unknown) {
      return {
        minimum,
        result: null,
        error: error instanceof Error ? error.message : 'Erro inesperado no domínio de alocação.',
        minimumKm: null,
      };
    }
  });
}

/** Presentation adapter only; never writes back into imported scenarios or participants. */
export function simulationPoints(
  participants: readonly Participant[],
  imported: readonly PontoMapa[],
  result: AllocationResult | null,
): readonly PontoMapa[] {
  const originals = new Map(imported.map((point) => [point.id, point]));
  const tutors = new Map(result?.tutors.map((tutor) => [tutor.tutorId, tutor]));
  const unassigned = new Map(result?.unassignedFellows.map((fellow) => [fellow.fellowId, fellow]));
  return participants.map((participant): PontoMapa => {
    const original = originals.get(participant.id);
    const tutor = tutors.get(participant.id);
    const fellow = unassigned.get(participant.id);
    const location = participant.location;
    return {
      id: participant.id,
      tipo: participant.type,
      nome: participant.name,
      municipio: participant.city,
      ibge6: original?.ibge6 ?? null,
      coordenada: location ? {
        latitude: location.latitude,
        longitude: location.longitude,
        origem: location.source === 'municipal-centroid' ? 'centroide-municipal' : 'importada',
        fonte: original?.coordenada?.fonte ?? 'Cadastro da sessão',
      } : null,
      cpfProvisorio: participant.identityUnverified ?? false,
      criterios: [],
      alertas: tutor && tutor.status !== 'active' ? [tutor.reason] : fellow ? [fellow.reason] : [],
      semBolsista: tutor?.fellowCount === 0,
    };
  });
}

export function simulationLinks(result: AllocationResult | null): readonly VinculoMapa[] {
  return result?.links.map((link): VinculoMapa => ({
    id: `simulation:${JSON.stringify([link.tutorId, link.fellowId])}`,
    tutorId: link.tutorId,
    bolsistaId: link.fellowId,
    kmPlanilha: null,
    distanciaGeodesicaKm: link.straightLineKm,
    criterio: 'Simulação geodésica',
    regra: `Mínimo ${result.config.minimoPorTutor}; máximo ${result.config.maximoPorTutor}; raio ${result.config.raioMaxKm} km`,
    segundaRodada: false,
    regra50Km: false,
    mesmoMunicipio: false,
    divergente: false,
    excede50Km: false,
    rota: null,
  })) ?? [];
}

export const TUTOR_STATUS_LABELS = {
  active: 'Ativo',
  dismissed: 'Dispensado',
  'below-minimum': 'Abaixo do mínimo',
} as const;
