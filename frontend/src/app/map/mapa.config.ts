import type { PathOptions } from 'leaflet';
import type { VinculoMapa } from '../domain/mapa.models';
import { resolveCssToken } from './allocation-palette';

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
  radii: { fifty: 50_000, reference: 130_000 },
  base: {
    get color() { return resolveCssToken('--color-muted'); },
    weight: 1,
    get fillColor() { return resolveCssToken('--color-grid'); },
    fillOpacity: 0.5,
  } satisfies PathOptions,
  tutor: {
    get normal() { return resolveCssToken('--color-tutor'); },
    get alert() { return resolveCssToken('--color-accent'); },
    get empty() { return resolveCssToken('--color-unassigned'); },
    get selected() { return resolveCssToken('--color-tutor'); },
  },
  fellow: {
    get normal() { return resolveCssToken('--color-fellow'); },
    get selected() { return resolveCssToken('--color-fellow'); },
    get unallocated() { return resolveCssToken('--color-unassigned'); },
  },
  rules: {
    segunda: { get color() { return resolveCssToken('--color-dismissed'); }, weight: 1.5, dashArray: '8 4' },
    cinquenta: { get color() { return resolveCssToken('--color-accent'); }, weight: 1.5, dashArray: '4 4' },
    municipio: { get color() { return resolveCssToken('--color-fellow'); }, weight: 1.5, dashArray: '2 5' },
    desconhecida: { get color() { return resolveCssToken('--color-muted'); }, weight: 1.5, dashArray: '6 6' },
  } satisfies Record<string, PathOptions>,
  circles: {
    fifty: { get color() { return resolveCssToken('--color-accent'); }, weight: 1, fillOpacity: 0.025 },
    reference: { get color() { return resolveCssToken('--color-muted'); }, weight: 1, fillOpacity: 0.015, dashArray: '6 5' },
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
  { simbolo: 'T', texto: 'Tutor da base importada, sem alerta identificado (não é resultado de simulação)', get cor() { return MAPA_CONFIG.tutor.normal; } },
  { simbolo: 'T!', texto: 'Tutor com alerta nos dados importados; selecione para consultar o motivo', get cor() { return MAPA_CONFIG.tutor.alert; } },
  { simbolo: 'T∅', texto: 'Tutor sem bolsistas nos vínculos importados; não equivale a dispensa na simulação', get cor() { return MAPA_CONFIG.tutor.empty; } },
  { simbolo: '●', texto: 'Bolsistas agrupados por município (número = quantidade)', get cor() { return MAPA_CONFIG.fellow.normal; } },
  { simbolo: '◆ n', texto: 'Bolsistas vinculados ao tutor selecionado, agrupados por município', get cor() { return MAPA_CONFIG.fellow.selected; } },
  { simbolo: '○', texto: 'Bolsista sem vínculo informado na planilha (não é diagnóstico de distância ou falta de vagas)', get cor() { return MAPA_CONFIG.fellow.unallocated; } },
  { simbolo: '━ ━', texto: 'Vínculo identificado na planilha como segunda rodada; não confirma rota rodoviária', get cor() { return MAPA_CONFIG.rules.segunda.color; } },
  { simbolo: '┄┄', texto: 'Vínculo cuja regra importada faz referência a 50 km; não confirma distância por estrada', get cor() { return MAPA_CONFIG.rules.cinquenta.color; } },
  { simbolo: '···', texto: 'Vínculo identificado como mesmo município; não implica endereços coincidentes', get cor() { return MAPA_CONFIG.rules.municipio.color; } },
  { simbolo: '╌╌', texto: 'Vínculo importado com regra não reconhecida; consulte os avisos da importação', get cor() { return MAPA_CONFIG.rules.desconhecida.color; } },
] as const;
