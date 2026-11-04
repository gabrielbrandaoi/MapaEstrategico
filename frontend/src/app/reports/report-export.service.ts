import { Injectable } from '@angular/core';
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

@Injectable({ providedIn: 'root' })
export class ReportExportService {
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
