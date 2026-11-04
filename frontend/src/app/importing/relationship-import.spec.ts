import { ParsedSheet } from '../domain/models';
import {
  detectRelationshipColumns,
  findRelationshipHeader,
  importRelationships,
  selectRelationshipSheet,
} from './relationship-import';

const HEADERS = [
  'NOME_bolsista',
  'CPF_bolsista',
  'CPF_TUTOR',
  'NOME_TUTOR',
  'MUNICIPIO_TUTOR',
  'km',
];

describe('relationship workbook import', () => {
  it('detects roles by headers regardless of order, punctuation or accents', () => {
    expect(
      detectRelationshipColumns([
        'CPF do tutor',
        'Nome do tutor',
        'CPF do bolsista',
        'Nome do bolsista',
        'Distância (km)',
      ]),
    ).toMatchObject({
      tutorCpf: 0,
      tutorName: 1,
      fellowCpf: 2,
      fellowName: 3,
      km: 4,
    });
    expect(detectRelationshipColumns(['NOME', 'CPF', 'TIPOLOGIA'])).toBeNull();
    expect(detectRelationshipColumns([...HEADERS, 'CPF do tutor'])).toBeNull();
  });

  it('selects a nominal relationship sheet instead of summaries or alert tabs', () => {
    const nominal = sheet([
      HEADERS,
      ['Pessoa B', '00000000001', '00000000002', 'Pessoa T', 'Cidade teste', 42],
    ]);
    const workbook = {
      fileName: 'sintetico.xlsx',
      sheets: [
        { name: 'Resumo', rows: [['NOME_TUTOR', 'MUNICIPIO_TUTOR', 'NOME_bolsista']] },
        { ...nominal, name: 'Sem KM', rows: nominal.rows.map((row) => row.slice(0, 5)) },
        nominal,
      ],
    };
    expect(selectRelationshipSheet(workbook)).toBe(nominal);
    expect(findRelationshipHeader(sheet([['Título'], HEADERS]))).toBe(1);
  });

  it('groups participants by CPF, preserves every relationship and does not invent routes', () => {
    const report = importRelationships(
      sheet([
        HEADERS,
        ['Pessoa B', '000.000.000-01', '000.000.000-02', 'Pessoa T', 'Cidade teste', '42,5'],
        ['Pessoa B', 1, 2, 'Pessoa T', 'Cidade teste', 0],
        ['Pessoa C', '00000000003', 2, 'Pessoa T', 'Cidade teste', ''],
      ]),
      0,
      'sintetico.xlsx',
    );

    expect(report.participants).toHaveLength(3);
    expect(report.participants.filter((person) => person.type === 'tutor')).toHaveLength(1);
    expect(report.relationships?.map((link) => link.reportedKm)).toEqual([42.5, 0, null]);
    expect(report.relationships?.[0]?.fellowId).toBe(report.relationships?.[1]?.fellowId);
    expect(report.issues.some((issue) => issue.code === 'duplicate_relationship')).toBe(true);
    expect(report.participants.every((person) => person.location === null)).toBe(true);
    expect(JSON.stringify(report)).not.toContain('000.000.000-01');
    expect(JSON.stringify(report)).not.toContain('00000000001');
  });

  it('reports absent identities and invalid distances with original row numbers', () => {
    const report = importRelationships(
      sheet([
        HEADERS,
        ['Pessoa B', '', 2, 'Pessoa T', 'Cidade teste', 30],
        ['Pessoa C', 3, 2, 'Pessoa T', 'Cidade teste', -5],
        ['Pessoa D', 4, 2, 'Pessoa T', 'Cidade teste', 'abc'],
      ]),
      0,
      'sintetico.xlsx',
    );
    expect(report.totalRows).toBe(3);
    expect(report.invalidRows).toEqual([2, 3, 4]);
    expect(report.relationships).toHaveLength(2);
    expect(report.relationships?.every((link) => link.reportedKm === null)).toBe(true);
    expect(report.relationships?.map((link) => link.sourceRow)).toEqual([3, 4]);
  });

  it('keeps masked CPFs as explicit provisional identities, not confirmed CPF matches', () => {
    const report = importRelationships(
      sheet([
        HEADERS,
        ['Pessoa B', 'XXX.000.001-XX', 2, 'Pessoa T', 'Cidade teste', 42],
        ['Pessoa C', 'XXX.000.001-XX', 2, 'Pessoa T', 'Cidade teste', 45],
        ['Pessoa B', '00000000001', 2, 'Pessoa T', 'Cidade teste', 42],
      ]),
      0,
      'sintetico.xlsx',
    );
    expect(report.relationships).toHaveLength(3);
    expect(report.participantsWithProvisionalIdentity).toBe(2);
    expect(report.participants.filter((person) => person.type === 'fellow')).toHaveLength(3);
    expect(report.invalidRows).toEqual([]);
    expect(report.issues.filter((issue) => issue.code === 'masked_identity')).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain('XXX.000.001-XX');
  });
});

function sheet(rows: unknown[][]): ParsedSheet {
  return { name: 'Relação nominal', rows };
}
