import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  PendingTasks,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, takeUntil } from 'rxjs';
import { LeafletMapComponent } from './map/leaflet-map.component';
import { LinhaVinculoTutor, TutorSummaryComponent } from './map/tutor-summary.component';
import { MapProjectionService } from './geolocation/map-projection.service';
import { CenarioMapa, Coordenada, PontoMapa, ResumoTutor } from './domain/mapa.models';
import { calcularVinculos, resumirTutor } from './domain/tutor-map-metrics';
import { classifyRoadDistance } from './domain/distance';
import { calculateDashboardStatistics } from './domain/dashboard-metrics';
import {
  ColumnMapping,
  ImportBatch,
  ImportReport,
  Location,
  ParsedWorkbook,
  Participant,
  ParticipantType,
  ProximityPair,
  RoadRoute,
} from './domain/models';
import { buildProximityPairs } from './domain/proximity';
import { RelatorioImportacao } from './importing/import-contracts';
import {
  AlertaParaInterface,
  ImportadorPlanilhaService,
  PreparacaoMapeamento,
} from './importing/importador-planilha.service';
import { ReportExportService } from './reports/report-export.service';
import { ROUTING_PROVIDER } from './routing/routing-provider';
import { DEFAULT_ALLOCATION_CONFIG } from './domain/allocation.models';
import {
  simulationScenarios, simulationPoints, simulationLinks, TUTOR_STATUS_LABELS,
} from './map/allocation-presentation';
import { SimulationsComponent } from './simulations/simulations.component';

type MappingControls = {
  [Key in keyof ColumnMapping]: FormControl<string>;
};

type RoadFilter = 'all' | 'not-calculated' | 'success' | 'unavailable' | 'error';
type PairSort = 'straight-line' | 'road-distance';
type ParticipantSort = 'name' | 'city' | 'type' | 'source-row';
type GeoStatus = 'idle' | 'loading' | 'ready' | 'error';
type AppTab = 'overview' | 'simulations' | 'relationships';
type PagedTable = 'participants' | 'pairs' | 'importedRelationships';

/** Linhas renderizadas por página nas tabelas extensas; exportações usam o conjunto completo. */
export const TABLE_PAGE_SIZE = 100;

export interface TablePageWindow {
  /** Página efetiva (0-based), já limitada ao total disponível. */
  readonly page: number;
  readonly pageCount: number;
  /** Índice inicial (inclusivo) e final (exclusivo) da fatia exibida. */
  readonly start: number;
  readonly end: number;
  readonly total: number;
}

const FIRST_PAGES: Readonly<Record<PagedTable, number>> = {
  participants: 0,
  pairs: 0,
  importedRelationships: 0,
};

const TAB_HEADING_IDS: Record<AppTab, string> = {
  overview: 'overview-title',
  simulations: 'simulations-title',
  relationships: 'relationships-title',
};

interface CenarioLote {
  readonly loteId: string;
  readonly cenario: CenarioMapa;
}

