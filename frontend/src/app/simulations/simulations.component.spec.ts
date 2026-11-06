import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ChartConfiguration } from 'chart.js';
import { vi } from 'vitest';
import { compareAllocationDistributions } from '../domain/allocation-distribution';
import type { Participant } from '../domain/models';
import { simulationScenarios } from '../map/allocation-presentation';
import { ReportExportService } from '../reports/report-export.service';
import { SimulationsComponent } from './simulations.component';

const chartMock = vi.hoisted(() => ({
  create: vi.fn<(canvas: HTMLCanvasElement, config: ChartConfiguration<'bar', number[], string>) => void>(),
  destroy: vi.fn(),
}));

vi.mock('chart.js', () => ({
  Chart: class {
    static register = vi.fn();
    constructor(canvas: HTMLCanvasElement, config: ChartConfiguration<'bar', number[], string>) {
      chartMock.create(canvas, config);
    }
    destroy(): void { chartMock.destroy(); }
  },
  BarController: class {}, BarElement: class {}, CategoryScale: class {},
  LinearScale: class {}, Title: class {}, SubTitle: class {}, Tooltip: class {}, Legend: class {},
}));

function participant(id: string, type: Participant['type'], located = true): Participant {
  return {
    id, type, name: `Participante sintético ${id}`,
    city: null, state: null, address: null, postalCode: null,
    sourceRow: 2,
    location: located ? { latitude: 0, longitude: 0, source: 'imported' } : null,
  };
}

const participants: readonly Participant[] = [
  ...Array.from({ length: 7 }, (_, index) => participant(`t${index}`, 'tutor')),
  ...Array.from({ length: 5 }, (_, index) => participant(`f${index}`, 'fellow')),
  participant('unlocated', 'fellow', false),
];

