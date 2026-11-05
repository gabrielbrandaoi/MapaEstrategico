import '@angular/compiler';
import type * as L from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Coordenada, PontoMapa, VinculoMapa } from '../domain/mapa.models';
import {
  agruparBolsistas, agruparBolsistasPorEstado, coordenadaValida, coordenadasSelecao,
  deslocamentoVisual, deslocamentosCoincidentes,
  metricasVinculo, validarBrasilGeoJson,
} from './leaflet-map.helpers';
import { BRASIL_BOUNDS, MAPA_CONFIG, regraVisual } from './mapa.config';
import { LeafletMapSession, type MapaState } from './leaflet-layers.service';

const coord = (latitude = -23, longitude = -46): Coordenada =>
  ({ latitude, longitude, origem: 'importada', fonte: 'fixture sintética' });
const ponto = (id: string, patch: Partial<PontoMapa> = {}): PontoMapa => ({
  id, tipo: 'fellow', nome: `Pessoa sintética ${id}`, municipio: 'Município sintético', ibge6: '123456',
  coordenada: coord(), cpfProvisorio: false, criterios: [], alertas: [], semBolsista: false, ...patch,
});
const vinculo = (patch: Partial<VinculoMapa> = {}): VinculoMapa => ({
  id: 'v', tutorId: 't', bolsistaId: 'b', kmPlanilha: 7, distanciaGeodesicaKm: 0,
  criterio: 'Sintético', regra: 'mesmo município', segundaRodada: false, regra50Km: false,
  mesmoMunicipio: true, divergente: false, excede50Km: false, rota: null, ...patch,
});
const geoJson = {
  type: 'FeatureCollection', features: [{
    type: 'Feature', properties: {}, geometry: {
      type: 'Polygon', coordinates: [[[-46, -23], [-45, -23], [-45, -22], [-46, -23]]],
    },
  }],
};

