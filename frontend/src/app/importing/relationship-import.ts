import { ImportReport, ParsedSheet, ParsedWorkbook } from '../domain/models';
import { AbaDetectada } from './import-contracts';
import { adaptarImportacao } from './import-domain.adapter';
import { normalizeHeader } from './excel-import';
import { detectarAbas } from './workbook-classifier';
import { mapearWorkbook } from './workbook-mapper';

export interface RelationshipColumns {
  tutorCpf: number;
  tutorName: number;
  fellowCpf: number;
  fellowName: number;
  tutorCity: number | null;
  fellowCity: number | null;
  km: number | null;
}

export function detectRelationshipColumns(headers: readonly unknown[]): RelationshipColumns | null {
  const detected = detectarAbas({
    fileName: '',
    sheets: [{ name: '', rows: [[...headers]] }],
  })[0];
  if (!detected || detected.tipo !== 'nominal') return null;
  return nominalColumns(detected, headers);
}

export function findRelationshipHeader(sheet: ParsedSheet): number {
  const detected = detectarAbas({ fileName: '', sheets: [sheet] })[0];
  return detected?.tipo === 'nominal' ? detected.cabecalho : -1;
}

export function selectRelationshipSheet(workbook: ParsedWorkbook): ParsedSheet | undefined {
  const candidates = detectarAbas(workbook).filter((aba) => aba.tipo === 'nominal');
  const selected = candidates.find((aba) => aba.colunas.km !== undefined) ?? candidates[0];
  return selected?.aba;
}

export function importRelationships(
  sheet: ParsedSheet,
  headerRow: number,
  fileName: string,
): ImportReport {
  const documento = { fileName, sheets: [sheet] };
  const detected = detectarAbas(documento)[0];
  if (!detected || detected.tipo !== 'nominal' || detected.cabecalho !== headerRow) {
    return {
      totalRows: 0,
      participants: [],
      participantsWithoutCoordinates: 0,
      invalidRows: [],
      relationships: [],
      issues: [
        {
          rowNumber: null,
          severity: 'error',
          code: 'missing_relationship_headers',
          message: 'São necessárias colunas distintas de CPF e nome para tutor e bolsista.',
        },
      ],
    };
  }
  return adaptarImportacao(mapearWorkbook(documento, [detected]), 'legacy').report;
}

function nominalColumns(
  aba: AbaDetectada,
  headers: readonly unknown[],
): RelationshipColumns | null {
  const { cpfTutor, nomeTutor, cpfBolsista, nomeBolsista } = aba.colunas;
  if (
    cpfTutor === undefined ||
    nomeTutor === undefined ||
    cpfBolsista === undefined ||
    nomeBolsista === undefined
  )
    return null;
  const fellowCities = headers.flatMap((header, index) =>
    ['municipiobolsista', 'municipiodobolsista', 'cidadebolsista', 'cidadedobolsista'].includes(
      normalizeHeader(header),
    )
      ? [index]
      : [],
  );
  return {
    tutorCpf: cpfTutor,
    tutorName: nomeTutor,
    fellowCpf: cpfBolsista,
    fellowName: nomeBolsista,
    tutorCity: aba.colunas.municipioTutor ?? null,
    fellowCity: fellowCities.length === 1 ? (fellowCities[0] ?? null) : null,
    km: aba.colunas.km ?? null,
  };
}
