import type { AllocationResult } from '../domain/allocation.models';
import { buildAllocationDistribution } from '../domain/allocation-distribution';
import type { Participant } from '../domain/models';
import {
  allocationCsvData,
  allocationDistributionCsvData,
  allocationDistributionExcelData,
  allocationExcelData,
  escapeCsvCell,
  importedRelationshipData,
  ReportExportService,
  safeSpreadsheetText,
} from './report-export.service';
import * as XLSX from 'xlsx';
import { vi } from 'vitest';

function allocationFixture(): { result: AllocationResult; participants: Participant[] } {
  const tutor = (id: string, name: string): Participant => ({
    id,
    name,
    type: 'tutor',
    city: 'Cidade fictícia',
    state: 'XX',
    address: 'ENDEREÇO FICTÍCIO NÃO EXPORTAR',
    postalCode: '00000-000',
    location: null,
    sourceRow: 2,
  });
  const fellow = (id: string, name: string): Participant => ({
    ...tutor(id, name),
    type: 'fellow',
  });

  const participants: Participant[] = [
    tutor('t1', '=Tutor sintético'),
    tutor('t2', 'Tutora sem vínculos'),
    tutor('t3', 'Tutor abaixo do mínimo'),
    fellow('f1', 'Bolsista alocado'),
    fellow('f3', 'Segunda bolsista alocada'),
    fellow('f2', 'Bolsista sem tutor'),
  ];
  const result: Omit<AllocationResult, 'distribution'> = {
    config: {
      minimoPorTutor: 2,
      raioMaxKm: 150,
      maximoPorTutor: 4,
      percentualDispensa: 0.15,
    },
    links: [
      { tutorId: 't1', fellowId: 'f1', straightLineKm: 12.5 },
      { tutorId: 't1', fellowId: 'f3', straightLineKm: 20 },
    ],
    unassignedFellows: [{ fellowId: 'f2', reason: 'Sem tutor elegível' }],
    tutors: [
      {
        tutorId: 't1',
        status: 'active',
        reason: 'Alocação dentro dos limites',
        fellowCount: 2,
        nearestFellowKm: 12.5,
      },
      {
        tutorId: 't2',
        status: 'dismissed',
        reason: 'Dispensado pelo cenário',
        fellowCount: 0,
        nearestFellowKm: null,
      },
      {
        tutorId: 't3',
        status: 'below-minimum',
        reason: 'Abaixo do mínimo configurado',
        fellowCount: 0,
        nearestFellowKm: null,
      },
    ],
    dismissedTutorIds: ['t2'],
    belowMinimumTutorIds: ['t3'],
    indicators: {
      allocatedFellows: 2,
      unassignedFellows: 1,
      activeTutors: 1,
      dismissedTutors: 1,
      belowMinimumTutors: 1,
      averageStraightLineKm: 16.25,
      maximumStraightLineKm: 20,
      tutorsByLoad: { 1: 0, 2: 1, 3: 0, 4: 0 },
    },
  };
  return {
    participants,
    result: { ...result, distribution: buildAllocationDistribution(result.tutors) },
  };
}

function comparisonFixture(): readonly [AllocationResult, AllocationResult] {
  const { result: minimum2 } = allocationFixture();
  const tutors = minimum2.tutors.map((tutor) =>
    tutor.tutorId === 't2'
      ? tutor
      : {
          ...tutor,
          status: 'active' as const,
          fellowCount: 1,
          nearestFellowKm: tutor.tutorId === 't1' ? 12.5 : 20,
        },
  );
  const minimum1: AllocationResult = {
    ...minimum2,
    config: { ...minimum2.config, minimoPorTutor: 1 },
    tutors,
    links: minimum2.links.map((link) =>
      link.fellowId === 'f3' ? { ...link, tutorId: 't3' } : link,
    ),
    belowMinimumTutorIds: [],
    indicators: {
      ...minimum2.indicators,
      activeTutors: 2,
      belowMinimumTutors: 0,
      tutorsByLoad: { 1: 2, 2: 0, 3: 0, 4: 0 },
    },
    distribution: buildAllocationDistribution(tutors),
  };
  return [minimum1, minimum2];
}

