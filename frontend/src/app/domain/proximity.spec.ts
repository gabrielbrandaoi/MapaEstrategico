import { DEFAULT_ALLOCATION_CONFIG } from './allocation.models';
import type { Participant } from './models';
import { buildProximityPairs } from './proximity';

function participant(id: string, type: Participant['type'], latitude: number): Participant {
  return {
    id, type, name: `Participante sintético ${id}`,
    city: null, state: null, address: null, postalCode: null,
    sourceRow: 1,
    location: { latitude, longitude: 0, source: 'imported' },
  };
}

describe('raio padrão dos candidatos', () => {
  it('usa a mesma configuração geodésica da simulação', () => {
    const participants = [
      participant('t', 'tutor', 0),
      participant('b-dentro', 'fellow', 1.3),
      participant('b-fora', 'fellow', 1.4),
    ];
    const pairs = buildProximityPairs(participants);
    expect(pairs.map((pair) => pair.fellowId)).toEqual(['b-dentro']);
    expect(pairs.every((pair) => pair.straightLineKm <= DEFAULT_ALLOCATION_CONFIG.raioMaxKm))
      .toBe(true);
    expect(pairs[0].route).toBeNull();
  });

  it('preserva a possibilidade de fornecer um raio explícito', () => {
    const participants = [
      participant('t', 'tutor', 0),
      participant('b', 'fellow', 1.1),
    ];
    expect(buildProximityPairs(participants, 100)).toEqual([]);
    expect(buildProximityPairs(participants, 150)).toHaveLength(1);
  });
});
