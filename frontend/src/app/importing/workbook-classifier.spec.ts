import { describe, expect, it } from 'vitest';
import { AbaCrua, DocumentoCru } from './import-contracts';
import { detectarAbas, normalizarCabecalho } from './workbook-classifier';

describe('workbook classifier', () => {
  it('normalizes accents, case, spaces and separators', () => {
    expect(normalizarCabecalho('  Município_TUTOR  ')).toBe('municipiotutor');
    expect(normalizarCabecalho('__EMPTY')).toBe('');
  });

  it('detects all five schemas from headers, independently of tab names', () => {
    const sheets: AbaCrua[] = [
      sheet('Resumo', [
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
      ]),
      sheet('Outra aba', [
        'NOME_TUTOR',
        'IBGE_TUTOR',
        'MUNICIPIO_TUTOR',
        'Regra_agregacao',
        'NOME_bolsista',
      ]),
      sheet('Dados', ['', 'ibge', 'nome', 'cpf', 'cpf_ajustado']),
      sheet('Tabela', ['NOME', 'CPF', 'IBGE', 'MUNICIPIO', 'MOTIVO']),
      sheet('Qualquer nome', [
        'NOME_TUTOR',
        'CPF_TUTOR',
        'IBGE_TUTOR',
        'MUNICIPIO_TUTOR',
        'n_bolsistas',
      ]),
    ];

    const resultados = detectarAbas(documento(sheets));
    expect(resultados.map((aba) => aba.tipo)).toEqual([
      'nominal',
      'contagem',
      'base-bolsistas',
      'alerta-50km',
      'alerta-rodada2',
    ]);
    expect(resultados[1]?.colunas.quantidadeBolsistas).toBe(4);
    expect(resultados[0]?.colunas.ibgeBolsista).toBe(9);
    expect(resultados[2]?.colunas).toEqual({ ibge: 1, nome: 2, cpf: 3, cpfAjustado: 4 });
    expect(resultados[4]?.colunas.quantidadeBolsistas).toBe(4);
  });

  it('finds a header below title rows and only in the first 20 physical rows', () => {
    const resultado = detectarAbas(
      documento([
        {
          name: 'Título',
          rows: [
            ['Relatório sintético'],
            ['NOME_TUTOR', 'CPF_TUTOR', 'IBGE_TUTOR', 'MUNICIPIO_TUTOR', 'n_bolsistas'],
          ],
        },
        {
          name: 'Cabeçalho tardio',
          rows: [
            ...Array.from({ length: 20 }, () => ['Linha sem cabeçalho']),
            ['NOME', 'CPF', 'IBGE', 'MUNICIPIO', 'MOTIVO'],
          ],
        },
      ]),
    );

    expect(resultado[0]).toMatchObject({ tipo: 'alerta-rodada2', cabecalho: 1 });
    expect(resultado[1]).toMatchObject({ tipo: 'ignorada', cabecalho: -1 });
  });

  it('supports the minimum legacy nominal shape and ignores empty placeholder columns', () => {
    const resultado = detectarAbas(
      documento([
        {
          name: 'Planilha genérica',
          rows: [['__EMPTY', 'Nome do Tutor', 'CPF Tutor', 'Nome Bolsista', 'CPF Bolsista', 'km']],
        },
      ]),
    )[0];

    expect(resultado).toMatchObject({
      tipo: 'nominal',
      cabecalho: 0,
      colunas: { nomeTutor: 1, cpfTutor: 2, nomeBolsista: 3, cpfBolsista: 4, km: 5 },
    });
  });

  it('accepts the four nominal identity headers when km is absent', () => {
    const resultado = detectarAbas(
      documento([
        sheet('Relação sem km', ['NOME_TUTOR', 'CPF_TUTOR', 'NOME_bolsista', 'CPF_bolsista']),
      ]),
    )[0];

    expect(resultado).toMatchObject({
      tipo: 'nominal',
      cabecalho: 0,
      colunas: { nomeTutor: 0, cpfTutor: 1, nomeBolsista: 2, cpfBolsista: 3 },
      ocorrencias: [],
    });
  });

  it('reports incomplete relational headers as errors even when ignored', () => {
    const resultado = detectarAbas(
      documento([sheet('Relações incompletas', ['NOME_TUTOR', 'NOME_BOLSISTA', 'CPF_TUTOR'])]),
    )[0];

    expect(resultado).toMatchObject({
      tipo: 'ignorada',
      cabecalho: 0,
      ocorrencias: [
        expect.objectContaining({
          codigo: 'cabecalho_relacional_incompleto',
          severidade: 'erro',
          linha: 1,
        }),
      ],
    });
  });

  it('leaves a single-role tutor CSV in simple/manual mode', () => {
    const resultado = detectarAbas(
      documento([sheet('Cadastro de tutores', ['NOME_TUTOR', 'CPF_TUTOR', 'MUNICIPIO_TUTOR'])]),
    )[0];

    expect(resultado).toMatchObject({
      tipo: 'ignorada',
      cabecalho: -1,
      colunas: {},
      ocorrencias: [],
    });
  });

  it('continues past a two-role partial preamble to find a complete header', () => {
    const resultado = detectarAbas(
      documento([
        {
          name: 'Relações',
          rows: [
            ['NOME_TUTOR', 'NOME_BOLSISTA'],
            ['NOME_TUTOR', 'CPF_TUTOR', 'NOME_BOLSISTA', 'CPF_BOLSISTA'],
          ],
        },
      ]),
    )[0];

    expect(resultado).toMatchObject({
      tipo: 'nominal',
      cabecalho: 1,
      colunas: { nomeTutor: 0, cpfTutor: 1, nomeBolsista: 2, cpfBolsista: 3 },
      ocorrencias: [],
    });
  });

  it('reports duplicate relational columns even if the schema is incomplete', () => {
    const resultado = detectarAbas(
      documento([sheet('Relação duplicada', ['NOME_TUTOR', 'NOME_TUTOR', 'NOME_BOLSISTA'])]),
    )[0];

    expect(resultado?.tipo).toBe('ignorada');
    expect(resultado?.ocorrencias.map((item) => item.codigo)).toEqual([
      'cabecalho_duplicado',
      'cabecalho_duplicado',
      'cabecalho_relacional_incompleto',
    ]);
  });

  it('does not silently select duplicate field columns and preserves source row/column', () => {
    const resultado = detectarAbas(
      documento([sheet('Aba', ['NOME', 'Nome', 'CPF', 'IBGE', 'MUNICIPIO', 'MOTIVO'])]),
    )[0];

    expect(resultado?.tipo).toBe('alerta-50km');
    expect(resultado?.colunas.nome).toBeUndefined();
    expect(resultado?.ocorrencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          linha: 1,
          coluna: 'A',
          codigo: 'cabecalho_duplicado',
          severidade: 'erro',
        }),
        expect.objectContaining({ linha: 1, coluna: 'B', codigo: 'cabecalho_duplicado' }),
      ]),
    );
  });

  it('reports an ambiguous schema instead of choosing one', () => {
    const resultado = detectarAbas(
      documento([sheet('Ambígua', ['NOME', 'CPF', 'IBGE', 'MUNICIPIO', 'MOTIVO', 'CPF_AJUSTADO'])]),
    )[0];

    expect(resultado).toMatchObject({
      tipo: 'ignorada',
      cabecalho: 0,
      ocorrencias: [expect.objectContaining({ codigo: 'schema_ambiguo', severidade: 'erro' })],
    });
  });

  it('does not classify by sheet name when no recognized header exists', () => {
    const resultado = detectarAbas(
      documento([{ name: 'nominal alerta 50km', rows: [['coluna A', 'coluna B']] }]),
    )[0];
    expect(resultado).toMatchObject({ tipo: 'ignorada', cabecalho: -1, colunas: {} });
  });
});

function sheet(name: string, header: string[]): AbaCrua {
  return { name, rows: [header] };
}

function documento(sheets: AbaCrua[]): DocumentoCru {
  return { fileName: 'fixture-sem-dados-pessoais.xlsx', sheets };
}
