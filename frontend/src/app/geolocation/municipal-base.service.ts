import { Inject, Injectable, InjectionToken } from '@angular/core';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { Coordenada } from '../domain/mapa.models';

export type GeoAssetReader = (relativePath: string) => Promise<unknown>;
export type EstadoBase = 'nao-carregada' | 'carregando' | 'pronta' | 'parcial' | 'erro';
export type ContornoBrasil = FeatureCollection<Polygon | MultiPolygon>;

/** Only same-origin static assets. No remote geocoder, tiles, or personal data. */
export const GEO_ASSET_READER = new InjectionToken<GeoAssetReader>('GEO_ASSET_READER', {
  providedIn: 'root',
  factory: () => async (path: string): Promise<unknown> => {
    const url = new URL(path, document.baseURI);
    if (url.origin !== window.location.origin) {
      throw new Error('A base geográfica deve ser da mesma origem.');
    }
    const response = await fetch(url, {
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Asset geográfico indisponível.');
    return response.json() as Promise<unknown>;
  },
});

export function coordenadaValida(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function registro(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** An invalid entry invalidates the asset; never silently accept a partial base. */
export function validarCentroides(value: unknown): ReadonlyMap<string, Coordenada> {
  if (!registro(value) || Object.keys(value).length === 0) {
    throw new Error('Base municipal vazia ou inválida.');
  }
  const result = new Map<string, Coordenada>();
  for (const [ibge6, pair] of Object.entries(value)) {
    if (!/^\d{6}$/.test(ibge6) || !Array.isArray(pair) || pair.length !== 2 ||
        typeof pair[0] !== 'number' || typeof pair[1] !== 'number' ||
        !coordenadaValida(pair[0], pair[1]) ||
        pair[0] < -34 || pair[0] > 6 || pair[1] < -74 || pair[1] > -28) {
      throw new Error('Base municipal com código ou coordenada inválida/invertida.');
    }
    result.set(ibge6, Object.freeze({
      latitude: pair[0], longitude: pair[1], origem: 'centroide-municipal',
      fonte: 'IBGE · malha municipal 2022 · centroide de área LAEA esférica (não sede)',
    }));
  }
  return result;
}

function anelValido(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 4) return false;
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2 ||
        typeof point[0] !== 'number' || typeof point[1] !== 'number' ||
        !coordenadaValida(point[1], point[0])) return false;
  }
  const first: unknown = value[0], last: unknown = value[value.length - 1];
  return Array.isArray(first) && Array.isArray(last) &&
    first[0] === last[0] && first[1] === last[1];
}

function poligonoValido(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(anelValido);
}

export function validarContorno(value: unknown): ContornoBrasil {
  if (!registro(value) || value['type'] !== 'FeatureCollection' ||
      !Array.isArray(value['features']) || value['features'].length === 0) {
    throw new Error('Contorno geográfico inválido.');
  }
  for (const feature of value['features']) {
    if (!registro(feature) || feature['type'] !== 'Feature' ||
        !registro(feature['geometry'])) throw new Error('Feição geográfica inválida.');
    const geometry = feature['geometry'];
    const coordinates = geometry['coordinates'];
    const valid = geometry['type'] === 'Polygon' ? poligonoValido(coordinates)
      : geometry['type'] === 'MultiPolygon' && Array.isArray(coordinates) &&
        coordinates.length > 0 && coordinates.every(poligonoValido);
    if (!valid) throw new Error('Geometria geográfica inválida.');
  }
  return value as unknown as ContornoBrasil;
}

@Injectable({ providedIn: 'root' })
export class MunicipalBaseService {
  private centroides: ReadonlyMap<string, Coordenada> | null = null;
  private contorno: ContornoBrasil | null = null;
  private pendente: Promise<void> | null = null;
  private estadoAtual: EstadoBase = 'nao-carregada';
  private falhasAtuais: readonly string[] = [];

  constructor(@Inject(GEO_ASSET_READER) private readonly reader: GeoAssetReader) {}

  get estado(): EstadoBase { return this.estadoAtual; }
  get falhas(): readonly string[] { return this.falhasAtuais; }

  carregar(): Promise<void> {
    if (this.pendente) return this.pendente;
    if (this.estadoAtual === 'pronta') return Promise.resolve();
    this.estadoAtual = 'carregando';
    const falhas: string[] = [];
    // Independent resources: loss of centroids must not suppress the Brazil/UF map.
    const centroides = this.centroides ? Promise.resolve() :
      Promise.resolve().then(() => this.reader('geo/municipal-centroids.json'))
        .then(value => { this.centroides = validarCentroides(value); })
        .catch(() => { falhas.push('Base municipal indisponível ou inválida (geo/municipal-centroids.json).'); });
    const contorno = this.contorno ? Promise.resolve() :
      Promise.resolve().then(() => this.reader('geo/br-ufs.geojson'))
        .then(value => { this.contorno = validarContorno(value); })
        .catch(() => { falhas.push('Contorno Brasil/UF indisponível ou inválido (geo/br-ufs.geojson).'); });
    this.pendente = Promise.all([centroides, contorno]).then(() => {
      this.falhasAtuais = Object.freeze(falhas.sort());
      this.estadoAtual = this.centroides && this.contorno ? 'pronta'
        : this.centroides || this.contorno ? 'parcial' : 'erro';
    }).finally(() => { this.pendente = null; });
    return this.pendente;
  }

  resolver(ibge6: string): Coordenada | null {
    if (!/^\d{6}$/.test(ibge6)) return null;
    return this.centroides?.get(ibge6) ?? null;
  }

  geojson(): ContornoBrasil | null { return this.contorno; }
}
