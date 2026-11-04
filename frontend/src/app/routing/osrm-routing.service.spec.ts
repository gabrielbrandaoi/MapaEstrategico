import { parseOsrmResponse } from './osrm-routing.service';

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Location, RoadRoute } from '../domain/models';
import { OsrmRoutingService } from './osrm-routing.service';

const from: Location = { latitude: 1, longitude: 2, source: 'imported' };
const to: Location = { latitude: 3, longitude: 4, source: 'imported' };

describe('OSRM response validation', () => {
  it('accepts a complete route without changing road units', () => {
    const result = parseOsrmResponse({
      code: 'Ok',
      routes: [{ distance: 51_250, duration: 3_600 }],
    });

    expect(result.status).toBe('success');
    expect(result.distanceMeters).toBe(51_250);
    expect(result.durationSeconds).toBe(3_600);
  });

  it('represents no route as unavailable, never as zero', () => {
    const result = parseOsrmResponse({ code: 'NoRoute', routes: [] });

    expect(result.status).toBe('unavailable');
    expect(result.distanceMeters).toBeNull();
    expect(result.durationSeconds).toBeNull();
  });

  it('rejects incomplete or malformed success responses', () => {
    const result = parseOsrmResponse({
      code: 'Ok',
      routes: [{ distance: 1200 }],
    });

    expect(result.status).toBe('error');
    expect(result.distanceMeters).toBeNull();
    expect(result.message).toContain('válidas');
  });
});

describe('OSRM routing adapter', () => {
  let service: OsrmRoutingService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OsrmRoutingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends longitude,latitude in the route URL and returns road meters', () => {
    let result: RoadRoute | undefined;
    service.route(from, to).subscribe((route) => (result = route));

    const request = http.expectOne(
      'https://router.project-osrm.org/route/v1/driving/2,1;4,3?overview=false&steps=false',
    );
    expect(request.request.method).toBe('GET');
    request.flush({ code: 'Ok', routes: [{ distance: 5_200, duration: 600 }] });

    expect(result?.status).toBe('success');
    expect(result?.distanceMeters).toBe(5_200);
  });

  it('surfaces HTTP rate limits as an explicit error state', () => {
    let result: RoadRoute | undefined;
    service.route(from, to).subscribe((route) => (result = route));

    const request = http.expectOne(
      'https://router.project-osrm.org/route/v1/driving/2,1;4,3?overview=false&steps=false',
    );
    request.flush({ message: 'rate limit' }, { status: 429, statusText: 'Too Many Requests' });

    expect(result?.status).toBe('error');
    expect(result?.distanceMeters).toBeNull();
    expect(result?.message).toContain('limitou');
  });

  it('does not cache an unavailable route so a manual retry can run', () => {
    service.route(from, to).subscribe();
    http
      .expectOne(
        'https://router.project-osrm.org/route/v1/driving/2,1;4,3?overview=false&steps=false',
      )
      .flush({ code: 'NoRoute', routes: [] });

    let result: RoadRoute | undefined;
    service.route(from, to).subscribe((route) => (result = route));
    http
      .expectOne(
        'https://router.project-osrm.org/route/v1/driving/2,1;4,3?overview=false&steps=false',
      )
      .flush({ code: 'Ok', routes: [{ distance: 4_000, duration: 500 }] });

    expect(result?.status).toBe('success');
  });
});
