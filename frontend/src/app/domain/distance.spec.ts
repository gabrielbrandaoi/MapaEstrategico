import { classifyRoadDistance, haversineKm } from './distance';
import { Location, RoadRoute } from './models';
import { buildProximityPairs } from './proximity';

function location(latitude: number, longitude: number): Location {
  return { latitude, longitude, source: 'imported' };
}

function route(status: RoadRoute['status'], distanceMeters: number | null): RoadRoute {
  return {
    status,
    distanceMeters,
    durationSeconds: status === 'success' ? 3_600 : null,
    provider: 'OSRM de teste',
    calculatedAt: '2026-01-01T00:00:00.000Z',
    profile: 'driving',
    message: null,
  };
}

describe('geodesic and road distance semantics', () => {
  it.each([
    ['São Paulo–Rio de Janeiro', -23.5505, -46.6333, -22.9068, -43.1729, 350, 370],
    ['Brasília–Manaus', -15.7939, -47.8828, -3.119, -60.0217, 1900, 1960],
  ] as const)('checks public capital coordinates: %s', (_, lat1, lon1, lat2, lon2, min, max) => {
    const km = haversineKm(location(lat1, lon1), location(lat2, lon2));
    expect(km).not.toBeNull();
    expect(km!).toBeGreaterThan(min);
    expect(km!).toBeLessThan(max);
    expect(haversineKm(location(lat2, lon2), location(lat1, lon1))).toBeCloseTo(km!, 8);
  });

  it('handles poles, antipodes and near-antipodes without exceeding half a circumference', () => {
    const halfCircumference = Math.PI * 6371.0088;
    expect(haversineKm(location(0, 0), location(0, 180))).toBeCloseTo(halfCircumference, 6);
    expect(haversineKm(location(-90, 0), location(90, 0))).toBeCloseTo(halfCircumference, 6);
    const nearAntipodal = haversineKm(location(0.001, 0), location(-0.001, 179.999999));
    expect(nearAntipodal!).toBeGreaterThan(20000);
    expect(nearAntipodal!).toBeLessThanOrEqual(halfCircumference);
  });

  it.each([
    [NaN, 0], [Infinity, 0], [-Infinity, 0], [0, NaN], [0, Infinity],
    [-91, 0], [0, 181], [0, -181],
  ])('rejects invalid coordinates (%s, %s) in either endpoint', (lat, lon) => {
    expect(haversineKm(location(lat, lon), location(0, 0))).toBeNull();
    expect(haversineKm(location(0, 0), location(lat, lon))).toBeNull();
  });

  it('returns zero for coincident coordinates and rejects invalid locations', () => {
    expect(haversineKm(location(0, 0), location(0, 0))).toBe(0);
    expect(haversineKm(location(91, 0), location(0, 0))).toBeNull();
  });

  it('keeps straight-line pair screening separate from road bands', () => {
    const participants = [
      {
        id: 'tutor-1',
        type: 'tutor' as const,
        name: 'Pessoa sintética A',
        city: null,
        state: null,
        address: null,
        postalCode: null,
        location: location(0, 0),
        sourceRow: 2,
      },
      {
        id: 'fellow-1',
        type: 'fellow' as const,
        name: 'Pessoa sintética B',
        city: null,
        state: null,
        address: null,
        postalCode: null,
        location: location(0, 0.5),
        sourceRow: 3,
      },
    ];

    const pairs = buildProximityPairs(participants);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.straightLineKm).toBeGreaterThan(50);
    expect(pairs[0]?.straightLineKm).toBeLessThan(60);
    expect(pairs[0]?.route).toBeNull();
  });

  it.each([
    [50_000, 'within-50-km'],
    [50_001, '50-to-100-km'],
    [100_000, '50-to-100-km'],
    [100_001, 'over-100-km'],
  ] as const)('classifies %s road meters at the exact thresholds', (meters, expected) => {
    expect(classifyRoadDistance(route('success', meters))).toBe(expected);
  });

  it('never classifies a missing or unavailable route as zero distance', () => {
    expect(classifyRoadDistance(null)).toBe('not-calculated');
    expect(classifyRoadDistance(route('unavailable', null))).toBe('unavailable');
    expect(classifyRoadDistance(route('error', null))).toBe('error');
  });
});