describe('helpers do adaptador Leaflet', () => {
  it.each([[91, 0], [-91, 0], [0, 181], [0, -181], [NaN, 0], [0, Infinity]])(
    'rejeita coordenada fora de WGS84 (%s,%s)', (lat, lon) =>
      expect(coordenadaValida(coord(lat, lon))).toBe(false),
  );
  it('aceita extremos e rejeita localização ausente', () => {
    expect(coordenadaValida(coord(90, -180))).toBe(true);
    expect(coordenadaValida(coord(-90, 180))).toBe(true);
    expect(coordenadaValida(null)).toBe(false);
  });
  it('agrupa por IBGE e não pelo nome; sem código não agrega municípios homônimos', () => {
    const points = [ponto('b'), ponto('a'), ponto('c', { ibge6: '654321' }),
      ponto('d', { ibge6: null }), ponto('e', { ibge6: null }),
      ponto('t', { tipo: 'tutor' }), ponto('invalid', { coordenada: coord(99) })];
    const result = agruparBolsistas(points);
    expect(result).toHaveLength(4);
    expect(result[0].pontos.map((p) => p.id)).toEqual(['a', 'b']);
    expect(result[0].coordenada).toEqual(points[1].coordenada);
    expect(agruparBolsistas([...points].reverse())).toEqual(result);
  });
  it('desloca só em pixels, de modo determinístico, sem alterar coordenadas originais', () => {
    const source = Object.freeze(coord());
    const p = ponto('x', { coordenada: source });
    const a = deslocamentoVisual(p.id, 14);
    expect(a).toEqual(deslocamentoVisual(p.id, 14));
    expect(a).not.toEqual(deslocamentoVisual('outro', 14));
    expect(Math.hypot(...a)).toBeCloseTo(14);
    expect(p.coordenada).toBe(source);
    expect(p.coordenada).toEqual(coord());
  });
  it('agrupa dois selecionados do mesmo IBGE em um símbolo e separa estados', () => {
    const points = [ponto('b1'), ponto('b2'), ponto('b3')];
    const groups = agruparBolsistasPorEstado(points, new Set(['b1', 'b2']), new Set(['b1', 'b2']));
    expect(groups).toHaveLength(2);
    expect(groups[0].estado).toBe('selecionado');
    expect(groups[0].pontos.map((p) => p.id)).toEqual(['b1', 'b2']);
    expect(groups[1].estado).toBe('sem-vinculo');
  });
  it('garante separação visual inclusive para IDs similares, estável com ordem invertida', () => {
    const ids = ['tutor:1', 'tutor:2', 'selecionado:ibge:240810'];
    const slots = deslocamentosCoincidentes(ids, 44);
    expect(slots).toEqual(deslocamentosCoincidentes([...ids].reverse(), 44));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = slots.get(ids[i])!;
        const b = slots.get(ids[j])!;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(43.99);
      }
    }
  });
  it('enquadra todos os vinculados reais, inclusive além de 2.500 km, nunca candidatos próximos', () => {
    const points = [ponto('t', { tipo: 'tutor', coordenada: coord(-30, -55) }),
      ponto('b', { coordenada: coord(4, -60) }), ponto('sem-vinculo', { coordenada: coord(-29, -55) })];
    expect(coordenadasSelecao(points, [vinculo()], 't')).toEqual([[-30, -55], [4, -60]]);
    expect(coordenadasSelecao(points, [vinculo()], null)).toEqual([]);
    expect(BRASIL_BOUNDS).toEqual([[-33.75, -73.99], [5.27, -28.85]]);
  });
  it('centraliza precedência das regras e raios em metros', () => {
    expect(regraVisual(vinculo({ segundaRodada: true, regra50Km: true }))).toBe('segunda');
    expect(regraVisual(vinculo({ regra50Km: true }))).toBe('cinquenta');
    expect(regraVisual(vinculo())).toBe('municipio');
    expect(regraVisual(vinculo({ mesmoMunicipio: false }))).toBe('desconhecida');
    expect(MAPA_CONFIG.radii).toEqual({ fifty: 50_000, hundred: 100_000 });
  });
  it('preserva as três métricas, zero e falha do provedor sem inventar distância rodoviária', () => {
    const values = metricasVinculo(vinculo({
      rota: { status: 'error', distanceMeters: null, durationSeconds: null,
        provider: 'Roteador sintético', calculatedAt: '', profile: 'driving', message: 'sem serviço' },
    }));
    expect(values).toEqual(['Planilha: 7 km', 'Geodésica: 0 km — mesmo município',
      'Rodoviária: erro (Roteador sintético): sem serviço']);
    expect(metricasVinculo(vinculo({ kmPlanilha: null }))[0]).toBe('Planilha: não informada');
    expect(metricasVinculo(vinculo())[2]).toBe('Rodoviária: não calculada');
  });
  it('valida o GeoJSON local e não aceita HTML, feições vazias ou contornos falsos', () => {
    expect(validarBrasilGeoJson(geoJson).features).toHaveLength(1);
    for (const invalid of ['<html>fallback SPA</html>', {}, { type: 'FeatureCollection', features: [] },
      { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }] },
      { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: {
        type: 'Polygon', coordinates: [[[200, 0], [1, 0], [1, 1], [200, 0]]],
      } }] }]) {
      expect(() => validarBrasilGeoJson(invalid)).toThrow();
    }
  });
});

