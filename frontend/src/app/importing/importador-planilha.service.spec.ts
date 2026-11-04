import { TestBed } from '@angular/core/testing';
import * as XLSX from 'xlsx';
import { ImportadorPlanilhaService, OpcoesImportacao } from './importador-planilha.service';

const opcoes: OpcoesImportacao = {
  aba: 'qualquer',
  cabecalho: 0,
  tipo: null,
  loteId: 'teste',
  mapeamento: {
    type: null,
    name: null,
    city: null,
    state: null,
    address: null,
    postalCode: null,
    latitude: null,
    longitude: null,
  },
};

function criarArquivo(bookType: 'xlsx' | 'xls'): File {
  const workbook = XLSX.utils.book_new();
  const sheets: [string, unknown[][]][] = [
    [
      'Planilha auxiliar',
      [
        [null, 'ibge', 'nome', 'cpf', 'cpf_ajustado'],
        [0, 123456, 'Bolsista sintético', 2, '000000'],
      ],
    ],
    [
      'Uma aba qualquer',
      [
        [
          'NOME_bolsista',
          'CPF_bolsista',
          'IBGE_TUTOR',
          'CPF_TUTOR',
          'NOME_TUTOR',
          'CNES_TUTOR',
          'PCS_TUTOR',
          'MUNICIPIO_TUTOR',
          'km',
          'IBGE',
          'Regra',
          'Regra_agregacao',
        ],
        [
          'Bolsista sintético',
          'XXX.000.000-XX',
          123456,
          1,
          'Tutor sintético A',
          null,
          2,
          'Cidade sintética',
          0,
          123456,
          '45 Ciclo do PMM',
          '10 pmm no municipio - nao precisa deslocar-se',
        ],
        [],
        [
          null,
          null,
          123456,
          3,
          'Tutor sintético B',
          null,
          2,
          'Cidade sintética',
          null,
          null,
          null,
          '2ª rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm',
        ],
      ],
    ],
    [
      'Contagem renomeada',
      [
        ['NOME_TUTOR', 'IBGE_TUTOR', 'MUNICIPIO_TUTOR', 'Regra_agregacao', 'NOME_bolsista'],
        [
          'Tutor sintético A',
          123456,
          'Cidade sintética',
          '10 pmm no municipio - nao precisa deslocar-se',
          1,
        ],
        [
          'Tutor sintético B',
          123456,
          'Cidade sintética',
          '2ª rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm',
          0,
        ],
      ],
    ],
    [
      'Primeiro alerta',
      [
        [null, 'NOME', 'CPF', 'IBGE', 'MUNICIPIO', 'MOTIVO'],
        [
          0,
          'Tutor sintético B',
          3,
          123456,
          'Cidade sintética',
          'Nenhum município vizinho encontrado',
        ],
      ],
    ],
    [
      'Outro alerta',
      [
        ['NOME_TUTOR', 'CPF_TUTOR', 'IBGE_TUTOR', 'MUNICIPIO_TUTOR', 'n_bolsistas'],
        ['Tutor sintético B', 3, 123456, 'Cidade sintética', 0],
      ],
    ],
  ];
  for (const [name, rows] of sheets)
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return new File([XLSX.write(workbook, { bookType, type: 'array' })], `sintetico.${bookType}`);
}

