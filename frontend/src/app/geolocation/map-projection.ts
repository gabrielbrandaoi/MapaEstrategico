import type { CenarioMapa, Coordenada, PontoMapa, VinculoMapa } from '../domain/mapa.models';
import type { ImportBatch, ParsedWorkbook } from '../domain/models';
import { calcularVinculos } from '../domain/tutor-map-metrics';
import { CriterioAlocacao } from '../importing/import-contracts';
import { adaptarImportacao } from '../importing/import-domain.adapter';
import { detectarAbas } from '../importing/workbook-classifier';
import { mapearWorkbook } from '../importing/workbook-mapper';

export type ResolverCoordenada = (ibge6: string) => Coordenada | null;

/** Plain text for Angular interpolation/textContent, never an HTML-safe string.
 * Redacts document identifiers and controls without corrupting visible text.
 */
export function textoPublico(value: string): string {
  return value
    .replace(/[0-9xX*•]{3}\.[0-9xX*•]{3}\.[0-9xX*•]{3}-[0-9xX*•]{2}/g, '[documento omitido]')
    .replace(/[0-9xX*•]{11,}/g, '[documento omitido]')
    .replace(/\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}/g, '[documento omitido]')
    .replace(/\bcpf\s*[:=]\s*[0-9xX*•.\s-]+/gi, '[documento omitido]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** Entire structural equality, including array order, missing keys and all report fields. */
function equivalentes(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) &&
      a.length === b.length && a.every((value, i) => equivalentes(value, b[i]));
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).sort(), other = Object.keys(right).sort();
  return keys.length === other.length &&
    keys.every((key, i) => key === other[i] && equivalentes(left[key], right[key]));
}

function localizacaoValida(coord: Coordenada | null): Coordenada | null {
  if (!coord || !Number.isFinite(coord.latitude) || !Number.isFinite(coord.longitude) ||
      Math.abs(coord.latitude) > 90 || Math.abs(coord.longitude) > 180) return null;
  // Copy, so the public DTO never aliases mutable data from a resolver.
  return { ...coord, fonte: textoPublico(coord.fonte) };
}

function finalizar(pontos: PontoMapa[], vinculos: VinculoMapa[]): CenarioMapa {
  return {
    pontos,
    vinculos: calcularVinculos(pontos, vinculos),
    semLocalizacao: pontos.filter(p => p.coordenada === null).map(p => ({
      participanteId: p.id, nome: p.nome, ibge6: p.ibge6,
      motivo: p.ibge6 ? 'Município ausente da base ou base municipal indisponível.'
        : 'Coordenada importada ausente ou inválida; município IBGE não informado.',
    })),
  };
}

function vinculoInicial(
  id: string, tutorId: string, bolsistaId: string, km: number | null,
  criterio: string, regra: string, segundaRodada: boolean, regra50Km: boolean,
): VinculoMapa {
  return {
    id, tutorId, bolsistaId, kmPlanilha: km,
    criterio: textoPublico(criterio), regra: textoPublico(regra),
    segundaRodada, regra50Km, distanciaGeodesicaKm: null, mesmoMunicipio: false,
    divergente: false, excede50Km: false, rota: null,
  };
}

function indexarPor<T>(values: readonly T[], key: (value: T) => string | null): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const id = key(value);
    if (id === null) continue;
    const group = result.get(id);
    if (group) group.push(value);
    else result.set(id, [value]);
  }
  return result;
}

/**
 * Pure browser/Node bridge. Raw identities live only inside this invocation.
 * The supplied batch is never matched by name or by unverified row positions.
 */
