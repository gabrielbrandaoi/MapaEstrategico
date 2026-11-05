import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import type * as L from 'leaflet';
import type { PontoMapa, VinculoMapa } from '../domain/mapa.models';
import {
  agruparBolsistasPorEstado, coordenadaValida, coordenadasSelecao, deslocamentosCoincidentes,
  metricasVinculo, validarBrasilGeoJson,
} from './leaflet-map.helpers';
import { BRASIL_BOUNDS, MAPA_CONFIG, regraVisual } from './mapa.config';
import { DEFAULT_ALLOCATION_CONFIG, type AllocationResult } from '../domain/allocation.models';
import { TUTOR_STATUS_LABELS } from './allocation-presentation';
import { ALLOCATION_PALETTE } from './allocation-palette';

export interface MapaState {
  readonly pontos: readonly PontoMapa[];
  readonly vinculos: readonly VinculoMapa[];
  readonly selectedTutorId: string | null;
  readonly show50Km: boolean;
  readonly show130Km: boolean;
  readonly tilesEnabled: boolean;
  readonly showTutors: boolean;
  readonly showFellows: boolean;
  readonly showLinks: boolean;
  readonly alertsOnly: boolean;
  readonly unallocatedOnly: boolean;
  readonly resetKey: number;
  readonly simulation?: boolean;
  readonly allocation?: AllocationResult | null;
  readonly simulationMinimum?: 1 | 2;
}

interface MapCallbacks {
  tutorSelected(id: string | null): void;
  pontoSelected(ponto: PontoMapa): void;
  baseState(loading: boolean, error: string | null): void;
}

interface MarkerRecord {
  readonly layer: L.Marker;
  coordinate: L.LatLngTuple;
  offset: readonly [number, number];
  signature: string;
  points: readonly PontoMapa[];
}

@Injectable({ providedIn: 'root' })
export class LeafletLayersService {
  private readonly document = inject(DOCUMENT);

  create(leaflet: typeof L, host: HTMLElement, callbacks: MapCallbacks): LeafletMapSession {
    return new LeafletMapSession(leaflet, host, this.document, callbacks);
  }
}

/** Leaflet adapter: the component owns lifecycle, this session owns the one map and reusable groups. */
export class LeafletMapSession {
  private readonly map: L.Map;
  private readonly base: L.LayerGroup;
  private readonly markers: L.LayerGroup;
  private readonly circles: L.LayerGroup;
  private readonly links: L.LayerGroup;
  private readonly renderer: L.Renderer;
  private readonly brasil: L.LatLngBounds;
  private readonly markerRecords = new Map<string, MarkerRecord>();
  private tiles: L.TileLayer | null = null;
  private tileFailed = false;
  private state: MapaState | null = null;
  private abort: AbortController | null = null;
  private destroyed = false;
  private viewportKey: string | null = null;
  private forceBrasil = false;
  private lastSize = '';
  private dataDrawn = false;

  constructor(
    private readonly leaflet: typeof L,
    private readonly host: HTMLElement,
    private readonly document: Document,
    private readonly callbacks: MapCallbacks,
  ) {
    this.brasil = leaflet.latLngBounds(BRASIL_BOUNDS);
    this.map = leaflet.map(host, {
      preferCanvas: true,
      zoomSnap: 0.1,
      zoomDelta: 0.5,
      minZoom: -10,
      maxZoom: MAPA_CONFIG.maxZoom,
      maxBounds: this.brasil.pad(0.5),
      maxBoundsViscosity: 0.8,
      attributionControl: true,
    });
    this.renderer = leaflet.canvas({ padding: 0.5 });
    this.base = leaflet.layerGroup().addTo(this.map);
    this.circles = leaflet.layerGroup().addTo(this.map);
    this.links = leaflet.layerGroup().addTo(this.map);
    this.markers = leaflet.layerGroup().addTo(this.map);
    this.map.attributionControl.addAttribution(MAPA_CONFIG.geographicBase.attribution);
    this.map.on('click', this.backgroundClick);
    this.map.on('zoomend', this.zoomEnd);
    this.verBrasil();
    void this.loadBase();
  }

