import type { Participant } from '../domain/models';
import { simulationLinks, simulationPoints, simulationScenarios } from './allocation-presentation';

function participant(id: string, type: Participant['type']): Participant {
  return {
    id, type, name: `Participante sintético ${id}`,
    city: 'Município sintético', state: null, address: null, postalCode: null,
    sourceRow: 1, identityUnverified: true,
    location: { latitude: -20, longitude: -40, source: 'municipal-centroid' },
  };
}

describe('adaptação dos cenários para apresentação', () => {
  it('mantém erros explícitos nos dois cenários em vez de resultados vazios de sucesso', () => {
    const duplicated = participant('t', 'tutor');
    const scenarios = simulationScenarios([duplicated, duplicated]);
    expect(scenarios.map((scenario) => scenario.minimum)).toEqual([1, 2]);
    expect(scenarios.every((scenario) =>
      scenario.result === null && !!scenario.error && scenario.minimumKm === null)).toBe(true);
  });

  it('preserva identidade e origem municipal sem inventar métricas da planilha ou estrada', () => {
    const participants = [
      participant('t1', 'tutor'), participant('t2', 'tutor'),
      participant('b1', 'fellow'), participant('b2', 'fellow'),
    ];
    const snapshot = structuredClone(participants);
    const result = simulationScenarios(participants)[1].result;
    if (!result) throw new Error('Cenário sintético inválido.');
    const links = simulationLinks(result);
    expect(links).toHaveLength(2);
    expect(links.every((link) =>
      link.kmPlanilha === null && link.rota === null && link.distanciaGeodesicaKm === 0)).toBe(true);
    const points = simulationPoints(participants, [], result);
    expect(points.every((point) =>
      point.cpfProvisorio && point.coordenada?.origem === 'centroide-municipal')).toBe(true);
    expect(points.find((point) => point.id === result.dismissedTutorIds[0])?.semBolsista)
      .toBe(true);
    expect(participants).toEqual(snapshot);
  });
});
