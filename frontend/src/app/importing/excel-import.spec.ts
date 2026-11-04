import { findHeaderRow, normalizeImportedRows, suggestColumnMapping } from './excel-import';

describe('Excel column mapping and validation', () => {
  it('suggests columns regardless of accents and capitalization', () => {
    const headers = ['TIPO', 'Nome completo', 'Município', 'Lat.', 'Longitude'];

    expect(suggestColumnMapping(headers)).toEqual({
      type: 0,
      name: 1,
      city: 2,
      state: null,
      address: null,
      postalCode: null,
      latitude: 3,
      longitude: 4,
    });
  });

  it('adapts to common alternate headers without relying on fixed column names', () => {
    const headers = [
      'Categoria profissional',
      'Nome do médico tutor',
      'Município de atuação',
      'Sigla do estado',
      'Endereço completo',
      'Código postal',
      'Latitude decimal',
      'Longitude decimal',
    ];

    expect(suggestColumnMapping(headers)).toEqual({
      type: 0,
      name: 1,
      city: 2,
      state: 3,
      address: 4,
      postalCode: 5,
      latitude: 6,
      longitude: 7,
    });
  });

  it('does not map a participant-type header to the name field', () => {
    expect(suggestColumnMapping(['Tipo de participante', 'Nome do tutor'])).toEqual({
      type: 0,
      name: 1,
      city: null,
      state: null,
      address: null,
      postalCode: null,
      latitude: null,
      longitude: null,
    });
  });

  it('uses an explicitly selected file type when the sheet has no role column', () => {
    const rows: unknown[][] = [
      ['REGISTRO', 'NOME', 'MUNICIPIO', 'UF', 'TIPOLOGIA'],
      [123, 'Pessoa sintética', 'Cidade teste', 'SP', 'Urbano'],
    ];
    const mapping = suggestColumnMapping(rows[0] ?? []);

    expect(mapping.type).toBeNull();
    expect(mapping.name).toBe(1);
    expect(mapping.city).toBe(2);
    expect(mapping.state).toBe(3);

    const report = normalizeImportedRows(rows, 0, mapping, 'tutor');

    expect(report.invalidRows).toEqual([]);
    expect(report.participants).toHaveLength(1);
    expect(report.participants[0]).toMatchObject({
      type: 'tutor',
      name: 'Pessoa sintética',
      city: 'Cidade teste',
      state: 'SP',
      location: null,
    });
    expect(report.participantsWithoutCoordinates).toBe(1);
  });

  it('requires an explicit file type when no role column is mapped', () => {
    const report = normalizeImportedRows(
      [
        ['NOME', 'MUNICIPIO'],
        ['Pessoa sintética', 'Cidade teste'],
      ],
      0,
      suggestColumnMapping(['NOME', 'MUNICIPIO']),
    );

    expect(report.participants).toHaveLength(0);
    expect(report.issues[0]?.code).toBe('required_mapping_missing');
  });

  it('finds a header below a title row', () => {
    expect(
      findHeaderRow([
        ['Relatório de participantes'],
        ['Tipo', 'Nome', 'Cidade'],
        ['Tutor', 'Pessoa sintética', 'Cidade teste'],
      ]),
    ).toBe(1);
  });

  it('keeps valid rows without coordinates and reports invalid and duplicate rows', () => {
    const rows: unknown[][] = [
      ['Tipo', 'Nome', 'Cidade', 'Latitude', 'Longitude'],
      ['Tutor', 'Pessoa sintética A', 'Cidade teste', '-23,5', '-46,6'],
      ['Bolsista', 'Pessoa sintética B', 'Cidade teste', '', ''],
      ['Bolsista', 'Pessoa sintética C', 'Cidade teste', '-23,2', ''],
      ['Bolsista', 'Pessoa sintética B', 'Cidade teste', '', ''],
    ];
    const mapping = suggestColumnMapping(rows[0] ?? []);

    const report = normalizeImportedRows(rows, 0, mapping);

    expect(report.totalRows).toBe(4);
    expect(report.participants).toHaveLength(3);
    expect(report.invalidRows).toEqual([4]);
    expect(report.participantsWithoutCoordinates).toBe(2);
    expect(report.issues.some((issue) => issue.code === 'partial_coordinates')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'duplicate_participant')).toBe(true);
  });

  it('rejects invalid coordinate ranges without discarding the row silently', () => {
    const rows: unknown[][] = [
      ['Tipo', 'Nome', 'Latitude', 'Longitude'],
      ['Tutor', 'Pessoa sintética', 91, 10],
    ];
    const mapping = suggestColumnMapping(rows[0] ?? []);

    const report = normalizeImportedRows(rows, 0, mapping);

    expect(report.participants).toHaveLength(0);
    expect(report.invalidRows).toEqual([2]);
    expect(report.issues.map((issue) => issue.code)).toContain('invalid_latitude');
  });
});