  async loadBase(): Promise<void> {
    if (this.destroyed) return;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.callbacks.baseState(true, null);
    try {
      const url = new URL(MAPA_CONFIG.geographicBase.assetPath, this.document.baseURI);
      if (url.origin !== new URL(this.document.URL).origin) {
        throw new Error('A base deve ser carregada da mesma origem da aplicação.');
      }
      const response = await fetch(url.href, { signal: abort.signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Base local indisponível (HTTP ${response.status}).`);
      const json: unknown = await response.json();
      const geoJson = validarBrasilGeoJson(json);
      if (abort.signal.aborted || this.destroyed) return;
      this.clear(this.base);
      this.leaflet.geoJSON(geoJson, {
        style: { ...MAPA_CONFIG.base, renderer: this.renderer },
        interactive: false,
      }).addTo(this.base);
      this.callbacks.baseState(false, null);
    } catch (error: unknown) {
      if (abort.signal.aborted || this.destroyed) return;
      this.clear(this.base);
      this.callbacks.baseState(false, error instanceof Error ? error.message : 'Falha ao carregar a base local.');
    }
  }

  render(state: MapaState): void {
    if (this.destroyed) return;
    const old = this.state;
    this.state = state;
    this.updateTiles();
    if (!old || !sameLayerState(old, state)) {
      this.dataDrawn = false;
      this.drawData();
    }
    const coords = coordenadasSelecao(state.pontos, state.vinculos, state.selectedTutorId);
    const viewportKey = `${state.selectedTutorId ?? ''}:${JSON.stringify(coords)}`;
    if (!old || old.resetKey !== state.resetKey) {
      this.forceBrasil = true;
      this.fitContext();
    } else if (this.viewportKey !== viewportKey) {
      this.forceBrasil = false;
      this.fitContext();
    }
    this.viewportKey = viewportKey;
  }

  resize(): void {
    if (this.destroyed || !this.host.clientWidth || !this.host.clientHeight) {
      this.lastSize = '';
      return;
    }
    const size = `${this.host.clientWidth}:${this.host.clientHeight}`;
    if (size === this.lastSize) return;
    this.lastSize = size;
    this.map.invalidateSize({ animate: false, pan: false });
    this.fitContext();
    if (!this.dataDrawn) this.drawData();
    else this.repositionMarkers();
  }

  verBrasil(): void {
    this.forceBrasil = true;
    this.fitContext();
  }

  ajustarAosPontos(): void {
    const state = this.state;
    if (this.destroyed || !state) return;
    const allocated = new Set(state.simulation
      ? state.allocation?.links.map((link) => link.fellowId) ?? []
      : state.vinculos.map((v) => v.bolsistaId));
    const coords = state.pontos
      .filter((p) => coordenadaValida(p.coordenada)
        && (p.tipo === 'tutor' ? state.showTutors : state.showFellows)
        && (!state.alertsOnly || p.alertas.length > 0)
        && (!state.unallocatedOnly || (p.tipo === 'tutor' ? p.semBolsista : !allocated.has(p.id))))
      .map((p) => [p.coordenada!.latitude, p.coordenada!.longitude] as [number, number]);
    if (!coords.length) {
      this.verBrasil();
      return;
    }
    this.forceBrasil = false;
    this.fitCoordinates(coords, MAPA_CONFIG.maxZoom);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort?.abort();
    this.abort = null;
    this.tiles?.off();
    this.tiles?.remove();
    this.tiles = null;
    for (const group of [this.base, this.markers, this.circles, this.links]) this.clear(group);
    this.map.off();
    this.map.remove();
    this.markerRecords.clear();
    this.state = null;
    this.viewportKey = null;
    this.lastSize = '';
  }

  private readonly backgroundClick = (): void => {
    this.verBrasil();
    this.callbacks.tutorSelected(null);
  };

  private readonly zoomEnd = (): void => {
    // Recompute visual-only pixel displacement after zoom, not source coordinates.
    if (!this.destroyed && this.state) this.repositionMarkers();
  };

  private fitContext(): void {
    if (!this.host.clientWidth || !this.host.clientHeight) return;
    const state = this.state;
    const coords = state && !this.forceBrasil && state.selectedTutorId
      ? coordenadasSelecao(state.pontos, state.vinculos, state.selectedTutorId) : [];
    this.fitCoordinates(coords, coords.length ? MAPA_CONFIG.selectedMaxZoom : MAPA_CONFIG.maxZoom);
  }

  private fitCoordinates(coords: [number, number][], maxZoom: number): void {
    if (!this.host.clientWidth || !this.host.clientHeight) return;
    const bounds = coords.length ? this.leaflet.latLngBounds(coords) : this.brasil;
    const inset = Math.max(0, Math.min(MAPA_CONFIG.padding,
      (this.host.clientWidth - 1) / 4, (this.host.clientHeight - 1) / 4));
    const padding = this.leaflet.point(inset * 2, inset * 2);
    // Derive minZoom from the current container, including narrow/mobile/previously hidden tabs.
    this.map.setMinZoom(-10);
    const brazilZoom = this.map.getBoundsZoom(this.brasil, false, padding);
    const contextZoom = this.map.getBoundsZoom(bounds, false, padding);
    this.map.setMinZoom(Math.min(brazilZoom, contextZoom));
    this.map.fitBounds(bounds, {
      padding: [inset, inset],
      maxZoom,
      animate: false,
    });
  }

  private updateTiles(): void {
    if (!this.state?.tilesEnabled) {
      this.tileFailed = false;
      this.tiles?.off();
      this.tiles?.remove();
      this.tiles = null;
      return;
    }
    if (this.tiles || this.tileFailed) return;
    this.tiles = this.leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      noWrap: true,
      // Requests are opt-in only. No prefetch, bulk download, or referrer suppression.
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    this.tiles.on('tileerror', () => {
      this.tileFailed = true;
      this.tiles?.off();
      this.tiles?.remove();
      this.tiles = null;
      // Deliberately silent: the local GeoJSON remains the primary map.
    });
    this.tiles.addTo(this.map);
  }

  private drawData(): void {
    const state = this.state;
    if (!state || !this.host.clientWidth || !this.host.clientHeight || !Number.isFinite(this.map.getZoom())) return;
    for (const group of [this.circles, this.links]) this.clear(group);
    const allocated = new Set(state.simulation
      ? state.allocation?.links.map((link) => link.fellowId) ?? []
      : state.vinculos.map((v) => v.bolsistaId));
    const selectedLinks = state.vinculos.filter((v) => v.tutorId === state.selectedTutorId);
    const linked = new Set(selectedLinks.map((v) => v.bolsistaId));
    const located = state.pontos.filter((p) => coordenadaValida(p.coordenada));
    const byId = new Map(located.map((p) => [p.id, p]));
    const visible = located.filter((p) =>
      (!state.alertsOnly || p.alertas.length > 0)
      && (!state.unallocatedOnly || (p.tipo === 'tutor' ? p.semBolsista : !allocated.has(p.id))));
    const selectedTutor = located.find((p) => p.tipo === 'tutor' && p.id === state.selectedTutorId);
    if (selectedTutor) this.drawCircles(selectedTutor);

    const tutors = state.showTutors ? visible.filter((p) => p.tipo === 'tutor') : [];
    const groups = state.showFellows
      ? agruparBolsistasPorEstado(visible, linked, allocated) : [];
    // Allocate slots to rendered symbols, not people: one slot per municipal/status aggregate.
    // Hash-only jitter can place nearby IDs on almost the same angle and hide a tutor.
    const anchors = new Map<string, string[]>();
    for (const item of [
      ...tutors.map((p) => ({ chave: `tutor:${p.id}`, coordenada: p.coordenada! })),
      ...groups,
    ]) {
      const key = `${item.coordenada.latitude},${item.coordenada.longitude}`;
      const ids = anchors.get(key) ?? [];
      ids.push(item.chave);
      anchors.set(key, ids);
    }
    const offsets = new Map<string, readonly [number, number]>();
    for (const ids of anchors.values()) {
      for (const [id, offset] of deslocamentosCoincidentes(ids, MAPA_CONFIG.coincidentMarkerSeparationPixels)) {
        offsets.set(id, offset);
      }
    }
    const activeMarkerKeys = new Set<string>();
    if (state.showTutors) {
      for (const tutor of tutors) {
        const selected = tutor.id === state.selectedTutorId;
        const allocation = state.allocation?.tutors.find((item) => item.tutorId === tutor.id);
        const color = state.simulation ? allocation?.status === 'active' ? ALLOCATION_PALETTE.active
          : allocation?.status === 'dismissed' ? ALLOCATION_PALETTE.dismissed
            : allocation?.status === 'below-minimum' ? ALLOCATION_PALETTE.belowMinimum : ALLOCATION_PALETTE.unassigned
          : selected ? MAPA_CONFIG.tutor.selected : tutor.alertas.length
          ? MAPA_CONFIG.tutor.alert : tutor.semBolsista ? MAPA_CONFIG.tutor.empty : MAPA_CONFIG.tutor.normal;
        const label = state.simulation ? allocation?.status === 'active' ? 'T✓'
          : allocation?.status === 'dismissed' ? 'T×'
            : allocation?.status === 'below-minimum' ? 'T!' : 'T?'
          : `T${tutor.alertas.length ? '!' : tutor.semBolsista ? '∅' : ''}`;
        const key = `tutor:${tutor.id}`;
        const coordinate: L.LatLngTuple = [tutor.coordenada!.latitude, tutor.coordenada!.longitude];
        this.marker(key, coordinate, offsets.get(key) ?? [0, 0], label, color, selected,
          `Tutor: ${tutor.nome}${state.simulation ? ` — ${this.simulationReason(tutor)}` : ''}`,
          JSON.stringify([tutor.tipo, tutor.nome, tutor.municipio, tutor.semBolsista, tutor.alertas,
            tutor.coordenada?.origem, tutor.coordenada?.fonte, tutor.coordenada?.latitude, tutor.coordenada?.longitude]),
          [tutor], () => this.popup(tutor),
          () => {
            this.callbacks.tutorSelected(selected ? null : tutor.id);
            this.callbacks.pontoSelected(tutor);
          });
        activeMarkerKeys.add(key);
      }
    }
    if (state.showFellows) {
        for (const group of groups) {
          const selected = group.estado === 'selecionado';
          const unallocated = group.estado === 'sem-vinculo';
          const first = group.pontos[0];
          const key = group.chave;
          const coordinate: L.LatLngTuple = [group.coordenada.latitude, group.coordenada.longitude];
          const title = `${first.municipio ?? 'Município não identificado'} — ${group.pontos.length} bolsista(s)${selected ? ' vinculado(s) ao tutor selecionado' : unallocated ? ' sem vínculo' : ''}`
            + (state.simulation ? ` — ${group.pontos.map((p) => `${p.nome}: ${this.simulationReason(p)}`).join('; ')}` : '');
          const signature = JSON.stringify([group.estado, first.municipio, group.pontos.map((p) => [
            p.id, p.nome, p.municipio, p.coordenada?.latitude, p.coordenada?.longitude,
            p.coordenada?.origem, p.coordenada?.fonte,
          ])]);
          this.marker(key, coordinate, offsets.get(key) ?? [0, 0],
            selected ? `◆ ${group.pontos.length}` : unallocated ? `○ ${group.pontos.length}` : String(group.pontos.length),
            selected ? MAPA_CONFIG.fellow.selected : unallocated ? MAPA_CONFIG.fellow.unallocated : MAPA_CONFIG.fellow.normal,
            selected, title, signature, group.pontos, () => this.popupGrupo(group.pontos, title), () => {
              if (group.pontos.length === 1) this.callbacks.pontoSelected(first);
            });
          activeMarkerKeys.add(key);
      }
    }
    for (const [key, record] of this.markerRecords) {
      if (!activeMarkerKeys.has(key)) {
        this.markers.removeLayer(record.layer);
        record.layer.off();
        record.layer.unbindPopup();
        record.layer.unbindTooltip();
        this.markerRecords.delete(key);
      }
    }
    if (state.showLinks && (state.simulation || selectedTutor)) {
      const visibleIds = new Set(visible.map((p) => p.id));
      for (const v of state.simulation ? state.vinculos : selectedLinks) {
        const fellow = byId.get(v.bolsistaId);
        const tutor = byId.get(v.tutorId);
        if (tutor && fellow && (!state.simulation || visibleIds.has(tutor.id)) && visibleIds.has(fellow.id)) {
          this.drawLink(tutor, fellow, v);
        }
      }
    }
    this.dataDrawn = true;
  }

  private marker(
    key: string, coordinate: L.LatLngTuple, offset: readonly [number, number],
    label: string, color: string, selected: boolean, title: string, contentSignature: string,
    points: readonly PontoMapa[], createContent: () => HTMLElement, click: () => void,
  ): void {
    const signature = JSON.stringify([label, color, selected, title, contentSignature, this.simulationContext()]);
    const position = this.visualPosition(coordinate, offset);
    const existing = this.markerRecords.get(key);
    if (existing) {
      existing.layer.setLatLng(position);
      const changed = existing.signature !== signature || !samePoints(existing.points, points);
      existing.coordinate = coordinate;
      existing.offset = offset;
      if (changed) {
        existing.layer.setIcon(this.markerIcon(label, color, selected));
        existing.layer.setZIndexOffset(selected ? 1000 : label.startsWith('T') ? 500 : 0);
        existing.layer.options.title = title;
        existing.layer.options.alt = title;
        const element = existing.layer.getElement();
        if (element) {
          element.title = title;
          element.setAttribute('aria-label', title);
        }
        existing.layer.bindPopup(createContent(), { maxWidth: 340, autoPan: false });
        existing.layer.unbindTooltip();
        if (this.state?.simulation) existing.layer.bindTooltip(this.tooltip(this.markerTooltip(title)));
        existing.layer.off('click').on('click', click);
        existing.signature = signature;
        existing.points = points;
      }
      return;
    }
    const marker = this.leaflet.marker(position, {
      icon: this.markerIcon(label, color, selected),
      title, alt: title, keyboard: true, bubblingMouseEvents: false,
      zIndexOffset: selected ? 1000 : label.startsWith('T') ? 500 : 0,
    });
    marker.bindPopup(createContent(), { maxWidth: 340, autoPan: false });
    if (this.state?.simulation) marker.bindTooltip(this.tooltip(this.markerTooltip(title)));
    marker.on('click', click);
    marker.addTo(this.markers);
    this.markerRecords.set(key, { layer: marker, coordinate, offset, signature, points });
  }

  private markerIcon(label: string, color: string, selected: boolean): L.DivIcon {
    const symbol = this.document.createElement('span');
    symbol.textContent = label;
    Object.assign(symbol.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '32px', height: '32px',
      borderRadius: this.state?.simulation && label === 'T×' ? '2px'
        : this.state?.simulation && label === 'T!' ? '25%' : '50%',
      background: color,
      color: '#fff', fontWeight: '700', fontSize: '13px',
      border: selected ? '3px solid #fff' : '2px solid #fff',
      boxShadow: selected ? '0 0 0 3px #35245b' : '0 1px 5px #0008',
    });
    return this.leaflet.divIcon({
      html: symbol, className: 'map-symbol', iconSize: [36, 36], iconAnchor: [18, 18],
    });
  }

  private visualPosition(coordinate: L.LatLngTuple, offset: readonly [number, number]): L.LatLngTuple {
    const [x, y] = offset;
    if (x === 0 && y === 0) return coordinate;
    const origin = this.map.project(coordinate);
    const point = this.map.unproject(this.leaflet.point(origin.x + x, origin.y + y));
    return [point.lat, point.lng];
  }

  private repositionMarkers(): void {
    for (const record of this.markerRecords.values()) {
      record.layer.setLatLng(this.visualPosition(record.coordinate, record.offset));
    }
  }

  private popupGrupo(pontos: readonly PontoMapa[], title: string): HTMLElement {
    const content = this.document.createElement('div');
    const heading = this.document.createElement('strong');
    heading.textContent = title;
    content.append(heading);
    const note = this.document.createElement('p');
    note.textContent = 'Agrupamento por código municipal; âncora em coordenada de origem. Escolha um bolsista:';
    content.append(note);
    for (const ponto of pontos) {
      const button = this.document.createElement('button');
      button.type = 'button';
      button.textContent = ponto.nome;
      button.style.display = 'block';
      button.addEventListener('click', () => this.callbacks.pontoSelected(ponto));
      content.append(button);
      const origin = this.document.createElement('small');
      origin.textContent = `${this.origem(ponto)}${this.state?.simulation ? ` ${this.simulationReason(ponto)}` : ''}`;
      content.append(origin);
    }
    return content;
  }

  private popup(ponto: PontoMapa): HTMLElement {
    const content = this.document.createElement('div');
    const title = this.document.createElement('strong');
    title.textContent = ponto.nome;
    content.append(title);
    for (const text of [
      `${ponto.tipo === 'tutor' ? 'Tutor' : 'Bolsista'} — ${ponto.municipio ?? 'município não identificado'}`,
      this.origem(ponto),
      ...(this.state?.simulation ? [this.simulationReason(ponto)] : []),
      ...(ponto.semBolsista ? ['Sem bolsista vinculado'] : []),
      ...ponto.alertas,
    ]) {
      const line = this.document.createElement('p');
      line.textContent = text;
      content.append(line);
    }
    return content;
  }

  private origem(ponto: PontoMapa): string {
    const c = ponto.coordenada;
    if (!c) return 'Localização desconhecida.';
    const source = String(c.origem).toLocaleLowerCase('pt-BR');
    const origin = source === 'importada' ? 'Planilha (precisão não verificada)'
      : source.includes('geocod') ? 'Geocodificada (estimativa; confirme a localização e a precisão)'
        : source === 'manual' ? 'Informada manualmente (precisão não verificada)'
          : source === 'centroide-municipal' ? 'Centroide municipal (aproximado, não endereço individual)'
            : 'Origem desconhecida (precisão não verificada)';
    return `${origin}. Fonte: ${c.fonte}. Coordenada original: ${c.latitude}, ${c.longitude}.`;
  }

  private drawCircles(tutor: PontoMapa): void {
    const c = tutor.coordenada!;
    if (this.state?.simulation && this.state.allocation) {
      this.leaflet.circle([c.latitude, c.longitude], {
        color: ALLOCATION_PALETTE.active, weight: 2, fillOpacity: 0.02,
        radius: DEFAULT_ALLOCATION_CONFIG.raioMaxKm * 1000,
        renderer: this.renderer, interactive: false,
      }).addTo(this.circles);
    }
    if (this.state?.show50Km) {
      this.leaflet.circle([c.latitude, c.longitude], {
        ...MAPA_CONFIG.circles.fifty, radius: MAPA_CONFIG.radii.fifty,
        renderer: this.renderer, interactive: false,
      }).addTo(this.circles);
    }
    if (this.state?.show130Km) {
      this.leaflet.circle([c.latitude, c.longitude], {
        ...MAPA_CONFIG.circles.reference, radius: MAPA_CONFIG.radii.reference,
        renderer: this.renderer, interactive: false,
      }).addTo(this.circles);
    }
  }

  private drawLink(tutor: PontoMapa, fellow: PontoMapa, vinculo: VinculoMapa): void {
    const a = tutor.coordenada!;
    const b = fellow.coordenada!;
    const metrics = this.document.createElement('div');
    for (const text of [
      `${this.state?.simulation ? 'Vínculo simulado' : 'Vínculo'}: ${tutor.nome} → ${fellow.nome} (não é rota rodoviária)`,
      `Critério: ${vinculo.criterio || 'desconhecido'} — ${vinculo.regra || 'regra desconhecida'}`,
      ...metricasVinculo(vinculo),
    ]) {
      const line = this.document.createElement('div');
      line.textContent = text;
      metrics.append(line);
    }
    const options: L.PolylineOptions = {
      ...MAPA_CONFIG.rules[regraVisual(vinculo)], renderer: this.renderer,
      bubblingMouseEvents: false,
    };
    // These are relationship connectors, NEVER a claimed road route. RoadRoute currently has no geometry.
    // A coincident (0 km) link gets an interactive anchor so the three independent metrics remain accessible.
    const layer = a.latitude === b.latitude && a.longitude === b.longitude
      ? this.leaflet.circleMarker([a.latitude, a.longitude], { ...options, radius: 11, fillOpacity: 0.05 })
      : this.leaflet.polyline([[a.latitude, a.longitude], [b.latitude, b.longitude]], options);
    layer.bindTooltip(metrics, { direction: 'auto', sticky: true });
    layer.bindPopup(metrics.cloneNode(true) as HTMLElement);
    layer.addTo(this.links);
  }

  private clear(group: L.LayerGroup): void {
    group.eachLayer((layer) => { layer.off(); layer.unbindPopup(); layer.unbindTooltip(); });
    group.clearLayers();
  }

  private tooltip(text: string): HTMLElement {
    const element = this.document.createElement('span');
    element.textContent = text;
    return element;
  }

  private markerTooltip(title: string): string {
    const context = this.simulationContext();
    return context ? `${title}. ${context}` : title;
  }

  private simulationContext(): string {
    if (!this.state?.simulation) return '';
    const minimum = this.state.simulationMinimum ?? DEFAULT_ALLOCATION_CONFIG.minimoPorTutor;
    return `Mínimo selecionado: ${minimum} bolsista(s) por tutor. Raio máximo de alocação: ${DEFAULT_ALLOCATION_CONFIG.raioMaxKm} km geodésicos; não representa distância ou cobertura por estrada.`;
  }

  private simulationReason(ponto: PontoMapa): string {
    const result = this.state?.allocation;
    if (!result) return 'Simulação indisponível — nenhum estado de alocação calculado.';
    if (ponto.tipo === 'tutor') {
      const tutor = result.tutors.find((item) => item.tutorId === ponto.id);
      return tutor ? `${TUTOR_STATUS_LABELS[tutor.status]}: ${tutor.reason}` : 'Tutor fora do resultado da simulação.';
    }
    const fellow = result.unassignedFellows.find((item) => item.fellowId === ponto.id);
    return fellow ? `Sem tutor: ${fellow.reason}` : 'Bolsista alocado na simulação.';
  }
}

function sameLayerState(a: MapaState, b: MapaState): boolean {
  return a.pontos === b.pontos
    && a.vinculos === b.vinculos
    && a.selectedTutorId === b.selectedTutorId
    && a.show50Km === b.show50Km
    && a.show130Km === b.show130Km
    && a.showTutors === b.showTutors
    && a.showFellows === b.showFellows
    && a.showLinks === b.showLinks
    && a.alertsOnly === b.alertsOnly
    && a.unallocatedOnly === b.unallocatedOnly
    && a.simulation === b.simulation
    && a.simulationMinimum === b.simulationMinimum
    && a.allocation === b.allocation;
}

function samePoints(a: readonly PontoMapa[], b: readonly PontoMapa[]): boolean {
  return a.length === b.length && a.every((point, index) => point === b[index]);
}
