import { TestBed } from '@angular/core/testing';
import * as L from 'leaflet';
import { vi } from 'vitest';
import { LeafletLayersService, type LeafletMapSession } from './leaflet-layers.service';
import { LEAFLET_LOADER, resolverModuloLeaflet, type LeafletModule } from './leaflet-loader';
import { LeafletMapComponent } from './leaflet-map.component';

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
});
