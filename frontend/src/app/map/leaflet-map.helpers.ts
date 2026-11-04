import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import type { Coordenada, PontoMapa, VinculoMapa } from '../domain/mapa.models';

export function coordenadaValida(value: Coordenada | null): value is Coordenada {
  return value !== null && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
    && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180;
}

export interface GrupoBolsistas {
  readonly chave: string;
  readonly pontos: readonly PontoMapa[];
  readonly coordenada: Coordenada;
}

export type EstadoGrupo = 'selecionado' | 'alocado' | 'sem-vinculo';

/** Municipal aggregation applies equally to highlighted and ordinary fellows. */
export function agruparBolsistasPorEstado(
  pontos: readonly PontoMapa[], selecionados: ReadonlySet<string>, alocados: ReadonlySet<string>,
): (GrupoBolsistas & { readonly estado: EstadoGrupo })[] {
  const estados: readonly EstadoGrupo[] = ['selecionado', 'alocado', 'sem-vinculo'];
  return estados.flatMap((estado) => agruparBolsistas(pontos.filter((p) => {
    const atual: EstadoGrupo = selecionados.has(p.id) ? 'selecionado'
      : alocados.has(p.id) ? 'alocado' : 'sem-vinculo';
    return atual === estado;
  })).map((grupo) => ({ ...grupo, chave: `${estado}:${grupo.chave}`, estado })));
}

/** Stable, collision-free slots in screen pixels, independent of input order. */
export function deslocamentosCoincidentes(
  ids: readonly string[], minimumSeparation: number,
): ReadonlyMap<string, readonly [number, number]> {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length < 2) return new Map(sorted.map((id) => [id, [0, 0] as const]));
  const radius = minimumSeparation / (2 * Math.sin(Math.PI / sorted.length));
  return new Map(sorted.map((id, index) => {
    const angle = index * 2 * Math.PI / sorted.length;
    return [id, [radius * Math.cos(angle), radius * Math.sin(angle)] as const];
  }));
}

/** No invented centroid: anchor is an actual source coordinate; all members remain in popup. */
export function agruparBolsistas(pontos: readonly PontoMapa[]): GrupoBolsistas[] {
  const grupos = new Map<string, PontoMapa[]>();
  for (const ponto of pontos) {
    if (ponto.tipo !== 'fellow' || !coordenadaValida(ponto.coordenada)) continue;
    const chave = ponto.ibge6 ? `ibge:${ponto.ibge6}` : `ponto:${ponto.id}`;
    const grupo = grupos.get(chave) ?? [];
    grupo.push(ponto);
    grupos.set(chave, grupo);
  }
  return Array.from(grupos, ([chave, membros]) => {
    const ordered = [...membros].sort((a, b) => a.id.localeCompare(b.id));
    return { chave, pontos: ordered, coordenada: ordered[0].coordenada! };
  }).sort((a, b) => a.chave.localeCompare(b.chave));
}

/** Screen-space displacement only. Never write these offsets to coordinates or distance inputs. */
export function deslocamentoVisual(id: string, radius: number): readonly [number, number] {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  const angle = (hash >>> 0) / 4294967296 * Math.PI * 2;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

export function coordenadasSelecao(
  pontos: readonly PontoMapa[], vinculos: readonly VinculoMapa[], tutorId: string | null,
): [number, number][] {
  const ids = new Set(vinculos.filter((v) => v.tutorId === tutorId).map((v) => v.bolsistaId));
  if (tutorId) ids.add(tutorId);
  return pontos.filter((p) => ids.has(p.id) && coordenadaValida(p.coordenada))
    .map((p) => [p.coordenada!.latitude, p.coordenada!.longitude]);
}

const km = (value: number | null): string => value !== null && Number.isFinite(value) && value >= 0
  ? `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km` : 'não informada';

export function metricasVinculo(v: VinculoMapa): readonly string[] {
  const rota = v.rota;
  const rodoviaria = rota?.status === 'success' && rota.distanceMeters !== null
    ? `${km(rota.distanceMeters / 1000)} (${rota.provider})`
    : rota ? `${rota.status === 'error' ? 'erro' : 'indisponível'} (${rota.provider})${rota.message ? `: ${rota.message}` : ''}`
      : 'não calculada';
  return [
    `Planilha: ${km(v.kmPlanilha)}`,
    `Geodésica: ${km(v.distanciaGeodesicaKm)}${v.mesmoMunicipio ? ' — mesmo município' : ''}`,
    `Rodoviária: ${rodoviaria}`,
  ];
}

function registro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function posicao(value: unknown): value is Position {
  return Array.isArray(value) && value.length >= 2
    && typeof value[0] === 'number' && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180
    && typeof value[1] === 'number' && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90
    && value.every((coordinate: unknown) => typeof coordinate === 'number' && Number.isFinite(coordinate));
}

function anel(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 4 || !value.every(posicao)) return false;
  const first: Position = value[0];
  const last: Position = value[value.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function poligono(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(anel);
}

/** Reject HTML fallbacks, invalid coordinates and non-polygon assets instead of drawing a fake outline. */
export function validarBrasilGeoJson(value: unknown): FeatureCollection<Polygon | MultiPolygon> {
  if (!registro(value) || value['type'] !== 'FeatureCollection'
    || !Array.isArray(value['features']) || value['features'].length === 0) {
    throw new Error('Base do Brasil inválida: esperado GeoJSON FeatureCollection não vazio.');
  }
  for (const feature of value['features']) {
    if (!registro(feature) || feature['type'] !== 'Feature' || !registro(feature['geometry'])) {
      throw new Error('Base do Brasil inválida: feição sem geometria.');
    }
    const geometry = feature['geometry'];
    const valid = geometry['type'] === 'Polygon' ? poligono(geometry['coordinates'])
      : geometry['type'] === 'MultiPolygon' && Array.isArray(geometry['coordinates'])
        && geometry['coordinates'].length > 0 && geometry['coordinates'].every(poligono);
    if (!valid) throw new Error('Base do Brasil inválida: polígonos ou coordenadas inválidos.');
  }
  // Every feature and every polygon position has been validated above.
  return value as unknown as FeatureCollection<Polygon | MultiPolygon>;
}
