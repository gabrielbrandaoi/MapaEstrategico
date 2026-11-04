import { describe, expect, it } from 'vitest';
import { CriterioAlocacao, OrigemBolsista } from './import-contracts';
import { interpretarMotivo, mapearCriterio, mapearOrigem } from './import-rules';

describe('import rules', () => {
  it('maps all supported origins regardless of accents and capitalization', () => {
    expect(mapearOrigem('45 Ciclo do PMM')).toMatchObject({
      valor: OrigemBolsista.Ciclo45,
      desconhecida: false,
    });
    expect(mapearOrigem('bolsistas NAO supervisionados segundo base MEC')).toMatchObject({
      valor: OrigemBolsista.NaoSupervisionadoMec,
      desconhecida: false,
    });
    expect(mapearOrigem('Bolsista na base EGESTOR que não aparecem na base MEC')).toMatchObject({
      valor: OrigemBolsista.EgestorForaMec,
      desconhecida: false,
    });
  });

  it('maps the three allocation criteria and ordinal variants centrally', () => {
    expect(mapearCriterio('10 PMM no município - não precisa deslocar-se')).toMatchObject({
      valor: CriterioAlocacao.DezNoMunicipio,
      desconhecida: false,
    });
    expect(mapearCriterio('Em até dois municípios com menos de 50km atingiu 5 PMM')).toMatchObject({
      valor: CriterioAlocacao.DoisMunicipios50Km,
      desconhecida: false,
    });
    expect(
      mapearCriterio(
        '2a rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm',
      ),
    ).toMatchObject({ valor: CriterioAlocacao.SegundaRodada, desconhecida: false });
    expect(
      mapearCriterio(
        '2.ª rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm',
      ).desconhecida,
    ).toBe(false);
  });

  it('preserves unknown original text and returns an explicit unknown enum', () => {
    const textoOriginal = ' Regra nova (dados demonstrativos) ';
    expect(mapearOrigem(textoOriginal)).toEqual({
      valor: OrigemBolsista.RegraDesconhecida,
      original: textoOriginal,
      desconhecida: true,
    });
    expect(mapearCriterio(null)).toEqual({
      valor: CriterioAlocacao.RegraDesconhecida,
      original: '',
      desconhecida: true,
    });
  });

  it('interprets the neighbor-not-found reason without inventing a quantity', () => {
    expect(interpretarMotivo('Nenhum município vizinho encontrado')).toEqual({
      tipo: 'sem-vizinho',
      quantidade: null,
      original: 'Nenhum município vizinho encontrado',
    });
  });

  it('extracts only non-negative counts below ten from the supported reason', () => {
    expect(interpretarMotivo('Apenas 7 bolsistas alocados (n < 10)')).toMatchObject({
      tipo: 'poucos-bolsistas',
      quantidade: 7,
    });
    expect(interpretarMotivo('Apenas 10 bolsistas alocados (n < 10)').tipo).toBe('desconhecido');
    expect(interpretarMotivo('Apenas -1 bolsistas alocados (n < 10)').tipo).toBe('desconhecido');
    expect(interpretarMotivo('Motivo não reconhecido')).toMatchObject({
      tipo: 'desconhecido',
      quantidade: null,
      original: 'Motivo não reconhecido',
    });
  });
});
