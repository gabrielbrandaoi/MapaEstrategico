import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, output } from '@angular/core';
import { By } from '@angular/platform-browser';
import { of, Subject, throwError } from 'rxjs';
import { ImportBatch, Participant, ProximityPair, RoadRoute } from './domain/models';
import { CenarioMapa, PontoMapa, VinculoMapa } from './domain/mapa.models';
import type { AllocationResult } from './domain/allocation.models';
import { App, pageWindow } from './app';
import { ReportExportService } from './reports/report-export.service';
import { ExcelWorkbookService } from './importing/excel-workbook.service';
import { MapProjectionService } from './geolocation/map-projection.service';
import { LeafletMapComponent } from './map/leaflet-map.component';
import { SimulationsComponent } from './simulations/simulations.component';
import type { SimulationScenario } from './map/allocation-presentation';
import { ROUTING_PROVIDER } from './routing/routing-provider';
import { vi } from 'vitest';

/** Substituto visual com o mesmo contrato público do mapa (sem Leaflet/rede no jsdom). */
@Component({ selector: 'app-leaflet-map', standalone: true, template: '' })
class LeafletMapStub {
  readonly pontos = input<readonly PontoMapa[]>([]);
  readonly vinculos = input<readonly VinculoMapa[]>([]);
  readonly selectedTutorId = input<string | null>(null);
  readonly show50Km = input(false);
  readonly show130Km = input(false);
  readonly tilesEnabled = input(false);
  readonly showTutors = input(true);
  readonly showFellows = input(true);
  readonly showLinks = input(true);
  readonly alertsOnly = input(false);
  readonly unallocatedOnly = input(false);
  readonly resetKey = input(0);
  readonly simulation = input(false);
  readonly allocation = input<AllocationResult | null>(null);
  readonly simulationMinimum = input<1 | 2>(1);
  readonly tutorSelected = output<string | null>();
  readonly pontoSelected = output<PontoMapa>();
}

@Component({ selector: 'app-simulations', standalone: true, template: '<p>Distribuição de tutores</p>' })
class SimulationsStub {
  readonly scenarios = input<readonly SimulationScenario[]>([]);
  readonly participants = input<readonly Participant[]>([]);
  readonly loading = input(false);
  readonly importRequested = output<void>();
}

/** Projeção sintética derivada do lote real importado (mesmos IDs, centróide fictício). */
function cenarioDoLote(lote: ImportBatch, extras: Partial<CenarioMapa> = {}): CenarioMapa {
  const pontos: PontoMapa[] = lote.report.participants.map((participant) => ({
    id: participant.id,
    tipo: participant.type,
    nome: participant.name,
    municipio: 'Cidade sintética',
    ibge6: '999999',
    coordenada: participant.location
      ? {
          latitude: participant.location.latitude,
          longitude: participant.location.longitude,
          origem: 'importada',
          fonte: 'planilha',
        }
      : { latitude: -20, longitude: -40, origem: 'centroide-municipal', fonte: 'base sintética' },
    cpfProvisorio: participant.identityUnverified ?? false,
    criterios: [],
    alertas: [],
    semBolsista: false,
  }));
  const vinculos: VinculoMapa[] = (lote.report.relationships ?? []).map((relationship, index) => ({
    id: `${relationship.tutorId}::${relationship.fellowId}::${index}`,
    tutorId: relationship.tutorId,
    bolsistaId: relationship.fellowId,
    kmPlanilha: relationship.reportedKm,
    distanciaGeodesicaKm: null,
    criterio: 'Critério sintético',
    regra: '',
    segundaRodada: false,
    regra50Km: false,
    mesmoMunicipio: false,
    divergente: false,
    excede50Km: false,
    rota: null,
  }));
  return { pontos, vinculos, semLocalizacao: [], ...extras };
}

const RELATIONSHIP_WORKBOOK = {
  fileName: 'vinculos-sinteticos.xlsx',
  sheets: [
    {
      name: 'Nominal',
      rows: [
        ['CPF_TUTOR', 'NOME_TUTOR', 'IBGE_TUTOR', 'CPF_bolsista', 'NOME_bolsista', 'km'],
        ['00000000001', 'Tutor sintético', 999999, '00000000002', 'Bolsista sintético', '3'],
      ],
    },
  ],
};

