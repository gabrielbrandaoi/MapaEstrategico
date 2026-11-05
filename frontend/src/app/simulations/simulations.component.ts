import { DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal, viewChild } from '@angular/core';
import { compareAllocationDistributions } from '../domain/allocation-distribution';
import type { AllocationResult, AllocationDistributionKey } from '../domain/allocation.models';
import type { Participant } from '../domain/models';
import { ALLOCATION_PALETTE } from '../map/allocation-palette';
import { TUTOR_STATUS_LABELS } from '../map/allocation-presentation';
import type { SimulationScenario } from '../map/allocation-presentation';
import { ReportExportService } from '../reports/report-export.service';
import {
  DistributionChartComponent,
  type DistributionDisplayRow,
} from './distribution-chart.component';

type SimulationView = '1' | '2' | 'comparison';
type SimulationContent =
  | { readonly state: 'loading' | 'empty' }
  | { readonly state: 'error'; readonly message: string }
  | {
    readonly state: 'success';
    readonly scenarios: readonly SimulationScenario[];
    readonly results: readonly AllocationResult[];
    readonly rows: readonly DistributionDisplayRow[];
  };

@Component({
  selector: 'app-simulations',
  standalone: true,
  imports: [DecimalPipe, DistributionChartComponent],
  templateUrl: './simulations.component.html',
  styleUrl: './simulations.component.scss',
})
export class SimulationsComponent {
  readonly scenarios = input<readonly SimulationScenario[]>([]);
  readonly participants = input<readonly Participant[]>([]);
  readonly loading = input(false);
  readonly view = signal<SimulationView>('comparison');
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  readonly exportStatus = signal<string | null>(null);
  readonly chart = viewChild(DistributionChartComponent);
  readonly palette = ALLOCATION_PALETTE;
  readonly tutorStatusLabels = TUTOR_STATUS_LABELS;
  readonly participantNames = computed(() => new Map(
    this.participants().map((participant) => [participant.id, participant.name]),
  ));
  private readonly exporter = inject(ReportExportService);
  private readonly destroyRef = inject(DestroyRef);
  private exportRevision = 0;

  readonly content = computed<SimulationContent>(() => {
    if (this.loading()) return { state: 'loading' };
    if (this.participants().length === 0) return { state: 'empty' };
    const view = this.view();
    const minimums: readonly (1 | 2)[] = view === 'comparison' ? [1, 2] : [view === '1' ? 1 : 2];
    const scenarios: SimulationScenario[] = [];
    const results: AllocationResult[] = [];
    for (const minimum of minimums) {
      const scenario = this.scenarios().find((item) => item.minimum === minimum);
      if (!scenario || scenario.error || !scenario.result) {
        return {
          state: 'error',
          message: `Falha no cenário mínimo ${minimum}: ${scenario?.error || 'resultado indisponível.'}`,
        };
      }
      scenarios.push(scenario);
      results.push(scenario.result);
    }
    try {
      const rows: readonly DistributionDisplayRow[] = view === 'comparison'
        ? compareAllocationDistributions(results[0], results[1]).map((row) => ({
          key: row.key,
          label: row.label,
          subtotal: row.subtotal,
          values: [
            { minimum: 1, count: row.minimum1Count, percentage: row.minimum1Percentage },
            { minimum: 2, count: row.minimum2Count, percentage: row.minimum2Percentage },
          ],
          countDifference: row.countDifference,
          percentagePointDifference: row.percentagePointDifference,
        }))
        : results[0].distribution.rows.map((row) => ({
          key: row.key,
          label: row.label,
          subtotal: row.subtotal,
          values: [{
            minimum: scenarios[0].minimum,
            count: row.count,
            percentage: row.percentage,
          }],
          countDifference: null,
          percentagePointDifference: null,
        }));
      return { state: 'success', scenarios, results, rows };
    } catch {
      return { state: 'error', message: 'Não foi possível comparar as distribuições dos cenários.' };
    }
  });

  constructor() {
    effect(() => {
      this.content();
      ++this.exportRevision;
      this.exportError.set(null);
      this.exportStatus.set(null);
    });
  }

  rowColor(key: AllocationDistributionKey): string {
    switch (key) {
      case 'dismissed': return this.palette.dismissed;
      case 'below-minimum': return this.palette.belowMinimum;
      case '0': return this.palette.unassigned;
      default: return this.palette.active;
    }
  }

  async exportDistribution(format: 'csv' | 'xlsx' | 'png'): Promise<void> {
    const content = this.content();
    if (content.state !== 'success' || this.exporting()) return;
    await this.performExport(async () => {
      if (format === 'csv') {
        this.exporter.exportAllocationDistributionCsv(content.results);
      } else if (format === 'xlsx') {
        await this.exporter.exportAllocationDistributionExcel(content.results);
      } else {
        const chart = this.chart();
        if (!chart) throw new Error('Gráfico indisponível.');
        await chart.exportPng();
      }
    }, format === 'xlsx' ? 'Excel' : format.toUpperCase());
  }

  async exportRelationships(minimum: 1 | 2, format: 'csv' | 'xlsx'): Promise<void> {
    const content = this.content();
    if (content.state !== 'success' || this.exporting()) return;
    const result = content.results.find((item) => item.config.minimoPorTutor === minimum);
    if (!result) return;
    const participants = this.participants();
    await this.performExport(async () => {
      if (format === 'csv') this.exporter.exportAllocationCsv(result, participants);
      else await this.exporter.exportAllocationExcel(result, participants);
    }, `de vínculos mínimo ${minimum} (${format === 'xlsx' ? 'Excel' : 'CSV'})`);
  }

  private async performExport(operation: () => Promise<void>, label: string): Promise<void> {
    const revision = ++this.exportRevision;
    this.exporting.set(true);
    this.exportError.set(null);
    this.exportStatus.set(null);
    try {
      await operation();
      if (!this.destroyRef.destroyed && revision === this.exportRevision) {
        this.exportStatus.set(`Download ${label} solicitado.`);
      }
    } catch {
      if (!this.destroyRef.destroyed && revision === this.exportRevision) {
        this.exportError.set('Não foi possível exportar o arquivo. Tente novamente.');
      }
    } finally {
      if (!this.destroyRef.destroyed) this.exporting.set(false);
    }
  }
}
