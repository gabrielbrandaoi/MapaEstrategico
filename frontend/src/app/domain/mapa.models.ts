import { RoadRoute } from './models';

export interface Coordenada {
  readonly latitude: number;
  readonly longitude: number;
  readonly origem: 'importada' | 'centroide-municipal';
  readonly fonte: string;
}

export interface PontoMapa {
  readonly id: string;
  readonly tipo: 'tutor' | 'fellow';
  readonly nome: string;
  readonly municipio: string | null;
  readonly ibge6: string | null;
  readonly coordenada: Coordenada | null;
  readonly cpfProvisorio: boolean;
  readonly criterios: readonly string[];
  readonly alertas: readonly string[];
  readonly semBolsista: boolean;
}

export interface VinculoMapa {
  readonly id: string;
  readonly tutorId: string;
  readonly bolsistaId: string;
  readonly kmPlanilha: number | null;
  readonly distanciaGeodesicaKm: number | null;
  readonly criterio: string;
  readonly regra: string;
  readonly segundaRodada: boolean;
  readonly regra50Km: boolean;
  readonly mesmoMunicipio: boolean;
  readonly divergente: boolean;
  readonly excede50Km: boolean;
  readonly rota: RoadRoute | null;
}

export interface EstatisticaKm {
  readonly amostras: number;
  readonly ausentes: number;
  readonly minimo: number | null;
  readonly media: number | null;
  readonly maximo: number | null;
}

export interface ResumoTutor {
  readonly tutor: PontoMapa;
  readonly quantidadeBolsistas: number;
  readonly quantidadeVinculos: number;
  readonly planilha: EstatisticaKm;
  readonly geodesica: EstatisticaKm;
  readonly rodoviaria: EstatisticaKm;
  readonly criterios: readonly string[];
  readonly alertas: readonly string[];
}

export interface ProblemaLocalizacao {
  readonly participanteId: string;
  readonly nome: string;
  readonly ibge6: string | null;
  readonly motivo: string;
}

export interface CenarioMapa {
  readonly pontos: readonly PontoMapa[];
  readonly vinculos: readonly VinculoMapa[];
  readonly semLocalizacao: readonly ProblemaLocalizacao[];
}