/** Small behavioral Leaflet fake: no real tiles, geocoding, canvas or participant network requests. */
function fakeLeaflet() {
  function layer() {
    const events = new Map<string, () => void>();
    const result = {
      events, options: {} as L.MarkerOptions,
      off: vi.fn((name?: string) => {
        if (name) events.delete(name);
        else events.clear();
        return result;
      }),
      on: vi.fn((name: string, callback: () => void) => { events.set(name, callback); return result; }),
      remove: vi.fn(() => result), unbindPopup: vi.fn(() => result), unbindTooltip: vi.fn(() => result),
      bindPopup: vi.fn((_content: HTMLElement) => result),
      bindTooltip: vi.fn((_content: HTMLElement) => result),
      setLatLng: vi.fn((_position: L.LatLngTuple) => result),
      setIcon: vi.fn((_icon: L.Icon) => result),
      setZIndexOffset: vi.fn((_offset: number) => result),
      getElement: vi.fn(() => undefined),
      addTo: vi.fn((target: { addLayer?: (item: unknown) => void }) => { target.addLayer?.(result); return result; }),
    };
    return result;
  }
  function group() {
    const items: ReturnType<typeof layer>[] = [];
    const result = {
      ...layer(), items,
      addTo: vi.fn(() => result),
      addLayer: (item: ReturnType<typeof layer>) => items.push(item),
      removeLayer: vi.fn((item: ReturnType<typeof layer>) => {
        const index = items.indexOf(item);
        if (index >= 0) items.splice(index, 1);
        return result;
      }),
      eachLayer: (fn: (item: ReturnType<typeof layer>) => void) => items.forEach(fn),
      clearLayers: vi.fn(() => { items.length = 0; }),
    };
    return result;
  }
  const zoom = { scale: 1 };
  const map = {
    ...layer(), attributionControl: { addAttribution: vi.fn() },
    setMinZoom: vi.fn(), getZoom: vi.fn(() => 4),
    getBoundsZoom: vi.fn(() => 3.2), fitBounds: vi.fn(), invalidateSize: vi.fn(),
    project: (value: [number, number]) => ({ x: value[1] * zoom.scale, y: value[0] * zoom.scale }),
    unproject: (value: { x: number; y: number }) =>
      ({ lng: value.x / zoom.scale, lat: value.y / zoom.scale }),
  };
  const groups = Array.from({ length: 4 }, group);
  let groupIndex = 0;
  const api = {
    map: vi.fn(() => map), canvas: vi.fn(() => ({})),
    latLngBounds: vi.fn((coords: unknown) => ({ coords, pad: () => ({}) })),
    layerGroup: vi.fn(() => groups[groupIndex++]),
    point: (x: number, y: number) => ({ x, y }),
    marker: vi.fn((_position: L.LatLngTuple, _options: L.MarkerOptions) => layer()),
    circle: vi.fn(() => layer()), circleMarker: vi.fn(() => layer()),
    polyline: vi.fn(() => layer()), divIcon: vi.fn((options: unknown) => options),
    geoJSON: vi.fn(() => layer()), tileLayer: vi.fn(() => layer()),
  };
  return { api, map, groups, zoom };
}

function state(patch: Partial<MapaState> = {}): MapaState {
  return {
    pontos: [], vinculos: [], selectedTutorId: null,
    show50Km: false, show100Km: false, tilesEnabled: false,
    showTutors: true, showFellows: true, showLinks: true,
    alertsOnly: false, unallocatedOnly: false, resetKey: 0, ...patch,
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => geoJson }));
  const realBase = document.createElement('base');
  realBase.href = `${document.location.origin}/app/`;
  document.head.append(realBase);
  const host = document.createElement('div');
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: 320 },
    clientHeight: { configurable: true, value: 600 },
  });
  const fake = fakeLeaflet();
  const callbacks = { tutorSelected: vi.fn(), pontoSelected: vi.fn(), baseState: vi.fn() };
  const session = new LeafletMapSession(fake.api as unknown as typeof L, host, document, callbacks);
  realBase.remove();
  return { ...fake, host, callbacks, session };
}

