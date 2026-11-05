import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ChartConfiguration } from 'chart.js';
import { vi } from 'vitest';
import { ALLOCATION_PALETTE } from '../map/allocation-palette';
import {
  DistributionChartComponent,
  distributionLabelsPlugin,
  distributionLegendItems,
  type DistributionDisplayRow,
} from './distribution-chart.component';

const chartMock = vi.hoisted(() => ({
  create: vi.fn<(canvas: HTMLCanvasElement, config: ChartConfiguration<'bar', number[], string>) => void>(),
  destroy: vi.fn(),
  register: vi.fn(),
  getChart: vi.fn(),
}));

vi.mock('chart.js', () => ({
  Chart: class {
    static register = chartMock.register;
    static getChart = chartMock.getChart;
    constructor(canvas: HTMLCanvasElement, config: ChartConfiguration<'bar', number[], string>) {
      chartMock.create(canvas, config);
    }
    destroy(): void { chartMock.destroy(); }
  },
  BarController: class {}, BarElement: class {}, CategoryScale: class {},
  LinearScale: class {}, Title: class {}, SubTitle: class {}, Tooltip: class {}, Legend: class {},
}));

const rows: readonly DistributionDisplayRow[] = [
  { key: '0', label: '0 bolsistas', subtotal: true,
    values: [{ minimum: 1, count: 2, percentage: 40 }, { minimum: 2, count: 3, percentage: 60 }],
    countDifference: 1, percentagePointDifference: 20 },
  ...(['1', '2', '3', '4'] as const).map((key): DistributionDisplayRow => ({
    key, label: `${key} bolsista(s)`, subtotal: false,
    values: [{ minimum: 1, count: 1, percentage: 20 }, { minimum: 2, count: 0, percentage: 0 }],
    countDifference: -1, percentagePointDifference: -20,
  })),
  { key: 'dismissed', label: 'Dispensados', subtotal: false,
    values: [{ minimum: 1, count: 1, percentage: 20 }, { minimum: 2, count: 1, percentage: 20 }],
    countDifference: 0, percentagePointDifference: 0 },
];