afterEach(() => {
  vi.doUnmock('xlsx');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('CSV formula-injection protection', () => {
  it('exports reported KM separately from confirmed routing, including its source', () => {
    const person = {
      id: 'test',
      name: 'Pessoa sintética',
      type: 'tutor' as const,
      city: null,
      state: null,
      address: null,
      postalCode: null,
      location: null,
      sourceRow: 2,
    };
    const data = importedRelationshipData([
      {
        tutor: person,
        fellow: { ...person, type: 'fellow' },
        relationship: {
          tutorId: 'test',
          fellowId: 'fellow',
          reportedKm: 52.5,
          sourceRow: 2,
          sheetName: 'Nominal',
          fileName: 'sintetico.xlsx',
        },
      },
    ]);
    expect(data[1]?.[4]).toBe(52.5);
    expect(data[1]?.[5]).toContain('não verificada');
    expect(data[1]?.slice(6, 9)).toEqual(['sintetico.xlsx', 'Nominal', 2]);
    expect(data[0]?.join(' ')).not.toContain('CPF');
  });

  it.each(['=1+1', '+SUM(A1:A2)', '-10+cmd', '@SUM(A1)', '\t=2+2'])(
    'escapes dangerous text beginning with %s',
    (value) => {
      expect(escapeCsvCell(value, true)).toBe(`"'${value.replace(/"/g, '""')}"`);
    },
  );

  it('quotes delimiters and quotes without changing safe text', () => {
    expect(escapeCsvCell('Cidade, "teste"', true)).toBe('"Cidade, ""teste"""');
  });

  it('does not rewrite non-text values such as negative coordinates', () => {
    expect(escapeCsvCell('-23.5', false)).toBe('"-23.5"');
  });

  it('keeps formula-like Excel export values as string cells', () => {
    const cell = XLSX.utils.aoa_to_sheet([['=1+1']])['A1'];

    expect(cell?.t).toBe('s');
    expect(cell?.f).toBeUndefined();
  });

  it('protects formula-like text before writing it to an Excel cell', () => {
    const safeText = safeSpreadsheetText(' \t=1+1');
    const cell = XLSX.utils.aoa_to_sheet([[safeText]])['A1'];

    expect(safeText).toBe("' \t=1+1");
    expect(cell?.t).toBe('s');
    expect(cell?.f).toBeUndefined();
  });
});

describe('allocation report exports', () => {
  it('includes scenario metadata, every tutor including zero-link tutors, and indicators in CSV data', () => {
    const { result, participants } = allocationFixture();
    const data = allocationCsvData(result, participants);
    const header = data[0] ?? [];
    const minimumIndex = header.indexOf('minimo_por_tutor');
    const radiusIndex = header.indexOf('raio_maximo_km');
    const capacityIndex = header.indexOf('capacidade_maxima');
    const exemptionIndex = header.indexOf('percentual_dispensa');
    const typeIndex = header.indexOf('tipo_registro');

    expect(data.map((row) => row.length)).toEqual(Array(data.length).fill(header.length));
    expect(
      data
        .slice(1)
        .every(
          (row) =>
            row[minimumIndex] === 2 &&
            row[radiusIndex] === 150 &&
            row[capacityIndex] === 4 &&
            row[exemptionIndex] === 15,
        ),
    ).toBe(true);

    const tutorRows = data.filter((row) => row[typeIndex] === 'tutor');
    expect(tutorRows).toHaveLength(3);
    expect(tutorRows.map((row) => row[header.indexOf('status_tutor')])).toEqual([
      'active',
      'dismissed',
      'below-minimum',
    ]);
    expect(tutorRows[1]?.[header.indexOf('fellow_count')]).toBe(0);
    expect(tutorRows.map((row) => row[header.indexOf('razao_tutor')])).toContain(
      'Dispensado pelo cenário',
    );
    expect(data.some((row) => row[typeIndex] === 'sem_tutor')).toBe(true);
    expect(data.some((row) => row[typeIndex] === 'indicador')).toBe(true);
    expect(data.flat().join('|')).not.toContain('ENDEREÇO FICTÍCIO');
  });

  it('keeps geodesic link distances distinct from spreadsheet and road distances', () => {
    const { result, participants } = allocationFixture();
    const csvRows = allocationCsvData(result, participants);
    const csvHeader = csvRows[0] ?? [];
    const linkRow = csvRows.find((row) => row[csvHeader.indexOf('tipo_registro')] === 'vinculo');

    expect(linkRow?.[csvHeader.indexOf('distancia_geodesica_km')]).toBe(12.5);
    expect(linkRow?.[csvHeader.indexOf('metrica_distancia')]).toContain('Geodésica em linha reta');
    expect(csvHeader.join('|')).not.toContain('distancia_rodoviaria');
    expect(csvHeader.join('|')).not.toContain('km_planilha');
  });

  it('builds the allocation sheets including distribution, retaining tutor, reason, and scenario values', () => {
    const { result, participants } = allocationFixture();
    const sheets = allocationExcelData(result, participants);

    expect(Object.keys(sheets)).toEqual([
      'resumo',
      'tutores',
      'vinculos',
      'semTutor',
      'distribuicao',
    ]);
    expect(sheets.tutores).toHaveLength(4);
    expect(sheets.tutores[2]).toContain('Dispensado pelo cenário');
    expect(sheets.tutores[2]).toContain(0);
    expect(sheets.tutores[1]).toContain(150);
    expect(sheets.vinculos[1]).toContain(12.5);
    expect(sheets.vinculos[1]?.join('|')).toContain(
      'não é KM informado na planilha nem distância rodoviária',
    );
    expect(sheets.semTutor[1]).toContain('Sem tutor elegível');
    const workbookSheets: (string | number)[][][] = Object.values(sheets);
    expect(
      workbookSheets.every((rows) => rows.every((row) => row.length === (rows[0]?.length ?? 0))),
    ).toBe(true);
    expect(workbookSheets.flat(2).join('|')).not.toContain('ENDEREÇO FICTÍCIO');
  });

  it('rejects inconsistent allocations in pure builders and before export side effects', async () => {
    const { result, participants } = allocationFixture();
    const inconsistent: AllocationResult = {
      ...result,
      tutors: result.tutors.map((tutor) =>
        tutor.tutorId === 't1' ? { ...tutor, fellowCount: 1 } : tutor,
      ),
    };
    const exporter = new ReportExportService();

    expect(() => allocationCsvData(inconsistent, participants)).toThrow(/carga diverge/i);
    expect(() => allocationExcelData(inconsistent, participants)).toThrow(/carga diverge/i);
    expect(() => exporter.exportAllocationCsv(inconsistent, participants)).toThrow(
      /carga diverge/i,
    );
    await expect(exporter.exportAllocationExcel(inconsistent, participants)).rejects.toThrow(
      /carga diverge/i,
    );
  });

  it.each(['missing', 'extra', 'duplicate', 'wrong-type'] as const)(
    'rejects a participant registry inconsistent with the scenario: %s',
    (kind) => {
      const { result, participants } = allocationFixture();
      const modified =
        kind === 'missing'
          ? participants.slice(1)
          : kind === 'extra'
            ? [...participants, { ...participants[0], id: 'extra' }]
            : kind === 'duplicate'
              ? [...participants, participants[0]]
              : participants.map((person) =>
                  person.id === 't1' ? { ...person, type: 'fellow' as const } : person,
                );
      expect(() => allocationCsvData(result, modified)).toThrow(/relatório de alocação/i);
      expect(() => allocationExcelData(result, modified)).toThrow(/relatório de alocação/i);
    },
  );

  it('rejects mismatched participants before legacy asynchronous Excel side effects', async () => {
    const { result, participants } = allocationFixture();
    const writeFile = vi.fn();
    vi.doMock('xlsx', async () => ({
      ...(await vi.importActual<typeof import('xlsx')>('xlsx')),
      writeFile,
    }));
    await expect(
      new ReportExportService().exportAllocationExcel(result, participants.slice(1)),
    ).rejects.toThrow(/relatório de alocação/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('propagates an Excel writer failure instead of reporting premature success', async () => {
    const { result, participants } = allocationFixture();
    vi.doMock('xlsx', async () => {
      const actual = await vi.importActual<typeof import('xlsx')>('xlsx');
      return {
        ...actual,
        writeFile: () => {
          throw new Error('Falha sintética de gravação');
        },
      };
    });

    try {
      await expect(
        new ReportExportService().exportAllocationExcel(result, participants),
      ).rejects.toThrow('Falha sintética de gravação');
    } finally {
      vi.doUnmock('xlsx');
    }
  });
});

describe('anonymous allocation distribution exports', () => {
  it('exports loads 1 to 4, every tutor status and tutors without coordinates', () => {
    const { result } = allocationFixture();
    const tutors = [1, 2, 3, 4].map((load) => ({
      tutorId: `load-${load}`,
      status: 'active' as const,
      reason: 'Carga sintética',
      fellowCount: load,
      nearestFellowKm: 1,
    }));
    const allTutors = [...tutors, ...result.tutors.filter((tutor) => tutor.status !== 'active')];
    const links = tutors.flatMap((tutor) =>
      Array.from({ length: tutor.fellowCount }, (_, index) => ({
        tutorId: tutor.tutorId,
        fellowId: `${tutor.tutorId}-fellow-${index}`,
        straightLineKm: 1,
      })),
    );
    const scenario: AllocationResult = {
      ...result,
      config: { ...result.config, minimoPorTutor: 1 },
      tutors: allTutors,
      links,
      indicators: {
        ...result.indicators,
        allocatedFellows: 10,
        activeTutors: 4,
        averageStraightLineKm: 1,
        maximumStraightLineKm: 1,
        tutorsByLoad: { 1: 1, 2: 1, 3: 1, 4: 1 },
      },
      distribution: buildAllocationDistribution(allTutors),
    };
    const rows = allocationDistributionExcelData([scenario]).distribuicao.slice(1);
    expect(rows.map((row) => row[7])).toEqual([2, 1, 1, 1, 1, 1, 1, 6]);
    expect(rows[1]?.[8]).toBeCloseTo(100 / 6);
    expect(rows.every((row) => row[4] === 6 && row[0] === 1)).toBe(true);
    expect(
      allocationDistributionCsvData([scenario]).every(
        (row, _, data) => row.length === data[0]!.length,
      ),
    ).toBe(true);
  });

  it('downloads anonymous CSV and neutralizes formula-like participant text in legacy CSV', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:synthetic-report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blobs = vi.spyOn(globalThis, 'Blob');
    const { result, participants } = allocationFixture();
    const exporter = new ReportExportService();
    exporter.exportAllocationDistributionCsv([result]);
    exporter.exportAllocationCsv(
      result,
      participants.map((participant) => ({
        ...participant,
        cpf: 'CPF SINTÉTICO NÃO EXPORTAR',
      })),
    );
    const anonymousCsv = String(blobs.mock.calls[0]?.[0]?.[0]);
    const legacyCsv = String(blobs.mock.calls[1]?.[0]?.[0]);
    expect(anonymousCsv).toContain('"Total de tutores (denominador)"');
    expect(anonymousCsv).toContain('"distribuicao"');
    expect(legacyCsv).toContain(`"'=Tutor sintético"`);
    for (const csv of [anonymousCsv, legacyCsv]) {
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).not.toContain('ENDEREÇO FICTÍCIO');
      expect(csv).not.toContain('CPF');
    }
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(2);
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('protects formula-like text in legacy Excel while retaining numeric counts and distribution', async () => {
    const writeFile = vi.fn((_workbook: XLSX.WorkBook, _filename: string) => {});
    vi.doMock('xlsx', async () => ({
      ...(await vi.importActual<typeof import('xlsx')>('xlsx')),
      writeFile,
    }));
    const { result, participants } = allocationFixture();
    const unsafe: AllocationResult = {
      ...result,
      tutors: result.tutors.map((tutor) => ({
        ...tutor,
        reason: ' \t=HYPERLINK("https://invalid.example")',
      })),
    };
    await new ReportExportService().exportAllocationExcel(unsafe, participants);
    const workbook = writeFile.mock.calls[0]![0];
    expect(workbook.SheetNames).toEqual([
      'Resumo',
      'Tutores',
      'Vínculos',
      'Sem tutor',
      'Distribuição',
    ]);
    const tutorSheet = workbook.Sheets['Tutores']!;
    expect(tutorSheet['F2']?.v).toBe("'=Tutor sintético");
    expect(tutorSheet['I2']?.v).toBe(`' \t=HYPERLINK("https://invalid.example")`);
    expect(tutorSheet['I2']?.f).toBeUndefined();
    expect(tutorSheet['J2']?.t).toBe('n');
    expect(JSON.stringify(workbook)).not.toContain('ENDEREÇO FICTÍCIO');
    expect(JSON.stringify(workbook)).not.toContain('CPF');
  });

  it('writes a single-scenario workbook without an empty comparison sheet', async () => {
    const writeFile = vi.fn((_workbook: XLSX.WorkBook, _filename: string) => {});
    vi.doMock('xlsx', async () => ({
      ...(await vi.importActual<typeof import('xlsx')>('xlsx')),
      writeFile,
    }));
    await new ReportExportService().exportAllocationDistributionExcel([allocationFixture().result]);
    expect(writeFile.mock.calls[0]?.[0].SheetNames).toEqual(['Resumo', 'Distribuição']);
  });

  it('exports all categories in order, all-tutor percentages and an explicit zero subtotal', () => {
    const { result, participants } = allocationFixture();
    const data = allocationDistributionExcelData([result]);
    const rows = data.distribuicao.slice(1);
    expect(rows.map((row) => row[5])).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      'dismissed',
      'below-minimum',
      'total',
    ]);
    expect(rows.map((row) => row[7])).toEqual([2, 0, 1, 0, 0, 1, 1, 3]);
    expect(rows.map((row) => row[9])).toEqual([
      'Sim',
      'Não',
      'Não',
      'Não',
      'Não',
      'Não',
      'Não',
      'Não',
    ]);
    expect(rows.every((row) => row[4] === 3)).toBe(true);
    expect(rows[0]?.[8]).toBeCloseTo(200 / 3);
    expect(rows[2]?.[8]).toBeCloseTo(100 / 3);
    expect(rows[7]?.[8]).toBe(100);
    expect(rows[0]?.[10]).toContain('não somar duas vezes');
    expect(rows.slice(1, 7).reduce((total, row) => total + Number(row[7]), 0)).toBe(3);
    expect(data.comparacao).toEqual([]);
    expect(data.resumo.flat()).toContain('Tutores dispensados');
    expect(data.resumo.flat()).toContain('Tutores abaixo do mínimo');
    expect(data.resumo.flat()).toContain('Tutores ativos');

    const legacy = allocationCsvData(result, participants);
    const header = legacy[0]!;
    const distribution = legacy.filter((row) => row[0] === 'distribuicao');
    expect(distribution).toHaveLength(8);
    expect(distribution.map((row) => row[header.indexOf('valor')])).toEqual(
      rows.map((row) => row[7]),
    );
    expect(allocationExcelData(result, participants).distribuicao).toEqual(data.distribuicao);
    expect(allocationExcelData(result, participants).resumo.flat()).toContain('Total de tutores');
  });

  it('compares in minimum order even for reversed input and exports signed counts and percentage points', () => {
    const [minimum1, minimum2] = comparisonFixture();
    const data = allocationDistributionExcelData([minimum2, minimum1]);
    expect(data.distribuicao[1]?.slice(0, 5)).toEqual([1, 150, 4, 15, 3]);
    expect(data.distribuicao[9]?.slice(0, 5)).toEqual([2, 150, 4, 15, 3]);
    const one = data.comparacao.find((row) => row[4] === '1');
    const two = data.comparacao.find((row) => row[4] === '2');
    expect(one?.slice(7, 10)).toEqual([2, 0, -2]);
    expect(one?.[12]).toBeCloseTo(-200 / 3);
    expect(two?.slice(7, 10)).toEqual([0, 1, 1]);
    expect(two?.[12]).toBeCloseTo(100 / 3);
    expect(two?.[13]).toContain('pontos percentuais');
    expect(data.comparacao.find((row) => row[4] === 'total')?.slice(7, 13)).toEqual([
      3, 3, 0, 100, 100, 0,
    ]);

    const csv = allocationDistributionCsvData([minimum1, minimum2]);
    expect(csv).toHaveLength(25);
    expect(csv.every((row) => row.length === csv[0]!.length)).toBe(true);
    const comparison = csv.find((row) => row[0] === 'comparacao' && row[6] === '1');
    expect(comparison?.slice(12, 15)).toEqual([2, 0, -2]);
    expect(comparison?.[17]).toBeCloseTo(-200 / 3);
    const sheets: (string | number)[][][] = Object.values(data);
    for (const sheet of sheets) {
      expect(sheet.every((row) => row.length === sheet[0]?.length)).toBe(true);
    }
  });

  it('keeps anonymous tables free of IDs, names, CPF, addresses and status reasons', () => {
    const { result } = allocationFixture();
    const privateResult: AllocationResult = {
      ...result,
      tutors: result.tutors.map((tutor) => ({
        ...tutor,
        reason: 'CPF SINTÉTICO ENDEREÇO FICTÍCIO =HYPERLINK("x")',
      })),
    };
    const exported = [
      ...allocationDistributionCsvData([privateResult]).flat(),
      ...Object.values(allocationDistributionExcelData([privateResult])).flat(2),
    ].join('|');
    for (const forbidden of ['CPF', 'ENDEREÇO', 'HYPERLINK', 't1', 'f1', '=Tutor sintético']) {
      expect(exported).not.toContain(forbidden);
    }
  });

  it.each([
    [],
    [allocationFixture().result, allocationFixture().result, allocationFixture().result],
  ])(
    'rejects invalid scenario cardinality without triggering a download: %j',
    async (...results: AllocationResult[]) => {
      const exporter = new ReportExportService();
      const createElement = vi.spyOn(document, 'createElement');
      expect(() => allocationDistributionCsvData(results)).toThrow();
      expect(() => allocationDistributionExcelData(results)).toThrow();
      expect(() => exporter.exportAllocationDistributionCsv(results)).toThrow();
      await expect(exporter.exportAllocationDistributionExcel(results)).rejects.toThrow();
      expect(createElement).not.toHaveBeenCalled();
    },
  );

  it.each(['count', 'percentage', 'subtotal', 'order', 'total', 'missing'] as const)(
    'rejects inconsistent distribution data in new and legacy exports: %s',
    async (kind) => {
      const { result, participants } = allocationFixture();
      const rows = result.distribution.rows.map((row, index) =>
        index !== 0
          ? row
          : {
              ...row,
              count: kind === 'count' ? 0 : row.count,
              percentage: kind === 'percentage' ? 100 : row.percentage,
              subtotal: kind === 'subtotal' ? false : row.subtotal,
            },
      );
      if (kind === 'order') rows.reverse();
      const invalid: AllocationResult = {
        ...result,
        distribution: {
          totalTutors: kind === 'total' ? 1 : 3,
          rows,
        },
      };
      if (kind === 'missing') Reflect.deleteProperty(invalid, 'distribution');
      const exporter = new ReportExportService();
      expect(() => allocationDistributionCsvData([invalid])).toThrow();
      expect(() => allocationDistributionExcelData([invalid])).toThrow();
      expect(() => allocationCsvData(invalid, participants)).toThrow();
      expect(() => allocationExcelData(invalid, participants)).toThrow();
      expect(() => exporter.exportAllocationDistributionCsv([invalid])).toThrow();
      await expect(exporter.exportAllocationDistributionExcel([invalid])).rejects.toThrow();
      expect(() => exporter.exportAllocationCsv(invalid, participants)).toThrow();
      await expect(exporter.exportAllocationExcel(invalid, participants)).rejects.toThrow();
    },
  );

  it.each(['minimum', 'radius', 'capacity', 'dismissal', 'population'] as const)(
    'rejects incompatible comparison configurations or tutor populations: %s',
    async (kind) => {
      const [minimum1, minimum2] = comparisonFixture();
      const changed: AllocationResult = {
        ...minimum2,
        config: {
          ...minimum2.config,
          minimoPorTutor: kind === 'minimum' ? 1 : 2,
          raioMaxKm: kind === 'radius' ? 151 : 150,
          maximoPorTutor: kind === 'capacity' ? 3 : 4,
          percentualDispensa: kind === 'dismissal' ? 0.1 : 0.15,
        },
        tutors: minimum2.tutors.map((tutor) =>
          kind === 'population' && tutor.tutorId === 't3' ? { ...tutor, tutorId: 'other' } : tutor,
        ),
        belowMinimumTutorIds: kind === 'population' ? ['other'] : minimum2.belowMinimumTutorIds,
      };
      const results = [minimum1, changed];
      expect(() => allocationDistributionCsvData(results)).toThrow();
      expect(() => allocationDistributionExcelData(results)).toThrow();
      expect(() => new ReportExportService().exportAllocationDistributionCsv(results)).toThrow();
      await expect(
        new ReportExportService().exportAllocationDistributionExcel(results),
      ).rejects.toThrow();
    },
  );

  it('exports empty tutor populations as zero, never NaN or Infinity', () => {
    const { result } = allocationFixture();
    const empty: AllocationResult = {
      ...result,
      links: [],
      tutors: [],
      unassignedFellows: [],
      dismissedTutorIds: [],
      belowMinimumTutorIds: [],
      indicators: {
        allocatedFellows: 0,
        unassignedFellows: 0,
        activeTutors: 0,
        dismissedTutors: 0,
        belowMinimumTutors: 0,
        averageStraightLineKm: null,
        maximumStraightLineKm: null,
        tutorsByLoad: { 1: 0, 2: 0, 3: 0, 4: 0 },
      },
      distribution: buildAllocationDistribution([]),
    };
    const rows = allocationDistributionExcelData([empty]).distribuicao.slice(1);
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row[4] === 0 && row[7] === 0 && row[8] === 0)).toBe(true);
  });

  it('awaits the Excel writer and includes scenario, distribution and comparison sheets', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const writeFile = vi.fn((_workbook: XLSX.WorkBook, _filename: string) => pending);
    vi.doMock('xlsx', async () => ({
      ...(await vi.importActual<typeof import('xlsx')>('xlsx')),
      writeFile,
    }));
    let completed = false;
    const promise = new ReportExportService()
      .exportAllocationDistributionExcel(comparisonFixture())
      .then(() => {
        completed = true;
      });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    // The exported workbook remains anonymous and uses numeric cells for percentages/deltas.
    const workbook = writeFile.mock.calls[0]![0];
    expect(workbook.SheetNames).toEqual(['Resumo', 'Distribuição', 'Comparação']);
    expect(workbook.Sheets['Comparação']?.['M3']?.t).toBe('n');
    expect(workbook.Sheets['Comparação']?.['M3']?.v).toBeCloseTo(-200 / 3);
    expect(JSON.stringify(workbook)).not.toContain('ENDEREÇO FICTÍCIO');
    expect(JSON.stringify(workbook)).not.toContain('CPF');
    finish();
    await promise;
    expect(completed).toBe(true);
  });

  it('propagates rejected Excel writes for both distribution and legacy reports', async () => {
    vi.doMock('xlsx', async () => ({
      ...(await vi.importActual<typeof import('xlsx')>('xlsx')),
      writeFile: () => Promise.reject(new Error('Falha assíncrona sintética')),
    }));
    const { result, participants } = allocationFixture();
    const exporter = new ReportExportService();
    await expect(exporter.exportAllocationDistributionExcel([result])).rejects.toThrow(
      'Falha assíncrona sintética',
    );
    await expect(exporter.exportAllocationExcel(result, participants)).rejects.toThrow(
      'Falha assíncrona sintética',
    );
  });
});