describe('ImportadorPlanilhaService', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it.each(['xlsx', 'xls'] as const)(
    'reads a real %s workbook and reconciles all five schemas',
    async (extension) => {
      const service = TestBed.inject(ImportadorPlanilhaService);
      const workbook = await service.ler(criarArquivo(extension));
      const preparation = service.preparar(workbook);
      expect(preparation.modo).toBe('workbook');
      expect(preparation.aba).toBe('Uma aba qualquer');
      const result = service.importar(workbook, opcoes);
      expect(result.relatorio.estado).not.toBe('erro');
      expect(result.relatorio.abas.map((sheet) => sheet.tipo)).toEqual([
        'base-bolsistas',
        'nominal',
        'contagem',
        'alerta-50km',
        'alerta-rodada2',
      ]);
      expect(result.relatorio.totais).toMatchObject({
        tutores: 2,
        bolsistas: 1,
        vinculos: 1,
        tutoresSemBolsista: 1,
        cnesAusentes: 2,
        cpfsProvisorios: 0,
      });
      expect(
        result.dados.lote.report.relationships?.some(
          (link) =>
            result.dados.lote.report.participants.find((person) => person.id === link.tutorId)
              ?.name === 'Tutor sintético B',
        ),
      ).toBe(false);
      expect(result.dados.lote.report.relationships?.[0]?.reportedKm).toBe(0);
      expect(
        result.dados.lote.report.participants.find((person) => person.name === 'Tutor sintético B')
          ?.sourceRow,
      ).toBe(4);
      expect(result.dados.lote.report.relationships).toHaveLength(1);
      expect(JSON.stringify(result.dados.lote)).not.toContain('00000000001');
      expect(JSON.stringify(result.dados.lote)).not.toContain('CPF-');
      expect(JSON.stringify(result.dados)).not.toContain('00000000001');
      expect(result.relatorio.divergencias).toHaveLength(0);
    },
  );

  it('reports a missing nominal sheet rather than treating a summary as participants', () => {
    const service = TestBed.inject(ImportadorPlanilhaService);
    const result = service.importar(
      {
        fileName: 'resumo.xlsx',
        sheets: [
          {
            name: 'Resumo',
            rows: [
              ['NOME_TUTOR', 'IBGE_TUTOR', 'MUNICIPIO_TUTOR', 'Regra_agregacao', 'NOME_bolsista'],
              ['Tutor sintético', 123456, 'Cidade', 'regra', 1],
            ],
          },
        ],
      },
      opcoes,
    );
    expect(result.relatorio.estado).toBe('erro');
    expect(result.dados.lote.report.participants).toHaveLength(0);
  });

  it('preserves CSV with explicit mapping and distinct batch ids', async () => {
    const service = TestBed.inject(ImportadorPlanilhaService);
    const workbook = await service.ler(
      new File(['Nome,Cidade\nPessoa sintetica,Cidade teste'], 'simple.csv'),
    );
    expect(service.preparar(workbook).modo).toBe('simples');
    const result = service.importar(workbook, {
      ...opcoes,
      aba: 'Sheet1',
      tipo: 'tutor',
      mapeamento: { ...opcoes.mapeamento, name: 0, city: 1 },
    });
    expect(result.dados.lote.report.participants).toHaveLength(1);
    expect(result.dados.lote.report.participants[0]?.type).toBe('tutor');
    expect(result.relatorio.estado).toBe('sucesso');
  });

  it('counts errors by sheet and physical row rather than merging equal row numbers', () => {
    const service = TestBed.inject(ImportadorPlanilhaService);
    const result = service.importar(
      {
        fileName: 'duas-nominais.xlsx',
        sheets: ['Primeira', 'Segunda'].map((name, index) => ({
          name,
          rows: [
            ['CPF_TUTOR', 'NOME_TUTOR', 'CPF_bolsista', 'NOME_bolsista', 'km'],
            [1, 'Tutor sintético', index + 2, `Bolsista sintético ${index}`, -1],
          ],
        })),
      },
      opcoes,
    );
    expect(result.dados.linhasComErro).toBe(2);
    expect(result.dados.lote.report.relationships).toHaveLength(2);
    expect(result.dados.lote.report.relationships?.every((link) => link.reportedKm === null)).toBe(
      true,
    );
  });

  it('keeps a single-role CSV in the manual import workflow', () => {
    const service = TestBed.inject(ImportadorPlanilhaService);
    const workbook = {
      fileName: 'tutores.csv',
      sheets: [
        {
          name: 'Dados',
          rows: [
            ['NOME_TUTOR', 'CPF_TUTOR', 'MUNICIPIO_TUTOR'],
            ['Tutor sintético', 1, 'Cidade sintética'],
          ],
        },
      ],
    };
    expect(service.preparar(workbook).modo).toBe('simples');
    const result = service.importar(workbook, {
      ...opcoes,
      aba: 'Dados',
      tipo: 'tutor',
      mapeamento: { ...opcoes.mapeamento, name: 0, city: 2 },
    });
    expect(result.relatorio.estado).toBe('sucesso');
    expect(result.dados.lote.report.participants).toHaveLength(1);
    expect(JSON.stringify(result.dados)).not.toContain('00000000001');
  });
});
