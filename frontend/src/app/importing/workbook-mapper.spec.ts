import { detectarAbas } from './workbook-classifier';
import { mapearWorkbook } from './workbook-mapper';
import type { DocumentoCru } from './import-contracts';

function workbook(entries: Array<[string, unknown[][]]>): DocumentoCru {
  return {
    fileName: 'sintetico.xlsx',
    sheets: entries.map(([name, rows]) => ({ name, rows })),
  };
}

function importar(entries: Array<[string, unknown[][]]>) {
  const document = workbook(entries);
  return mapearWorkbook(document, detectarAbas(document));
}

const NOMINAL = [
  'NOME_TUTOR',
  'CPF_TUTOR',
  'IBGE_TUTOR',
  'CNES_TUTOR',
  'PCS_TUTOR',
  'MUNICIPIO_TUTOR',
  'NOME_BOLSISTA',
  'CPF_BOLSISTA',
  'IBGE_BOLSISTA',
  'km',
  'Regra',
  'Regra_agregacao',
];

describe('mapearWorkbook', () => {
  it('imports all five schemas, reconciles the base mask, and lists ignored sheets', () => {
    const result = importar([
      [
        'Nominal',
        [
          NOMINAL,
          [
            'Tutor sintético',
            1,
            123456,
            null,
            null,
            'Cidade',
            'Bolsista sintético',
            'XXX.000.000-XX',
            123456,
            0,
            '45 Ciclo do PMM',
            '10 pmm no municipio - nao precisa deslocar-se',
          ],
          [
            'Tutor sem bolsista',
            3,
            123456,
            null,
            null,
            'Cidade',
            null,
            null,
            null,
            null,
            null,
            null,
          ],
        ],
      ],
      [
        'Contagens',
        [
          ['NOME_TUTOR', 'IBGE_TUTOR', 'MUNICIPIO_TUTOR', 'Regra_agregacao', 'NOME_BOLSISTA'],
          ['Tutor sintético', 123456, 'Cidade', '10 pmm no municipio - nao precisa deslocar-se', 1],
          [
            'Tutor sem bolsista',
            123456,
            'Cidade',
            '2ª rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm',
            0,
          ],
        ],
      ],
      [
        'Base',
        [
          ['NOME', 'CPF', 'IBGE', 'CPF_AJUSTADO'],
          ['Bolsista sintético', 2, 123456, '000000'],
        ],
      ],
      [
        'Alerta 50',
        [
          ['NOME', 'CPF', 'IBGE', 'MUNICIPIO', 'MOTIVO'],
          ['Tutor sem bolsista', 3, 123456, 'Cidade', 'Nenhum município vizinho encontrado'],
        ],
      ],
      [
        'Alerta rodada',
        [
          ['NOME_TUTOR', 'CPF_TUTOR', 'IBGE_TUTOR', 'MUNICIPIO_TUTOR', 'n_bolsistas'],
          ['Tutor sem bolsista', 3, 123456, 'Cidade', 0],
        ],
      ],
      ['Ajuda', [['observação'], ['conteúdo ignorado']]],
    ]);

    expect(result.relatorio.abas.map(({ tipo }) => tipo)).toEqual([
      'nominal',
      'contagem',
      'base-bolsistas',
      'alerta-50km',
      'alerta-rodada2',
      'ignorada',
    ]);
    expect(result.dados.tutores).toHaveLength(2);
    expect(result.dados.bolsistas).toHaveLength(1);
    expect(result.dados.vinculos).toHaveLength(1);
    expect(
      result.dados.tutores.find(({ nome }) => nome === 'Tutor sem bolsista')?.bolsistas,
    ).toEqual([]);
    expect(result.relatorio.totais).toMatchObject({
      tutores: 2,
      bolsistas: 1,
      vinculos: 1,
      tutoresSemBolsista: 1,
      cpfsProvisorios: 0,
      cnesAusentes: 2,
    });
    expect(result.relatorio.abas.at(-1)).toMatchObject({
      nome: 'Ajuda',
      tipo: 'ignorada',
      linhasLidas: 0,
    });
    expect(result.relatorio.divergencias).toEqual([]);
    expect(result.dados.alertas.some(({ tipo }) => tipo === 'sem-bolsista')).toBe(true);
  });

  it('imports reduced legacy nominal headers without IBGE and warns instead of rejecting', () => {
    const result = importar([
      [
        'Nominal legado',
        [
          ['NOME_TUTOR', 'CPF_TUTOR', 'NOME_BOLSISTA', 'CPF_BOLSISTA', 'km'],
          ['Tutor legado', 1, 'Bolsista legado', 2, 12.345],
        ],
      ],
    ]);

    expect(result.dados.tutores).toHaveLength(1);
    expect(result.dados.bolsistas).toHaveLength(1);
    expect(result.dados.vinculos[0]?.kmPlanilha).toBe(12.345);
    expect(
      result.relatorio.ocorrencias.some(({ codigo }) => codigo === 'ibge_nominal_ausente'),
    ).toBe(true);
    expect(result.relatorio.estado).toBe('parcial');
  });

  it('preserves a valid tutor when the fellow is incomplete and reports a physical row and column', () => {
    const result = importar([
      [
        'Nominal',
        [
          NOMINAL,
          [
            'Tutor válido',
            1,
            123456,
            null,
            null,
            'Cidade',
            'Bolsista incompleto',
            'CPF ruim',
            123456,
            2,
            null,
            null,
          ],
        ],
      ],
    ]);

    expect(result.dados.tutores).toHaveLength(1);
    expect(result.dados.bolsistas).toHaveLength(0);
    expect(result.dados.vinculos).toHaveLength(0);
    expect(result.relatorio.ocorrencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: 'cpf_invalido', linha: 2, coluna: 'H' }),
        expect.objectContaining({ codigo: 'invalid_relationship_identity', linha: 2, coluna: 'H' }),
      ]),
    );
    expect(result.relatorio.abas[0]).toMatchObject({
      linhasLidas: 1,
      linhasAceitas: 0,
      linhasRejeitadas: 1,
    });
  });

  it('keeps negative and malformed KM as null without discarding the link; null and zero stay distinct', () => {
    const result = importar([
      [
        'Nominal',
        [
          NOMINAL,
          ['Tutor A', 1, 123456, null, null, 'Cidade', 'Bolsista A', 2, 123456, -1, null, null],
          ['Tutor B', 3, 123456, null, null, 'Cidade', 'Bolsista B', 4, 123456, 'ruim', null, null],
          ['Tutor C', 5, 123456, null, null, 'Cidade', 'Bolsista C', 6, 123456, 0, null, null],
          ['Tutor D', 7, 123456, null, null, 'Cidade', 'Bolsista D', 8, 123456, null, null, null],
        ],
      ],
    ]);

    expect(result.dados.vinculos.map(({ kmPlanilha }) => kmPlanilha)).toEqual([
      null,
      null,
      0,
      null,
    ]);
    expect(
      result.relatorio.ocorrencias.filter(({ codigo }) => codigo === 'invalid_reported_km'),
    ).toHaveLength(2);
    expect(
      result.relatorio.ocorrencias
        .filter(({ codigo }) => codigo === 'invalid_reported_km')
        .every(({ linha, coluna }) => linha > 1 && coluna === 'J'),
    ).toBe(true);
  });

  it('retains each repeated relationship row and emits the facade-compatible code', () => {
    const result = importar([
      [
        'Nominal',
        [
          NOMINAL,
          ['Tutor', 1, 123456, null, null, 'Cidade', 'Bolsista', 2, 123456, 10, null, null],
          ['Tutor', 1, 123456, null, null, 'Cidade', 'Bolsista', 2, 123456, 11, null, null],
        ],
      ],
    ]);

    expect(result.dados.vinculos).toHaveLength(2);
    expect(result.dados.tutores[0]?.bolsistas).toHaveLength(1);
    expect(result.relatorio.ocorrencias).toContainEqual(
      expect.objectContaining({ codigo: 'duplicate_relationship', linha: 3 }),
    );
  });

  it('keeps unknown rules as enums with originals, while report messages redact CPF-like sequences', () => {
    const secretLikeValue = '99999999999';
    const result = importar([
      [
        'Nominal',
        [
          NOMINAL,
          [
            'Tutor',
            1,
            123456,
            null,
            null,
            'Cidade',
            'Bolsista',
            2,
            123456,
            null,
            `Regra ${secretLikeValue}`,
            `Critério ${secretLikeValue}`,
          ],
        ],
      ],
    ]);

    expect(result.dados.vinculos[0]?.origem).toBe('RegraDesconhecida');
    expect(result.dados.vinculos[0]?.origemOriginal).toContain(secretLikeValue);
    expect(
      result.relatorio.ocorrencias.some(({ codigo }) => codigo === 'regra_origem_desconhecida'),
    ).toBe(true);
    expect(result.relatorio.ocorrencias.map(({ mensagem }) => mensagem).join(' ')).not.toContain(
      secretLikeValue,
    );
    expect(
      result.relatorio.divergencias
        .map(
          ({ mensagem, esperado, encontrado }) => `${mensagem}${esperado ?? ''}${encontrado ?? ''}`,
        )
        .join(' '),
    ).not.toContain(secretLikeValue);
  });

  it('reports an adjusted-CPF disagreement without exposing the full CPF in divergence fields', () => {
    const result = importar([
      [
        'Nominal',
        [
          NOMINAL,
          ['Tutor', 1, 123456, null, null, 'Cidade', 'Bolsista', 2, 123456, null, null, null],
        ],
      ],
      [
        'Base',
        [
          ['NOME', 'CPF', 'IBGE', 'CPF_AJUSTADO'],
          ['Bolsista', 2, 123456, '654321'],
        ],
      ],
    ]);

    expect(result.relatorio.divergencias).toContainEqual(
      expect.objectContaining({
        codigo: 'cpf_ajustado_divergente',
        esperado: '000000',
        encontrado: '654321',
      }),
    );
    expect(JSON.stringify(result.relatorio.divergencias)).not.toContain('00000000002');
  });

  it('accepts a masked CPF in base C as an incomplete candidate instead of rejecting it', () => {
    const result = importar([
      [
        'Nominal',
        [
          NOMINAL,
          [
            'Tutor',
            1,
            123456,
            null,
            null,
            'Cidade',
            'Bolsista sintético',
            'XXX.000.000-XX',
            123456,
            null,
            null,
            null,
          ],
        ],
      ],
      [
        'Base',
        [
          ['NOME', 'CPF', 'IBGE', 'CPF_AJUSTADO'],
          ['Bolsista sintético', 'XXX.000.000-XX', 123456, 0],
        ],
      ],
    ]);

    expect(result.relatorio.abas.find(({ tipo }) => tipo === 'base-bolsistas')).toMatchObject({
      linhasLidas: 1,
      linhasAceitas: 1,
      linhasRejeitadas: 0,
    });
    expect(result.dados.bolsistas[0]).toMatchObject({ cpf: null, cpfProvisorio: true });
    expect(result.relatorio.ocorrencias.some(({ codigo }) => codigo === 'base_cpf_mascarado')).toBe(
      true,
    );
    expect(
      result.relatorio.ocorrencias.some(({ codigo }) => codigo === 'linha_base_invalida'),
    ).toBe(false);
  });

  it('does not reconcile a masked identity without IBGE and keeps it under SEM-IBGE', () => {
    const result = importar([
      [
        'Nominal',
        [
          ['NOME_TUTOR', 'CPF_TUTOR', 'IBGE_TUTOR', 'NOME_BOLSISTA', 'CPF_BOLSISTA'],
          ['Tutor', 1, 123456, 'Bolsista sintético', 'XXX.000.000-XX'],
        ],
      ],
      [
        'Base',
        [
          ['NOME', 'CPF', 'IBGE', 'CPF_AJUSTADO'],
          ['Bolsista sintético', 2, 123456, '000000'],
        ],
      ],
    ]);

    expect(result.dados.vinculos).toHaveLength(1);
    expect(result.dados.bolsistas[0]).toMatchObject({ cpf: null, cpfProvisorio: true });
    expect(result.dados.bolsistas[0]?.id).toContain('SEM-IBGE');
    expect(result.relatorio.ocorrencias.some(({ codigo }) => codigo === 'ibge_ausente')).toBe(true);
    expect(result.dados.bolsistas[0]?.cpf).not.toBe('00000000002');
  });

  it('rejects a malformed non-empty IBGE rather than treating it as absent', () => {
    const result = importar([
      [
        'Nominal',
        [
          [
            'NOME_TUTOR',
            'CPF_TUTOR',
            'IBGE_TUTOR',
            'NOME_BOLSISTA',
            'CPF_BOLSISTA',
            'IBGE_BOLSISTA',
          ],
          ['Tutor', 1, 123456, 'Bolsista sintético', 'XXX.000.000-XX', 'código inválido'],
        ],
      ],
    ]);

    expect(result.dados.bolsistas).toHaveLength(0);
    expect(result.relatorio.ocorrencias).toContainEqual(
      expect.objectContaining({ codigo: 'ibge_invalido', severidade: 'erro', linha: 2 }),
    );
    expect(result.relatorio.ocorrencias.some(({ codigo }) => codigo === 'ibge_ausente')).toBe(
      false,
    );
  });

  it('matches masked fellows only to one base row with matching normalized name and IBGE', () => {
    const unique = importar([
      [
        'Nominal',
        [
          NOMINAL,
          [
            'Tutor',
            1,
            123456,
            null,
            null,
            'Cidade',
            ' Base Único ',
            'XXX.000.000-XX',
            123456,
            null,
            null,
            null,
          ],
        ],
      ],
      [
        'Base',
        [
          ['NOME', 'CPF', 'IBGE', 'CPF_AJUSTADO'],
          ['base unico', 2, 123456, '000000'],
        ],
      ],
    ]);
    expect(unique.dados.bolsistas).toHaveLength(1);
    expect(unique.dados.bolsistas[0]?.cpf).toBe('00000000002');
    expect(unique.relatorio.totais.cpfsProvisorios).toBe(0);

    const ambiguous = importar([
      [
        'Nominal',
        [
          NOMINAL,
          [
            'Tutor',
            1,
            123456,
            null,
            null,
            'Cidade',
            'Base A',
            'XXX.000.000-XX',
            123456,
            null,
            null,
            null,
          ],
        ],
      ],
      [
        'Base',
        [
          ['NOME', 'CPF', 'IBGE', 'CPF_AJUSTADO'],
          ['Base A', 1, 123456, '000000'],
          ['Base B', 2, 123456, '000000'],
        ],
      ],
    ]);
    expect(ambiguous.dados.bolsistas).toHaveLength(1);
    expect(ambiguous.dados.bolsistas[0]?.cpf).toBeNull();
    expect(ambiguous.dados.bolsistas[0]?.cpfProvisorio).toBe(true);
    expect(
      ambiguous.relatorio.ocorrencias.some(({ codigo }) => codigo === 'base_mascarada_colisao'),
    ).toBe(true);
  });

  it('deduplicates identical C base rows before testing uniqueness for masked reconciliation', () => {
    const result = importar([
      [
        'Nominal',
        [
          NOMINAL,
          [
            'Tutor',
            1,
            123456,
            null,
            null,
            'Cidade',
            'Bolsista sintético',
            'XXX.000.000-XX',
            123456,
            null,
            null,
            null,
          ],
        ],
      ],
      [
        'Base',
        [
          ['NOME', 'CPF', 'IBGE', 'CPF_AJUSTADO'],
          ['Bolsista sintético', 2, 123456, 0],
          [' Bolsista sintético ', 2, 123456, 0],
        ],
      ],
    ]);

    expect(result.relatorio.abas.find(({ tipo }) => tipo === 'base-bolsistas')).toMatchObject({
      linhasLidas: 2,
      linhasAceitas: 2,
      linhasRejeitadas: 0,
    });
    expect(result.dados.bolsistas[0]).toMatchObject({ cpf: '00000000002', cpfProvisorio: false });
    expect(
      result.relatorio.ocorrencias.some(({ codigo }) => codigo === 'base_registro_duplicado'),
    ).toBe(true);
    expect(
      result.relatorio.ocorrencias.some(({ codigo }) => codigo === 'base_mascarada_colisao'),
    ).toBe(false);
  });

  it('redacts CPF-shaped substrings from both known and unknown alert motives', () => {
    const privateLikeValue = '123.456.789-01';
    const result = importar([
      [
        'Nominal',
        [NOMINAL, ['Tutor', 1, 123456, null, null, 'Cidade', null, null, null, null, null, null]],
      ],
      [
        'Alertas',
        [
          ['NOME', 'CPF', 'IBGE', 'MUNICIPIO', 'MOTIVO'],
          ['Tutor', 1, 123456, 'Cidade', `Nenhum município vizinho encontrado ${privateLikeValue}`],
          ['Tutor', 1, 123456, 'Cidade', `Motivo externo ${privateLikeValue}`],
          ['Tutor', 1, 123456, 'Cidade', 'Nenhum município vizinho encontrado'],
        ],
      ],
    ]);

    const alertas = result.dados.alertas.filter(({ tipo }) => tipo !== 'sem-bolsista');
    expect(alertas).toHaveLength(3);
    expect(alertas.every(({ motivo }) => !motivo.includes(privateLikeValue))).toBe(true);
    expect(alertas.some(({ tipo }) => tipo === 'sem-vizinho')).toBe(true);
    expect(JSON.stringify(result.relatorio.ocorrencias)).not.toContain(privateLikeValue);
  });

  it('normalizes numeric CPF-adjusted values to six digits before divergence checks', () => {
    const result = importar([
      [
        'Nominal',
        [NOMINAL, ['Tutor', 1, 123456, null, null, 'Cidade', null, null, null, null, null, null]],
      ],
      [
        'Base',
        [
          ['NOME', 'CPF', 'IBGE', 'CPF_AJUSTADO'],
          ['Bolsista A', '00001234567', 123456, 12345],
          ['Bolsista B', '00001234568', 123456, '12345.0'],
        ],
      ],
    ]);

    expect(
      result.relatorio.divergencias.filter(({ codigo }) => codigo === 'cpf_ajustado_divergente'),
    ).toHaveLength(0);
  });

  it('keeps masked identities separate from full CPFs and from other names sharing a mask', () => {
    const result = importar([
      [
        'Nominal',
        [
          NOMINAL,
          [
            'Tutor',
            1,
            123456,
            null,
            null,
            'Cidade',
            'Bolsista A',
            'XXX.000.000-XX',
            123456,
            null,
            null,
            null,
          ],
          [
            'Tutor',
            1,
            123456,
            null,
            null,
            'Cidade',
            'Bolsista B',
            'XXX.000.000-XX',
            123456,
            null,
            null,
            null,
          ],
          ['Tutor', 1, 123456, null, null, 'Cidade', 'Bolsista A', 2, 123456, null, null, null],
        ],
      ],
    ]);

    expect(result.dados.bolsistas).toHaveLength(3);
    expect(result.dados.bolsistas.map(({ cpfProvisorio }) => cpfProvisorio)).toEqual([
      true,
      true,
      false,
    ]);
    expect(new Set(result.dados.bolsistas.map(({ id }) => id)).size).toBe(3);
    expect(result.dados.tutores[0]?.bolsistas).toHaveLength(3);
  });

  it('associates B only by unique normalized name plus IBGE and compares distinct nominal fellows', () => {
    const unique = importar([
      [
        'Nominal',
        [
          NOMINAL,
          ['Tutor Único', 1, 123456, null, null, 'Cidade', 'Bolsista', 2, 123456, 4, null, null],
        ],
      ],
      [
        'Contagens',
        [
          ['NOME_TUTOR', 'IBGE_TUTOR', 'MUNICIPIO_TUTOR', 'Regra_agregacao', 'NOME_BOLSISTA'],
          [' tutor unico ', 123456, 'Cidade', null, 1],
        ],
      ],
    ]);
    expect(unique.dados.contagens[0]?.tutorId).toBe(unique.dados.tutores[0]?.id);
    expect(unique.relatorio.divergencias).toHaveLength(0);

    const ambiguous = importar([
      [
        'Nominal',
        [
          NOMINAL,
          ['Tutor Igual', 1, 123456, null, null, 'Cidade', null, null, null, null, null, null],
          ['Tutor Igual', 3, 123456, null, null, 'Cidade', null, null, null, null, null, null],
        ],
      ],
      [
        'Contagens',
        [
          ['NOME_TUTOR', 'IBGE_TUTOR', 'MUNICIPIO_TUTOR', 'Regra_agregacao', 'NOME_BOLSISTA'],
          ['Tutor Igual', 123456, 'Cidade', null, 0],
        ],
      ],
    ]);
    expect(ambiguous.dados.contagens[0]?.tutorId).toBeNull();
    expect(
      ambiguous.relatorio.ocorrencias.some(({ codigo }) => codigo === 'contagem_tutor_ambiguo'),
    ).toBe(true);
  });

  it('counts the historical NOME_bolsista field as the B quantity', () => {
    const result = importar([
      [
        'Nominal',
        [
          NOMINAL,
          ['Tutor', 1, 123456, null, null, 'Cidade', 'Bolsista', 2, 123456, null, null, null],
        ],
      ],
      [
        'Contagem',
        [
          ['NOME_TUTOR', 'IBGE_TUTOR', 'MUNICIPIO_TUTOR', 'Regra_agregacao', 'NOME_bolsista'],
          ['Tutor', 123456, 'Cidade', null, 1],
        ],
      ],
    ]);
    expect(result.dados.contagens[0]?.quantidadeBolsistas).toBe(1);
  });

  it('reports unmatched D/E references and reconciles E quantity for a matched tutor', () => {
    const result = importar([
      [
        'Nominal',
        [
          NOMINAL,
          ['Tutor real', 1, 123456, null, null, 'Cidade', null, null, null, null, null, null],
        ],
      ],
      [
        'Alerta 50',
        [
          ['NOME', 'CPF', 'IBGE', 'MUNICIPIO', 'MOTIVO'],
          ['Tutor inexistente', 9, 123456, 'Cidade', 'Nenhum município vizinho encontrado'],
        ],
      ],
      [
        'Alerta rodada',
        [
          ['NOME_TUTOR', 'CPF_TUTOR', 'IBGE_TUTOR', 'MUNICIPIO_TUTOR', 'n_bolsistas'],
          ['Tutor real', 1, 123456, 'Cidade', 1],
          ['Tutor inexistente', 9, 123456, 'Cidade', 0],
        ],
      ],
    ]);

    expect(
      result.dados.alertas.some(
        ({ nome, tutorId }) => nome === 'Tutor inexistente' && tutorId === null,
      ),
    ).toBe(true);
    expect(
      result.relatorio.ocorrencias.filter(({ codigo }) => codigo === 'alerta_sem_referencia'),
    ).toHaveLength(2);
    expect(result.relatorio.divergencias).toContainEqual(
      expect.objectContaining({
        codigo: 'alerta_rodada2_divergente',
        esperado: 1,
        encontrado: 0,
        coluna: 'E',
      }),
    );
  });

  it('scales to 881 nominal rows while deduplicating 212 tutors', () => {
    const rows: unknown[][] = [NOMINAL];
    for (let index = 0; index < 881; index += 1) {
      const tutorNumber = (index % 212) + 1;
      rows.push([
        `Tutor sintético ${tutorNumber}`,
        tutorNumber,
        123456,
        null,
        null,
        'Cidade sintética',
        `Bolsista sintético ${index + 1}`,
        index + 1000,
        123456,
        null,
        null,
        null,
      ]);
    }

    const result = importar([['Nominal', rows]]);
    expect(result.relatorio.abas[0]?.linhasLidas).toBe(881);
    expect(result.dados.tutores).toHaveLength(212);
    expect(result.dados.bolsistas).toHaveLength(881);
    expect(result.dados.vinculos).toHaveLength(881);
  });

  it('uses physical row and Excel column references for imported source records', () => {
    const result = importar([
      [
        'Nominal',
        [
          ['Título'],
          NOMINAL,
          [
            'Tutor',
            'CPF ruim',
            123456,
            null,
            null,
            'Cidade',
            'Bolsista',
            2,
            123456,
            null,
            null,
            null,
          ],
        ],
      ],
    ]);
    const issue = result.relatorio.ocorrencias.find(({ codigo }) => codigo === 'cpf_invalido');
    expect(issue).toMatchObject({ aba: 'Nominal', linha: 3, coluna: 'B' });
  });
});
