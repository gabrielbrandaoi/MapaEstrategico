import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { EstatisticaKm, PontoMapa, ResumoTutor, VinculoMapa } from '../domain/mapa.models';

/** Linha de apresentação já resolvida pelo container (vínculo + bolsista + estado da rota). */
export interface LinhaVinculoTutor {
  readonly vinculo: VinculoMapa;
  readonly bolsista: PontoMapa | null;
  readonly carregandoRota: boolean;
}

interface LinhaEstatistica {
  readonly rotulo: string;
  readonly estatistica: EstatisticaKm;
}

@Component({
  selector: 'app-tutor-summary',
  standalone: true,
  templateUrl: './tutor-summary.component.html',
  styleUrl: './tutor-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TutorSummaryComponent {
  readonly resumo = input.required<ResumoTutor>();
  readonly linhas = input<readonly LinhaVinculoTutor[]>([]);
  readonly routeConsent = input(false);

  readonly routeConsentChange = output<boolean>();
  readonly routeRequested = output<string>();
  readonly deselect = output<void>();

  protected readonly estatisticas = computed<readonly LinhaEstatistica[]>(() => {
    const resumo = this.resumo();
    return [
      { rotulo: 'Planilha (informada)', estatistica: resumo.planilha },
      { rotulo: 'Geodésica (linha reta)', estatistica: resumo.geodesica },
      { rotulo: 'Rodoviária (OSRM)', estatistica: resumo.rodoviaria },
    ];
  });

  protected readonly pontosAtencao = computed(() =>
    this.linhas().filter(
      ({ vinculo }) =>
        vinculo.divergente || vinculo.regra50Km || vinculo.excede50Km || vinculo.segundaRodada,
    ),
  );

  protected onConsentChanged(event: Event): void {
    const target = event.target;
    this.routeConsentChange.emit(target instanceof HTMLInputElement && target.checked);
  }

  protected formatKm(value: number | null): string {
    return value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
  }

  /**
   * Zero só significa "mesmo município" quando ambos os pontos são centróides municipais;
   * caso contrário, as coordenadas apenas coincidem.
   */
  protected formatGeodesica(linha: LinhaVinculoTutor): string {
    const { vinculo } = linha;
    if (vinculo.distanciaGeodesicaKm === null) return 'Sem localização';
    if (vinculo.distanciaGeodesicaKm !== 0) return this.formatKm(vinculo.distanciaGeodesicaKm);
    const ambosCentroides =
      this.resumo().tutor.coordenada?.origem === 'centroide-municipal' &&
      linha.bolsista?.coordenada?.origem === 'centroide-municipal';
    return ambosCentroides && vinculo.mesmoMunicipio
      ? '0 km (mesmo município, centróide)'
      : '0 km (coordenadas coincidentes)';
  }

  protected formatRodoviaria(vinculo: VinculoMapa): string {
    const rota = vinculo.rota;
    if (!rota) return 'Não calculada';
    if (rota.status === 'success' && rota.distanceMeters !== null) {
      return this.formatKm(rota.distanceMeters / 1_000);
    }
    return rota.status === 'unavailable' ? 'Rota indisponível' : 'Falha no roteador';
  }

  protected podeCalcular(linha: LinhaVinculoTutor): boolean {
    return (
      (linha.bolsista?.coordenada ?? null) !== null &&
      this.resumo().tutor.coordenada !== null &&
      !linha.carregandoRota &&
      linha.vinculo.rota?.status !== 'success'
    );
  }
}


