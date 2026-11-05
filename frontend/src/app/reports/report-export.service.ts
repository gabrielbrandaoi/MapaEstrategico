import { Injectable } from '@angular/core';
import type { AllocationResult, TutorAllocation } from '../domain/allocation.models';
import { validateAllocationResult } from '../domain/allocation';
import {
  compareAllocationDistributions,
  validateAllocationDistribution,
} from '../domain/allocation-distribution';
import { classifyRoadDistance } from '../domain/distance';
import { ImportedRelationship, Participant, ProximityPair } from '../domain/models';

export interface ExportRow {
  tutor: Participant;
  fellow: Participant;
  pair: ProximityPair;
}

export interface ImportedRelationshipExportRow {
  tutor: Participant;
  fellow: Participant;
  relationship: ImportedRelationship;
}

export function importedRelationshipData(
  rows: readonly ImportedRelationshipExportRow[],
): (string | number)[][] {
  return [
    [
      'Tutor',
      'Cidade do tutor',
      'Bolsista',
      'Cidade do bolsista',
      'KM informado na planilha',
      'Origem da distância',
      'Arquivo',
      'Aba',
      'Linha',
      'Identificação do tutor',
      'Identificação do bolsista',
    ],
    ...rows.map(({ tutor, fellow, relationship }) => [
      tutor.name,
      tutor.city ?? '',
      fellow.name,
      fellow.city ?? '',
      relationship.reportedKm ?? '',
      'Informada na planilha; não verificada pelo roteador',
      relationship.fileName,
      relationship.sheetName,
      relationship.sourceRow,
      tutor.identityUnverified ? 'Provisória: CPF mascarado e nome' : 'CPF completo informado',
      fellow.identityUnverified ? 'Provisória: CPF mascarado e nome' : 'CPF completo informado',
    ]),
  ];
}

const HEADERS = [
  'Tutor',
  'Cidade do tutor',
  'Bolsista',
  'Cidade do bolsista',
  'Distância em linha reta (km)',
  'Status da rota rodoviária',
  'Faixa rodoviária',
  'Distância rodoviária (km)',
  'Tempo rodoviário (min)',
  'Provedor',
  'Calculada em',
];

type ReportValue = string | number;

export interface AllocationExcelData {
  resumo: ReportValue[][];
  tutores: ReportValue[][];
  vinculos: ReportValue[][];
  semTutor: ReportValue[][];
  distribuicao: ReportValue[][];
}

export interface AllocationDistributionExcelData {
  resumo: ReportValue[][];
  distribuicao: ReportValue[][];
  comparacao: ReportValue[][];
}

const SCENARIO_HEADERS = [
  'Mínimo por tutor',
  'Raio máximo (km)',
  'Capacidade máxima',
  'Dispensa (%)',
];

const GEODESIC_DISTANCE_NOTE =
  'Geodésica em linha reta; não é KM informado na planilha nem distância rodoviária';

const DISTRIBUTION_NOTE =
  'Percentuais sobre todos os tutores. A linha 0 é subtotal de dispensados e abaixo do mínimo; não somar duas vezes. Total = cargas 1 a 4 + dispensados + abaixo do mínimo.';
const COMPARISON_NOTE =
  'Delta = mínimo 2 menos mínimo 1; diferença de percentuais em pontos percentuais (p.p.).';
const DISTRIBUTION_HEADERS = [
  ...SCENARIO_HEADERS,
  'Total de tutores (denominador)',
  'Categoria',
  'Descrição',
  'Quantidade de tutores',
  'Percentual de todos os tutores (%)',
  'Subtotal',
  'Nota',
];