export function projetarMapa(
  workbook: ParsedWorkbook, lote: ImportBatch, loteId: string, resolverCoord: ResolverCoordenada,
): CenarioMapa {
  if (!/^lote-\d{1,9}$/.test(loteId)) throw new Error('Identificador de lote opaco inválido.');
  const abas = detectarAbas(workbook);
  const estruturado = abas.some(aba => aba.tipo !== 'ignorada' ||
    aba.ocorrencias.some(issue => issue.severidade === 'erro'));
  if (!estruturado) {
    // Simple/manual imports already carry the selected mapping and locations.
    // No geocoding or municipality inference. Preserve the importer's opaque IDs:
    // participant.id === ponto.id is also used by routing and selection.
    const ids = new Map<string, string>();
    for (const p of lote.report.participants) {
      if (ids.has(p.id)) throw new Error('Participantes duplicados no lote.');
      const bySourceRow = p.id === `${loteId}:${p.type}-${p.sourceRow}` &&
        Number.isSafeInteger(p.sourceRow) && p.sourceRow > 0 && p.sourceRow < 1_000_000_000;
      const opaqueIndex = new RegExp(`^${loteId}:p[1-9]\\d{0,8}$`).test(p.id);
      if (!bySourceRow && !opaqueIndex) throw new Error('Identificador de participante não opaco.');
      ids.set(p.id, p.id);
    }
    const linked = new Set((lote.report.relationships ?? []).map(v => v.tutorId));
    const pontos = lote.report.participants.map((p): PontoMapa => ({
      id: ids.get(p.id)!, tipo: p.type, nome: textoPublico(p.name),
      municipio: p.city === null ? null : textoPublico(p.city), ibge6: null,
      coordenada: p.location ? localizacaoValida({
        latitude: p.location.latitude, longitude: p.location.longitude,
        origem: 'importada', fonte: 'Coordenada importada da planilha; sem geocodificação',
      }) : null,
      cpfProvisorio: p.identityUnverified ?? false, criterios: [], alertas: [],
      semBolsista: p.type === 'tutor' && !linked.has(p.id),
    }));
    const roles = new Map(lote.report.participants.map(p => [p.id, p.type]));
    const vinculos = (lote.report.relationships ?? []).map((v, i) => {
      const tutorId = ids.get(v.tutorId), bolsistaId = ids.get(v.fellowId);
      if (!tutorId || !bolsistaId || roles.get(v.tutorId) !== 'tutor' ||
          roles.get(v.fellowId) !== 'fellow') throw new Error('Vínculo inconsistente no lote.');
      return vinculoInicial(`${loteId}:v${i + 1}`, tutorId, bolsistaId, v.reportedKm, '', '', false, false);
    });
    return finalizar(pontos, vinculos);
  }

  const replay = mapearWorkbook(workbook, abas);
  const esperado = adaptarImportacao(replay, loteId);
  // Validate ALL output fields before constructing public DTOs or invoking resolver.
  if (!equivalentes(esperado, lote)) {
    throw new Error('Lote incompatível com a planilha: reimporte os dados antes de projetar.');
  }
  const { tutores, bolsistas, vinculos: rawVinculos, alertas } = replay.dados;
  const tutorIds = new Map(tutores.map((tutor, i) =>
    [tutor.id, esperado.report.participants[i].id]));
  const bolsistaIds = new Map(bolsistas.map((bolsista, i) =>
    [bolsista.id, esperado.report.participants[tutores.length + i].id]));
  const porTutor = indexarPor(rawVinculos, v => v.tutorId);
  const porBolsista = indexarPor(rawVinculos, v => v.bolsistaId);
  const alertasPorTutor = indexarPor(alertas, alerta => alerta.tutorId);
  const pontos: PontoMapa[] = [];
  for (const tutor of tutores) {
    // Identity join (private ID), never a name/municipality heuristic.
    const avisos = alertasPorTutor.get(tutor.id) ?? [];
    const relacionados = porTutor.get(tutor.id) ?? [];
    pontos.push({
      id: tutorIds.get(tutor.id)!, tipo: 'tutor', nome: textoPublico(tutor.nome),
      municipio: tutor.municipio === null ? null : textoPublico(tutor.municipio),
      ibge6: tutor.ibge || null, coordenada: localizacaoValida(resolverCoord(tutor.ibge)),
      cpfProvisorio: tutor.cpfProvisorio,
      criterios: [...new Set([tutor.criterioOriginal, ...relacionados.map(v => v.criterioOriginal)]
        .filter(Boolean).map(textoPublico))],
      alertas: avisos.map(a => textoPublico(a.motivo || a.tipo)),
      semBolsista: relacionados.length === 0,
    });
  }
  for (const bolsista of bolsistas) {
    pontos.push({
      id: bolsistaIds.get(bolsista.id)!, tipo: 'fellow', nome: textoPublico(bolsista.nome),
      municipio: null, ibge6: bolsista.ibge || null,
      coordenada: localizacaoValida(resolverCoord(bolsista.ibge)),
      cpfProvisorio: bolsista.cpfProvisorio,
      criterios: [...new Set((porBolsista.get(bolsista.id) ?? [])
        .map(v => v.criterioOriginal).filter(Boolean).map(textoPublico))],
      alertas: [], semBolsista: false,
    });
  }
  const vinculos = rawVinculos.map((v, i) => {
    const tutorId = tutorIds.get(v.tutorId), bolsistaId = bolsistaIds.get(v.bolsistaId);
    if (!tutorId || !bolsistaId) throw new Error('Vínculo inconsistente na projeção.');
    return vinculoInicial(`${loteId}:v${i + 1}`, tutorId, bolsistaId, v.kmPlanilha,
      v.criterioOriginal, v.origemOriginal,
      v.criterio === CriterioAlocacao.SegundaRodada,
      v.criterio === CriterioAlocacao.DoisMunicipios50Km);
  });
  return finalizar(pontos, vinculos);
}
