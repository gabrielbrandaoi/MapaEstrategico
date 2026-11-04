import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, tap, timeout } from 'rxjs';
import { isValidLocation } from '../domain/distance';
import { Location, RoadRoute } from '../domain/models';
import { RoutingProvider } from './routing-provider';

const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/driving';
const ROUTE_TIMEOUT_MS = 15_000;
const PROVIDER_NAME = 'OSRM público';

@Injectable({ providedIn: 'root' })
export class OsrmRoutingService implements RoutingProvider {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, RoadRoute>();

  route(from: Location, to: Location): Observable<RoadRoute> {
    if (!isValidLocation(from) || !isValidLocation(to)) {
      return of(createRoute('error', null, null, 'As coordenadas do par são inválidas.'));
    }

    const key = routeCacheKey(from, to);
    const cached = this.cache.get(key);
    if (cached) {
      return of(cached);
    }

    const coordinates = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
    const url = `${OSRM_BASE_URL}/${coordinates}?overview=false&steps=false`;

    return this.http.get<unknown>(url).pipe(
      timeout({ first: ROUTE_TIMEOUT_MS }),
      map(parseOsrmResponse),
      tap((route) => {
        if (route.status === 'success') {
          this.cache.set(key, route);
        }
      }),
      catchError((error: unknown) =>
        of(createRoute('error', null, null, describeRoutingError(error))),
      ),
    );
  }
}

export function parseOsrmResponse(payload: unknown): RoadRoute {
  if (!isRecord(payload)) {
    return createRoute('error', null, null, 'Resposta inválida do roteador.');
  }

  const code = payload['code'];
  if (code === 'NoRoute' || code === 'NoSegment' || code === 'NoMatch') {
    return createRoute(
      'unavailable',
      null,
      null,
      'O roteador não encontrou uma rota para este par.',
    );
  }

  if (code !== 'Ok') {
    return createRoute('error', null, null, 'O roteador retornou uma resposta inesperada.');
  }

  const routes = payload['routes'];
  const firstRoute = Array.isArray(routes) ? routes[0] : undefined;
  if (!isRecord(firstRoute)) {
    return createRoute(
      'unavailable',
      null,
      null,
      'O roteador não retornou uma rota para este par.',
    );
  }

  const distanceMeters = firstRoute['distance'];
  const durationSeconds = firstRoute['duration'];
  if (
    typeof distanceMeters !== 'number' ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0 ||
    typeof durationSeconds !== 'number' ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0
  ) {
    return createRoute(
      'error',
      null,
      null,
      'A resposta do roteador não contém distância e duração válidas.',
    );
  }

  return createRoute('success', distanceMeters, durationSeconds, null);
}

function createRoute(
  status: RoadRoute['status'],
  distanceMeters: number | null,
  durationSeconds: number | null,
  message: string | null,
): RoadRoute {
  return {
    status,
    distanceMeters,
    durationSeconds,
    provider: PROVIDER_NAME,
    calculatedAt: new Date().toISOString(),
    profile: 'driving',
    message,
  };
}

function routeCacheKey(from: Location, to: Location): string {
  return [
    String(from.latitude),
    String(from.longitude),
    String(to.latitude),
    String(to.longitude),
  ].join(',');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function describeRoutingError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'Não foi possível conectar ao roteador.';
    }
    if (error.status === 429) {
      return 'O roteador limitou as solicitações; tente novamente mais tarde.';
    }
    if (error.status >= 500) {
      return 'O roteador está indisponível no momento.';
    }
    return `O roteador respondeu com erro HTTP ${error.status}.`;
  }

  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'O cálculo da rota excedeu o tempo limite.';
  }

  return 'O cálculo da rota falhou.';
}
