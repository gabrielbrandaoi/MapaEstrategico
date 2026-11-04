import { escapeCsvCell, importedRelationshipData } from './report-export.service';
import * as XLSX from 'xlsx';

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
});
