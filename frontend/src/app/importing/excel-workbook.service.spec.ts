import { ExcelWorkbookService } from './excel-workbook.service';
import * as XLSX from 'xlsx';

describe('ExcelWorkbookService', () => {
  const service = new ExcelWorkbookService();

  it('reads a local CSV and reports its worksheet name', async () => {
    const file = new File(
      ['Tipo,Nome,Cidade,Latitude,Longitude\nTutor,Pessoa sintética,Cidade teste,0,0'],
      'synthetic.csv',
      { type: 'text/csv' },
    );

    const workbook = await service.read(file);

    expect(workbook.fileName).toBe('synthetic.csv');
    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0]?.name).toBe('Sheet1');
    expect(workbook.sheets[0]?.rows[1]).toEqual([
      'Tutor',
      'Pessoa sintética',
      'Cidade teste',
      '0',
      '0',
    ]);
  });

  it('reads an XLSX workbook and preserves the selected sheet name', async () => {
    const source = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      source,
      XLSX.utils.aoa_to_sheet([
        ['Tipo', 'Nome'],
        ['Tutor', 'Pessoa sintética'],
      ]),
      'Dados sintéticos',
    );
    const bytes = XLSX.write(source, { bookType: 'xlsx', type: 'array' });
    const file = new File([bytes], 'synthetic.xlsx');

    const workbook = await service.read(file);

    expect(workbook.sheets[0]?.name).toBe('Dados sintéticos');
    expect(workbook.sheets[0]?.rows[1]).toEqual(['Tutor', 'Pessoa sintética']);
  });

  it('preserves empty Excel rows so validation points to original row numbers', async () => {
    const source = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      source,
      XLSX.utils.aoa_to_sheet([['NOME', 'MUNICIPIO'], [], ['Pessoa sintética', 'Cidade teste']]),
      'Dados',
    );
    const workbook = await service.read(
      new File([XLSX.write(source, { bookType: 'xlsx', type: 'array' })], 'synthetic.xlsx'),
    );
    expect(workbook.sheets[0]?.rows[2]).toEqual(['Pessoa sintética', 'Cidade teste']);
  });

  it('reads numeric identifiers without formatting and preserves null cells and row offsets', async () => {
    const source = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['CPF_TUTOR', 'IBGE_TUTOR', 'CNES_TUTOR'],
      [1234567890, 123456, null],
    ]);
    sheet['A2'].z = '0.00E+00';
    XLSX.utils.book_append_sheet(source, sheet, 'Dados');
    const workbook = await service.read(
      new File([XLSX.write(source, { bookType: 'xlsx', type: 'array' })], 'synthetic.xlsx'),
    );
    expect(workbook.sheets[0]?.rows[1]).toEqual([1234567890, 123456, null]);
  });

  it('rejects unsupported extensions and empty files', async () => {
    await expect(service.read(new File(['data'], 'unsupported.txt'))).rejects.toThrow(
      'Formato não suportado',
    );
    await expect(service.read(new File([], 'empty.csv'))).rejects.toThrow(
      'arquivo selecionado está vazio',
    );
  });
});
