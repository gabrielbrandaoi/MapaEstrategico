import { haversineKm } from './distance';
import { Participant, ProximityPair } from './models';

export interface DashboardStatistics {
  tutorCount: number;
  fellowCount: number;
  locatedCount: number;
  withoutCoordinatesCount: number;
  locatedFellowCount: number;
  geodesicWithin50Count: number;
  geodesicWithin100Count: number;
  averageNearestStraightLineKm: number | null;
  successfulRouteCount: number;
  averageRoadKm: number | null;
  maxRoadKm: number | null;
  fellowsWithRoadWithin50Count: number;
  fellowsWithMultipleNearbyTutorsCount: number;
}

export function calculateDashboardStatistics(
  participants: readonly Participant[],
  pairs: readonly ProximityPair[],
): DashboardStatistics {
  const tutors = participants.filter(
    (participant) => participant.type === 'tutor' && participant.location !== null,
  );
  const fellows = participants.filter((participant) => participant.type === 'fellow');
  const locatedFellows = fellows.filter((participant) => participant.location !== null);
  const nearestDistances: number[] = [];
  let geodesicWithin50Count = 0;
  let geodesicWithin100Count = 0;

  for (const fellow of locatedFellows) {
    const fellowLocation = fellow.location;
    if (!fellowLocation) {
      continue;
    }

    let nearestDistance: number | null = null;
    for (const tutor of tutors) {
      const tutorLocation = tutor.location;
      if (!tutorLocation) {
        continue;
      }

      const distance = haversineKm(tutorLocation, fellowLocation);
      if (distance !== null && (nearestDistance === null || distance < nearestDistance)) {
        nearestDistance = distance;
      }
    }

    if (nearestDistance === null) {
      continue;
    }

    nearestDistances.push(nearestDistance);
    if (nearestDistance <= 50) {
      geodesicWithin50Count += 1;
    }
    if (nearestDistance <= 100) {
      geodesicWithin100Count += 1;
    }
  }

  const nearbyCounts = new Map<string, number>();
  for (const pair of pairs) {
    nearbyCounts.set(pair.fellowId, (nearbyCounts.get(pair.fellowId) ?? 0) + 1);
  }

  const successfulRoutes = pairs.flatMap((pair) => {
    const distanceMeters = confirmedRoadDistanceMeters(pair);
    return distanceMeters === null ? [] : [distanceMeters / 1_000];
  });
  const fellowsWithRoadWithin50 = new Set(
    pairs.flatMap((pair) => {
      const distanceMeters = confirmedRoadDistanceMeters(pair);
      return distanceMeters !== null && distanceMeters <= 50_000 ? [pair.fellowId] : [];
    }),
  );
  return {
    tutorCount: participants.filter((participant) => participant.type === 'tutor').length,
    fellowCount: fellows.length,
    locatedCount: participants.filter((participant) => participant.location !== null).length,
    withoutCoordinatesCount: participants.filter((participant) => participant.location === null)
      .length,
    locatedFellowCount: locatedFellows.length,
    geodesicWithin50Count,
    geodesicWithin100Count,
    averageNearestStraightLineKm: nearestDistances.length > 0 ? average(nearestDistances) : null,
    successfulRouteCount: successfulRoutes.length,
    averageRoadKm: successfulRoutes.length > 0 ? average(successfulRoutes) : null,
    maxRoadKm: successfulRoutes.length > 0 ? Math.max(...successfulRoutes) : null,
    fellowsWithRoadWithin50Count: fellowsWithRoadWithin50.size,
    fellowsWithMultipleNearbyTutorsCount: [...nearbyCounts.values()].filter((count) => count > 1)
      .length,
  };
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function confirmedRoadDistanceMeters(pair: ProximityPair): number | null {
  const distanceMeters = pair.route?.distanceMeters;
  return pair.route?.status === 'success' &&
    distanceMeters !== null &&
    distanceMeters !== undefined &&
    Number.isFinite(distanceMeters) &&
    distanceMeters >= 0
    ? distanceMeters
    : null;
}
