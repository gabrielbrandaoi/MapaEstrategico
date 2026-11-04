import { calculateDashboardStatistics } from './dashboard-metrics';
import { Participant, ProximityPair, RoadRoute } from './models';
import { buildProximityPairs } from './proximity';

describe('calculateDashboardStatistics', () => {
  it('counts unique coverage and uses successful road routes only', () => {
    const participants = [
      participant('tutor-1', 'tutor', 0.2),
      participant('tutor-2', 'tutor', 1),
      participant('fellow-1', 'fellow', 0.5),
      participant('fellow-2', 'fellow', 1.5),
      participant('fellow-3', 'fellow', null),
    ];
    const pairs = buildProximityPairs(participants).map((pair) => ({
      ...pair,
      route:
        pair.tutorId === 'tutor-1'
          ? roadRoute('success', 50_000)
          : pair.fellowId === 'fellow-2'
            ? roadRoute('success', 120_000)
            : roadRoute('error', null),
    }));

    const statistics = calculateDashboardStatistics(participants, pairs);

    expect(statistics).toEqual({
      tutorCount: 2,
      fellowCount: 3,
      locatedCount: 4,
      withoutCoordinatesCount: 1,
      locatedFellowCount: 2,
      geodesicWithin50Count: 1,
      geodesicWithin100Count: 2,
      averageNearestStraightLineKm: expect.any(Number),
      successfulRouteCount: 2,
      averageRoadKm: 85,
      maxRoadKm: 120,
      fellowsWithRoadWithin50Count: 1,
      fellowsWithMultipleNearbyTutorsCount: 1,
    });
    expect(statistics.averageNearestStraightLineKm).toBeCloseTo(44.5, 0);
  });

  it('returns null road and distance averages when none can be calculated', () => {
    const fellow = participant('fellow-1', 'fellow', 0);

    expect(calculateDashboardStatistics([fellow], [])).toEqual({
      tutorCount: 0,
      fellowCount: 1,
      locatedCount: 1,
      withoutCoordinatesCount: 0,
      locatedFellowCount: 1,
      geodesicWithin50Count: 0,
      geodesicWithin100Count: 0,
      averageNearestStraightLineKm: null,
      successfulRouteCount: 0,
      averageRoadKm: null,
      maxRoadKm: null,
      fellowsWithRoadWithin50Count: 0,
      fellowsWithMultipleNearbyTutorsCount: 0,
    });
  });

  it('ignores invalid distances reported with a success status', () => {
    const tutor = participant('tutor-1', 'tutor', 0);
    const fellow = participant('fellow-1', 'fellow', 0.1);
    const pairs: ProximityPair[] = [
      {
        tutorId: tutor.id,
        fellowId: fellow.id,
        straightLineKm: 11,
        route: roadRoute('success', Number.NaN),
      },
    ];
    const statistics = calculateDashboardStatistics([tutor, fellow], pairs);

    expect(statistics.successfulRouteCount).toBe(0);
    expect(statistics.averageRoadKm).toBeNull();
    expect(statistics.maxRoadKm).toBeNull();
    expect(statistics.fellowsWithRoadWithin50Count).toBe(0);
  });
});

function participant(id: string, type: Participant['type'], longitude: number | null): Participant {
  return {
    id,
    type,
    name: id,
    city: null,
    state: null,
    address: null,
    postalCode: null,
    location: longitude === null ? null : { latitude: 0, longitude, source: 'imported' },
    sourceRow: 1,
  };
}

function roadRoute(status: RoadRoute['status'], distanceMeters: number | null): RoadRoute {
  return {
    status,
    distanceMeters,
    durationSeconds: status === 'success' ? 3_600 : null,
    provider: 'Test fixture',
    calculatedAt: '2026-01-01T00:00:00.000Z',
    profile: 'driving',
    message: null,
  };
}
