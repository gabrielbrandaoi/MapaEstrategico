import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, PLATFORM_ID,
  ViewChild, effect, inject, input, output, signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { PontoMapa, VinculoMapa } from '../domain/mapa.models';
import { LeafletLayersService, type LeafletMapSession, type MapaState } from './leaflet-layers.service';
import { LEAFLET_LOADER } from './leaflet-loader';
import { MAPA_LEGENDA } from './mapa.config';

@Component({
  selector: 'app-leaflet-map',
  standalone: true,
  templateUrl: './leaflet-map.component.html',
  styleUrl: './leaflet-map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeafletMapComponent implements AfterViewInit, OnDestroy {
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
  readonly loading = signal(true);
  readonly baseError = signal<string | null>(null);
  readonly legendaAberta = signal(true);
  readonly legenda = MAPA_LEGENDA;
  @ViewChild('mapHost', { static: true }) private readonly mapHost!: ElementRef<HTMLDivElement>;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly layers = inject(LeafletLayersService);
  private readonly loadLeaflet = inject(LEAFLET_LOADER);
  private readonly ready = signal(false);
  private session: LeafletMapSession | null = null;
  private observer: ResizeObserver | null = null;
  private destroyed = false;
  private initializing = false;

  constructor() {
    effect(() => {
      const state = this.state();
      if (this.ready()) this.session?.render(state);
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.inicializar();
  }

  verBrasil(): void {
    this.session?.verBrasil();
    this.tutorSelected.emit(null);
  }

  tentarBase(): void {
    if (this.session) void this.session.loadBase();
    else void this.inicializar();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.session?.destroy();
    this.session = null;
  }

  private async inicializar(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.session || this.initializing) return;
    this.initializing = true;
    this.loading.set(true);
    this.baseError.set(null);
    try {
      const leaflet = await this.loadLeaflet();
      if (this.destroyed) return;
      this.session = this.layers.create(leaflet, this.mapHost.nativeElement, {
        tutorSelected: (id) => this.tutorSelected.emit(id),
        pontoSelected: (ponto) => this.pontoSelected.emit(ponto),
        baseState: (loading, error) => { this.loading.set(loading); this.baseError.set(error); },
      });
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(() => this.session?.resize());
        this.observer.observe(this.mapHost.nativeElement);
      }
      this.ready.set(true);
    } catch (error: unknown) {
      this.session?.destroy();
      this.session = null;
      this.loading.set(false);
      const detalhe = error instanceof Error && error.message ? ` Detalhe: ${error.message}` : '';
      this.baseError.set(`Não foi possível inicializar o mapa.${detalhe}`);
    } finally {
      this.initializing = false;
    }
  }

  private state(): MapaState {
    return {
      pontos: this.pontos(), vinculos: this.vinculos(), selectedTutorId: this.selectedTutorId(),
      show50Km: this.show50Km(), show100Km: this.show100Km(), tilesEnabled: this.tilesEnabled(),
      showTutors: this.showTutors(), showFellows: this.showFellows(), showLinks: this.showLinks(),
      alertsOnly: this.alertsOnly(), unallocatedOnly: this.unallocatedOnly(), resetKey: this.resetKey(),
    };
  }
}
