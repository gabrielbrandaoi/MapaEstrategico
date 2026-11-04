import { Injectable, inject } from '@angular/core';
import { ColumnMapping, ImportBatch, ParsedWorkbook, ParticipantType } from '../domain/models';
import { ExcelWorkbookService } from './excel-workbook.service';
import { findHeaderRow, normalizeImportedRows, suggestColumnMapping } from './excel-import';
import { AlertaTutor, RelatorioImportacao } from './import-contracts';
import { adaptarImportacao } from './import-domain.adapter';
import { detectarAbas } from './workbook-classifier';
import { mapearWorkbook } from './workbook-mapper';

export interface OpcoesImportacao {
  aba: string;
  cabecalho: number;
  mapeamento: ColumnMapping;
  tipo: ParticipantType | null;
  loteId: string;
}

export interface ResultadoParaInterface {
  dados: { lote: ImportBatch; alertas: AlertaParaInterface[]; linhasComErro: number };
  relatorio: RelatorioImportacao;
}

export type AlertaParaInterface = Omit<AlertaTutor, 'tutorId'> & { cpfProvisorio: boolean };

export interface PreparacaoMapeamento {
  aba: string;
  cabecalho: number;
  mapeamento: ColumnMapping;
  modo: 'workbook' | 'simples';
  nominal: boolean;
}

@Injectable({ providedIn: 'root' })
export class ImportadorPlanilhaService {
  private readonly leitor = inject(ExcelWorkbookService);

  ler(file: File): Promise<ParsedWorkbook> {
    return this.leitor.read(file);
  }

  preparar(workbook: ParsedWorkbook, aba?: string, cabecalho?: number): PreparacaoMapeamento {
    const detected = detectarAbas(workbook);
    const nominal = detected.find((item) => item.tipo === 'nominal');
    const selected =
      workbook.sheets.find((sheet) => sheet.name === (aba ?? nominal?.aba.name)) ??
      workbook.sheets[0];
    const classified = detected.find((item) => item.aba.name === selected?.name);
    const header =
      cabecalho ??
      (classified && classified.cabecalho >= 0
        ? classified.cabecalho
        : findHeaderRow(selected?.rows ?? []));
    return {
      aba: selected?.name ?? '',
      cabecalho: header,
      mapeamento: suggestColumnMapping(selected?.rows[header] ?? []),
      modo: detected.some(
        (item) =>
          item.tipo !== 'ignorada' || item.ocorrencias.some((issue) => issue.severidade === 'erro'),
      )
        ? 'workbook'
        : 'simples',
      nominal: nominal !== undefined,
    };
  }

  importar(workbook: ParsedWorkbook, opcoes: OpcoesImportacao): ResultadoParaInterface {
    const abas = detectarAbas(workbook);
    if (
      abas.some(
        (aba) =>
          aba.tipo !== 'ignorada' || aba.ocorrencias.some((issue) => issue.severidade === 'erro'),
      )
    ) {
      const resultado = mapearWorkbook(workbook, abas);
      return {
        dados: {
          lote: adaptarImportacao(resultado, opcoes.loteId),
          linhasComErro: new Set(
            resultado.relatorio.ocorrencias
              .filter((issue) => issue.severidade === 'erro' && issue.linha > 0)
              .map((issue) => JSON.stringify([issue.aba, issue.linha])),
          ).size,
          alertas: resultado.dados.alertas.map(({ tutorId, ...alerta }) => ({
            ...alerta,
            cpfProvisorio: resultado.dados.tutores.some(
              (tutor) => tutor.id === tutorId && tutor.cpfProvisorio,
            ),
          })),
        },
        relatorio: resultado.relatorio,
      };
    }

    const sheet = workbook.sheets.find((aba) => aba.name === opcoes.aba);
    if (!sheet) throw new Error('A aba selecionada não existe no arquivo.');
    const report = normalizeImportedRows(
      sheet.rows,
      opcoes.cabecalho,
      opcoes.mapeamento,
      opcoes.tipo,
    );
    const id = (value: string): string => `${opcoes.loteId}:${value}`;
    const lote: ImportBatch = {
      fileName: workbook.fileName,
      sheetName: sheet.name,
      participantType: opcoes.mapeamento.type === null ? opcoes.tipo : null,
      report: {
        ...report,
        participants: report.participants.map((participant) => ({
          ...participant,
          id: id(participant.id),
        })),
      },
    };
    return {
      dados: { lote, alertas: [], linhasComErro: report.invalidRows.length },
      relatorio: {
        arquivo: workbook.fileName,
        estado: report.issues.some((issue) => issue.severity === 'error')
          ? report.participants.length > 0
            ? 'parcial'
            : 'erro'
          : 'sucesso',
        abas: workbook.sheets.map((aba) => ({
          nome: aba.name,
          tipo: 'ignorada',
          cabecalho: aba === sheet ? opcoes.cabecalho + 1 : null,
          linhasLidas: aba === sheet ? report.totalRows : 0,
          linhasAceitas: aba === sheet ? report.participants.length : 0,
          linhasRejeitadas: aba === sheet ? report.invalidRows.length : 0,
        })),
        totais: {
          tutores: report.participants.filter((participant) => participant.type === 'tutor').length,
          bolsistas: report.participants.filter((participant) => participant.type === 'fellow')
            .length,
          vinculos: 0,
          tutoresSemBolsista: 0,
          cpfsProvisorios: 0,
          cnesAusentes: 0,
        },
        ocorrencias: report.issues.map((issue) => ({
          aba: sheet.name,
          linha: issue.rowNumber ?? 0,
          coluna: null,
          severidade: issue.severity === 'error' ? 'erro' : 'aviso',
          codigo: issue.code,
          mensagem: issue.message,
        })),
        divergencias: [],
      },
    };
  }
}