/** Anonymous table: no participant registry or personal data is needed. */
export function allocationDistributionExcelData(
  results: readonly AllocationResult[],
): AllocationDistributionExcelData {
  const scenarios = validatedDistributionScenarios(results);
  const comparison =
    scenarios.length === 2 ? compareAllocationDistributions(scenarios[0]!, scenarios[1]!) : [];
  return {
    resumo: [
      [...SCENARIO_HEADERS, 'Indicador', 'Valor', 'Unidade'],
      ...scenarios.flatMap((result) => [
        [...scenarioValues(result), 'Total de tutores', result.distribution.totalTutors, 'tutores'],
        ...allocationIndicatorRows(result).map(([label, count, unit]) => [
          ...scenarioValues(result),
          label,
          count ?? '',
          unit ?? '',
        ]),
        [...scenarioValues(result), 'Nota da distribuição', DISTRIBUTION_NOTE, ''],
        [...scenarioValues(result), 'Métrica das distâncias', GEODESIC_DISTANCE_NOTE, ''],
      ]),
    ],
    distribuicao: [[...DISTRIBUTION_HEADERS], ...scenarios.flatMap(distributionRows)],
    comparacao:
      comparison.length === 0
        ? []
        : [
            [
              'Raio máximo (km)',
              'Capacidade máxima',
              'Dispensa (%)',
              'Total de tutores (denominador)',
              'Categoria',
              'Descrição',
              'Subtotal',
              'Mínimo 1: quantidade',
              'Mínimo 2: quantidade',
              'Delta 2 - 1: quantidade',
              'Mínimo 1 (%)',
              'Mínimo 2 (%)',
              'Delta 2 - 1 (p.p.)',
              'Nota',
            ],
            ...comparison.map((row) => [
              ...scenarioValues(scenarios[0]!).slice(1),
              scenarios[0]!.distribution.totalTutors,
              row.key,
              row.label,
              row.subtotal ? 'Sim' : 'Não',
              row.minimum1Count,
              row.minimum2Count,
              row.countDifference,
              row.minimum1Percentage,
              row.minimum2Percentage,
              row.percentagePointDifference,
              `${DISTRIBUTION_NOTE} ${COMPARISON_NOTE}`,
            ]),
          ],
  };
}

/** One rectangular CSV with explicit scenario and comparison record types. */
export function allocationDistributionCsvData(
  results: readonly AllocationResult[],
): ReportValue[][] {
  const data = allocationDistributionExcelData(results);
  const comparisonHeaders = data.comparacao[0]?.slice(7, 13) ?? [
    'Mínimo 1: quantidade',
    'Mínimo 2: quantidade',
    'Delta 2 - 1: quantidade',
    'Mínimo 1 (%)',
    'Mínimo 2 (%)',
    'Delta 2 - 1 (p.p.)',
  ];
  return [
    ['Tipo de registro', ...DISTRIBUTION_HEADERS, ...comparisonHeaders],
    ...data.distribuicao.slice(1).map((row) => ['distribuicao', ...row, '', '', '', '', '', '']),
    ...data.comparacao
      .slice(1)
      .map((row) => [
        'comparacao',
        '1 versus 2',
        ...row.slice(0, 3),
        row[3]!,
        row[4]!,
        row[5]!,
        '',
        '',
        row[6]!,
        row[13]!,
        ...row.slice(7, 13),
      ]),
  ];
}

function distributionRows(result: AllocationResult): ReportValue[][] {
  return result.distribution.rows.map((row) => [
    ...scenarioValues(result),
    result.distribution.totalTutors,
    row.key,
    row.label,
    row.count,
    row.percentage,
    row.subtotal ? 'Sim' : 'Não',
    DISTRIBUTION_NOTE,
  ]);
}

function validatedDistributionScenarios(results: readonly AllocationResult[]): AllocationResult[] {
  if (!Array.isArray(results) || (results.length !== 1 && results.length !== 2)) {
    throw new Error('Relatório de alocação: informe um ou dois cenários.');
  }
  for (const result of results) validateReportAllocation(result);
  return [...results].sort((a, b) => a.config.minimoPorTutor - b.config.minimoPorTutor);
}

function validateReportAllocation(result: AllocationResult): void {
  validateAllocationResult(result);
  validateAllocationDistribution(result.distribution, result.tutors);
}

/**
 * Builds typed CSV records. The scenario configuration is repeated on every
 * record so individual rows remain interpretable when filtered or separated.
 */
