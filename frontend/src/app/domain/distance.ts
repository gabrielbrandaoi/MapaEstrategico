import { Location, RoadDistanceBand, RoadRoute } from './models';

const EARTH_RADIUS_KM = 6_371.0088;

export function isValidLocation(location: Location): boolean {
  return (
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    location.longitude >= -180 &&
    location.longitude <= 180
  );
}

export function haversineKm(from: Location, to: Location): number | null {
  if (!isValidLocation(from) || !isValidLocation(to)) {
    return null;
  }

  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function classifyRoadDistance(route: RoadRoute | null): RoadDistanceBand {
  if (!route) {
    return 'not-calculated';
  }

  if (route.status === 'unavailable') {
    return 'unavailable';
  }

  if (route.status === 'error') {
    return 'error';
  }

  if (
    route.distanceMeters === null ||
    !Number.isFinite(route.distanceMeters) ||
    route.distanceMeters < 0
  ) {
    return 'error';
  }

  const distanceKm = route.distanceMeters / 1_000;
  if (distanceKm <= 50) {
    return 'within-50-km';
  }
  if (distanceKm <= 100) {
    return '50-to-100-km';
  }
  return 'over-100-km';
}
