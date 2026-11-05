import {
  afterNextRender,
  Component,
  effect,
  input,
  signal,
  viewChild,
  ElementRef,
} from '@angular/core';
import type { Chart, LegendItem, Plugin } from 'chart.js';
import type { AllocationDistributionKey } from '../domain/allocation.models';
import { ALLOCATION_PALETTE } from '../map/allocation-palette';

export interface DistributionValue {
  readonly minimum: 1 | 2;
  readonly count: number;
  readonly percentage: number;
}

/** Presentation only: all quantities and deltas come from the domain. */
export interface DistributionDisplayRow {
  readonly key: AllocationDistributionKey;
  readonly label: string;
  readonly subtotal: boolean;
  readonly values: readonly DistributionValue[];
  readonly countDifference: number | null;
  readonly percentagePointDifference: number | null;
}

/** Canvas legend: required so the standalone PNG identifies every series and the zero subtotal. */
export function distributionLegendItems(minimums: readonly (1 | 2)[]): LegendItem[] {
  const outline = (minimum: 1 | 2): Pick<LegendItem, 'strokeStyle' | 'lineWidth' | 'lineDash'> => ({
    strokeStyle: '#172b4d',
    lineWidth: 2,
    lineDash: minimum === 2 ? [5, 3] : [],
  });
  if (minimums.length === 2) {
    return minimums.map((minimum, datasetIndex) => ({
      text: `Mínimo ${minimum} (contorno ${minimum === 1 ? 'contínuo' : 'tracejado'})`,
      fillStyle: minimum === 1 ? ALLOCATION_PALETTE.minimum1 : ALLOCATION_PALETTE.minimum2,
      hidden: false,
      datasetIndex,
      ...outline(minimum),
    }));
  }
  const minimum = minimums[0] ?? 1;
  return [
    {
      text: `Mínimo ${minimum}: tutores com 1 a 4 bolsistas`,
      fillStyle: ALLOCATION_PALETTE.active, hidden: false, ...outline(minimum),
    },
    {
      text: '0: dispensados + abaixo do mínimo',
      fillStyle: ALLOCATION_PALETTE.unassigned, hidden: false, ...outline(minimum),
    },
  ];
}

/** Values and dashed outlines remain legible without relying on color alone. */
export const distributionLabelsPlugin: Plugin<'bar'> = {
  id: 'allocation-distribution-labels',
  beforeDraw(chart) {
    // Opaque background keeps the exported PNG readable outside the page theme.
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (!chart.isDatasetVisible(datasetIndex)) return;
      const meta = chart.getDatasetMeta(datasetIndex);
      meta.data.forEach((element, index) => {
        const position = element.tooltipPosition(true);
        const value = dataset.data[index];
        if (typeof value !== 'number') return;
        if (dataset.label === 'Mínimo 2') {
          const bounds = element.getProps(['x', 'y', 'base', 'width'], true);
          if (
            typeof bounds['x'] === 'number' && typeof bounds['y'] === 'number' &&
            typeof bounds['base'] === 'number' && typeof bounds['width'] === 'number'
          ) {
            ctx.strokeStyle = '#172b4d';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(
              bounds['x'] - bounds['width'] / 2, bounds['y'],
              bounds['width'], bounds['base'] - bounds['y'],
            );
            ctx.setLineDash([]);
          }
        }
        ctx.fillStyle = '#172b4d';
        if (typeof position.x === 'number' && typeof position.y === 'number') {
          ctx.fillText(String(value), position.x, position.y - 5);
        }
      });
    });
    ctx.restore();
  },
};

@Component({
  selector: 'app-distribution-chart',
  standalone: true,
  templateUrl: './distribution-chart.component.html',
  styleUrl: './distribution-chart.component.scss',
})
export class DistributionChartComponent {
  readonly rows = input<readonly DistributionDisplayRow[]>([]);
  readonly palette = ALLOCATION_PALETTE;
  readonly ready = signal(false);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly rendered = signal(false);
  private readonly retryCount = signal(0);
  private chart: Chart<'bar', number[], string> | null = null;
  private revision = 0;

  constructor() {
    afterNextRender(() => this.rendered.set(true));
    effect((onCleanup) => {
      const rows = this.rows();
      const canvas = this.canvas()?.nativeElement;
      this.retryCount();
      if (!this.rendered() || !canvas) return;
      const revision = ++this.revision;
      this.ready.set(false);
      this.loading.set(true);
      this.error.set(null);
      void this.renderChart(canvas, rows, revision);
      onCleanup(() => {
        ++this.revision;
        this.chart?.destroy();
        this.chart = null;
      });
    });
  }