describe('App', () => {
  let projetar: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    projetar = vi.fn(async (_workbook: unknown, lote: ImportBatch) => cenarioDoLote(lote));
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: ExcelWorkbookService,
          useValue: { read: vi.fn() },
        },
        {
          provide: ROUTING_PROVIDER,
          useValue: { route: () => of({}) },
        },
        { provide: MapProjectionService, useValue: { projetar } },
      ],
    })
      .overrideComponent(App, {
        remove: { imports: [LeafletMapComponent, SimulationsComponent] },
        add: { imports: [LeafletMapStub, SimulationsStub] },
      })
      .compileComponents();
  });

  function mapStub(fixture: ComponentFixture<App>): LeafletMapStub {
    return fixture.debugElement.query(By.directive(LeafletMapStub))
      .componentInstance as LeafletMapStub;
  }

  async function importWorkbook(fixture: ComponentFixture<App>, fileName: string): Promise<void> {
    await selectFile(fixture, fileName);
    fixture.nativeElement
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('keeps name and municipality search in the toolbar across map and relationships tabs', async () => {
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue(RELATIONSHIP_WORKBOOK);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await importWorkbook(fixture, 'vinculos-sinteticos.xlsx');
    const root: HTMLElement = fixture.nativeElement;
    navButton(root, 'Visão geral').click();
    await fixture.whenStable();
    fixture.detectChanges();
    const search = root.querySelector<HTMLInputElement>('.topbar input[type="search"]');
    expect(search).not.toBeNull();
    expect(root.querySelectorAll('input[type="search"]')).toHaveLength(1);
    expect(root.querySelector('.map-panel #map-scenario')).not.toBeNull();
    expect(root.querySelectorAll('.map-filter-group legend')).toHaveLength(4);
    expect(root.querySelector('.detail-panel')).not.toBeNull();
    search!.value = 'Sem correspondência sintética';
    search!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(mapStub(fixture).pontos()).toHaveLength(0);
    expect(root.querySelector('#search-results')?.textContent).toContain('0 participantes na tabela');
    expect(search?.getAttribute('aria-describedby')).toBe('search-results');
    const clear = [...root.querySelectorAll<HTMLButtonElement>('.topbar button')]
      .find((button) => button.textContent?.trim() === 'Limpar pesquisa');
    expect(clear).toBeDefined();
    clear?.click();
    fixture.detectChanges();
    expect(search?.value).toBe('');
    expect(root.querySelector('#search-results')).toBeNull();
    expect(mapStub(fixture).pontos()).toHaveLength(2);
    search!.value = 'Sem correspondência sintética';
    search!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const reset = root.querySelector<HTMLButtonElement>('.table-empty-state button');
    expect(reset?.textContent).toContain('Limpar filtros');
    reset?.click();
    fixture.detectChanges();
    expect(root.querySelector('.table-empty-state')).toBeNull();
    search!.value = 'Sem correspondência sintética';
    search!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    navButton(root, 'Relações e rotas').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector<HTMLInputElement>('.topbar input[type="search"]')?.value)
      .toBe('Sem correspondência sintética');
    expect(root.querySelectorAll('input[type="search"]')).toHaveLength(1);
    expect(root.querySelector('#search-results')?.textContent).toContain('0 pares próximos');
    navButton(root, 'Simulações').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.topbar input[type="search"]')).toBeNull();
    fixture.destroy();
  });

  it('separates the distribution tab from the map and explicitly selects map scenarios', async () => {
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue({
      fileName: 'simulacao-sintetica.csv',
      sheets: [{
        name: 'Dados',
        rows: [
          ['tipo', 'nome', 'latitude', 'longitude'],
          ...Array.from({ length: 7 }, (_, index) =>
            ['tutor', `Tutor sintético ${index}`, -20 - index * 0.01, -40]),
          ...Array.from({ length: 13 }, (_, index) =>
            ['bolsista', `Bolsista sintético ${index}`, -20 - index * 0.005, -40]),
        ],
      }],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await importWorkbook(fixture, 'simulacao-sintetica.csv');
    const root: HTMLElement = fixture.nativeElement;
    const map = mapStub(fixture);
    expect(root.querySelector('#allocation-title')).toBeNull();
    expect(root.querySelector('#simulation-minimum')).toBeNull();
    expect(root.querySelector('.kpi-grid')).not.toBeNull();
    expect(map.simulation()).toBe(true);
    expect(map.simulationMinimum()).toBe(1);
    function selectMap(value: string): void {
      const select = root.querySelector<HTMLSelectElement>('#map-scenario');
      if (!select) throw new Error('Seletor do mapa ausente.');
      select.value = value;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }

    selectMap('2');
    expect(map.simulation()).toBe(true);
    expect(map.simulationMinimum()).toBe(2);
    const simulatedLinks = mapStub(fixture).vinculos();
    expect(simulatedLinks).toHaveLength(13);
    expect(new Set(simulatedLinks.map((link) => link.bolsistaId)).size).toBe(13);
    expect(simulatedLinks.every((link) => link.kmPlanilha === null && link.rota === null))
      .toBe(true);
    navButton(root, 'Simulações').click();
    await fixture.whenStable();
    fixture.detectChanges();
    const simulations = fixture.debugElement.query(By.directive(SimulationsStub))
      .componentInstance as SimulationsStub;
    expect(simulations.scenarios().map((scenario) => scenario.minimum)).toEqual([1, 2]);
    expect(simulations.participants()).toHaveLength(20);
    expect(simulations.scenarios()[1].result?.indicators.allocatedFellows).toBe(13);
    expect(simulations.scenarios()[1].result?.distribution.totalTutors).toBe(7);
    expect(simulations.scenarios()[1].result?.indicators.dismissedTutors).toBe(2);
    expect(simulations.scenarios()[1].result?.config.raioMaxKm).toBe(150);
    expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(true);
    expect(root.querySelector('.kpi-grid')).toBeNull();
    expect(root.querySelector('#relationships-title')).toBeNull();
    expect(mapStub(fixture)).toBe(map);
    navButton(root, 'Visão geral').click();
    fixture.detectChanges();
    expect(map.vinculos()).toEqual(simulatedLinks);
    expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(false);
    expect(root.querySelector('app-simulations')).toBeNull();
    selectMap('imported');
    expect(mapStub(fixture).vinculos()).toEqual([]);
    expect(mapStub(fixture)).toBe(map);
    expect(map.simulation()).toBe(false);
    expect(map.allocation()).toBeNull();
    expect(root.querySelector('#allocation-title')).toBeNull();
    expect(root.querySelector('.kpi-grid')).not.toBeNull();
    const clearButton = [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Limpar dados');
    if (!clearButton) throw new Error('Ação de limpar dados ausente.');
    selectMap('1');
    clearButton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector<HTMLSelectElement>('#map-scenario')?.value).toBe('1');
    expect(map.simulation()).toBe(true);
    expect(map.allocation()?.tutors).toEqual([]);
  });

  it('keeps imported links unchanged when visiting the distribution tab', async () => {
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue(RELATIONSHIP_WORKBOOK);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await importWorkbook(fixture, 'vinculos-sinteticos.xlsx');
    const root: HTMLElement = fixture.nativeElement;
    const select = root.querySelector<HTMLSelectElement>('#map-scenario');
    if (!select) throw new Error('Seletor do mapa ausente.');
    select.value = 'imported';
    select.dispatchEvent(new Event('change'));
    navButton(root, 'Visão geral').click();
    fixture.detectChanges();
    const map = mapStub(fixture);
    const importedLinks = map.vinculos();
    expect(importedLinks).toHaveLength(1);
    expect(importedLinks[0].kmPlanilha).toBe(3);
    expect(map.simulation()).toBe(false);

    navButton(root, 'Simulações').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(map.simulation()).toBe(false);
    expect(map.vinculos()).toEqual(importedLinks);
    const scenarios = (fixture.debugElement.query(By.directive(SimulationsStub))
      .componentInstance as SimulationsStub).scenarios();
    expect(scenarios[0].result?.indicators.dismissedTutors).toBe(1);
    expect(root.querySelector('#simulations-title')).not.toBeNull();
    expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(true);

    navButton(root, 'Visão geral').click();
    fixture.detectChanges();
    expect(mapStub(fixture)).toBe(map);
    expect(map.simulation()).toBe(false);
    expect(map.vinculos()).toEqual(importedLinks);
    expect(root.querySelector('#simulation-minimum')).toBeNull();
    expect(root.querySelector('#relationships-title')).toBeNull();
    expect(root.querySelector('.people-panel')).not.toBeNull();
  });

  it('renders the map on an empty session and keeps the same instance across tabs', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const map = mapStub(fixture);
    expect(map.pontos()).toEqual([]);
    const root: HTMLElement = fixture.nativeElement;
    const reference = [...root.querySelectorAll<HTMLLabelElement>('label')]
      .find((label) => label.textContent?.includes('130 km (referência)'))
      ?.querySelector<HTMLInputElement>('input');
    if (!reference) throw new Error('Controle do raio de 130 km ausente.');
    expect(map.show130Km()).toBe(true);
    reference.click();
    fixture.detectChanges();
    expect(map.show130Km()).toBe(false);
    expect(root.textContent).not.toContain('100 km (referência)');
    expect(root.querySelector('#simulation-minimum')).toBeNull();
    navButton(root, 'Simulações').click();
    fixture.detectChanges();
    expect(root.querySelector('#simulations-title')).not.toBeNull();
    expect(root.querySelector('app-simulations')).not.toBeNull();
    expect((fixture.debugElement.query(By.directive(SimulationsStub))
      .componentInstance as SimulationsStub).participants()).toEqual([]);
    expect(root.querySelector('.people-panel')).toBeNull();
    expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(true);
    expect(mapStub(fixture)).toBe(map);
    navButton(root, 'Relações e rotas').click();
    fixture.detectChanges();
    expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(true);
    navButton(root, 'Visão geral').click();
    fixture.detectChanges();
    expect(mapStub(fixture)).toBe(map);
    expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(false);
  });

  it.each(['Visão geral', 'Simulações', 'Relações e rotas'])(
    'opens the overview after importing Excel from %s',
    async (tab) => {
      vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue(RELATIONSHIP_WORKBOOK);
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;
      navButton(root, tab).click();
      fixture.detectChanges();
      await importWorkbook(fixture, 'vinculos-sinteticos.xlsx');
      expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(false);
      expect(navButton(root, 'Visão geral').getAttribute('aria-current')).toBe('page');
      expect(mapStub(fixture).pontos()).toHaveLength(2);
      const sections = [...root.querySelectorAll('.people-panel, .map-workspace, .import-summary')];
      expect(sections.map((section) => section.classList.contains('people-panel')
        ? 'participants'
        : section.classList.contains('map-workspace') ? 'map' : 'import')).toEqual([
        'participants', 'map', 'import',
      ]);
      expect(root.querySelectorAll('.people-panel')).toHaveLength(1);
      fixture.destroy();
    },
  );

  it('brings the overview and its map into view after import and when its tab is clicked', async () => {
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue(RELATIONSHIP_WORKBOOK);
    // jsdom does not implement scrollIntoView; record which element the app scrolls to.
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const fixture = TestBed.createComponent(App);
      fixture.autoDetectChanges();
      const root: HTMLElement = fixture.nativeElement;
      document.body.append(root);
      for (const [selector, height] of [['.navigation-bar', 60], ['.topbar', 78]] as const) {
        const bar = root.querySelector<HTMLElement>(selector);
        if (!bar) throw new Error(`Barra ausente: ${selector}`);
        bar.style.position = 'sticky';
        vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, height));
      }
      const content = root.querySelector<HTMLElement>('.content-wrap');
      if (!content) throw new Error('Conteúdo ausente.');
      content.style.rowGap = '16px';
      await importWorkbook(fixture, 'vinculos-sinteticos.xlsx');
      const heading = root.querySelector<HTMLElement>('#overview-title');
      expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(false);
      expect(scrolled).toContain(heading);
      expect(document.activeElement).toBe(heading);
      expect(heading?.style.scrollMarginTop).toBe('154px');
      navButton(root, 'Relações e rotas').click();
      await fixture.whenStable();
      expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(true);
      // The map stays mounted when another tab is active.
      expect(root.querySelector('.map-workspace')?.previousElementSibling).not.toBeNull();

      navButton(root, 'Visão geral').click();
      await fixture.whenStable();

      const restoredHeading = root.querySelector<HTMLElement>('#overview-title');
      expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(false);
      expect(scrolled).toContain(restoredHeading);
      expect(document.activeElement).toBe(restoredHeading);
      expect(mapStub(fixture).pontos()).toHaveLength(2);

      const mapHeading = root.querySelector<HTMLElement>('#map-title');
      [...root.querySelectorAll<HTMLButtonElement>('.people-panel button')]
        .find((button) => button.textContent?.trim() === 'Ir para o mapa')?.click();
      await fixture.whenStable();
      expect(document.activeElement).toBe(mapHeading);
      expect(scrolled).toContain(mapHeading);
      expect(mapHeading?.style.scrollMarginTop).toBe('154px');
      expect(root.querySelector('.participant-row--selected')).toBeNull();
      [...root.querySelectorAll<HTMLButtonElement>('.map-heading-row button')]
        .find((button) => button.textContent?.trim() === 'Voltar aos participantes')?.click();
      await fixture.whenStable();
      expect(document.activeElement).toBe(root.querySelector('#people-title'));

      const personButtons = root.querySelectorAll<HTMLButtonElement>('.table-person-link');
      personButtons[0].click();
      await fixture.whenStable();
      expect(root.querySelectorAll('.participant-row--selected')).toHaveLength(1);
      expect(personButtons[0].closest('tr')?.classList.contains('participant-row--selected')).toBe(true);
      expect(personButtons[0].textContent).toContain('Selecionado');
      expect([...root.querySelectorAll('.detail-section h3')].map((h) => h.textContent))
        .toEqual(['Identificação', 'Localização', 'Situação']);
      expect(document.activeElement).toBe(mapHeading);
      personButtons[1].click();
      await fixture.whenStable();
      expect(root.querySelectorAll('.participant-row--selected')).toHaveLength(1);
      expect(personButtons[0].textContent).not.toContain('Selecionado');
      expect(personButtons[1].textContent).toContain('Selecionado');
      mapStub(fixture).tutorSelected.emit(null);
      fixture.detectChanges();
      expect(root.querySelector('.participant-row--selected')).toBeNull();

      navButton(root, 'Relações e rotas').click();
      await fixture.whenStable();
      expect(scrolled).toContain(root.querySelector('#relationships-title'));
      root.remove();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('projects a workbook, selects a tutor from the map and deselects back to Brazil', async () => {
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue(RELATIONSHIP_WORKBOOK);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const initialReset = mapStub(fixture).resetKey();
    await importWorkbook(fixture, 'vinculos-sinteticos.xlsx');

    const root: HTMLElement = fixture.nativeElement;
    const select = root.querySelector<HTMLSelectElement>('#map-scenario');
    if (!select) throw new Error('Seletor do mapa ausente.');
    select.value = 'imported';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(projetar).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'vinculos-sinteticos.xlsx' }),
      expect.objectContaining({ fileName: 'vinculos-sinteticos.xlsx' }),
      'lote-1',
    );
    const map = mapStub(fixture);
    expect(map.pontos()).toHaveLength(2);
    expect(map.vinculos()).toHaveLength(1);
    expect(map.resetKey()).toBeGreaterThan(initialReset);
    const tutor = map.pontos().find((ponto) => ponto.tipo === 'tutor');
    if (!tutor) throw new Error('Tutor projetado ausente.');

    map.tutorSelected.emit(tutor.id);
    fixture.detectChanges();
    const summary = root.querySelector('app-tutor-summary');
    expect(summary?.textContent).toContain('Tutor sintético');
    expect(summary?.textContent?.replace(/\s+/g, ' ')).toContain(
      '0 km (mesmo município, centróide)',
    );
    expect(summary?.textContent).toContain('centróides municipais');
    expect(root.textContent).toContain('Centróide municipal (provisório)');
    expect(root.textContent).not.toContain('00000000001');
    expect(mapStub(fixture).selectedTutorId()).toBe(tutor.id);

    const resetBefore = mapStub(fixture).resetKey();
    [...root.querySelectorAll<HTMLButtonElement>('app-tutor-summary button')]
      .find((button) => button.textContent?.includes('Desmarcar'))
      ?.click();
    fixture.detectChanges();
    expect(root.querySelector('app-tutor-summary')).toBeNull();
    expect(mapStub(fixture).selectedTutorId()).toBeNull();
    expect(mapStub(fixture).resetKey()).toBe(resetBefore + 1);

    mapStub(fixture).tutorSelected.emit(tutor.id);
    fixture.detectChanges();
    mapStub(fixture).tutorSelected.emit(null);
    fixture.detectChanges();
    expect(root.querySelector('app-tutor-summary')).toBeNull();
  });

  it('does not show the focused tutor status in the selected fellow details', async () => {
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue({
      fileName: 'detalhes-sinteticos.csv',
      sheets: [{
        name: 'Dados',
        rows: [
          ['tipo', 'nome', 'latitude', 'longitude'],
          ['tutor', 'Tutor sintético A', -20, -40],
          ['tutor', 'Tutor sintético B', -20, -40],
          ['bolsista', 'Bolsista sintético', -20, -40],
        ],
      }],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await importWorkbook(fixture, 'detalhes-sinteticos.csv');
    const root: HTMLElement = fixture.nativeElement;
    const select = root.querySelector<HTMLSelectElement>('#map-scenario');
    if (!select) throw new Error('Seletor do mapa ausente.');
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const map = mapStub(fixture);
    const workspaceClass = root.querySelector('.workspace-grid')?.className;
    const detailsClass = root.querySelector('.detail-panel')?.className;
    const activeTutor = map.allocation()?.tutors.find((tutor) => tutor.status === 'active');
    const fellow = map.pontos().find((ponto) => ponto.tipo === 'fellow');
    if (!activeTutor || !fellow) throw new Error('Participantes sintéticos ausentes.');
    map.tutorSelected.emit(activeTutor.tutorId);
    fixture.detectChanges();
    expect(root.querySelector('.detail-panel')?.textContent).toContain('Simulação mínimo');
    map.pontoSelected.emit(fellow);
    fixture.detectChanges();
    expect(root.querySelector('.detail-panel')?.textContent).toContain(fellow.nome);
    expect(root.querySelector('.detail-panel')?.textContent).not.toContain('Simulação mínimo');
    expect(map.selectedTutorId()).toBe(activeTutor.tutorId);
    expect(root.querySelector('.workspace-grid')?.className).toBe(workspaceClass);
    expect(root.querySelector('.detail-panel')?.className).toBe(detailsClass);
  });

  it('replaces the previous scenario when a new workbook is imported', async () => {
    const read = vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read');
    read.mockResolvedValue(RELATIONSHIP_WORKBOOK);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await importWorkbook(fixture, 'vinculos-sinteticos.xlsx');
    const tutor = mapStub(fixture).pontos().find((ponto) => ponto.tipo === 'tutor');
    mapStub(fixture).tutorSelected.emit(tutor?.id ?? null);
    fixture.detectChanges();

    read.mockResolvedValue({ ...RELATIONSHIP_WORKBOOK, fileName: 'segunda-planilha.xlsx' });
    await importWorkbook(fixture, 'segunda-planilha.xlsx');
    const root: HTMLElement = fixture.nativeElement;
    expect(mapStub(fixture).pontos()).toHaveLength(2);
    expect(mapStub(fixture).pontos().every((ponto) => ponto.id.startsWith('lote-2'))).toBe(true);
    expect(mapStub(fixture).selectedTutorId()).toBeNull();
    expect(root.querySelectorAll('.import-detailed-report')).toHaveLength(1);
    expect(root.textContent).not.toContain('vinculos-sinteticos.xlsx');
  });

  it.each(['1', '2', 'imported'] as const)(
    'preserves map scenario %s when replacing a workbook or adding a CSV',
    async (scenario) => {
      const read = vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read');
      read.mockResolvedValue(RELATIONSHIP_WORKBOOK);
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await importWorkbook(fixture, 'vinculos-sinteticos.xlsx');
      const root: HTMLElement = fixture.nativeElement;
      const map = mapStub(fixture);
      const select = root.querySelector<HTMLSelectElement>('#map-scenario');
      if (!select) throw new Error('Seletor do mapa ausente.');
      select.value = scenario;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      read.mockResolvedValue({ ...RELATIONSHIP_WORKBOOK, fileName: 'substituta.xlsx' });
      await importWorkbook(fixture, 'substituta.xlsx');
      expect(select.value).toBe(scenario);
      expect(map.simulation()).toBe(scenario !== 'imported');
      expect(map.simulationMinimum()).toBe(scenario === '2' ? 2 : 1);
      expect(map.pontos().every((ponto) => ponto.id.startsWith('lote-2'))).toBe(true);
      if (scenario !== 'imported') {
        expect(map.allocation()?.config.minimoPorTutor).toBe(Number(scenario));
        expect(map.allocation()?.tutors).toHaveLength(1);
      }

      read.mockResolvedValue({
        fileName: 'adicional.csv',
        sheets: [{
          name: 'Dados',
          rows: [
            ['tipo', 'nome', 'latitude', 'longitude'],
            ['tutor', 'Tutor adicional sintético', -20, -40],
          ],
        }],
      });
      await importWorkbook(fixture, 'adicional.csv');
      expect(select.value).toBe(scenario);
      expect(mapStub(fixture)).toBe(map);
      expect(map.simulation()).toBe(scenario !== 'imported');
      expect(map.simulationMinimum()).toBe(scenario === '2' ? 2 : 1);
      expect(map.pontos()).toHaveLength(3);
      if (scenario !== 'imported') {
        expect(map.allocation()?.tutors).toHaveLength(2);
      }
    },
  );

  it('accumulates simple CSV registrations in the map scenario', async () => {
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockImplementation(async (file) => ({
      fileName: file.name,
      sheets: [
        {
          name: 'Dados',
          rows: [
            ['Nome', 'Cidade', 'UF'],
            ['Pessoa sintética', 'Cidade teste', 'SP'],
          ],
        },
      ],
    }));
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await importFile(fixture, 'tutores.csv', 'tutor');
    await importFile(fixture, 'bolsistas.csv', 'fellow');
    expect(projetar).toHaveBeenCalledTimes(2);
    expect(mapStub(fixture).pontos().map((ponto) => ponto.tipo)).toEqual(['tutor', 'fellow']);
  });

  it('keeps the import when the geographic projection fails and reports it', async () => {
    projetar.mockRejectedValueOnce(new Error('Base municipal indisponível.'));
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue(RELATIONSHIP_WORKBOOK);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await importWorkbook(fixture, 'vinculos-sinteticos.xlsx');
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.geo-error')?.textContent).toContain('Base municipal indisponível');
    expect(mapStub(fixture).pontos()).toHaveLength(2);
    expect(mapStub(fixture).pontos().every((ponto) => ponto.coordenada === null)).toBe(true);
    expect(mapStub(fixture).allocation()?.links).toEqual([]);
    expect(mapStub(fixture).allocation()?.tutors[0].status).toBe('below-minimum');
    navButton(root, 'Relações e rotas').click();
    fixture.detectChanges();
    expect(root.querySelectorAll('.imported-relations-table tbody tr')).toHaveLength(1);
  });

  it('counts missing municipalities by unique IBGE and records without IBGE separately', async () => {
    projetar.mockImplementationOnce(async (_workbook: unknown, lote: ImportBatch) =>
      cenarioDoLote(lote, {
        semLocalizacao: [
          { participanteId: 'a', nome: 'A', ibge6: '111111', motivo: 'sem base' },
          { participanteId: 'b', nome: 'B', ibge6: '111111', motivo: 'sem base' },
          { participanteId: 'c', nome: 'C', ibge6: null, motivo: 'sem IBGE' },
        ],
      }),
    );
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue(RELATIONSHIP_WORKBOOK);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await importWorkbook(fixture, 'vinculos-sinteticos.xlsx');
    const text = fixture.nativeElement.querySelector('.map-missing')?.textContent ?? '';
    const normalized = text.replace(/\s+/g, ' ');
    expect(normalized).toContain('1 município sem localização');
    expect(normalized).toContain('3 registros fora do mapa');
    expect(normalized).toContain('1 registro sem código IBGE');
    expect(normalized).toContain('IBGE 111111 — sem base: A, B');
    expect(normalized).toContain('Sem código IBGE — sem IBGE: C');
  });

  it('discards a pending projection when the session is cleared', async () => {
    let resolve: (cenario: CenarioMapa) => void = () => undefined;
    let pendingLote: ImportBatch | null = null;
    projetar.mockImplementationOnce(
      (_workbook: unknown, lote: ImportBatch) =>
        new Promise<CenarioMapa>((done) => {
          pendingLote = lote;
          resolve = done;
        }),
    );
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue(RELATIONSHIP_WORKBOOK);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await selectFile(fixture, 'vinculos-sinteticos.xlsx');
    const root: HTMLElement = fixture.nativeElement;
    root
      .querySelector<HTMLFormElement>('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    fixture.detectChanges();
    expect(root.querySelector('.geo-status')).not.toBeNull();
    [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Limpar dados'))
      ?.click();
    if (!pendingLote) throw new Error('Projeção não iniciada.');
    resolve(cenarioDoLote(pendingLote));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(mapStub(fixture).pontos()).toEqual([]);
    expect(root.querySelector('.geo-status')).toBeNull();
  });

  it('discards a pending file read when the session is cleared', async () => {
    const read = vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read');
    read.mockResolvedValue(RELATIONSHIP_WORKBOOK);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await importWorkbook(fixture, 'vinculos-sinteticos.xlsx');

    let resolveRead: (workbook: typeof RELATIONSHIP_WORKBOOK) => void = () => undefined;
    read.mockImplementationOnce(
      () => new Promise((done) => (resolveRead = done)),
    );
    const root: HTMLElement = fixture.nativeElement;
    dispatchFile(root, 'pessoal-pendente.xlsx');
    fixture.detectChanges();
    expect(root.textContent).toContain('Lendo o arquivo localmente');

    [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Limpar dados'))
      ?.click();
    fixture.detectChanges();
    expect(root.textContent).not.toContain('Lendo o arquivo localmente');

    resolveRead({ ...RELATIONSHIP_WORKBOOK, fileName: 'pessoal-pendente.xlsx' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('#import-title')).toBeNull();
    expect(root.textContent).not.toContain('Lendo o arquivo localmente');
    expect(root.textContent).not.toContain('pessoal-pendente.xlsx');
  });

  it('ignores an obsolete read without ending the loading state of a newer upload', async () => {
    const pending: ((workbook: typeof RELATIONSHIP_WORKBOOK) => void)[] = [];
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockImplementation(
      () => new Promise((done) => pending.push(done)),
    );
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    dispatchFile(root, 'antigo.xlsx');
    dispatchFile(root, 'novo.xlsx');
    expect(pending).toHaveLength(2);

    pending[0]({ ...RELATIONSHIP_WORKBOOK, fileName: 'antigo.xlsx' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('#import-title')).toBeNull();
    expect(root.textContent).toContain('Lendo o arquivo localmente');

    pending[1]({ ...RELATIONSHIP_WORKBOOK, fileName: 'novo.xlsx' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('#import-title')).not.toBeNull();
    expect(root.textContent).not.toContain('Lendo o arquivo localmente');
  });

  it('calculates a single link route on demand and keeps other distances on OSRM error', async () => {
    const route = vi.fn(() => throwError(() => new Error('OSRM fora do ar.')));
    TestBed.overrideProvider(ROUTING_PROVIDER, { useValue: { route } });
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue(RELATIONSHIP_WORKBOOK);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await importWorkbook(fixture, 'vinculos-sinteticos.xlsx');
    const root: HTMLElement = fixture.nativeElement;
    const select = root.querySelector<HTMLSelectElement>('#map-scenario');
    if (!select) throw new Error('Seletor do mapa ausente.');
    select.value = 'imported';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const tutor = mapStub(fixture).pontos().find((ponto) => ponto.tipo === 'tutor');
    mapStub(fixture).tutorSelected.emit(tutor?.id ?? null);
    fixture.detectChanges();
    const calculate = (): HTMLButtonElement | undefined =>
      [...root.querySelectorAll<HTMLButtonElement>('app-tutor-summary button')].find((button) =>
        button.textContent?.includes('Calcular rota'),
      );
    expect(calculate()?.disabled).toBe(true);
    const consent = root.querySelector<HTMLInputElement>('.tutor-summary__consent input');
    if (!consent) throw new Error('Consentimento não renderizado.');
    consent.checked = true;
    consent.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    calculate()?.click();
    fixture.detectChanges();
    expect(route).toHaveBeenCalledTimes(1);
    const table = root.querySelector('.tutor-summary__links')?.textContent ?? '';
    expect(table).toContain('OSRM fora do ar.');
    expect(table).toContain('3 km');
    expect(table.replace(/\s+/g, ' ')).toContain('0 km (mesmo município, centróide)');
  });

  it('creates an empty session without demo participants', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Importar Excel ou CSV');
    expect(fixture.nativeElement.textContent).not.toContain('Hello, mapa-estrategico');
  });

  it('adds separate tutor and fellow files to the same analysis', async () => {
    const workbookService = TestBed.inject(ExcelWorkbookService);
    vi.spyOn(workbookService, 'read').mockImplementation(async (file) => ({
      fileName: file.name,
      sheets: [
        {
          name: 'Dados',
          rows: [
            ['REGISTRO', 'NOME', 'MUNICIPIO', 'UF', 'TIPOLOGIA'],
            [1, 'Pessoa sintética', 'Cidade teste', 'SP', 'Urbano'],
          ],
        },
      ],
    }));

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    await importFile(fixture, 'tutores.csv', 'tutor');
    await importFile(fixture, 'bolsistas.csv', 'fellow');

    const summary = fixture.nativeElement.querySelector('.kpi-grid') as HTMLElement;
    const counts = [...summary.querySelectorAll<HTMLElement>('.kpi-value')].map((element) =>
      element.textContent?.trim(),
    );
    expect(counts.slice(0, 2)).toEqual(['1', '1']);
    expect(fixture.nativeElement.textContent).toContain('tutores.csv');
    expect(fixture.nativeElement.textContent).toContain('bolsistas.csv');
  });

  it('automatically selects the relationship sheet and imports both roles without classification', async () => {
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue({
      fileName: 'vinculos-sinteticos.xlsx',
      sheets: [
        { name: 'Resumo', rows: [['NOME_TUTOR', 'NOME_bolsista']] },
        {
          name: 'Nominal',
          rows: [
            ['CPF_TUTOR', 'NOME_TUTOR', 'CPF_bolsista', 'NOME_bolsista', 'km'],
            ['00000000001', 'Tutor sintético', '00000000002', 'Bolsista sintético', '52,5'],
          ],
        },
        { name: 'Alertas', rows: [['NOME', 'CPF', 'MOTIVO']] },
      ],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await selectFile(fixture, 'vinculos-sinteticos.xlsx');
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.file-type-field')).toBeNull();
    expect(root.textContent).toContain('Tutores e bolsistas reconhecidos automaticamente');
    expect(root.querySelector<HTMLSelectElement>('.import-selectors select')?.value).toBe(
      'Nominal',
    );
    root
      .querySelector<HTMLFormElement>('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(false);
    navButton(root, 'Relações e rotas').click();
    fixture.detectChanges();
    expect(root.querySelectorAll('.imported-relations-table tbody tr')).toHaveLength(1);
    expect(root.querySelector('.imported-relations-table')?.textContent).toContain('52.5');
    expect(root.querySelector('.imported-relations-table')?.textContent).toContain(
      'Tutor sintético',
    );
    expect(root.querySelector('.imported-relations-table')?.textContent).toContain(
      'Bolsista sintético',
    );
    expect(root.textContent).not.toContain('00000000001');
  });

  it('shows a clear workbook error when only a counts sheet is present', async () => {
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue({
      fileName: 'sem-nominal.xlsx',
      sheets: [
        {
          name: 'Não é uma nominal',
          rows: [
            ['NOME_TUTOR', 'IBGE_TUTOR', 'MUNICIPIO_TUTOR', 'Regra_agregacao', 'NOME_bolsista'],
            ['Tutor sintético', 123456, 'Cidade sintética', 'desconhecida', 5],
          ],
        },
      ],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await selectFile(fixture, 'sem-nominal.xlsx');
    const root: HTMLElement = fixture.nativeElement;
    root
      .querySelector<HTMLFormElement>('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.import-detailed-report')?.textContent).toContain('erro');
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Importação não aplicada');
    expect(root.querySelector('.imported-relations-table')).toBeNull();
    expect(root.querySelector('.file-type-field')).toBeNull();
  });

  it('keeps an unallocated tutor and shows its provisional identity in alerts', async () => {
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue({
      fileName: 'tutor-sem-bolsista.xlsx',
      sheets: [
        {
          name: 'Dados renomeados',
          rows: [
            ['CPF_TUTOR', 'NOME_TUTOR', 'IBGE_TUTOR', 'CPF_bolsista', 'NOME_bolsista', 'km'],
            ['XXX.000.001-XX', 'Tutor sintético sem bolsista', 123456, null, null, null],
          ],
        },
      ],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await selectFile(fixture, 'tutor-sem-bolsista.xlsx');
    const root: HTMLElement = fixture.nativeElement;
    root
      .querySelector<HTMLFormElement>('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    const report = root.querySelector('.import-detailed-report');
    expect(report?.textContent).toContain('1 tutores');
    expect(report?.textContent).toContain('0 bolsistas');
    const alerts = root.querySelector('[aria-labelledby="import-alerts-title"]');
    expect(alerts?.textContent).toContain('Tutor sintético sem bolsista');
    expect(alerts?.textContent).toContain('Identidade provisória');
    const issues = root.querySelector<HTMLDetailsElement>('.import-summary details');
    expect(issues).not.toBeNull();
    expect(issues?.open).toBe(false);
    expect(issues?.querySelector('summary')?.textContent).toContain('Ver avisos e erros');
    issues?.querySelector('summary')?.click();
    expect(issues?.open).toBe(true);
    expect(issues?.querySelector('.issue-list')?.textContent).toContain('Identidade provisória');
    expect(root.querySelector('.import-detailed-report')).not.toBeNull();
    expect(root.textContent).not.toContain('XXX.000.001-XX');
    expect(root.querySelectorAll('.imported-relations-table tbody tr')).toHaveLength(0);
  });

  it('cancels pending road routes when clearing the session', async () => {
    const pending = new Subject<RoadRoute>();
    TestBed.overrideProvider(ROUTING_PROVIDER, { useValue: { route: () => pending } });
    vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue({
      fileName: 'coordenadas-sinteticas.csv',
      sheets: [
        {
          name: 'Dados',
          rows: [
            ['Tipo', 'Nome', 'Latitude', 'Longitude'],
            ['Tutor', 'Tutor sintético', -20, -40],
            ['Bolsista', 'Bolsista sintético', -20.1, -40.1],
          ],
        },
      ],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await selectFile(fixture, 'coordenadas-sinteticas.csv');
    const root: HTMLElement = fixture.nativeElement;
    root
      .querySelector<HTMLFormElement>('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    const relationshipsTab = [...root.querySelectorAll<HTMLButtonElement>('nav button')].find(
      (button) => button.textContent?.includes('Relações e rotas'),
    );
    relationshipsTab?.click();
    fixture.detectChanges();
    const consent = root.querySelector<HTMLInputElement>('.route-consent input');
    if (!consent) throw new Error('Controle de consentimento não renderizado.');
    consent.checked = true;
    consent.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const calculate = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Calcular rota'),
    );
    expect(calculate).toBeDefined();
    calculate?.click();
    expect(pending.observed).toBe(true);
    [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Limpar dados'))
      ?.click();
    fixture.detectChanges();
    expect(pending.observed).toBe(false);
    expect(root.querySelector('.route-consent')).toBeNull();
  });

  describe('paginação das tabelas extensas', () => {
    /** 1 tutor + N bolsistas a poucos km: N pares e N + 1 participantes, todos com coordenadas. */
    function coordinateRows(fellows: number): (string | number)[][] {
      return [
        ['Tipo', 'Nome', 'Latitude', 'Longitude'],
        ['Tutor', 'Tutor sintético', -20, -40],
        ...Array.from({ length: fellows }, (_, index) => [
          'Bolsista',
          `Bolsista sintético ${String(index).padStart(3, '0')}`,
          -20 - (index + 1) / 10_000,
          -40,
        ]),
      ];
    }

    async function importCoordinates(fixture: ComponentFixture<App>, fellows: number) {
      vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue({
        fileName: 'coordenadas-sinteticas.csv',
        sheets: [{ name: 'Dados', rows: coordinateRows(fellows) }],
      });
      await importWorkbook(fixture, 'coordenadas-sinteticas.csv');
    }

    function rowTexts(root: HTMLElement, selector: string): string[] {
      return [...root.querySelectorAll<HTMLElement>(`${selector} tbody tr`)].map(
        (row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      );
    }

    function pagerButton(root: HTMLElement, navLabel: string, label: string): HTMLButtonElement {
      const nav = root.querySelector(`nav[aria-label="Paginação: ${navLabel}"]`);
      const button = [...(nav?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
        (item) => item.textContent?.trim() === label,
      );
      if (!button) throw new Error(`Botão ${label} ausente em ${navLabel}.`);
      return button;
    }

    function pagerStatus(root: HTMLElement, navLabel: string): string {
      return (
        root
          .querySelector(`nav[aria-label="Paginação: ${navLabel}"] [role=status]`)
          ?.textContent?.replace(/\s+/g, ' ')
          .trim() ?? ''
      );
    }

    it('limits the window to the available total (clamp) and covers boundaries', () => {
      expect(pageWindow(0, 3)).toEqual({ page: 0, pageCount: 1, start: 0, end: 0, total: 0 });
      expect(pageWindow(100, 1)).toEqual({ page: 0, pageCount: 1, start: 0, end: 100, total: 100 });
      expect(pageWindow(101, 1)).toEqual({ page: 1, pageCount: 2, start: 100, end: 101, total: 101 });
      expect(pageWindow(250, 9)).toEqual({ page: 2, pageCount: 3, start: 200, end: 250, total: 250 });
      expect(pageWindow(250, -4).page).toBe(0);
    });

    it('pages proximity pairs without losing rows and exports the full filtered set', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await importCoordinates(fixture, 150);
      const root: HTMLElement = fixture.nativeElement;
      navButton(root, 'Relações e rotas').click();
      fixture.detectChanges();

      const firstPage = rowTexts(root, '.route-panel .relations-table');
      expect(firstPage).toHaveLength(100);
      expect(pagerStatus(root, 'pares tutor–bolsista')).toBe(
        'Exibindo 1–100 de 150 pares · página 1 de 2',
      );
      expect(root.querySelector('.route-panel')?.textContent).toContain('150 pares dentro');
      const previous = pagerButton(root, 'pares tutor–bolsista', 'Anterior');
      expect(previous.getAttribute('aria-disabled')).toBe('true');

      const next = pagerButton(root, 'pares tutor–bolsista', 'Próxima');
      next.focus();
      next.click();
      fixture.detectChanges();
      const secondPage = rowTexts(root, '.route-panel .relations-table');
      expect(secondPage).toHaveLength(50);
      expect(pagerStatus(root, 'pares tutor–bolsista')).toBe(
        'Exibindo 101–150 de 150 pares · página 2 de 2',
      );
      // Botão no limite fica aria-disabled (não "disabled"), preservando o foco do teclado.
      expect(next.getAttribute('aria-disabled')).toBe('true');
      expect(next.disabled).toBe(false);
      expect(document.activeElement === next || !root.isConnected).toBe(true);
      next.click();
      fixture.detectChanges();
      expect(pagerStatus(root, 'pares tutor–bolsista')).toContain('página 2 de 2');

      // Unicidade e cobertura: as duas páginas somam todos os pares, sem repetição.
      const names = [...firstPage, ...secondPage].map((text) => /Bolsista sintético \d{3}/.exec(text)?.[0]);
      expect(new Set(names).size).toBe(150);
      expect(names.every((name) => name !== undefined)).toBe(true);

      const exportCsv = vi
        .spyOn(TestBed.inject(ReportExportService), 'exportCsv')
        .mockImplementation(() => undefined);
      [...root.querySelectorAll<HTMLButtonElement>('.page-heading button')]
        .find((button) => button.textContent?.includes('Exportar CSV'))
        ?.click();
      const exported = exportCsv.mock.calls[0]?.[0] ?? [];
      expect(exported).toHaveLength(150);
      expect(new Set(exported.map(({ fellow }) => fellow.id)).size).toBe(150);
      // Ordem do export = ordem completa exibida (linha reta crescente), não só a página.
      const distances = exported.map(({ pair }) => pair.straightLineKm);
      expect(distances).toEqual([...distances].sort((left, right) => left - right));
    });

    it('resets the pairs page when filtering and clamps when the list shrinks', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await importCoordinates(fixture, 150);
      const root: HTMLElement = fixture.nativeElement;
      navButton(root, 'Relações e rotas').click();
      fixture.detectChanges();
      pagerButton(root, 'pares tutor–bolsista', 'Última').click();
      fixture.detectChanges();
      expect(pagerStatus(root, 'pares tutor–bolsista')).toContain('página 2 de 2');

      const statusFilter = [...root.querySelectorAll<HTMLSelectElement>('.table-filters select')][1];
      if (!statusFilter) throw new Error('Filtro de status ausente.');
      statusFilter.value = 'not-calculated';
      statusFilter.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(pagerStatus(root, 'pares tutor–bolsista')).toContain('página 1 de 2');

      // Volta à última página e restringe a pesquisa: a página efetiva é limitada ao total.
      pagerButton(root, 'pares tutor–bolsista', 'Última').click();
      fixture.detectChanges();
      navButton(root, 'Visão geral').click();
      fixture.detectChanges();
      const search = root.querySelector<HTMLInputElement>('.topbar input[type=search]');
      if (!search) throw new Error('Pesquisa ausente.');
      search.value = 'Bolsista sintético 00';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      navButton(root, 'Relações e rotas').click();
      fixture.detectChanges();
      expect(rowTexts(root, '.route-panel .relations-table')).toHaveLength(10);
      expect(root.querySelector('nav[aria-label="Paginação: pares tutor–bolsista"]')).toBeNull();
    });

    it('pages participants, resets on filter and returns to page 1 on a new import', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await importCoordinates(fixture, 150);
      const root: HTMLElement = fixture.nativeElement;
      expect(rowTexts(root, '.people-panel')).toHaveLength(100);
      expect(pagerStatus(root, 'participantes')).toBe(
        'Exibindo 1–100 de 151 participantes · página 1 de 2',
      );
      expect(root.querySelector('.people-panel')?.textContent).toContain(
        '151 de 151 registros',
      );
      pagerButton(root, 'participantes', 'Próxima').click();
      fixture.detectChanges();
      expect(rowTexts(root, '.people-panel')).toHaveLength(51);
      const currentPage = pagerStatus(root, 'participantes');
      [...root.querySelectorAll<HTMLButtonElement>('.people-panel button')]
        .find((button) => button.textContent?.trim() === 'Ir para o mapa')?.click();
      fixture.detectChanges();
      [...root.querySelectorAll<HTMLButtonElement>('.map-heading-row button')]
        .find((button) => button.textContent?.trim() === 'Voltar aos participantes')?.click();
      fixture.detectChanges();
      expect(pagerStatus(root, 'participantes')).toBe(currentPage);

      const tutorsToggle = root.querySelector<HTMLInputElement>('.filter-controls input');
      if (!tutorsToggle) throw new Error('Filtro de tutores ausente.');
      tutorsToggle.checked = false;
      tutorsToggle.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(pagerStatus(root, 'participantes')).toBe(
        'Exibindo 1–100 de 150 participantes · página 1 de 2',
      );
      tutorsToggle.checked = true;
      tutorsToggle.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      pagerButton(root, 'participantes', 'Próxima').click();
      fixture.detectChanges();
      await importCoordinates(fixture, 150);
      // CSV simples acumula cadastros: 302 participantes, de volta à primeira página.
      expect(pagerStatus(root, 'participantes')).toBe(
        'Exibindo 1–100 de 302 participantes · página 1 de 4',
      );
    });

    it('pages imported relationships and exports every filtered relationship', async () => {
      const rows: (string | number)[][] = [
        ['CPF_TUTOR', 'NOME_TUTOR', 'IBGE_TUTOR', 'CPF_bolsista', 'NOME_bolsista', 'km'],
        ...Array.from({ length: 120 }, (_, index) => [
          '00000000001',
          'Tutor sintético',
          999999,
          String(10_000 + index).padStart(11, '0'),
          `Bolsista sintético ${String(index).padStart(3, '0')}`,
          String(index + 1),
        ]),
      ];
      vi.spyOn(TestBed.inject(ExcelWorkbookService), 'read').mockResolvedValue({
        fileName: 'vinculos-extensos.xlsx',
        sheets: [{ name: 'Nominal', rows }],
      });
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await importWorkbook(fixture, 'vinculos-extensos.xlsx');
      const root: HTMLElement = fixture.nativeElement;
      navButton(root, 'Relações e rotas').click();
      fixture.detectChanges();
      expect(rowTexts(root, '.imported-relations-table')).toHaveLength(100);
      expect(pagerStatus(root, 'vínculos informados')).toBe(
        'Exibindo 1–100 de 120 vínculos · página 1 de 2',
      );
      pagerButton(root, 'vínculos informados', 'Próxima').click();
      fixture.detectChanges();
      expect(rowTexts(root, '.imported-relations-table')).toHaveLength(20);

      const exportRelationships = vi
        .spyOn(TestBed.inject(ReportExportService), 'exportImportedRelationships')
        .mockResolvedValue();
      [...root.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('Exportar vínculos CSV'))
        ?.click();
      const exported = exportRelationships.mock.calls[0]?.[0] ?? [];
      expect(exported).toHaveLength(120);
      expect(new Set(exported.map(({ fellow }) => fellow.id)).size).toBe(120);
    });

    it('applies a route without recomputing pair geometry or the participant index', async () => {
      const success: RoadRoute = {
        status: 'success',
        distanceMeters: 12_300,
        durationSeconds: 900,
        provider: 'Roteador sintético',
        calculatedAt: '2026-01-01T00:00:00.000Z',
        profile: 'driving',
        message: null,
      };
      TestBed.overrideProvider(ROUTING_PROVIDER, { useValue: { route: () => of(success) } });
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await importCoordinates(fixture, 3);
      const internals = fixture.componentInstance as unknown as {
        proximityGeometry: () => readonly ProximityPair[];
        participantsById: () => ReadonlyMap<string, Participant>;
        allProximityPairs: () => readonly ProximityPair[];
      };
      const geometry = internals.proximityGeometry();
      const index = internals.participantsById();
      expect(geometry).toHaveLength(3);
      // Sem rotas, nenhuma cópia: a lista exibida é a própria geometria.
      expect(internals.allProximityPairs()).toBe(geometry);

      const root: HTMLElement = fixture.nativeElement;
      navButton(root, 'Relações e rotas').click();
      fixture.detectChanges();
      const consent = root.querySelector<HTMLInputElement>('.route-consent input');
      if (!consent) throw new Error('Consentimento ausente.');
      consent.checked = true;
      consent.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      [...root.querySelectorAll<HTMLButtonElement>('.relations-table button')]
        .find((button) => button.textContent?.includes('Calcular rota'))
        ?.click();
      fixture.detectChanges();

      expect(internals.proximityGeometry()).toBe(geometry);
      expect(internals.participantsById()).toBe(index);
      const withRoutes = internals.allProximityPairs();
      const routed = withRoutes.filter((pair) => pair.route !== null);
      expect(routed).toHaveLength(1);
      // Pares sem rota mantêm a referência da geometria; só o par roteado é um objeto novo.
      expect(withRoutes.filter((pair, index) => pair === geometry[index])).toHaveLength(2);
      expect(geometry.every((pair) => pair.route === null)).toBe(true);
      expect(routed[0]?.route?.distanceMeters).toBe(12_300);
      expect(root.querySelector('.route-panel')?.textContent).toContain('12.3 km');
    });
  });
});

function dispatchFile(root: HTMLElement, fileName: string): void {
  const fileInput = root.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) throw new Error('Seletor de arquivo ausente.');
  Object.defineProperty(fileInput, 'files', {
    configurable: true,
    value: [new File(['synthetic'], fileName)],
  });
  fileInput.dispatchEvent(new Event('change'));
}

function navButton(root: HTMLElement, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>('nav button')].find((item) =>
    item.textContent?.includes(label),
  );
  if (!button) throw new Error(`Aba ${label} não encontrada.`);
  return button;
}

async function selectFile(fixture: ComponentFixture<App>, fileName: string): Promise<void> {
  const fileInput = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(fileInput, 'files', {
    configurable: true,
    value: [new File(['synthetic'], fileName, { type: 'text/csv' })],
  });
  fileInput.dispatchEvent(new Event('change'));
  await fixture.whenStable();
  fixture.detectChanges();
}

async function importFile(
  fixture: ComponentFixture<App>,
  fileName: string,
  participantType: 'tutor' | 'fellow',
): Promise<void> {
  await selectFile(fixture, fileName);
  const typeSelector = fixture.nativeElement.querySelector(
    '.file-type-field select',
  ) as HTMLSelectElement;
  typeSelector.value = participantType;
  typeSelector.dispatchEvent(new Event('change'));
  fixture.detectChanges();

  const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await fixture.whenStable();
  fixture.detectChanges();
}
