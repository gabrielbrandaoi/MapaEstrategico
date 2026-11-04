import { haversineKm } from './distance';
import { EstatisticaKm, PontoMapa, ResumoTutor, VinculoMapa } from './mapa.models';
import { Location } from './models';

export const DISTANCE_POLICY = Object.freeze({
  limiteRegra50Km: 50,
  divergenciaAbsolutaKm: 15,
  divergenciaRelativa: 0.2,
});

function distanciaValida(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

/** Ausência não é zero; números inválidos são erros explícitos. */
export function divergenciaRelevante(
  planilha: number | null,
  geodesica: number | null,
): boolean {
  for (const value of [planilha, geodesica]) {
    if (value !== null && !distanciaValida(value)) {
      throw new RangeError('Distância deve ser finita, não negativa ou null.');
    }
  }
  if (planilha === null || geodesica === null) {
    return false;
  }
  return Math.abs(planilha - geodesica) > Math.max(
    DISTANCE_POLICY.divergenciaAbsolutaKm,
    DISTANCE_POLICY.divergenciaRelativa * geodesica,
  );
}

function localizacao(ponto: PontoMapa | undefined): Location | null {
  const coordenada = ponto?.coordenada;
  return coordenada
    ? {
        latitude: coordenada.latitude,
        longitude: coordenada.longitude,
        source: coordenada.origem === 'importada' ? 'imported' : 'municipal-centroid',
      }
    : null;
}

/**
 * Enriquece todos os vínculos importados, sem selecionar candidatos ou atribuir tutores.
 * Distâncias são de um trecho entre pontos, não ida/volta nem circuito multiparada.
 * Município é confirmado somente por IBGE presente e igual; nomes não bastam.
 * Centroides coincidentes dão zero pelo Haversine, nunca por sobrescrita pelo IBGE.
 */
export function calcularVinculos(
  pontos: readonly PontoMapa[],
  vinculos: readonly VinculoMapa[],
): VinculoMapa[] {
  const porId = new Map(pontos.map((ponto) => [ponto.id, ponto]));
  return vinculos.map((vinculo) => {
    const tutor = porId.get(vinculo.tutorId);
    const bolsista = porId.get(vinculo.bolsistaId);
    const origem = localizacao(tutor);
    const destino = localizacao(bolsista);
    const distanciaGeodesicaKm = origem && destino ? haversineKm(origem, destino) : null;
    return {
      ...vinculo,
      distanciaGeodesicaKm,
      mesmoMunicipio: Boolean(tutor?.ibge6 && tutor.ibge6 === bolsista?.ibge6),
      divergente: divergenciaRelevante(vinculo.kmPlanilha, distanciaGeodesicaKm),
      excede50Km: vinculo.regra50Km && !vinculo.segundaRodada && (
        (distanciaGeodesicaKm !== null &&
          distanciaGeodesicaKm > DISTANCE_POLICY.limiteRegra50Km) ||
        (vinculo.kmPlanilha !== null &&
          vinculo.kmPlanilha > DISTANCE_POLICY.limiteRegra50Km)
      ),
    };
  });
}

/** Denominador: vínculos do tutor, inclusive duplicados; inválidos contam como ausentes. */
function estatistica(valores: readonly (number | null)[]): EstatisticaKm {
  const validos = valores.filter(distanciaValida);
  let minimo: number | null = null;
  let maximo: number | null = null;
  let media: number | null = null;
  for (const [index, valor] of validos.entries()) {
    minimo = minimo === null ? valor : Math.min(minimo, valor);
    maximo = maximo === null ? valor : Math.max(maximo, valor);
    // Média incremental evita overflow da soma de números finitos.
    media = media === null ? valor : media + (valor - media) / (index + 1);
  }
  return {
    amostras: validos.length,
    ausentes: valores.length - validos.length,
    minimo,
    media,
    maximo,
  };
}

/** Estatísticas por vínculo; cobertura por bolsistas únicos. Não infere elegibilidade. */
export function resumirTutor(
  tutor: PontoMapa,
  vinculos: readonly VinculoMapa[],
): ResumoTutor {
  const relacionados = vinculos.filter((vinculo) => vinculo.tutorId === tutor.id);
  const criterios = new Set(tutor.criterios);
  const alertas = new Set(tutor.alertas);
  const rodoviarias: (number | null)[] = [];
  for (const vinculo of relacionados) {
    if (vinculo.criterio) {
      criterios.add(vinculo.criterio);
    }
    if (!distanciaValida(vinculo.kmPlanilha)) {
      alertas.add('Distância de planilha ausente ou inválida.');
    }
    if (!distanciaValida(vinculo.distanciaGeodesicaKm)) {
      alertas.add('Distância geodésica ausente ou inválida; verifique as localizações.');
    }
    const metros = vinculo.rota?.distanceMeters ?? null;
    const rodoviaria = vinculo.rota?.status === 'success' && distanciaValida(metros)
      ? metros / 1_000
      : null;
    rodoviarias.push(rodoviaria);
    if (rodoviaria === null) {
      alertas.add('Distância rodoviária não calculada, indisponível ou inválida.');
    }
    if (vinculo.divergente) {
      alertas.add('Divergência relevante entre distância de planilha e geodésica.');
    }
    if (vinculo.regra50Km && !vinculo.segundaRodada && vinculo.excede50Km) {
      alertas.add('Vínculo sujeito à regra de 50 km excede o limite.');
    }
  }
  return {
    tutor,
    quantidadeBolsistas: new Set(relacionados.map((vinculo) => vinculo.bolsistaId)).size,
    quantidadeVinculos: relacionados.length,
    planilha: estatistica(relacionados.map((vinculo) => vinculo.kmPlanilha)),
    geodesica: estatistica(relacionados.map((vinculo) => vinculo.distanciaGeodesicaKm)),
    rodoviaria: estatistica(rodoviarias),
    criterios: [...criterios],
    alertas: [...alertas],
  };
}