  retry(): void {
    this.retryCount.update((count) => count + 1);
  }

  readonly description = () => {
    const rows = this.rows().filter((row) => ['0', '1', '2', '3', '4'].includes(row.key));
    return `Distribuição de tutores por quantidade de bolsistas. ${rows.map((row) =>
      `${row.label}: ${row.values.map((value) =>
        `mínimo ${value.minimum}, ${value.count} tutores`).join('; ')}`,
    ).join('. ')}. Zero é subtotal; os dados completos estão na tabela de distribuição nesta seção.`;
  };

  async exportPng(): Promise<void> {
    const canvas = this.canvas()?.nativeElement;
    if (!this.ready() || !canvas || !this.chart) {
      throw new Error('O gráfico ainda não está disponível para exportação.');
    }
    const revision = this.revision;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value
        ? resolve(value)
        : reject(new Error('Não foi possível gerar a imagem PNG.')), 'image/png');
    });
    if (revision !== this.revision) {
      throw new Error('O gráfico mudou durante a exportação. Tente novamente.');
    }
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'distribuicao-alocacao.png';
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private async renderChart(
    canvas: HTMLCanvasElement,
    rows: readonly DistributionDisplayRow[],
    revision: number,
  ): Promise<void> {
    let chartType: typeof Chart | null = null;
    try {
      const { Chart, BarController, BarElement, CategoryScale, LinearScale, Title, SubTitle, Tooltip, Legend } =
        await import('chart.js');
      if (revision !== this.revision) return;
      chartType = Chart;
      Chart.register(
        BarController, BarElement, CategoryScale, LinearScale, Title, SubTitle, Tooltip, Legend,
      );
      const bars = rows.filter((row) => ['0', '1', '2', '3', '4'].includes(row.key));
      const values = bars[0]?.values ?? [];
      const comparison = values.length === 2;
      const legendItems = distributionLegendItems(values.map((value) => value.minimum));
      this.chart = new Chart<'bar', number[], string>(canvas, {
        type: 'bar',
        data: {
          labels: bars.map((row) => row.key === '0' ? '0 (subtotal)' : row.key),
          datasets: values.map(({ minimum }, seriesIndex) => ({
            label: `Mínimo ${minimum}`,
            data: bars.map((row) => row.values[seriesIndex].count),
            backgroundColor: comparison
              ? minimum === 1 ? ALLOCATION_PALETTE.minimum1 : ALLOCATION_PALETTE.minimum2
              : bars.map((row) => row.subtotal
                ? ALLOCATION_PALETTE.unassigned : ALLOCATION_PALETTE.active),
            borderColor: '#172b4d',
            // Mínimo 2 is outlined only by the dashed local plugin, never a solid border beneath it.
            borderWidth: minimum === 1 ? 1 : 0,
          })),
        },
        plugins: [distributionLabelsPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          layout: { padding: { top: 24 } },
          scales: {
            x: { title: { display: true, text: 'Quantidade de bolsistas por tutor' } },
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Quantidade de tutores' },
              ticks: { precision: 0 },
              grace: '15%',
            },
          },
          plugins: {
            title: { display: true, text: ['Distribuição de tutores', 'por quantidade de bolsistas'] },
            subtitle: {
              display: true,
              text: ['Barra 0 = subtotal', 'não somar novamente aos estados'],
              padding: { bottom: 8 },
            },
            legend: {
              display: true,
              position: 'top',
              onClick: () => undefined,
              labels: { generateLabels: () => legendItems, boxWidth: 24, color: '#172b4d' },
            },
          },
        },
      });
      this.ready.set(true);
    } catch (error: unknown) {
      if (revision === this.revision) {
        (this.chart ?? chartType?.getChart(canvas))?.destroy();
        this.chart = null;
        this.error.set(chartType
          ? 'Não foi possível desenhar o gráfico. Tente novamente. Consulte a tabela de distribuição.'
          : 'Não foi possível carregar a biblioteca do gráfico. Verifique se a aplicação está conectada e tente novamente. Consulte a tabela de distribuição.');
        console.error('Falha ao exibir o gráfico de distribuição.', error);
      }
    } finally {
      if (revision === this.revision) this.loading.set(false);
    }
  }
}
