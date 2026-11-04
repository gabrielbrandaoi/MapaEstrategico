import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Location, RoadRoute } from '../domain/models';

export interface RoutingProvider {
  route(from: Location, to: Location): Observable<RoadRoute>;
}

export const ROUTING_PROVIDER = new InjectionToken<RoutingProvider>('ROUTING_PROVIDER');
