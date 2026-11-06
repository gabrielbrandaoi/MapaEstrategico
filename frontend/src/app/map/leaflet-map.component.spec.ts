import { TestBed } from '@angular/core/testing';
import * as L from 'leaflet';
import { vi } from 'vitest';
import { LeafletLayersService, type LeafletMapSession } from './leaflet-layers.service';
import { LEAFLET_LOADER, resolverModuloLeaflet, type LeafletModule } from './leaflet-loader';
import { LeafletMapComponent } from './leaflet-map.component';
import { simulateAllocation } from '../domain/allocation';
import { DEFAULT_ALLOCATION_CONFIG } from '../domain/allocation.models';
import { ALLOCATION_PALETTE } from './allocation-palette';

function fakeSession(): LeafletMapSession {
  return {
    render: vi.fn(), resize: vi.fn(), verBrasil: vi.fn(), ajustarAosPontos: vi.fn(),
    loadBase: vi.fn(), destroy: vi.fn(),
  } as unknown as LeafletMapSession;
}

describe('LeafletMapComponent initialization', () => {
  let loader: ReturnType<typeof vi.fn<() => Promise<LeafletModule>>>;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    loader = vi.fn<() => Promise<LeafletModule>>();
    create = vi.fn((_leaflet: LeafletModule, _host: HTMLElement, callbacks: { baseState(l: boolean, e: string | null): void }) => {
      callbacks.baseState(false, null);
      return fakeSession();
    });
    TestBed.configureTestingModule({
      imports: [LeafletMapComponent],
      providers: [
        { provide: LEAFLET_LOADER, useValue: loader },
        { provide: LeafletLayersService, useValue: { create } },
      ],
    });
  });

  async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }): Promise<void> {
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }

  it('creates the map with a default-only Leaflet module (production bundle shape)', async () => {
    loader.mockImplementation(async () => resolverModuloLeaflet({ default: { ...L } }));
    const fixture = TestBed.createComponent(LeafletMapComponent);
    fixture.detectChanges();
    await settle(fixture);

    expect(create).toHaveBeenCalledTimes(1);
    expect(typeof (create.mock.calls[0][0] as LeafletModule).map).toBe('function');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows a visible error with detail and retries initialization on "Tentar novamente"', async () => {
    loader.mockRejectedValueOnce(new Error('falha sintética'));
    loader.mockResolvedValueOnce(L);
    const fixture = TestBed.createComponent(LeafletMapComponent);
    fixture.detectChanges();
    await settle(fixture);

    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain('Não foi possível inicializar o mapa.');
    expect(alert.textContent).toContain('falha sintética');
    expect(create).not.toHaveBeenCalled();

    (alert.querySelector('button') as HTMLButtonElement).click();
    await settle(fixture);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('routes the real "Ajustar aos pontos" action to the map session', async () => {
    loader.mockResolvedValue(L);
    const session = fakeSession();
    create.mockReturnValue(session);
    const fixture = TestBed.createComponent(LeafletMapComponent);
    fixture.detectChanges();
    await settle(fixture);

    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    const button = Array.from(buttons)
      .find((candidate) => candidate.textContent?.trim() === 'Ajustar aos pontos') as HTMLButtonElement;
    button.click();

    expect(session.ajustarAosPontos).toHaveBeenCalledOnce();
    fixture.destroy();
  });

  it('recreates the Leaflet session when the template replaces the map host', async () => {
    TestBed.overrideComponent(LeafletMapComponent, {
      set: {
        template: '@if (showTutors()) { <div #mapHost></div> } @else { <div #mapHost></div> }',
      },
    });
    loader.mockResolvedValue(L);
    const first = fakeSession();
    const second = fakeSession();
    create.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const fixture = TestBed.createComponent(LeafletMapComponent);
    fixture.detectChanges();
    await settle(fixture);
    const oldHost = create.mock.calls[0][1];
    fixture.componentRef.setInput('showTutors', false);
    fixture.detectChanges();
    await settle(fixture);
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][1]).not.toBe(oldHost);
    expect(create.mock.calls[1][1]).toBe(fixture.nativeElement.querySelector('div'));
    expect(second.render).toHaveBeenCalled();
    fixture.destroy();
    expect(second.destroy).toHaveBeenCalledOnce();
  });

  it('does not initialize Leaflet on an obsolete host after an asynchronous load', async () => {
    TestBed.overrideComponent(LeafletMapComponent, {
      set: {
        template: '@if (showTutors()) { <div #mapHost></div> } @else { <div #mapHost></div> }',
      },
    });
    let resolveFirst!: (leaflet: LeafletModule) => void;
    loader.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    loader.mockResolvedValueOnce(L);
    const fixture = TestBed.createComponent(LeafletMapComponent);
    fixture.detectChanges();
    fixture.componentRef.setInput('showTutors', false);
    fixture.detectChanges();
    await settle(fixture);
    resolveFirst(L);
    await settle(fixture);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][1]).toBe(fixture.nativeElement.querySelector('div'));
    fixture.destroy();
  });

  it('explains simulation statuses and reflects the selected minimum in the legend', async () => {
    loader.mockResolvedValue(L);
    const fixture = TestBed.createComponent(LeafletMapComponent);
    fixture.componentRef.setInput('simulation', true);
    fixture.componentRef.setInput('simulationMinimum', 2);
    fixture.componentRef.setInput('allocation', simulateAllocation([], [], {
      ...DEFAULT_ALLOCATION_CONFIG, minimoPorTutor: 2,
    }));
    fixture.detectChanges();
    await settle(fixture);
    const root: HTMLElement = fixture.nativeElement;
    const legend = root.querySelector('.map-legend');
    expect(legend?.querySelector('.legend-essentials')?.textContent).toContain('Tutor');
    const details = legend?.querySelector('details');
    expect(details?.open).toBe(false);
    details?.querySelector('summary')?.click();
    expect(details?.open).toBe(true);
    expect(legend?.textContent).toContain('mínimo 2');
    expect(legend?.textContent).toContain('Tutor dispensado');
    expect(legend?.textContent).toContain('Tutor abaixo do mínimo');
    expect(legend?.textContent).toContain('Bolsista sem tutor');
    expect(legend?.textContent).toContain('arredondada para cima');
    expect(legend?.textContent).toContain('coordenadas válidas');
    expect(legend?.textContent).toContain('vínculo simulado');
    const colorStyle = (color: string): string => {
      const element = document.createElement('span');
      element.style.background = color;
      return element.style.background;
    };
    expect((root.querySelector('.simulation-symbol--active') as HTMLElement).style.background)
      .toBe(colorStyle(ALLOCATION_PALETTE.active));
    expect((root.querySelector('.simulation-symbol--dismissed') as HTMLElement).style.background)
      .toBe(colorStyle(ALLOCATION_PALETTE.dismissed));
    expect((root.querySelector('.simulation-symbol--below') as HTMLElement).style.background)
      .toBe(colorStyle(ALLOCATION_PALETTE.belowMinimum));
    expect((root.querySelector('.simulation-symbol--fellow') as HTMLElement).style.background)
      .toBe(colorStyle(ALLOCATION_PALETTE.unassigned));
    expect(legend?.textContent).toContain(`${DEFAULT_ALLOCATION_CONFIG.raioMaxKm} km`);
    expect(legend?.textContent).toContain('vagas esgotadas');
    expect(legend?.textContent).toContain('geodésicos');
    expect(legend?.textContent).toContain('não');
    fixture.componentRef.setInput('simulationMinimum', 1);
    fixture.componentRef.setInput('allocation', simulateAllocation([], []));
    fixture.detectChanges();
    expect(legend?.textContent).toContain('mínimo 1');
    fixture.destroy();
  });

  it('exports the shared status palette, including minimum-specific chart colors', () => {
    expect(ALLOCATION_PALETTE).toEqual({
      active: 'var(--color-tutor)', dismissed: 'var(--color-dismissed)',
      belowMinimum: 'var(--color-accent)', unassigned: 'var(--color-unassigned)',
      minimum1: 'var(--color-accent)', minimum2: 'var(--color-fellow)',
    });
  });
});