describe('DistributionChartComponent (Chart.js modular mock, no real canvas)', () => {
  let fixture: ComponentFixture<DistributionChartComponent>;
  let component: DistributionChartComponent;
  let host: HTMLElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({ imports: [DistributionChartComponent] }).compileComponents();
    fixture = TestBed.createComponent(DistributionChartComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement;
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(): Promise<void> {
    fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(chartMock.create).toHaveBeenCalled());
    fixture.detectChanges();
  }

  function config(): ChartConfiguration<'bar', number[], string> {
    const config = chartMock.create.mock.calls.at(-1)?.[1];
    if (!config) throw new Error('Chart.js não recebeu configuração.');
    return config;
  }

  it('renders only 0..4, grouped from the exact domain values with shared colors and local labels plugin', async () => {
    await render();
    const chart = config();
    expect(chart.type).toBe('bar');
    expect(chart.data.labels).toEqual(['0 (subtotal)', '1', '2', '3', '4']);
    expect(chart.data.datasets.map((dataset) => dataset.label)).toEqual(['Mínimo 1', 'Mínimo 2']);
    expect(chart.data.datasets[0].data).toEqual([2, 1, 1, 1, 1]);
    expect(chart.data.datasets[1].data).toEqual([3, 0, 0, 0, 0]);
    expect(chart.data.datasets[0].backgroundColor).toBe(ALLOCATION_PALETTE.minimum1);
    expect(chart.data.datasets[1].backgroundColor).toBe(ALLOCATION_PALETTE.minimum2);
    expect(chart.data.datasets[0].borderWidth).toBe(1);
    expect(chart.data.datasets[1].borderWidth).toBe(0);
    expect(chart.plugins).toContain(distributionLabelsPlugin);
    expect(distributionLabelsPlugin.afterDatasetsDraw).toBeTypeOf('function');
    expect(chart.options?.responsive).toBe(true);
    expect(chart.options?.maintainAspectRatio).toBe(false);
    expect(chart.options?.animation).toBe(false);
    expect(chart.options?.scales?.['x']?.title?.text).toBe('Quantidade de bolsistas por tutor');
    expect(chart.options?.scales?.['y']?.title?.text).toBe('Quantidade de tutores');
    expect(chart.options?.plugins?.title?.text).toContain('Distribuição de tutores');
    expect(chart.options?.plugins?.subtitle?.text).toContain('Barra 0 = subtotal');
    expect(chart.options?.plugins?.legend?.display).toBe(true);
    expect(chart.options?.plugins?.legend?.position).toBe('top');
    expect(distributionLegendItems([1, 2]).map((item) => [item.text, item.lineDash])).toEqual([
      ['Mínimo 1 (contorno contínuo)', []],
      ['Mínimo 2 (contorno tracejado)', [5, 3]],
    ]);
    expect(chart.options?.plugins?.legend?.labels?.generateLabels).toBeTypeOf('function');
    expect(distributionLabelsPlugin.beforeDraw).toBeTypeOf('function');
    expect(chartMock.register).toHaveBeenCalledOnce();
    expect(component.ready()).toBe(true);
    expect(component.loading()).toBe(false);
  });

  it('identifies a single exported scenario and zero subtotal inside the canvas legend', () => {
    expect(distributionLegendItems([2]).map((item) => [item.text, item.fillStyle, item.lineDash])).toEqual([
      ['Mínimo 2: tutores com 1 a 4 bolsistas', ALLOCATION_PALETTE.active, [5, 3]],
      ['0: dispensados + abaixo do mínimo', ALLOCATION_PALETTE.unassigned, [5, 3]],
    ]);
  });

  it('provides a text alternative, subtotal explanation and non-color scenario distinction', async () => {
    await render();
    const canvas = host.querySelector('canvas');
    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.getAttribute('aria-label')).toContain('mínimo 1, 2 tutores');
    expect(canvas?.getAttribute('aria-label')).toContain('tabela de distribuição');
    expect(host.textContent).toContain('0 é o subtotal');
    expect(host.textContent).toContain('contorno tracejado');
    expect(host.querySelector('.series-swatch.dashed')).not.toBeNull();
  });

  it('rebuilds automatically on data changes and destroys every superseded chart on teardown', async () => {
    await render();
    fixture.componentRef.setInput('rows', rows.map((row) => ({ ...row, values: [row.values[0]] })));
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(chartMock.create).toHaveBeenCalledTimes(2));
    expect(chartMock.destroy).toHaveBeenCalledTimes(1);
    expect(config().data.datasets).toHaveLength(1);
    expect(config().data.datasets[0].backgroundColor).toEqual([
      ALLOCATION_PALETTE.unassigned, ALLOCATION_PALETTE.active, ALLOCATION_PALETTE.active,
      ALLOCATION_PALETTE.active, ALLOCATION_PALETTE.active,
    ]);
    fixture.destroy();
    expect(chartMock.destroy).toHaveBeenCalledTimes(2);
  });

  it('displays a chart initialization error, keeping a visible table fallback instruction and no PNG readiness', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    chartMock.create.mockImplementationOnce(() => { throw new Error('Falha sintética de canvas'); });
    await render();
    expect(component.ready()).toBe(false);
    expect(component.loading()).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Consulte a tabela');
    expect(host.querySelector<HTMLElement>('.chart-container')?.hidden).toBe(true);
    expect(host.querySelector('.chart-legend')).toBeNull();
    expect(host.querySelector('button')?.textContent).toContain('Tentar novamente');
    await expect(component.exportPng()).rejects.toThrow('ainda não está disponível');
  });

  it('retries a failed chart and releases a partially initialized canvas before reusing it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const destroyPartial = vi.fn();
    chartMock.getChart.mockReturnValueOnce({ destroy: destroyPartial });
    chartMock.create.mockImplementationOnce(() => { throw new Error('Falha sintética'); });
    await render();
    expect(destroyPartial).toHaveBeenCalledOnce();
    host.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(component.ready()).toBe(true));
    fixture.detectChanges();
    expect(chartMock.create).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector<HTMLElement>('.chart-container')?.hidden).toBe(false);
  });

  it('cancels the lazy chart initialization when the view is destroyed', async () => {
    fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
    fixture.detectChanges();
    fixture.destroy();
    await fixture.whenStable();
    expect(chartMock.create).not.toHaveBeenCalled();
    expect(chartMock.destroy).not.toHaveBeenCalled();
  });

  it('downloads PNG via toBlob, object URL and always releases the URL', async () => {
    await render();
    const blob = new Blob(['synthetic'], { type: 'image/png' });
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(blob));
    const createObjectURL = vi.fn<(value: Blob) => string>().mockReturnValue('blob:synthetic');
    const revokeObjectURL = vi.fn<(value: string) => void>();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await component.exportPng();
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
  });

  it('rejects empty PNG blobs and stale exports instead of returning success', async () => {
    await render();
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementationOnce((callback) => callback(null));
    await expect(component.exportPng()).rejects.toThrow('Não foi possível gerar');
    let finish: BlobCallback | undefined;
    toBlob.mockImplementationOnce((callback) => { finish = callback; });
    const pending = component.exportPng();
    fixture.componentRef.setInput('rows', [...rows]);
    fixture.detectChanges();
    finish?.(new Blob(['synthetic'], { type: 'image/png' }));
    await expect(pending).rejects.toThrow('mudou durante a exportação');
  });

  it('revokes the URL even when the browser download action throws', async () => {
    await render();
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(new Blob(['synthetic'], { type: 'image/png' })));
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:synthetic'), revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('Falha sintética'); });
    await expect(component.exportPng()).rejects.toThrow('Falha sintética');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
  });
});
