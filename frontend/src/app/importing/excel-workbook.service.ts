import { Injectable } from '@angular/core';
import { ParsedSheet, ParsedWorkbook } from '../domain/models';
import type * as XLSXTypes from 'xlsx';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);

@Injectable({ providedIn: 'root' })
export class ExcelWorkbookService {
  async read(file: File): Promise<ParsedWorkbook> {
    const extension = file.name.includes('.')
      ? `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
      : '';
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error('Formato não suportado. Selecione um arquivo XLSX, XLS ou CSV.');
    }
    if (file.size === 0) {
      throw new Error('O arquivo selecionado está vazio.');
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error('O arquivo excede o limite de 10 MB.');
    }

    const XLSX = await import('xlsx');
    let workbook: XLSXTypes.WorkBook;
    try {
      const contents = await file.arrayBuffer();
      const options = {
        cellDates: false,
        bookVBA: false,
        bookDeps: false,
        WTF: false,
      };
      workbook =
        extension === '.csv'
          ? XLSX.read(decodeCsv(contents), { ...options, type: 'string', raw: true })
          : XLSX.read(contents, { ...options, type: 'array' });
    } catch (error: unknown) {
      throw new Error(
        'Não foi possível ler a planilha. Verifique se o arquivo é válido e não está protegido por senha.',
        { cause: error },
      );
    }

    function decodeCsv(contents: ArrayBuffer): string {
      const bytes = new Uint8Array(contents);
      if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(contents);
      }
      if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(contents);
      }

      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(contents);
      } catch {
        return new TextDecoder('windows-1252').decode(contents);
      }
    }

    const sheets: ParsedSheet[] = workbook.SheetNames.flatMap((name) => {
      const worksheet = workbook.Sheets[name];
      if (!worksheet) {
        return [];
      }

      const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: true,
        range: 0,
      });
      return [{ name, rows }];
    });

    if (
      !sheets.some((sheet) =>
        sheet.rows.some((row) => row.some((value) => value !== null && value !== '')),
      )
    ) {
      throw new Error('O arquivo não contém abas com dados para importar.');
    }

    return { fileName: file.name, sheets };
  }
}