const EMPTY_MAPPING: ColumnMapping = {
  type: null,
  name: null,
  city: null,
  state: null,
  address: null,
  postalCode: null,
  latitude: null,
  longitude: null,
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LeafletMapComponent, TutorSummaryComponent, SimulationsComponent],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly importador = inject(ImportadorPlanilhaService);
  private readonly reportExportService = inject(ReportExportService);
  private readonly routingProvider = inject(ROUTING_PROVIDER);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mapProjection = inject(MapProjectionService);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly sessionCleared = new Subject<void>();
  private importSequence = 0;
  private sessionGeneration = 0;
  private pendingProjections = 0;
  /** Invalida leituras de arquivo obsoletas (limpar, cancelar ou novo upload). */
  private fileReadGeneration = 0;

  protected readonly participants = signal<Participant[]>([]);
  protected readonly allocationConfig = DEFAULT_ALLOCATION_CONFIG;
  protected readonly tutorStatusLabels = TUTOR_STATUS_LABELS;
  protected readonly mapScenario = signal<'imported' | '1' | '2'>('1');
  protected readonly allocationMode = computed(() =>
    this.mapScenario() === 'imported' ? 'imported' : 'simulation',
  );
  protected readonly simulationMinimum = computed<1 | 2>(() =>
    this.mapScenario() === '2' ? 2 : 1,
  );
  protected readonly simulationScenarios = computed(() => simulationScenarios(this.participants()));
  protected readonly selectedSimulation = computed(() =>
    this.simulationScenarios().find((scenario) => scenario.minimum === this.simulationMinimum()) ?? null,
  );
  protected readonly allocationResult = computed(() =>
    this.allocationMode() === 'simulation' ? this.selectedSimulation()?.result ?? null : null,
  );
  protected readonly selectedSimulationTutor = computed(() =>
    this.allocationResult()?.tutors.find((tutor) => tutor.tutorId === this.selectedTutorId()) ?? null,
  );
  protected readonly selectedSimulationFellow = computed(() =>
    this.allocationResult()?.unassignedFellows.find(
      (fellow) => fellow.fellowId === this.selectedParticipant()?.id,
    ) ?? null,
  );
  protected readonly parsedWorkbook = signal<ParsedWorkbook | null>(null);
  protected readonly selectedSheetName = signal('');
  protected readonly headerRowIndex = signal(-1);
  protected readonly importBatches = signal<(ImportBatch & { linhasComErro: number })[]>([]);
  protected readonly relatoriosDetalhados = signal<RelatorioImportacao[]>([]);
  protected readonly alertasImportados = signal<AlertaParaInterface[]>([]);
  protected readonly preparacao = signal<PreparacaoMapeamento | null>(null);
  protected readonly fileParticipantType = signal<ParticipantType | null>(null);
  private readonly selectedParticipantId = signal<string | null>(null);
  protected readonly selectedParticipant = computed(() => {
    const id = this.selectedParticipantId();
    return id === null ? null : (this.participantById(id) ?? null);
  });
  protected readonly selectedTutorId = signal<string | null>(null);
  protected readonly activeTab = signal<AppTab>('overview');
  protected readonly searchText = signal('');
  protected readonly tutorFilter = signal(true);
  protected readonly fellowFilter = signal(true);
  protected readonly show50Km = signal(true);
  protected readonly show130Km = signal(true);
  protected readonly tilesEnabled = signal(false);
  protected readonly showLinks = signal(true);
  protected readonly alertsOnly = signal(false);
  protected readonly unallocatedOnly = signal(false);
  protected readonly mapResetKey = signal(0);
  protected readonly cenariosPorLote = signal<readonly CenarioLote[]>([]);
  protected readonly geoStatus = signal<GeoStatus>('idle');
  protected readonly geoError = signal<string | null>(null);
  protected readonly routesByVinculo = signal<ReadonlyMap<string, RoadRoute>>(new Map());
  protected readonly loadingVinculos = signal<ReadonlySet<string>>(new Set());
  protected readonly routeConsent = signal(false);
  protected readonly loadingRouteKeys = signal<ReadonlySet<string>>(new Set());
  protected readonly routesByPair = signal<ReadonlyMap<string, RoadRoute>>(new Map());
  protected readonly roadFilter = signal<RoadFilter>('all');
  protected readonly pairSort = signal<PairSort>('straight-line');
  protected readonly participantSort = signal<ParticipantSort>('name');
  protected readonly isReadingFile = signal(false);
  protected readonly isProcessingImport = signal(false);
  protected readonly fileError = signal<string | null>(null);
  protected readonly operationError = signal<string | null>(null);
  private readonly mappingRevision = signal(0);
  /** Página solicitada por tabela; a página efetiva é limitada em `*Page` (clamp). */
  private readonly requestedPages = signal<Readonly<Record<PagedTable, number>>>(FIRST_PAGES);

  protected readonly mappingForm = new FormGroup<MappingControls>({
    type: new FormControl('', { nonNullable: true }),
    name: new FormControl('', { nonNullable: true }),
    city: new FormControl('', { nonNullable: true }),
    state: new FormControl('', { nonNullable: true }),
    address: new FormControl('', { nonNullable: true }),
    postalCode: new FormControl('', { nonNullable: true }),
    latitude: new FormControl('', { nonNullable: true }),
    longitude: new FormControl('', { nonNullable: true }),
  });

  protected readonly mappingFields: ReadonlyArray<{
    key: keyof ColumnMapping;
    label: string;
    required: boolean;
  }> = [
    { key: 'type', label: 'Tipo de participante (coluna)', required: false },
    { key: 'name', label: 'Nome', required: true },
    { key: 'city', label: 'Cidade', required: false },
    { key: 'state', label: 'UF / estado', required: false },
    { key: 'address', label: 'Endereço', required: false },
    { key: 'postalCode', label: 'CEP', required: false },
    { key: 'latitude', label: 'Latitude', required: false },
    { key: 'longitude', label: 'Longitude', required: false },
  ];

  constructor() {
    this.mappingForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.mappingRevision.update((revision) => revision + 1));
  }

  protected readonly currentSheet = computed(() => {
    const workbook = this.parsedWorkbook();
    return workbook?.sheets.find((sheet) => sheet.name === this.selectedSheetName());
  });

  protected readonly headerRowOptions = computed(() => {
    const rows = this.currentSheet()?.rows ?? [];
    return rows
      .slice(0, 20)
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.some((cell) => String(cell ?? '').trim() !== ''))
      .map(({ index }) => ({
        index,
        label: `Linha ${index + 1}`,
      }));
  });

  protected readonly columnOptions = computed(() => {
    const row = this.currentSheet()?.rows[this.headerRowIndex()] ?? [];
    return row.map((value, index) => ({
      value: String(index),
      label: String(value ?? '').trim() || `Coluna ${index + 1}`,
    }));
  });

  protected readonly workbookMode = computed(() => this.preparacao()?.modo === 'workbook');

  protected readonly importedRelationships = computed(() =>
    this.importBatches().flatMap((batch) => batch.report.relationships ?? []),
  );

  protected readonly visibleImportedRelationships = computed(() => {
    const query = normalizeSearch(this.searchText());
    return this.importedRelationships()
      .filter((relationship) => {
        const tutor = this.participantById(relationship.tutorId);
        const fellow = this.participantById(relationship.fellowId);
        return normalizeSearch(
          `${tutor?.name ?? ''} ${tutor?.city ?? ''} ${fellow?.name ?? ''} ${fellow?.city ?? ''}`,
        ).includes(query);
      })
      .sort(
        (left, right) =>
          (left.reportedKm ?? Number.POSITIVE_INFINITY) -
          (right.reportedKm ?? Number.POSITIVE_INFINITY),
      );
  });

  protected readonly filteredParticipants = computed(() => {
    const query = normalizeSearch(this.searchText());
    const participants = this.participants().filter((participant) => {
      if (participant.type === 'tutor' && !this.tutorFilter()) {
        return false;
      }
      if (participant.type === 'fellow' && !this.fellowFilter()) {
        return false;
      }
      return (
        query === '' ||
        normalizeSearch(
          [
            participant.name,
            participant.city ?? '',
            participant.state ?? '',
            participant.address ?? '',
          ].join(' '),
        ).includes(query)
      );
    });

    return participants.sort((left, right) => {
      switch (this.participantSort()) {
        case 'city':
          return (left.city ?? '').localeCompare(right.city ?? '', 'pt-BR');
        case 'type':
          return left.type.localeCompare(right.type, 'pt-BR');
        case 'source-row':
          return left.sourceRow - right.sourceRow;
        case 'name':
          return left.name.localeCompare(right.name, 'pt-BR');
      }
    });
  });

  private readonly importedMapPontos = computed<readonly PontoMapa[]>(() =>
    this.cenariosPorLote().flatMap(({ cenario }) => cenario.pontos),
  );

  protected readonly mapPontos = computed<readonly PontoMapa[]>(() =>
    this.allocationMode() === 'simulation'
      ? simulationPoints(this.participants(), this.importedMapPontos(), this.allocationResult())
      : this.importedMapPontos(),
  );

  private readonly pontosPorId = computed(
    () => new Map(this.mapPontos().map((ponto) => [ponto.id, ponto] as const)),
  );

  /** Vínculos de todos os lotes, com rotas sob demanda aplicadas e métricas do domínio. */
  protected readonly mapVinculos = computed(() => {
    if (this.allocationMode() === 'simulation') return simulationLinks(this.allocationResult());
    const rotas = this.routesByVinculo();
    const vinculos = this.cenariosPorLote().flatMap(({ cenario }) =>
      cenario.vinculos.map((vinculo) => {
        const rota = rotas.get(vinculo.id);
        return rota ? { ...vinculo, rota } : vinculo;
      }),
    );
    return calcularVinculos(this.mapPontos(), vinculos);
  });

  private readonly selectedTutorVinculos = computed(() => {
    const id = this.selectedTutorId();
    return id === null ? [] : this.mapVinculos().filter((vinculo) => vinculo.tutorId === id);
  });

  /** Pontos filtrados pela busca; o tutor selecionado e seus bolsistas nunca são ocultados. */
  protected readonly visibleMapPontos = computed(() => {
    const query = normalizeSearch(this.searchText());
    if (query === '') return this.mapPontos();
    const selected = this.selectedTutorId();
    const ligados = new Set(this.selectedTutorVinculos().map((vinculo) => vinculo.bolsistaId));
    return this.mapPontos().filter(
      (ponto) =>
        ponto.id === selected ||
        ligados.has(ponto.id) ||
        normalizeSearch(`${ponto.nome} ${ponto.municipio ?? ''}`).includes(query),
    );
  });

  /** Vínculos com ambos os extremos visíveis; os do tutor selecionado são sempre preservados. */
  protected readonly visibleMapVinculos = computed(() => {
    const selected = this.selectedTutorId();
    const ids = new Set(this.visibleMapPontos().map((ponto) => ponto.id));
    return this.mapVinculos().filter(
      (vinculo) =>
        vinculo.tutorId === selected || (ids.has(vinculo.tutorId) && ids.has(vinculo.bolsistaId)),
    );
  });

  protected readonly selectedTutorPonto = computed(() => {
    const id = this.selectedTutorId();
    const ponto = id === null ? undefined : this.pontosPorId().get(id);
    return ponto?.tipo === 'tutor' ? ponto : null;
  });

  protected readonly selectedTutorSummary = computed<ResumoTutor | null>(() => {
    const tutor = this.selectedTutorPonto();
    return tutor ? resumirTutor(tutor, this.selectedTutorVinculos()) : null;
  });

  protected readonly selectedTutorLinhas = computed<readonly LinhaVinculoTutor[]>(() => {
    const pontos = this.pontosPorId();
    const loading = this.loadingVinculos();
    return this.selectedTutorVinculos().map((vinculo) => ({
      vinculo,
      bolsista: pontos.get(vinculo.bolsistaId) ?? null,
      carregandoRota: loading.has(vinculo.id),
    }));
  });

  /** Problemas agrupados por IBGE + motivo (nomes apenas; sem CPF). */
  protected readonly missingLocationItems = computed(() => {
    const grupos = new Map<string, { chave: string; ibge6: string | null; motivo: string; nomes: string[] }>();
    for (const { cenario } of this.cenariosPorLote()) {
      for (const item of cenario.semLocalizacao) {
        const chave = `${item.ibge6 ?? ''}::${item.motivo}`;
        const grupo = grupos.get(chave) ?? { chave, ibge6: item.ibge6, motivo: item.motivo, nomes: [] };
        grupo.nomes.push(item.nome);
        grupos.set(chave, grupo);
      }
    }
    return [...grupos.values()];
  });

  /** Municípios distintos (IBGE) sem coordenada vs. registros sem IBGE identificável. */
  protected readonly missingLocationSummary = computed(() => {
    const itens = this.cenariosPorLote().flatMap(({ cenario }) => cenario.semLocalizacao);
    const municipios = new Set(itens.flatMap((item) => (item.ibge6 ? [item.ibge6] : [])));
    return {
      registros: itens.length,
      municipios: municipios.size,
      registrosSemIbge: itens.filter((item) => !item.ibge6).length,
    };
  });

  /** Índice por ID, recalculado apenas quando o cadastro muda. */
  private readonly participantsById = computed(
    () =>
      new Map(this.participants().map((participant) => [participant.id, participant] as const)),
  );

  /**
   * Geometria dos pares (haversine + ordenação) depende só do cadastro; atualizar uma rota
   * não deve refazer este cálculo.
   */
  private readonly proximityGeometry = computed(() =>
    buildProximityPairs(this.participants(), DEFAULT_ALLOCATION_CONFIG.raioMaxKm),
  );

  /**
   * Pares com rota aplicada. A geometria já traz `route: null`; sem rota, a referência do par é
   * reutilizada para não duplicar objetos em cargas grandes. Só pares roteados geram novo objeto.
   */
  protected readonly allProximityPairs = computed<readonly ProximityPair[]>(() => {
    const routes = this.routesByPair();
    const geometry = this.proximityGeometry();
    if (routes.size === 0) return geometry;
    return geometry.map((pair) => {
      const route = routes.get(pairKey(pair));
      return route ? { ...pair, route } : pair;
    });
  });

  protected readonly visibleProximityPairs = computed(() => {
    const query = normalizeSearch(this.searchText());
    const filter = this.roadFilter();
    const pairs = this.allProximityPairs().filter((pair) => {
      const tutor = this.participantById(pair.tutorId);
      const fellow = this.participantById(pair.fellowId);
      const matchesQuery =
        query === '' ||
        normalizeSearch(
          `${tutor?.name ?? ''} ${tutor?.city ?? ''} ${fellow?.name ?? ''} ${fellow?.city ?? ''}`,
        ).includes(query);
      const matchesRoute =
        filter === 'all' ||
        (filter === 'not-calculated' && pair.route === null) ||
        (filter !== 'not-calculated' && pair.route?.status === filter);
      return matchesQuery && matchesRoute;
    });

    return pairs.sort((left, right) => {
      if (this.pairSort() === 'road-distance') {
        const leftDistance =
          left.route?.status === 'success'
            ? (left.route.distanceMeters ?? Number.POSITIVE_INFINITY)
            : Number.POSITIVE_INFINITY;
        const rightDistance =
          right.route?.status === 'success'
            ? (right.route.distanceMeters ?? Number.POSITIVE_INFINITY)
            : Number.POSITIVE_INFINITY;
        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }
      }
      return left.straightLineKm - right.straightLineKm;
    });
  });

  protected readonly participantsPage = computed(() =>
    pageWindow(this.filteredParticipants().length, this.requestedPages().participants),
  );
  protected readonly pagedParticipants = computed(() => {
    const { start, end } = this.participantsPage();
    return this.filteredParticipants().slice(start, end);
  });

  protected readonly pairsPage = computed(() =>
    pageWindow(this.visibleProximityPairs().length, this.requestedPages().pairs),
  );
  protected readonly pagedProximityPairs = computed(() => {
    const { start, end } = this.pairsPage();
    return this.visibleProximityPairs().slice(start, end);
  });

  protected readonly importedRelationshipsPage = computed(() =>
    pageWindow(
      this.visibleImportedRelationships().length,
      this.requestedPages().importedRelationships,
    ),
  );
  protected readonly pagedImportedRelationships = computed(() => {
    const { start, end } = this.importedRelationshipsPage();
    return this.visibleImportedRelationships().slice(start, end);
  });

  protected readonly statistics = computed(() =>
    calculateDashboardStatistics(this.participants(), this.allProximityPairs()),
  );

  protected readonly hasTypeColumnMapping = computed(() => {
    this.mappingRevision();
    return this.mappingForm.controls.type.value !== '';
  });

  protected readonly canProcessImport = computed(() => {
    if (this.workbookMode()) return true;
    this.mappingRevision();
    const values = this.mappingForm.getRawValue();
    const hasAnyLocationColumn =
      values.address !== '' ||
      values.city !== '' ||
      values.latitude !== '' ||
      values.longitude !== '';
    return (
      values.name !== '' &&
      (values.type !== '' || this.fileParticipantType() !== null) &&
      hasAnyLocationColumn
    );
  });

  protected displayedIssues(report: ImportReport): ImportReport['issues'] {
    return report.issues.slice(0, 100);
  }

  protected openFilePicker(fileInput: HTMLInputElement): void {
    fileInput.click();
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    const file = target.files?.[0];
    target.value = '';
    if (!file) {
      return;
    }

    const readToken = ++this.fileReadGeneration;
    this.isReadingFile.set(true);
    this.fileError.set(null);
    this.operationError.set(null);
    this.parsedWorkbook.set(null);
    this.fileParticipantType.set(null);
    try {
      const workbook = await this.importador.ler(file);
      if (readToken !== this.fileReadGeneration) return;
      this.parsedWorkbook.set(workbook);
      this.applyPreparation(this.importador.preparar(workbook));
    } catch (error: unknown) {
      if (readToken !== this.fileReadGeneration) return;
      this.fileError.set(
        error instanceof Error ? error.message : 'Falha ao ler o arquivo selecionado.',
      );
    } finally {
      // Só a leitura mais recente encerra o indicador; leituras obsoletas são descartadas.
      if (readToken === this.fileReadGeneration) this.isReadingFile.set(false);
    }
  }

  protected onSheetSelected(event: Event): void {
    const value = inputValue(event);
    if (!value) {
      return;
    }
    this.selectedSheetName.set(value);
    const workbook = this.parsedWorkbook();
    if (workbook) this.applyPreparation(this.importador.preparar(workbook, value));
  }

  protected onHeaderRowSelected(event: Event): void {
    const value = Number(inputValue(event));
    if (!Number.isInteger(value) || value < 0) {
      return;
    }
    this.headerRowIndex.set(value);
    const workbook = this.parsedWorkbook();
    if (workbook)
      this.applyPreparation(this.importador.preparar(workbook, this.selectedSheetName(), value));
  }

  protected onFileParticipantTypeChanged(event: Event): void {
    const value = inputValue(event);
    if (value === 'tutor' || value === 'fellow') {
      this.fileParticipantType.set(value);
    } else {
      this.fileParticipantType.set(null);
    }
  }

  protected async processImport(): Promise<void> {
    const workbook = this.parsedWorkbook();
    if (!workbook || !this.currentSheet() || !this.canProcessImport()) {
      this.operationError.set(
        'Selecione a aba e o cabeçalho, mapeie nome e localização e informe o tipo do arquivo ou mapeie a coluna de tipo.',
      );
      return;
    }

    this.isProcessingImport.set(true);
    this.operationError.set(null);
    const values = this.mappingForm.getRawValue();
    const toIndex = (value: string): number | null => {
      if (value === '') {
        return null;
      }
      const index = Number(value);
      return Number.isInteger(index) && index >= 0 ? index : null;
    };
    const mapping: ColumnMapping = {
      type: toIndex(values.type),
      name: toIndex(values.name),
      city: toIndex(values.city),
      state: toIndex(values.state),
      address: toIndex(values.address),
      postalCode: toIndex(values.postalCode),
      latitude: toIndex(values.latitude),
      longitude: toIndex(values.longitude),
    };

    const replacesScenario = this.workbookMode();
    const loteId = `lote-${++this.importSequence}`;
    let projection: { workbook: ParsedWorkbook; lote: ImportBatch } | null = null;
    try {
      const resultado = this.importador.importar(workbook, {
        aba: this.selectedSheetName(),
        cabecalho: this.headerRowIndex(),
        mapeamento: mapping,
        tipo: this.fileParticipantType(),
        loteId,
      });
      if (resultado.relatorio.estado === 'erro') {
        this.relatoriosDetalhados.update((relatorios) => [...relatorios, resultado.relatorio]);
        this.operationError.set(
          'Importação não aplicada. Consulte os erros e pontos de atenção no relatório.',
        );
        return;
      }
      // Planilha completa substitui o cenário anterior; CSV simples acumula cadastros.
      if (replacesScenario) this.resetAnalysisState();
      this.relatoriosDetalhados.update((relatorios) => [...relatorios, resultado.relatorio]);
      this.importBatches.update((batches) => [
        ...batches,
        {
          ...resultado.dados.lote,
          linhasComErro: resultado.dados.linhasComErro,
        },
      ]);
      this.participants.update((participants) => [
        ...participants,
        ...resultado.dados.lote.report.participants,
      ]);
      this.alertasImportados.update((alertas) => [...alertas, ...resultado.dados.alertas]);
      this.selectTab('overview');
      this.resetPages();
      this.parsedWorkbook.set(null);
      this.selectedSheetName.set('');
      this.headerRowIndex.set(-1);
      this.mappingForm.reset(emptyMappingFormValue());
      this.fileParticipantType.set(null);
      this.preparacao.set(null);
      this.mapResetKey.update((key) => key + 1);
      projection = { workbook, lote: resultado.dados.lote };
    } catch (error: unknown) {
      this.operationError.set(
        error instanceof Error ? error.message : 'Não foi possível validar a planilha.',
      );
    } finally {
      this.isProcessingImport.set(false);
    }
    if (projection) await this.projectScenario(projection.workbook, projection.lote, loteId);
  }

  protected cancelImport(): void {
    this.fileReadGeneration += 1;
    this.isReadingFile.set(false);
    this.parsedWorkbook.set(null);
    this.selectedSheetName.set('');
    this.headerRowIndex.set(-1);
    this.mappingForm.reset(emptyMappingFormValue());
    this.fileParticipantType.set(null);
    this.preparacao.set(null);
    this.fileError.set(null);
    this.operationError.set(null);
  }

  protected clearData(): void {
    this.resetAnalysisState();
    this.mapScenario.set('1');
    this.mapResetKey.update((key) => key + 1);
    this.tilesEnabled.set(false);
    this.searchText.set('');
    this.roadFilter.set('all');
    this.pairSort.set('straight-line');
    this.cancelImport();
  }

  protected onShowLinksChanged(event: Event): void {
    this.showLinks.set(inputChecked(event));
  }

  protected onAlertsOnlyChanged(event: Event): void {
    this.alertsOnly.set(inputChecked(event));
  }

  protected onUnallocatedOnlyChanged(event: Event): void {
    this.unallocatedOnly.set(inputChecked(event));
  }

  protected onMapTutorSelected(tutorId: string | null): void {
    if (tutorId === null) {
      this.deselectTutor();
      return;
    }
    this.selectedTutorId.set(tutorId);
    this.selectedParticipantId.set(tutorId);
  }

  protected onMapPontoSelected(ponto: PontoMapa): void {
    if (ponto.tipo === 'tutor') {
      this.onMapTutorSelected(ponto.id);
      return;
    }
    // Bolsista: mostra os detalhes sem perder o tutor em foco.
    this.selectedParticipantId.set(ponto.id);
  }

  protected deselectTutor(): void {
    this.selectedTutorId.set(null);
    this.selectedParticipantId.set(null);
    this.mapResetKey.update((key) => key + 1);
  }

  protected onSearchChanged(event: Event): void {
    this.searchText.set(inputValue(event));
    this.resetPages();
  }

  protected clearSearch(input: HTMLInputElement): void {
    this.searchText.set('');
    this.resetPages();
    input.focus();
  }

  protected resetViewFilters(): void {
    this.searchText.set('');
    this.tutorFilter.set(true);
    this.fellowFilter.set(true);
    this.roadFilter.set('all');
    this.resetPages();
  }

  protected onTutorFilterChanged(event: Event): void {
    this.tutorFilter.set(inputChecked(event));
    this.resetPages('participants');
  }

  protected onFellowFilterChanged(event: Event): void {
    this.fellowFilter.set(inputChecked(event));
    this.resetPages('participants');
  }

  protected onTilesConsentChanged(event: Event): void {
    this.tilesEnabled.set(inputChecked(event));
  }

  protected onRouteConsentChanged(event: Event): void {
    this.routeConsent.set(inputChecked(event));
  }

  protected on50KmChanged(event: Event): void {
    this.show50Km.set(inputChecked(event));
  }

  protected on130KmChanged(event: Event): void {
    this.show130Km.set(inputChecked(event));
  }

  protected onMapScenarioChanged(event: Event): void {
    const value = inputValue(event);
    if (value !== 'imported' && value !== '1' && value !== '2') {
      this.operationError.set('Selecione um cenário válido para o mapa.');
      return;
    }
    this.operationError.set(null);
    this.mapScenario.set(value);
    this.deselectTutor();
  }

  protected onRoadFilterChanged(event: Event): void {
    const value = inputValue(event);
    if (
      value === 'all' ||
      value === 'not-calculated' ||
      value === 'success' ||
      value === 'unavailable' ||
      value === 'error'
    ) {
      this.roadFilter.set(value);
      this.resetPages('pairs');
    }
  }

  protected onPairSortChanged(event: Event): void {
    const value = inputValue(event);
    if (value === 'straight-line' || value === 'road-distance') {
      this.pairSort.set(value);
      this.resetPages('pairs');
    }
  }

  protected onParticipantSortChanged(event: Event): void {
    const value = inputValue(event);
    if (value === 'name' || value === 'city' || value === 'type' || value === 'source-row') {
      this.participantSort.set(value);
      this.resetPages('participants');
    }
  }

  /** Navega para a página solicitada; valores fora do intervalo são ignorados. */
  protected goToPage(table: PagedTable, page: number): void {
    const current = this.pageWindowOf(table);
    if (!Number.isInteger(page) || page < 0 || page >= current.pageCount || page === current.page) {
      return;
    }
    this.requestedPages.update((pages) => ({ ...pages, [table]: page }));
  }

  protected selectParticipant(participant: Participant): void {
    this.selectedParticipantId.set(participant.id);
    this.selectedTutorId.set(participant.type === 'tutor' ? participant.id : null);
  }

  protected viewOnMap(participant: Participant): void {
    this.selectParticipant(participant);
    this.goToMap();
  }

  protected goToMap(): void {
    this.selectTab('overview', 'map-title');
  }

  protected goToParticipants(): void {
    this.selectTab('overview', 'people-title');
  }

  protected selectTab(tab: AppTab, headingId: string = TAB_HEADING_IDS[tab]): void {
    this.activeTab.set(tab);
    afterNextRender(
      () => {
        const heading = this.document.getElementById(headingId);
        if (!heading) return;
        const view = this.document.defaultView;
        const fixedBars = this.document.querySelectorAll<HTMLElement>('.navigation-bar, .topbar');
        let stickyHeight = 0;
        for (const bar of fixedBars) {
          if (view?.getComputedStyle(bar).position === 'sticky') {
            stickyHeight += bar.getBoundingClientRect().height;
          }
        }
        const content = this.document.querySelector('.content-wrap');
        const spacing = content && view ? Number.parseFloat(view.getComputedStyle(content).rowGap) : 0;
        heading.style.scrollMarginTop = `${stickyHeight + (Number.isFinite(spacing) ? spacing : 0)}px`;
        if (typeof heading.scrollIntoView === 'function') {
          heading.scrollIntoView({ block: 'start' });
        }
        heading.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  protected calculateRoadRoute(pair: ProximityPair): void {
    if (!this.routeConsent()) {
      this.operationError.set(
        'Confirme a autorização para enviar ao OSRM as coordenadas do par selecionado.',
      );
      return;
    }

    const tutor = this.participantById(pair.tutorId);
    const fellow = this.participantById(pair.fellowId);
    if (!tutor?.location || !fellow?.location) {
      this.operationError.set(
        'Não é possível calcular a rota: este par não possui coordenadas válidas.',
      );
      return;
    }

    const key = pairKey(pair);
    const generation = this.sessionGeneration;
    this.operationError.set(null);
    this.loadingRouteKeys.update((keys) => new Set(keys).add(key));
    this.routingProvider
      .route(tutor.location, fellow.location)
      .pipe(takeUntil(this.sessionCleared), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (route) => {
          if (generation !== this.sessionGeneration) return;
          this.routesByPair.update((routes) => new Map(routes).set(key, route));
          this.loadingRouteKeys.update((keys) => {
            const next = new Set(keys);
            next.delete(key);
            return next;
          });
        },
        error: (error: unknown) => {
          if (generation !== this.sessionGeneration) return;
          const route = createRoutingError(error);
          this.routesByPair.update((routes) => new Map(routes).set(key, route));
          this.loadingRouteKeys.update((keys) => {
            const next = new Set(keys);
            next.delete(key);
            return next;
          });
          this.operationError.set(route.message);
        },
      });
  }

  /** Rota rodoviária sob demanda para um único vínculo do tutor selecionado. */
  protected calculateVinculoRoute(vinculoId: string): void {
    if (!this.routeConsent()) {
      this.operationError.set(
        'Confirme a autorização para enviar ao OSRM as coordenadas do vínculo selecionado.',
      );
      return;
    }
    const vinculo = this.selectedTutorVinculos().find((item) => item.id === vinculoId);
    const tutor = vinculo ? this.pontosPorId().get(vinculo.tutorId) : undefined;
    const bolsista = vinculo ? this.pontosPorId().get(vinculo.bolsistaId) : undefined;
    if (!vinculo || !tutor?.coordenada || !bolsista?.coordenada) {
      this.operationError.set('Não é possível calcular a rota: o vínculo não possui localização.');
      return;
    }
    if (this.loadingVinculos().has(vinculoId)) return;

    const generation = this.sessionGeneration;
    const finish = (route: RoadRoute): void => {
      if (generation !== this.sessionGeneration) return;
      this.routesByVinculo.update((routes) => new Map(routes).set(vinculoId, route));
      this.loadingVinculos.update((ids) => {
        const next = new Set(ids);
        next.delete(vinculoId);
        return next;
      });
    };
    this.operationError.set(null);
    this.loadingVinculos.update((ids) => new Set(ids).add(vinculoId));
    this.routingProvider
      .route(toRoutingLocation(tutor.coordenada), toRoutingLocation(bolsista.coordenada))
      .pipe(takeUntil(this.sessionCleared), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: finish,
        error: (error: unknown) => finish(createRoutingError(error)),
      });
  }

  protected isRouteLoading(pair: ProximityPair): boolean {
    return this.loadingRouteKeys().has(pairKey(pair));
  }

  protected participantById(id: string): Participant | undefined {
    return this.participantsById().get(id);
  }

  protected routeStatusLabel(route: RoadRoute | null): string {
    if (!route) {
      return 'Não calculada';
    }
    if (route.status === 'success') {
      return 'Rota disponível';
    }
    if (route.status === 'unavailable') {
      return 'Indisponível';
    }
    return 'Falha ao calcular';
  }

  protected roadBandLabel(route: RoadRoute | null): string {
    const band = classifyRoadDistance(route);
    switch (band) {
      case 'within-50-km':
        return 'Até 50 km rodoviários';
      case '50-to-100-km':
        return '50 a 100 km rodoviários';
      case 'over-100-km':
        return 'Mais de 100 km rodoviários';
      case 'unavailable':
        return 'Rota indisponível';
      case 'error':
        return 'Erro de roteamento';
      case 'not-calculated':
        return 'Não calculada';
    }
  }

  protected formatRoadDistance(route: RoadRoute | null): string {
    return route?.status === 'success' && route.distanceMeters !== null
      ? `${(route.distanceMeters / 1_000).toFixed(1)} km`
      : '—';
  }

  protected formatRoadDuration(route: RoadRoute | null): string {
    if (route?.status !== 'success' || route.durationSeconds === null) {
      return '—';
    }
    const minutes = Math.round(route.durationSeconds / 60);
    return `${minutes} min`;
  }

  protected formatCalculatedAt(route: RoadRoute | null): string {
    return route
      ? new Intl.DateTimeFormat('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(new Date(route.calculatedAt))
      : '—';
  }

  protected exportCsv(): void {
    try {
      this.reportExportService.exportCsv(this.exportRows());
    } catch (error: unknown) {
      this.operationError.set(
        error instanceof Error ? error.message : 'Falha ao criar o arquivo CSV.',
      );
    }
  }

  protected async exportExcel(): Promise<void> {
    try {
      await this.reportExportService.exportExcel(this.exportRows());
    } catch (error: unknown) {
      this.operationError.set(
        error instanceof Error ? error.message : 'Falha ao criar o arquivo Excel.',
      );
    }
  }

  protected async exportImportedRelationships(format: 'csv' | 'xlsx'): Promise<void> {
    try {
      const rows = this.visibleImportedRelationships().flatMap((relationship) => {
        const tutor = this.participantById(relationship.tutorId);
        const fellow = this.participantById(relationship.fellowId);
        return tutor && fellow ? [{ tutor, fellow, relationship }] : [];
      });
      await this.reportExportService.exportImportedRelationships(rows, format);
    } catch (error: unknown) {
      this.operationError.set(
        error instanceof Error ? error.message : 'Falha ao exportar os vínculos importados.',
      );
    }
  }

  private exportRows() {
    return this.visibleProximityPairs().flatMap((pair) => {
      const tutor = this.participantById(pair.tutorId);
      const fellow = this.participantById(pair.fellowId);
      return tutor && fellow ? [{ tutor, fellow, pair }] : [];
    });
  }

  private async projectScenario(
    workbook: ParsedWorkbook,
    lote: ImportBatch,
    loteId: string,
  ): Promise<void> {
    const generation = this.sessionGeneration;
    const removeTask = this.pendingTasks.add();
    this.pendingProjections += 1;
    this.geoStatus.set('loading');
    try {
      const cenario = await this.mapProjection.projetar(workbook, lote, loteId);
      if (generation !== this.sessionGeneration) return;
      this.cenariosPorLote.update((cenarios) => [...cenarios, { loteId, cenario }]);
      this.participants.update((participants) =>
        applyProjectedLocations(participants, cenario.pontos),
      );
    } catch (error: unknown) {
      if (generation !== this.sessionGeneration) return;
      this.geoError.set(
        `Importação concluída sem localização no mapa para ${lote.fileName}: ${
          error instanceof Error ? error.message : 'falha inesperada na base municipal.'
        }`,
      );
    } finally {
      if (generation === this.sessionGeneration) {
        this.pendingProjections -= 1;
        if (this.pendingProjections === 0) {
          this.geoStatus.set(this.geoError() ? 'error' : 'ready');
        }
      }
      removeTask();
    }
  }

  /** Descarta dados, cenário, rotas e seleção; invalida projeções e rotas pendentes. */
  private resetAnalysisState(): void {
    this.sessionGeneration += 1;
    this.sessionCleared.next();
    this.pendingProjections = 0;
    this.participants.set([]);
    this.importBatches.set([]);
    this.relatoriosDetalhados.set([]);
    this.alertasImportados.set([]);
    this.routesByPair.set(new Map());
    this.loadingRouteKeys.set(new Set());
    this.routesByVinculo.set(new Map());
    this.loadingVinculos.set(new Set());
    this.cenariosPorLote.set([]);
    this.geoStatus.set('idle');
    this.geoError.set(null);
    this.selectedParticipantId.set(null);
    this.selectedTutorId.set(null);
    this.routeConsent.set(false);
    this.resetPages();
  }

  /** Volta à primeira página (todas as tabelas ou apenas a indicada). */
  private resetPages(table?: PagedTable): void {
    this.requestedPages.update((pages) =>
      table === undefined ? FIRST_PAGES : { ...pages, [table]: 0 },
    );
  }

  private pageWindowOf(table: PagedTable): TablePageWindow {
    switch (table) {
      case 'participants':
        return this.participantsPage();
      case 'pairs':
        return this.pairsPage();
      case 'importedRelationships':
        return this.importedRelationshipsPage();
    }
  }

  private applyPreparation(preparacao: PreparacaoMapeamento): void {
    this.preparacao.set(preparacao);
    this.selectedSheetName.set(preparacao.aba);
    this.headerRowIndex.set(preparacao.cabecalho);
    this.mappingForm.setValue(mappingFormValue(preparacao.mapeamento));
  }
}

/**
 * Copia para o cadastro somente centróides municipais projetados, casando por ID (nunca por
 * nome) e sem sobrescrever coordenadas importadas.
 */
function applyProjectedLocations(
  participants: Participant[],
  pontos: readonly PontoMapa[],
): Participant[] {
  const porId = new Map(pontos.map((ponto) => [ponto.id, ponto] as const));
  return participants.map((participant) => {
    const ponto = porId.get(participant.id);
    const coordenada = ponto?.coordenada;
    if (
      !ponto ||
      !coordenada ||
      participant.location ||
      coordenada.origem !== 'centroide-municipal'
    ) {
      return participant;
    }
    return {
      ...participant,
      city: participant.city ?? ponto.municipio,
      location: {
        latitude: coordenada.latitude,
        longitude: coordenada.longitude,
        source: 'municipal-centroid',
      },
    };
  });
}

/** Janela de página limitada ao total: filtros que reduzem a lista nunca deixam página vazia. */
export function pageWindow(
  total: number,
  requestedPage: number,
  pageSize = TABLE_PAGE_SIZE,
): TablePageWindow {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(0, Math.trunc(requestedPage)), pageCount - 1);
  const start = page * pageSize;
  return { page, pageCount, start, end: Math.min(start + pageSize, total), total };
}

