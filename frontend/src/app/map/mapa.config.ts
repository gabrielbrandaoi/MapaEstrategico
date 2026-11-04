import type { PathOptions } from 'leaflet';
import type { VinculoMapa } from '../domain/mapa.models';

/** WGS84: latitude/longitude, never router longitude/latitude. */
export const BRASIL_BOUNDS: [[number, number], [number, number]] = [
  [-33.75, -73.99],
  [5.27, -28.85],
];

export const MAPA_CONFIG = {
  geographicBase: {
    assetPath: 'geo/br-ufs.geojson',
    referenceYear: 2022,
    attribution: 'Fonte: IBGE — API de Malhas Geográficas, referência 2022. Simplificação: Mapa Estratégico.',
  },
  padding: 20,
  maxZoom: 18,
  selectedMaxZoom: 11,
  visualJitterPixels: 14,
  coincidentMarkerSeparationPixels: 44,
  radii: { fifty: 50_000, hundred: 100_000 },
  base: {
    color: '#526b73', weight: 1, fillColor: '#e5eee9', fillOpacity: 0.7,
  } satisfies PathOptions,
  tutor: { normal: '#174e87', alert: '#a32a25', empty: '#764a13', selected: '#142f67' },
  fellow: { normal: '#137165', selected: '#673ab7', unallocated: '#656575' },
  rules: {
    segunda: { color: '#8b3fc2', weight: 3, dashArray: '8 4' },
    cinquenta: { color: '#ba6015', weight: 3, dashArray: '4 4' },
    municipio: { color: '#14796c', weight: 3, dashArray: '2 5' },
    desconhecida: { color: '#5d6470', weight: 2, dashArray: '6 6' },
  } satisfies Record<string, PathOptions>,
  circles: {
    fifty: { color: '#b36916', weight: 1.5, fillOpacity: 0.06 },
    hundred: { color: '#745129', weight: 1.5, fillOpacity: 0.03, dashArray: '6 5' },
  } satisfies Record<string, PathOptions>,
} as const;

export type RegraVisual = keyof typeof MAPA_CONFIG.rules;

export function regraVisual(vinculo: VinculoMapa): RegraVisual {
  if (vinculo.segundaRodada) return 'segunda';
  if (vinculo.regra50Km) return 'cinquenta';
  if (vinculo.mesmoMunicipio) return 'municipio';
  return 'desconhecida';
}

export const MAPA_LEGENDA = [
  { simbolo: 'T', texto: 'Tutor', cor: MAPA_CONFIG.tutor.normal },
  { simbolo: 'T!', texto: 'Tutor com alerta', cor: MAPA_CONFIG.tutor.alert },
  { simbolo: 'T∅', texto: 'Tutor sem bolsista', cor: MAPA_CONFIG.tutor.empty },
  { simbolo: '●', texto: 'Bolsistas agrupados por município (número = quantidade)', cor: MAPA_CONFIG.fellow.normal },
  { simbolo: '◆ n', texto: 'Bolsistas vinculados ao tutor selecionado, agrupados por município', cor: MAPA_CONFIG.fellow.selected },
  { simbolo: '○', texto: 'Bolsista sem vínculo', cor: MAPA_CONFIG.fellow.unallocated },
  { simbolo: '━ ━', texto: 'Segunda rodada', cor: MAPA_CONFIG.rules.segunda.color },
  { simbolo: '┄┄', texto: 'Regra de 50 km', cor: MAPA_CONFIG.rules.cinquenta.color },
  { simbolo: '···', texto: 'Mesmo município', cor: MAPA_CONFIG.rules.municipio.color },
  { simbolo: '╌╌', texto: 'Regra desconhecida', cor: MAPA_CONFIG.rules.desconhecida.color },
] as const;
