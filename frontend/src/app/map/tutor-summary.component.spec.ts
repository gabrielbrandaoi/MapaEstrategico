import { TestBed } from '@angular/core/testing';
import { Coordenada, PontoMapa, ResumoTutor, VinculoMapa } from '../domain/mapa.models';
import { resumirTutor } from '../domain/tutor-map-metrics';
import { LinhaVinculoTutor, TutorSummaryComponent } from './tutor-summary.component';

function coordenada(origem: Coordenada['origem'], latitude = -20): Coordenada {
  return { latitude, longitude: -40, origem, fonte: 'sintética' };
}

function ponto(id: string, tipo: PontoMapa['tipo'], coord: Coordenada): PontoMapa {
  return {
    id,
    tipo,
    nome: `${tipo} sintético ${id}`,
    municipio: 'Cidade sintética',
    ibge6: '999999',
    coordenada: coord,
    cpfProvisorio: false,
    criterios: [],
    alertas: [],
    semBolsista: false,
  };
}

function vinculo(distancia: number, kmPlanilha: number | null): VinculoMapa {
  return {
    id: 'v1',
    tutorId: 't1',
    bolsistaId: 'b1',
    kmPlanilha,
    distanciaGeodesicaKm: distancia,
    criterio: 'Critério',
    regra: '',
    segundaRodada: false,
    regra50Km: false,
    mesmoMunicipio: true,
    divergente: false,
    excede50Km: false,
    rota: null,
  };
}

function render(tutor: PontoMapa, bolsista: PontoMapa, item: VinculoMapa): HTMLElement {
  const fixture = TestBed.createComponent(TutorSummaryComponent);
  const resumo: ResumoTutor = resumirTutor(tutor, [item]);
  const linhas: LinhaVinculoTutor[] = [{ vinculo: item, bolsista, carregandoRota: false }];
  fixture.componentRef.setInput('resumo', resumo);
  fixture.componentRef.setInput('linhas', linhas);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function geodesicCell(root: HTMLElement): string {
  return root.querySelector('.tutor-summary__links tbody td:nth-child(3)')?.textContent?.trim() ?? '';
}

describe('TutorSummaryComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [TutorSummaryComponent] }));

  it('labels zero as same municipality only when both points are municipal centroids', () => {
    const root = render(
      ponto('t1', 'tutor', coordenada('centroide-municipal')),
      ponto('b1', 'fellow', coordenada('centroide-municipal')),
      vinculo(0, 0),
    );
    expect(geodesicCell(root)).toBe('0 km (mesmo município, centróide)');
    expect(root.querySelector('.tutor-summary__links tbody td:nth-child(2)')?.textContent?.trim()).toBe(
      '0 km',
    );
  });

  it('labels zero between imported coordinates as coincident, not same municipality', () => {
    const root = render(
      ponto('t1', 'tutor', coordenada('importada')),
      ponto('b1', 'fellow', coordenada('importada')),
      vinculo(0, 2),
    );
    expect(geodesicCell(root)).toBe('0 km (coordenadas coincidentes)');
  });

  it('shows the real distance for distinct imported coordinates in the same municipality', () => {
    const root = render(
      ponto('t1', 'tutor', coordenada('importada')),
      ponto('b1', 'fellow', coordenada('importada', -20.05)),
      vinculo(5.6, 6),
    );
    expect(geodesicCell(root)).toBe('5,6 km');
    expect(root.textContent).not.toContain('mesmo município, centróide');
  });

  it('discloses that consent may send precise imported coordinates and is shared', () => {
    const root = render(
      ponto('t1', 'tutor', coordenada('importada')),
      ponto('b1', 'fellow', coordenada('centroide-municipal')),
      vinculo(3, 3),
    );
    const consent = root.querySelector('.tutor-summary__consent')?.textContent ?? '';
    expect(consent).toContain('importadas da planilha');
    expect(consent).toContain('centróides municipais');
    expect(consent).toContain('Relações e rotas');
  });
});
