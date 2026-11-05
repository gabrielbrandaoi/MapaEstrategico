import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, output } from '@angular/core';
import { By } from '@angular/platform-browser';
import { of, Subject, throwError } from 'rxjs';
import { ImportBatch, RoadRoute } from './domain/models';
import { CenarioMapa, PontoMapa, VinculoMapa } from './domain/mapa.models';
import { App } from './app';
import { ExcelWorkbookService } from './importing/excel-workbook.service';
import { MapProjectionService } from './geolocation/map-projection.service';
import { LeafletMapComponent } from './map/leaflet-map.component';
import { ROUTING_PROVIDER } from './routing/routing-provider';
import { vi } from 'vitest';

/** Substituto visual com o mesmo contrato público do mapa (sem Leaflet/rede no jsdom). */
@Component({ selector: 'app-leaflet-map', standalone: true, template: '' })
class LeafletMapStub {
  readonly pontos = input<readonly PontoMapa[]>([]);
  readonly vinculos = input<readonly VinculoMapa[]>([]);
  readonly selectedTutorId = input<string | null>(null);
  readonly show50Km = input(false);
  readonly show100Km = input(false);
  readonly tilesEnabled = input(false);
  readonly showTutors = input(true);
  readonly showFellows = input(true);
  readonly showLinks = input(true);
  readonly alertsOnly = input(false);
  readonly unallocatedOnly = input(false);
  readonly resetKey = input(0);
  readonly tutorSelected = output<string | null>();
  readonly pontoSelected = output<PontoMapa>();
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
        remove: { imports: [LeafletMapComponent] },
        add: { imports: [LeafletMapStub] },
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

  it('renders the map on an empty session and keeps the same instance across tabs', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const map = mapStub(fixture);
    expect(map.pontos()).toEqual([]);
    const root: HTMLElement = fixture.nativeElement;
    navButton(root, 'Relações e rotas').click();
    fixture.detectChanges();
    expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(true);
    navButton(root, 'Visão geral').click();
    fixture.detectChanges();
    expect(mapStub(fixture)).toBe(map);
    expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(false);
  });

  it('brings the overview and its map into view when "Visão geral" is clicked after an import', async () => {
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
      await importWorkbook(fixture, 'vinculos-sinteticos.xlsx');
      const root: HTMLElement = fixture.nativeElement;
      document.body.append(root);
      expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(true);
      // Import reports stay above the tab content on both tabs.
      expect(root.querySelector('.map-workspace')?.previousElementSibling).not.toBeNull();

      navButton(root, 'Visão geral').click();
      await fixture.whenStable();

      const heading = root.querySelector<HTMLElement>('#overview-title');
      expect(root.querySelector<HTMLElement>('.map-workspace')?.hidden).toBe(false);
      expect(scrolled).toContain(heading);
      expect(document.activeElement).toBe(heading);
      expect(mapStub(fixture).pontos()).toHaveLength(2);

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
    const root: HTMLElement = fixture.nativeElement;
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
    expect(mapStub(fixture).pontos()).toEqual([]);
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
    const tutor = mapStub(fixture).pontos().find((ponto) => ponto.tipo === 'tutor');
    mapStub(fixture).tutorSelected.emit(tutor?.id ?? null);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
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