export function allocationCsvData(
  result: AllocationResult,
  participants: readonly Participant[],
): ReportValue[][] {
  validateReportAllocation(result);
  const headers = [
    'tipo_registro',
    'minimo_por_tutor',
    'raio_maximo_km',
    'capacidade_maxima',
    'percentual_dispensa',
    'id_tutor',
    'tutor',
    'cidade_tutor',
    'status_tutor',
    'razao_tutor',
    'fellow_count',
    'id_bolsista',
    'bolsista',
    'cidade_bolsista',
    'distancia_geodesica_km',
    'metrica_distancia',
    'razao_sem_tutor',
    'indicador',
    'valor',
  ];
  const peopleById = allocationParticipants(result, participants);
  const tutors = allocationTutorRows(result, peopleById);
  const scenario = scenarioValues(result);
  const records: ReportValue[][] = [headers];

  for (const { participant, allocation } of tutors) {
    records.push([
      'tutor',
      ...scenario,
      participant.id,
      participant.name,
      participant.city ?? '',
      allocation.status,
      allocation.reason,
      allocation.fellowCount,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }

  for (const link of result.links) {
    const tutor = reportParticipant(peopleById, link.tutorId, 'tutor');
    const fellow = reportParticipant(peopleById, link.fellowId, 'fellow');
    records.push([
      'vinculo',
      ...scenario,
      link.tutorId,
      tutor.name,
      tutor.city ?? '',
      '',
      '',
      '',
      link.fellowId,
      fellow.name,
      fellow.city ?? '',
      link.straightLineKm,
      GEODESIC_DISTANCE_NOTE,
      '',
      '',
      '',
    ]);
  }

  for (const unassigned of result.unassignedFellows) {
    const fellow = reportParticipant(peopleById, unassigned.fellowId, 'fellow');
    records.push([
      'sem_tutor',
      ...scenario,
      '',
      '',
      '',
      '',
      '',
      '',
      unassigned.fellowId,
      fellow.name,
      fellow.city ?? '',
      '',
      '',
      unassigned.reason,
      '',
      '',
    ]);
  }

  for (const [indicator, value] of allocationIndicatorRows(result)) {
    records.push([
      'indicador',
      ...scenario,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      indicator,
      value ?? '',
    ]);
  }

  const distributionHeaders = [
    'categoria_distribuicao',
    'percentual_todos_tutores',
    'subtotal',
    'total_tutores_denominador',
    'nota_distribuicao',
  ];
  const extended = records.map((row, index) => [
    ...row,
    ...(index === 0 ? distributionHeaders : ['', '', '', '', '']),
  ]);
  for (const row of result.distribution.rows) {
    extended.push([
      'distribuicao',
      ...scenario,
      ...Array<ReportValue>(12).fill(''),
      row.label,
      row.count,
      row.key,
      row.percentage,
      row.subtotal ? 'Sim' : 'Não',
      result.distribution.totalTutors,
      DISTRIBUTION_NOTE,
    ]);
  }
  return extended;
}

/** Builds allocation sheets without adding planilha or route distances. */
export function allocationExcelData(
  result: AllocationResult,
  participants: readonly Participant[],
): AllocationExcelData {
  validateReportAllocation(result);
  const scenario = scenarioValues(result);
  const peopleById = allocationParticipants(result, participants);
  const tutors = allocationTutorRows(result, peopleById);
  const scenarioHeaders = [...SCENARIO_HEADERS];

  return {
    resumo: [
      [...scenarioHeaders, 'Indicador', 'Valor', 'Unidade'],
      ...allocationIndicatorRows(result).map(([indicator, value, unit]) => [
        ...scenario,
        indicator,
        value ?? '',
        unit ?? '',
      ]),
      [...scenario, 'Nota sobre distância dos vínculos', GEODESIC_DISTANCE_NOTE, ''],
      [...scenario, 'Total de tutores', result.distribution.totalTutors, 'tutores'],
      [...scenario, 'Nota da distribuição', DISTRIBUTION_NOTE, ''],
      ...result.distribution.rows.flatMap((row) => [
        [...scenario, `Distribuição ${row.key}: ${row.label}`, row.count, 'tutores'],
        [
          ...scenario,
          `Distribuição ${row.key}: percentual de todos os tutores`,
          row.percentage,
          '%',
        ],
      ]),
    ],
    tutores: [
      [
        ...scenarioHeaders,
        'ID tutor',
        'Tutor',
        'Cidade',
        'Status',
        'Razão',
        'Quantidade de bolsistas',
        'Bolsista mais próximo (km geodésicos)',
      ],
      ...tutors.map(({ participant, allocation }) => [
        ...scenario,
        participant.id,
        participant.name,
        participant.city ?? '',
        allocation.status,
        allocation.reason,
        allocation.fellowCount,
        allocation.nearestFellowKm ?? '',
      ]),
    ],
    vinculos: [
      [
        ...scenarioHeaders,
        'ID tutor',
        'Tutor',
        'Cidade do tutor',
        'ID bolsista',
        'Bolsista',
        'Cidade do bolsista',
        'Distância geodésica (km)',
        'Métrica da distância',
      ],
      ...result.links.map((link) => {
        const tutor = reportParticipant(peopleById, link.tutorId, 'tutor');
        const fellow = reportParticipant(peopleById, link.fellowId, 'fellow');
        return [
          ...scenario,
          link.tutorId,
          tutor.name,
          tutor.city ?? '',
          link.fellowId,
          fellow.name,
          fellow.city ?? '',
          link.straightLineKm,
          GEODESIC_DISTANCE_NOTE,
        ];
      }),
    ],
    semTutor: [
      [...scenarioHeaders, 'ID bolsista', 'Bolsista', 'Cidade', 'Razão'],
      ...result.unassignedFellows.map((unassigned) => {
        const fellow = reportParticipant(peopleById, unassigned.fellowId, 'fellow');
        return [
          ...scenario,
          unassigned.fellowId,
          fellow.name,
          fellow.city ?? '',
          unassigned.reason,
        ];
      }),
    ],
    distribuicao: [[...DISTRIBUTION_HEADERS], ...distributionRows(result)],
  };
}

@Injectable({ providedIn: 'root' })
export class ReportExportService {
  exportAllocationDistributionCsv(results: readonly AllocationResult[]): void {
    const data = allocationDistributionCsvData(results);
    const csv = data
      .map((row) =>
        row.map((value) => escapeCsvCell(String(value), typeof value === 'string')).join(','),
      )
      .join('\r\n');
    downloadBlob(
      new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
      'distribuicao-alocacao.csv',
    );
  }

  async exportAllocationDistributionExcel(results: readonly AllocationResult[]): Promise<void> {
    const data = allocationDistributionExcelData(results);
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    const sheets: [string, ReportValue[][]][] = [
      ['Resumo', data.resumo],
      ['Distribuição', data.distribuicao],
    ];
    if (data.comparacao.length) sheets.push(['Comparação', data.comparacao]);
    for (const [name, rows] of sheets) {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet(
          rows.map((row) =>
            row.map((value) => (typeof value === 'string' ? safeSpreadsheetText(value) : value)),
          ),
        ),
        name,
      );
    }
    await XLSX.writeFile(workbook, 'distribuicao-alocacao.xlsx');
  }

  async exportImportedRelationships(
    rows: readonly ImportedRelationshipExportRow[],
    format: 'csv' | 'xlsx',
  ): Promise<void> {
    const data = importedRelationshipData(rows);
    if (format === 'csv') {
      const csv = data
        .map((row) =>
          row.map((value) => escapeCsvCell(String(value), typeof value === 'string')).join(','),
        )
        .join('\r\n');
      downloadBlob(
        new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
        'vinculos-importados.csv',
      );
      return;
    }
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'Vínculos importados');
    XLSX.writeFile(workbook, 'vinculos-importados.xlsx');
  }

  exportCsv(rows: readonly ExportRow[]): void {
    const data = [
      HEADERS,
      ...rows.map(({ tutor, fellow, pair }) => [
        tutor.name,
        tutor.city ?? '',
        fellow.name,
        fellow.city ?? '',
        pair.straightLineKm.toFixed(1),
        pair.route?.status ?? 'não calculada',
        roadBandLabel(pair),
        pair.route?.distanceMeters === null || pair.route === null
          ? ''
          : (pair.route.distanceMeters / 1_000).toFixed(1),
        pair.route?.durationSeconds === null || pair.route === null
          ? ''
          : (pair.route.durationSeconds / 60).toFixed(0),
        pair.route?.provider ?? '',
        pair.route?.calculatedAt ?? '',
      ]),
    ];

    const csv = data
      .map((row) =>
        row.map((value) => escapeCsvCell(String(value), typeof value === 'string')).join(','),
      )
      .join('\r\n');

    downloadBlob(
      new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
      'relacoes-proximidade.csv',
    );
  }

  exportAllocationCsv(result: AllocationResult, participants: readonly Participant[]): void {
    validateAllocationResult(result);
    const data = allocationCsvData(result, participants);
    const csv = data
      .map((row) =>
        row.map((value) => escapeCsvCell(String(value), typeof value === 'string')).join(','),
      )
      .join('\r\n');

    downloadBlob(
      new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
      'relatorio-alocacao.csv',
    );
  }

  async exportAllocationExcel(
    result: AllocationResult,
    participants: readonly Participant[],
  ): Promise<void> {
    validateAllocationResult(result);
    const data = allocationExcelData(result, participants);
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    const sheets: [string, ReportValue[][]][] = [
      ['Resumo', data.resumo],
      ['Tutores', data.tutores],
      ['Vínculos', data.vinculos],
      ['Sem tutor', data.semTutor],
      ['Distribuição', data.distribuicao],
    ];

    for (const [name, rows] of sheets) {
      const worksheet = XLSX.utils.aoa_to_sheet(
        rows.map((row) =>
          row.map((value) => (typeof value === 'string' ? safeSpreadsheetText(value) : value)),
        ),
      );
      worksheet['!cols'] = rows[0]?.map((value) => ({
        wch: Math.min(Math.max(String(value).length + 2, 14), 48),
      }));
      XLSX.utils.book_append_sheet(workbook, worksheet, name);
    }

    await XLSX.writeFile(workbook, 'relatorio-alocacao.xlsx');
  }

  async exportExcel(rows: readonly ExportRow[]): Promise<void> {
    const XLSX = await import('xlsx');
    const data = [
      HEADERS,
      ...rows.map(({ tutor, fellow, pair }) => [
        tutor.name,
        tutor.city ?? '',
        fellow.name,
        fellow.city ?? '',
        Number(pair.straightLineKm.toFixed(1)),
        pair.route?.status ?? 'não calculada',
        roadBandLabel(pair),
        pair.route?.distanceMeters === null || pair.route === null
          ? ''
          : Number((pair.route.distanceMeters / 1_000).toFixed(1)),
        pair.route?.durationSeconds === null || pair.route === null
          ? ''
          : Number((pair.route.durationSeconds / 60).toFixed(0)),
        pair.route?.provider ?? '',
        pair.route?.calculatedAt ?? '',
      ]),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = HEADERS.map((header) => ({
      wch: Math.max(header.length + 2, 18),
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Proximidade');
    XLSX.writeFile(workbook, 'relacoes-proximidade.xlsx');
  }
}

export function escapeCsvCell(value: string, untrustedText: boolean): string {
  const safeValue = untrustedText && /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

export function safeSpreadsheetText(value: string): string {
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function roadBandLabel(pair: ProximityPair): string {
  switch (classifyRoadDistance(pair.route)) {
    case 'within-50-km':
      return 'Até 50 km';
    case '50-to-100-km':
      return '50 a 100 km';
    case 'over-100-km':
      return 'Mais de 100 km';
    case 'not-calculated':
      return 'Não calculada';
    case 'unavailable':
      return 'Indisponível';
    case 'error':
      return 'Erro';
  }
}

function scenarioValues(result: AllocationResult): [number, number, number, number] {
  return [
    result.config.minimoPorTutor,
    result.config.raioMaxKm,
    result.config.maximoPorTutor,
    result.config.percentualDispensa * 100,
  ];
}

function allocationTutorRows(
  result: AllocationResult,
  participantsById: ReadonlyMap<string, Participant>,
): { participant: Participant; allocation: TutorAllocation }[] {
  return result.tutors.map((allocation) => ({
    participant: reportParticipant(participantsById, allocation.tutorId, 'tutor'),
    allocation,
  }));
}

function reportParticipant(
  participants: ReadonlyMap<string, Participant>,
  id: string,
  type: Participant['type'],
): Participant {
  const participant = participants.get(id);
  if (!participant || participant.type !== type) {
    throw new Error('Relatório de alocação: participante ausente ou com tipo incompatível.');
  }
  return participant;
}

function allocationParticipants(
  result: AllocationResult,
  participants: readonly Participant[],
): ReadonlyMap<string, Participant> {
  const people = new Map(participants.map((participant) => [participant.id, participant]));
  const expectedCount =
    result.tutors.length + result.links.length + result.unassignedFellows.length;
  if (people.size !== participants.length || people.size !== expectedCount) {
    throw new Error('Relatório de alocação: cadastro divergente do cenário ou IDs duplicados.');
  }
  for (const tutor of result.tutors) reportParticipant(people, tutor.tutorId, 'tutor');
  for (const link of result.links) reportParticipant(people, link.fellowId, 'fellow');
  for (const fellow of result.unassignedFellows)
    reportParticipant(people, fellow.fellowId, 'fellow');
  return people;
}

function allocationIndicatorRows(result: AllocationResult): [string, number | null, string?][] {
  const indicators = result.indicators;
  const rows: [string, number | null, string?][] = [
    ['Bolsistas alocados', indicators.allocatedFellows, 'bolsistas'],
    ['Bolsistas sem tutor', indicators.unassignedFellows, 'bolsistas'],
    ['Tutores ativos', indicators.activeTutors, 'tutores'],
    ['Tutores dispensados', indicators.dismissedTutors, 'tutores'],
    ['Tutores abaixo do mínimo', indicators.belowMinimumTutors, 'tutores'],
    ['Média de distância geodésica em linha reta', indicators.averageStraightLineKm, 'km'],
    ['Máxima distância geodésica em linha reta', indicators.maximumStraightLineKm, 'km'],
    ['Vínculos exportados', result.links.length, 'vínculos'],
  ];

  for (const load of [1, 2, 3, 4] as const) {
    rows.push([`Tutores com ${load} bolsista(s)`, indicators.tutorsByLoad[load], 'tutores']);
  }
  return rows;
}