describe('sessão Leaflet: lifecycle e camadas', () => {
  it('abre Brasil sem pontos; reutiliza mapa/grupos; minzoom é derivado do tamanho', () => {
    const { api, map, session } = setup();
    session.render(state());
    session.render(state({ show50Km: true }));
    expect(api.map).toHaveBeenCalledOnce();
    expect(api.map).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ preferCanvas: true }));
    expect(api.layerGroup).toHaveBeenCalledTimes(4);
    expect(map.fitBounds).toHaveBeenCalled();
    expect(map.getBoundsZoom).toHaveBeenCalledWith(expect.anything(), false, { x: 40, y: 40 });
    expect(map.setMinZoom).toHaveBeenCalledWith(3.2);
    expect(api.tileLayer).not.toHaveBeenCalled();
    expect(map.attributionControl.addAttribution).toHaveBeenCalledWith(
      'Fonte: IBGE — API de Malhas Geográficas, referência 2022. Simplificação: Mapa Estratégico.',
    );
    session.destroy();
  });
  it('usa só vínculos do tutor selecionado; círculos são L.circle em metros', () => {
    const { api, session } = setup();
    const pontos = [ponto('t', { tipo: 'tutor' }), ponto('b', { coordenada: coord(-3, -60) }),
      ponto('c', { coordenada: coord(-22, -45) })];
    session.render(state());
    session.render(state({ pontos, vinculos: [vinculo(), vinculo({ id: 'outro', tutorId: 'outro', bolsistaId: 'c' })],
      selectedTutorId: 't', show50Km: true, show100Km: true }));
    expect(api.polyline).toHaveBeenCalledTimes(1);
    expect(api.polyline).toHaveBeenCalledWith([[-23, -46], [-3, -60]], expect.objectContaining({ dashArray: '2 5' }));
    expect(api.circle).toHaveBeenCalledWith([-23, -46], expect.objectContaining({ radius: 50_000 }));
    expect(api.circle).toHaveBeenCalledWith([-23, -46], expect.objectContaining({ radius: 100_000 }));
    expect(api.latLngBounds).toHaveBeenCalledWith([[-23, -46], [-3, -60]]);
    session.destroy();
  });
  it('não impõe minzoom fixo que corte o Brasil em telas pequenas', () => {
    const { map, session } = setup();
    map.getBoundsZoom.mockReturnValue(-0.4);
    session.verBrasil();
    expect(map.setMinZoom).toHaveBeenLastCalledWith(-0.4);
    session.destroy();
  });
  it('reposiciona offsets em pixels no zoom sem recriar marcadores ou popups', () => {
    const { api, map, zoom, session } = setup();
    const pontos = [ponto('t', { tipo: 'tutor' }), ponto('b')];
    session.render(state({ pontos }));
    expect(api.marker).toHaveBeenCalledTimes(2);
    const markers = api.marker.mock.results.map(({ value }) => value);
    const popupCalls = markers.map((marker) => marker.bindPopup.mock.calls.length);

    zoom.scale = 2;
    map.events.get('zoomend')?.();

    expect(api.marker).toHaveBeenCalledTimes(2);
    markers.forEach((marker) => expect(marker.setLatLng).toHaveBeenCalledOnce());
    const positions = markers.map((marker) => marker.setLatLng.mock.calls.at(-1)?.[0]);
    const delta = Math.hypot(
      (positions[0]![0] - positions[1]![0]) * zoom.scale,
      (positions[0]![1] - positions[1]![1]) * zoom.scale,
    );
    expect(delta).toBeCloseTo(44, 5);
    expect(markers.map((marker) => marker.bindPopup.mock.calls.length)).toEqual(popupCalls);
    session.destroy();
  });
  it('reconcilia seleção por identidade e mantém os marcadores que não mudaram', () => {
    const { api, session, groups } = setup();
    const pontos = [
      ponto('t1', { tipo: 'tutor', coordenada: coord(-23, -46) }),
      ponto('t2', { tipo: 'tutor', coordenada: coord(-22, -45) }),
      ponto('t3', { tipo: 'tutor', coordenada: coord(-21, -44) }),
    ];
    session.render(state({ pontos, showFellows: false }));
    const original = api.marker.mock.results.map(({ value }) => value);
    const creations = api.marker.mock.calls.length;

    session.render(state({ pontos, selectedTutorId: 't1', showFellows: false }));

    expect(api.marker).toHaveBeenCalledTimes(creations);
    expect(groups[3].removeLayer).not.toHaveBeenCalled();
    expect(original.filter((marker) => marker.setIcon).length).toBe(3);
    expect(original.reduce((count, marker) => count + marker.setIcon.mock.calls.length, 0)).toBe(1);
    expect(original.reduce((count, marker) => count + marker.bindPopup.mock.calls.length, 0)).toBe(4);
    session.destroy();
  });
  it('atualiza posição, popup e estilo quando o mesmo ID recebe dados novos', () => {
    const { api, session } = setup();
    session.render(state({ pontos: [ponto('t', {
      tipo: 'tutor', nome: 'Nome anterior', coordenada: coord(-23, -46),
    })] }));
    const marker = api.marker.mock.results[0].value;
    const popupAnterior = marker.bindPopup.mock.calls[0][0] as HTMLElement;

    session.render(state({ pontos: [ponto('t', {
      tipo: 'tutor', nome: 'Nome atualizado', coordenada: coord(-12, -34),
      alertas: ['Alerta atualizado'],
    })] }));

    expect(api.marker).toHaveBeenCalledOnce();
    expect(marker.setLatLng).toHaveBeenLastCalledWith([-12, -34]);
    expect(marker.bindPopup).toHaveBeenCalledTimes(2);
    expect(popupAnterior.textContent).toContain('Nome anterior');
    expect(marker.bindPopup.mock.calls[1][0].textContent).toContain('Nome atualizado');
    expect(marker.bindPopup.mock.calls[1][0].textContent).toContain('Alerta atualizado');
    expect(marker.setIcon).toHaveBeenCalledOnce();
    session.destroy();
  });
  it('mantém os 1.000 marcadores em zoom e seleção sem criar/remover layers inalteradas', () => {
    const { api, map, zoom, groups, host, session } = setup();
    const pontos = Array.from({ length: 1_000 }, (_, index) => {
      const latitude = -30 + (index % 80) * 0.05;
      const longitude = -60 + Math.floor(index / 80) * 0.05;
      return index < 100
        ? ponto(`t${index}`, { tipo: 'tutor', coordenada: coord(latitude, longitude) })
        : ponto(`b${index}`, {
          ibge6: String(index).padStart(6, '0'),
          coordenada: coord(latitude, longitude),
        });
    });
    session.render(state({ pontos }));
    expect(api.marker).toHaveBeenCalledTimes(1_000);
    const created = api.marker.mock.calls.length;

    session.render(state({ pontos }));
    expect(api.marker).toHaveBeenCalledTimes(created);
    zoom.scale = 1.5;
    map.events.get('zoomend')?.();
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1_200 });
    session.resize();
    expect(api.marker).toHaveBeenCalledTimes(created);
    session.render(state({ pontos, selectedTutorId: 't0' }));

    expect(api.marker).toHaveBeenCalledTimes(created);
    expect(groups[3].removeLayer).not.toHaveBeenCalled();
    expect(api.marker.mock.results.reduce((count, result) =>
      count + result.value.setIcon.mock.calls.length, 0)).toBe(1);
    session.destroy();
  });
  it('ajusta aos pontos visíveis respeitando camadas e filtros', () => {
    const { api, map, session } = setup();
    const pontos = [
      ponto('t', { tipo: 'tutor', coordenada: coord(-23, -46) }),
      ponto('b', { coordenada: coord(-3, -60), alertas: ['Alerta sintético'] }),
      ponto('hidden', { coordenada: coord(-20, -40) }),
    ];
    session.render(state({ pontos, showTutors: false, alertsOnly: true }));

    session.ajustarAosPontos();

    expect(map.fitBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ coords: [[-3, -60]] }),
      expect.objectContaining({ maxZoom: MAPA_CONFIG.maxZoom, animate: false }),
    );
    expect(api.marker).toHaveBeenCalledOnce();
    session.destroy();
  });
  it('renderiza Natal: dois bolsistas selecionados no mesmo centroide como ◆ 2 sem ocultar tutor', () => {
    const { api, session } = setup();
    const original = Object.freeze(coord(-5.79, -35.21));
    const points = [
      ponto('t', { tipo: 'tutor', municipio: 'Natal', coordenada: original }),
      ponto('b1', { municipio: 'Natal', coordenada: original }),
      ponto('b2', { municipio: 'Natal', coordenada: original }),
    ];
    session.render(state({ pontos: points, selectedTutorId: 't',
      vinculos: [vinculo({ bolsistaId: 'b1' }), vinculo({ id: 'v2', bolsistaId: 'b2' })] }));
    expect(api.marker).toHaveBeenCalledTimes(2);
    const tutorPosition = api.marker.mock.calls[0][0];
    const fellowPosition = api.marker.mock.calls[1][0];
    expect(tutorPosition).not.toEqual(fellowPosition);
    // Fake map projection is identity: differences here measure the allocated screen pixels.
    expect(Math.hypot(tutorPosition[0] - fellowPosition[0], tutorPosition[1] - fellowPosition[1]))
      .toBeGreaterThanOrEqual(44);
    const groupIcon = api.divIcon.mock.calls[1][0] as L.DivIconOptions;
    expect((groupIcon.html as HTMLElement).textContent).toBe('◆ 2');
    const popup = api.marker.mock.results[1].value.bindPopup.mock.calls[0][0];
    expect(popup.querySelectorAll('button')).toHaveLength(2);
    expect(popup.textContent).toContain('2 bolsista(s) vinculado(s)');
    expect(points.every((p) => p.coordenada === original)).toBe(true);
    expect(original).toEqual(coord(-5.79, -35.21));
    session.destroy();
  });
  it('filtra alertas e sem vínculo sem excluir bolsistas não alocados por padrão', () => {
    const { api, groups, session } = setup();
    const pontos = [ponto('allocated'), ponto('free', { alertas: ['Alerta sintético'], ibge6: null })];
    session.render(state({ pontos, vinculos: [vinculo({ bolsistaId: 'allocated' })] }));
    expect(api.marker).toHaveBeenCalledTimes(2);
    const allocatedMarker = api.marker.mock.results
      .map(({ value }) => value)
      .find((marker) => !marker.bindPopup.mock.calls[0][0].textContent.includes('sem vínculo'))!;
    const freeMarker = api.marker.mock.results
      .map(({ value }) => value)
      .find((marker) => marker.bindPopup.mock.calls[0][0].textContent.includes('sem vínculo'))!;
    api.marker.mockClear();
    session.render(state({ pontos, vinculos: [vinculo({ bolsistaId: 'allocated' })],
      alertsOnly: true, unallocatedOnly: true }));
    expect(api.marker).not.toHaveBeenCalled();
    expect(groups[3].removeLayer).toHaveBeenCalledWith(allocatedMarker);
    expect(groups[3].items).toEqual([freeMarker]);
    expect(allocatedMarker.events.size).toBe(0);
    expect(allocatedMarker.unbindPopup).toHaveBeenCalledOnce();
    expect(freeMarker.bindPopup.mock.calls[0][0].textContent).toContain('sem vínculo');
    session.destroy();
  });
  it('usa DOM/textContent seguro e alterna o tutor no clique sem dados de CPF', () => {
    const { api, callbacks, session } = setup();
    const unsafe = '<img src=x onerror=alert(1)>';
    session.render(state({ pontos: [ponto('t', { tipo: 'tutor', nome: unsafe })] }));
    const first = api.marker.mock.results[0].value;
    const popup = first.bindPopup.mock.calls[0][0] as HTMLElement;
    expect(popup.querySelector('img')).toBeNull();
    expect(popup.textContent).toContain(unsafe);
    expect(popup.textContent).not.toContain('CPF');
    first.events.get('click')?.();
    expect(callbacks.tutorSelected).toHaveBeenLastCalledWith('t');
    session.render(state({ selectedTutorId: 't', pontos: [ponto('t', { tipo: 'tutor' })] }));
    expect(api.marker).toHaveBeenCalledOnce();
    first.events.get('click')?.();
    expect(callbacks.tutorSelected).toHaveBeenLastCalledWith(null);
    session.destroy();
  });
  it('mantém a instância ao reaparecer de aba oculta e limpa fetch/listeners/camadas', () => {
    const { api, map, host, session, groups } = setup();
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 0 });
    session.resize();
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 800 });
    session.resize();
    expect(map.invalidateSize).toHaveBeenCalledWith({ animate: false, pan: false });
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    session.destroy();
    session.destroy();
    expect(signal?.aborted).toBe(true);
    expect(map.off).toHaveBeenCalledOnce();
    expect(map.remove).toHaveBeenCalledOnce();
    expect(groups.every((g) => g.clearLayers.mock.calls.length > 0)).toBe(true);
    expect(api.map).toHaveBeenCalledOnce();
  });
  it('remove tiles com falha silenciosamente e só tenta novamente após novo consentimento', () => {
    const { api, callbacks, session } = setup();
    session.render(state({ tilesEnabled: true }));
    const tile = api.tileLayer.mock.results[0].value;
    tile.events.get('tileerror')?.();
    session.render(state({ tilesEnabled: true }));
    expect(api.tileLayer).toHaveBeenCalledOnce();
    expect(tile.remove).toHaveBeenCalledOnce();
    expect(callbacks.baseState).not.toHaveBeenCalledWith(false, expect.any(String));
    session.render(state({ tilesEnabled: false }));
    session.render(state({ tilesEnabled: true }));
    expect(api.tileLayer).toHaveBeenCalledTimes(2);
    session.destroy();
  });
  it('carrega asset relativo ao base href e reporta erro explícito, sem contorno substituto', async () => {
    const { api, callbacks, session } = setup();
    await session.loadBase();
    expect(fetch).toHaveBeenCalledWith(`${document.location.origin}/app/geo/br-ufs.geojson`,
      expect.objectContaining({ credentials: 'same-origin' }));
    expect(api.geoJSON).toHaveBeenCalledOnce();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    await session.loadBase();
    expect(callbacks.baseState).toHaveBeenLastCalledWith(false, 'Base local indisponível (HTTP 404).');
    expect(api.geoJSON).toHaveBeenCalledOnce();
    session.destroy();
  });
  it('propaga clique de fundo como desseleção e reset reenquadra Brasil', () => {
    const { api, map, callbacks, session } = setup();
    session.render(state());
    session.render(state({ selectedTutorId: 't', pontos: [ponto('t', { tipo: 'tutor' })] }));
    map.events.get('click')?.();
    expect(callbacks.tutorSelected).toHaveBeenLastCalledWith(null);
    session.render(state({ resetKey: 1 }));
    expect(map.fitBounds).toHaveBeenLastCalledWith(expect.objectContaining({ coords: BRASIL_BOUNDS }), expect.anything());
    expect(api.map).toHaveBeenCalledOnce();
    session.destroy();
  });
  it('libera popup, listeners e referências de layers ao destruir a sessão', () => {
    const { api, groups, map, session } = setup();
    session.render(state({ pontos: [ponto('t', { tipo: 'tutor' })] }));
    const marker = api.marker.mock.results[0].value;
    expect(marker.events.size).toBe(1);

    session.destroy();
    session.render(state({ pontos: [ponto('novo', { tipo: 'tutor' })] }));

    expect(marker.events.size).toBe(0);
    expect(marker.unbindPopup).toHaveBeenCalledOnce();
    expect(groups[3].items).toHaveLength(0);
    expect(api.marker).toHaveBeenCalledOnce();
    expect(map.off).toHaveBeenCalledOnce();
  });
});