describe('SimulationsComponent', () => {
  let fixture: ComponentFixture<SimulationsComponent>;
  let component: SimulationsComponent;
  let host: HTMLElement;
  let exporter: ReportExportService;
  const scenarios = simulationScenarios(participants);

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({ imports: [SimulationsComponent] }).compileComponents();
    fixture = TestBed.createComponent(SimulationsComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement;
    exporter = TestBed.inject(ReportExportService);
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  async function populate(): Promise<void> {
    fixture.componentRef.setInput('participants', participants);
    fixture.componentRef.setInput('scenarios', scenarios);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function content() {
    const data = component.content();
    if (data.state !== 'success') throw new Error('Esperava cenários válidos na fixture sintética.');
    return data;
  }

  it('starts in comparison with an accessible empty state and no exports/chart', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.view()).toBe('comparison');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Importe participantes');
    expect(host.querySelector('app-distribution-chart')).toBeNull();
    expect(host.querySelector('.export-actions')).toBeNull();
    expect(host.querySelector('h1')).toBeNull();
    const requestImport = vi.fn();
    component.importRequested.subscribe(requestImport);
    host.querySelector<HTMLButtonElement>('.empty-state button')?.click();
    expect(requestImport).toHaveBeenCalledOnce();
  });

  it('prioritizes loading and never shows previous results as a fresh success', async () => {
    await populate();
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    expect(host.textContent).toContain('Atualizando cenários');
    expect(host.querySelector('table')).toBeNull();
    expect(host.querySelector('.export-actions')).toBeNull();
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    expect(host.querySelector('.distribution-table')).not.toBeNull();
  });

  it('uses the domain comparison once for the table and chart, keeping all eight rows', async () => {
    await populate();
    const data = content();
    const expected = compareAllocationDistributions(data.results[0], data.results[1]);
    expect(data.rows.map((row) => row.key)).toEqual([
      '0', '1', '2', '3', '4', 'dismissed', 'below-minimum', 'total',
    ]);
    for (const [index, row] of data.rows.entries()) {
      expect(row.values.map((value) => value.count)).toEqual([
        expected[index].minimum1Count, expected[index].minimum2Count,
      ]);
      expect(row.countDifference).toBe(expected[index].countDifference);
      expect(row.percentagePointDifference).toBe(expected[index].percentagePointDifference);
    }
    expect(component.chart()?.rows()).toBe(data.rows);
    expect(host.querySelectorAll('.distribution-table tbody tr')).toHaveLength(8);
    expect(host.querySelectorAll('.distribution-table .subtotal')).toHaveLength(1);
    expect(host.querySelector('.distribution-table .total')).not.toBeNull();
    expect(host.textContent).toContain('Não é contado duas vezes');
    expect(host.textContent).toContain('p.p.');
    expect(host.querySelectorAll('.table-scroll[tabindex="0"]')).toHaveLength(2);
    expect(host.querySelector('app-leaflet-map')).toBeNull();
  });

  it('supports native labeled radio controls and single-scenario distribution', async () => {
    await populate();
    const radio = host.querySelector<HTMLInputElement>('input[value="2"]');
    expect(radio?.closest('label')?.textContent).toContain('Mínimo 2');
    radio?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.view()).toBe('2');
    const data = content();
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toBe(scenarios[1].result);
    expect(data.rows.map((row) => row.values[0].count)).toEqual(
      data.results[0].distribution.rows.map((row) => row.count),
    );
    expect(host.querySelectorAll('.distribution-table thead th')).toHaveLength(3);
    expect(data.rows.every((row) => row.countDifference === null)).toBe(true);
    expect(host.querySelector('input[value="2"]:checked')).not.toBeNull();
  });

  it('shows all five count indicators, geodesic distances and expandable reasons', async () => {
    await populate();
    for (const label of [
      'Bolsistas alocados', 'Bolsistas sem tutor', 'Tutores ativos',
      'Tutores dispensados', 'Tutores abaixo do mínimo',
      'Menor distância geodésica (km)', 'Média geodésica (km)', 'Maior distância geodésica (km)',
    ]) expect(host.textContent).toContain(label);
    expect(host.querySelectorAll('details')).toHaveLength(2);
    expect(host.querySelector('summary')?.textContent).toContain('Estados, razões e vínculos');
    expect(host.textContent).toContain(participants[0].name);
    const result = content().results[0];
    expect(host.textContent).toContain(result.unassignedFellows[0].reason);
    expect(host.textContent).toContain('não representam trajetos rodoviários');
  });

  it('keeps failure explicit, including a missing scenario; healthy scenario is independently selectable', async () => {
    await populate();
    fixture.componentRef.setInput('scenarios', [
      scenarios[0], { minimum: 2, result: null, error: 'Erro sintético de domínio', minimumKm: null },
    ]);
    fixture.detectChanges();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Erro sintético de domínio');
    expect(host.querySelector('table')).toBeNull();
    expect(host.querySelector('.export-actions')).toBeNull();
    component.view.set('1');
    fixture.detectChanges();
    expect(content().results).toHaveLength(1);
    component.view.set('comparison');
    fixture.componentRef.setInput('scenarios', [scenarios[0]]);
    fixture.detectChanges();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('resultado indisponível');
  });

  it('refreshes automatically when inputs change, including participants becoming empty', async () => {
    await populate();
    const changedParticipants = participants.slice(0, 7);
    const changed = simulationScenarios(changedParticipants);
    fixture.componentRef.setInput('participants', changedParticipants);
    fixture.componentRef.setInput('scenarios', changed);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(content().results[0]).toBe(changed[0].result);
    expect(component.chart()?.rows()).toBe(content().rows);
    fixture.componentRef.setInput('participants', []);
    fixture.detectChanges();
    expect(component.content().state).toBe('empty');
    expect(host.querySelector('table')).toBeNull();
  });

  it('surfaces invalid comparisons as errors rather than an empty successful result', async () => {
    await populate();
    fixture.componentRef.setInput('scenarios', [
      { ...scenarios[0], result: scenarios[1].result }, scenarios[1],
    ]);
    fixture.detectChanges();
    expect(component.content().state).toBe('error');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível comparar');
    expect(host.querySelector('table')).toBeNull();
  });

  it('exports the displayed comparison or single scenario via the report service', async () => {
    const csv = vi.spyOn(exporter, 'exportAllocationDistributionCsv').mockImplementation(() => {});
    const excel = vi.spyOn(exporter, 'exportAllocationDistributionExcel').mockResolvedValue();
    await populate();
    await component.exportDistribution('csv');
    expect(csv).toHaveBeenCalledWith([scenarios[0].result, scenarios[1].result]);
    component.view.set('1');
    fixture.detectChanges();
    await component.exportDistribution('xlsx');
    expect(excel).toHaveBeenCalledWith([scenarios[0].result]);
    fixture.detectChanges();
    expect(host.textContent).toContain('Download Excel solicitado.');
    for (const button of host.querySelectorAll('.export-actions button')) {
      expect(button.classList.contains('button')).toBe(true);
      expect(button.classList.contains('button--quiet')).toBe(true);
    }
  });

  it('preserves detailed relationships CSV/Excel exports with the selected result and participants', async () => {
    const csv = vi.spyOn(exporter, 'exportAllocationCsv').mockImplementation(() => {});
    const excel = vi.spyOn(exporter, 'exportAllocationExcel').mockResolvedValue();
    await populate();
    await component.exportRelationships(1, 'csv');
    expect(csv).toHaveBeenCalledWith(scenarios[0].result, participants);
    await component.exportRelationships(2, 'xlsx');
    expect(excel).toHaveBeenCalledWith(scenarios[1].result, participants);
  });

  it('reports CSV/Excel failure without success and permits retry', async () => {
    const csv = vi.spyOn(exporter, 'exportAllocationDistributionCsv')
      .mockImplementationOnce(() => { throw new Error('Falha sintética'); })
      .mockImplementation(() => {});
    vi.spyOn(exporter, 'exportAllocationDistributionExcel').mockRejectedValue(new Error('Falha sintética'));
    await populate();
    await component.exportDistribution('csv');
    fixture.detectChanges();
    expect(csv).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível exportar');
    expect(component.exportStatus()).toBeNull();
    expect(component.exporting()).toBe(false);
    await component.exportDistribution('xlsx');
    expect(component.exportStatus()).toBeNull();
    await component.exportDistribution('csv');
    expect(component.exportError()).toBeNull();
    expect(component.exportStatus()).toContain('CSV');
  });

  it('avoids concurrent exports and stale notifications when inputs change or component is destroyed', async () => {
    let finish: (() => void) | undefined;
    const excel = vi.spyOn(exporter, 'exportAllocationDistributionExcel').mockImplementation(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    await populate();
    const pending = component.exportDistribution('xlsx');
    expect(component.exporting()).toBe(true);
    fixture.detectChanges();
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.export-actions button'))
      .every((button) => button.disabled)).toBe(true);
    await component.exportDistribution('xlsx');
    expect(excel).toHaveBeenCalledTimes(1);
    component.view.set('1');
    fixture.detectChanges();
    finish?.();
    await pending;
    expect(component.exportStatus()).toBeNull();
    expect(component.exporting()).toBe(false);
    const second = component.exportDistribution('xlsx');
    fixture.destroy();
    finish?.();
    await second;
    expect(component.exportStatus()).toBeNull();
  });

  it('delegates PNG export to the live chart and makes errors visible', async () => {
    await populate();
    const chart = component.chart();
    if (!chart) throw new Error('Gráfico ausente na fixture.');
    const png = vi.spyOn(chart, 'exportPng').mockResolvedValue();
    await component.exportDistribution('png');
    expect(png).toHaveBeenCalledOnce();
    expect(component.exportStatus()).toContain('PNG');
    png.mockRejectedValueOnce(new Error('Canvas indisponível'));
    await component.exportDistribution('png');
    fixture.detectChanges();
    expect(component.exportStatus()).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível exportar');
  });
});
