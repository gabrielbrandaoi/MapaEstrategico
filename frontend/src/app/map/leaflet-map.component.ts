import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, PLATFORM_ID,
  effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { PontoMapa, VinculoMapa } from '../domain/mapa.models';
import { LeafletLayersService, type LeafletMapSession, type MapaState } from './leaflet-layers.service';
import { LEAFLET_LOADER } from './leaflet-loader';
import { MAPA_CONFIG, MAPA_LEGENDA } from './mapa.config';
import { DEFAULT_ALLOCATION_CONFIG, type AllocationResult } from '../domain/allocation.models';
import { ALLOCATION_PALETTE } from './allocation-palette';

@Component({
  selector: 'app-leaflet-map',
  standalone: true,
  templateUrl: './leaflet-map.component.html',
  styleUrl: './leaflet-map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeafletMapComponent implements OnDestroy {
  readonly pontos = input<readonly PontoMapa[]>([]);
  readonly simulation = input(false);
  readonly allocation = input<AllocationResult | null>(null);
  readonly simulationMinimum = input<1 | 2>(DEFAULT_ALLOCATION_CONFIG.minimoPorTutor);
  readonly allocationConfig = DEFAULT_ALLOCATION_CONFIG;
  readonly allocationPalette = ALLOCATION_PALETTE;
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
  readonly tutorSelected = output<string | null>();
  readonly pontoSelected = output<PontoMapa>();
  readonly loading = signal(true);
  readonly baseError = signal<string | null>(null);
  readonly legendaAberta = signal(true);
  readonly legenda = MAPA_LEGENDA;
  readonly fellowColors = MAPA_CONFIG.fellow;
  private readonly mapHost = viewChild<ElementRef<HTMLDivElement>>('mapHost');
  private readonly platformId = inject(PLATFORM_ID);
  private readonly layers = inject(LeafletLayersService);
  private readonly loadLeaflet = inject(LEAFLET_LOADER);
  private readonly ready = signal(false);
  private session: LeafletMapSession | null = null;
  private observer: ResizeObserver | null = null;
  private destroyed = false;
  private initializing = false;

  constructor() {
    effect((onCleanup) => {
      const host = this.mapHost()?.nativeElement;
      if (!host) return;
      void this.inicializar(host);
      onCleanup(() => {
        this.observer?.disconnect();
        this.observer = null;
        this.session?.destroy();
        this.session = null;
        this.initializing = false;
        this.ready.set(false);
      });
    });
    effect(() => {
      const state = this.state();
      if (this.ready()) this.session?.render(state);
    });
  }

  verBrasil(): void {
    this.session?.verBrasil();
    this.tutorSelected.emit(null);
  }

  ajustarAosPontos(): void {
    this.session?.ajustarAosPontos();
  }

  tentarBase(): void {
    if (this.session) void this.session.loadBase();
    else {
      const host = this.mapHost()?.nativeElement;
      if (host) void this.inicializar(host);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.session?.destroy();
    this.session = null;
  }

  private async inicializar(host: HTMLDivElement): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.session || this.initializing) return;
    this.initializing = true;
    this.loading.set(true);
    this.baseError.set(null);
    try {
      const leaflet = await this.loadLeaflet();
      if (this.destroyed || this.mapHost()?.nativeElement !== host) return;
      this.session = this.layers.create(leaflet, host, {
        tutorSelected: (id) => this.tutorSelected.emit(id),
        pontoSelected: (ponto) => this.pontoSelected.emit(ponto),
        baseState: (loading, error) => { this.loading.set(loading); this.baseError.set(error); },
      });
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(() => this.session?.resize());
        this.observer.observe(host);
      }
      this.ready.set(true);
    } catch (error: unknown) {
      if (this.destroyed || this.mapHost()?.nativeElement !== host) return;
      this.session?.destroy();
      this.session = null;
      this.loading.set(false);
      const detalhe = error instanceof Error && error.message ? ` Detalhe: ${error.message}` : '';
      this.baseError.set(`Não foi possível inicializar o mapa.${detalhe}`);
    } finally {
      if (this.mapHost()?.nativeElement === host) this.initializing = false;
    }
  }

  private state(): MapaState {
    return {
      pontos: this.pontos(), vinculos: this.vinculos(), selectedTutorId: this.selectedTutorId(),
      show50Km: this.show50Km(), show130Km: this.show130Km(), tilesEnabled: this.tilesEnabled(),
      showTutors: this.showTutors(), showFellows: this.showFellows(), showLinks: this.showLinks(),
      alertsOnly: this.alertsOnly(), unallocatedOnly: this.unallocatedOnly(), resetKey: this.resetKey(),
      simulation: this.simulation(), allocation: this.allocation(),
      simulationMinimum: this.simulationMinimum(),
    };
  }
}