function toRoutingLocation(coordenada: Coordenada): Location {
  return {
    latitude: coordenada.latitude,
    longitude: coordenada.longitude,
    source: coordenada.origem === 'importada' ? 'imported' : 'municipal-centroid',
  };
}

function pairKey(pair: Pick<ProximityPair, 'tutorId' | 'fellowId'>): string {
  return `${pair.tutorId}::${pair.fellowId}`;
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function inputValue(event: Event): string {
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement
    ? target.value
    : '';
}

function inputChecked(event: Event): boolean {
  const target = event.target;
  return target instanceof HTMLInputElement && target.checked;
}

function mappingFormValue(mapping: ColumnMapping): Record<keyof ColumnMapping, string> {
  return {
    type: mapping.type === null ? '' : String(mapping.type),
    name: mapping.name === null ? '' : String(mapping.name),
    city: mapping.city === null ? '' : String(mapping.city),
    state: mapping.state === null ? '' : String(mapping.state),
    address: mapping.address === null ? '' : String(mapping.address),
    postalCode: mapping.postalCode === null ? '' : String(mapping.postalCode),
    latitude: mapping.latitude === null ? '' : String(mapping.latitude),
    longitude: mapping.longitude === null ? '' : String(mapping.longitude),
  };
}

function emptyMappingFormValue(): Record<keyof ColumnMapping, string> {
  return mappingFormValue(EMPTY_MAPPING);
}

function createRoutingError(error: unknown): RoadRoute {
  return {
    status: 'error',
    distanceMeters: null,
    durationSeconds: null,
    provider: 'OSRM público',
    calculatedAt: new Date().toISOString(),
    profile: 'driving',
    message:
      error instanceof Error ? error.message : 'O cálculo da rota falhou por um erro inesperado.',
  };
}
