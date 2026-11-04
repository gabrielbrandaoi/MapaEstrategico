import { haversineKm } from './distance';
import { Participant, ProximityPair } from './models';

export function buildProximityPairs(
  participants: readonly Participant[],
  maxStraightLineKm = 100,
): ProximityPair[] {
  const tutors = participants.filter(
    (participant) => participant.type === 'tutor' && participant.location,
  );
  const fellows = participants.filter(
    (participant) => participant.type === 'fellow' && participant.location,
  );
  const pairs: ProximityPair[] = [];

  for (const tutor of tutors) {
    for (const fellow of fellows) {
      if (!tutor.location || !fellow.location) {
        continue;
      }

      const straightLineKm = haversineKm(tutor.location, fellow.location);
      if (straightLineKm !== null && straightLineKm <= maxStraightLineKm) {
        pairs.push({
          tutorId: tutor.id,
          fellowId: fellow.id,
          straightLineKm,
          route: null,
        });
      }
    }
  }

  return pairs.sort((left, right) => left.straightLineKm - right.straightLineKm);
}
