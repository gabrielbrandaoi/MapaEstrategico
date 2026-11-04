import { adaptarImportacao } from './import-domain.adapter';
import { CriterioAlocacao, OrigemBolsista, ResultadoImportacao } from './import-contracts';

describe('import-domain adapter', () => {
  it('keeps stable entity references but never sends CPF keys or invented coordinates to presentation', () => {
    const fonte = { aba: 'Nominal', linha: 2, coluna: null };
    const result: ResultadoImportacao = {
      dados: {
        tutores: [
          {
            id: 'CPF-00000000001',
            cpf: '00000000001',
            cpfProvisorio: false,
            nome: 'Tutor sintético',
            ibge: '123456',
            municipio: 'Cidade',
            cnes: null,
            pcs: null,
            bolsistas: ['PROV-test'],
            criterio: CriterioAlocacao.SegundaRodada,
            criterioOriginal: '',
            fonte,
          },
        ],
        bolsistas: [
          {
            id: 'PROV-test',
            cpf: null,
            cpfProvisorio: true,
            nome: 'Bolsista sintético',
            ibge: '123456',
            seisDigitos: '000000',
            origem: OrigemBolsista.Ciclo45,
            origemOriginal: '',
            fonte,
          },
        ],
        vinculos: [
          {
            id: 'v1',
            tutorId: 'CPF-00000000001',
            bolsistaId: 'PROV-test',
            kmPlanilha: null,
            origem: OrigemBolsista.Ciclo45,
            origemOriginal: '',
            criterio: CriterioAlocacao.SegundaRodada,
            criterioOriginal: '',
            fonte,
          },
        ],
        alertas: [],
        contagens: [],
      },
      relatorio: {
        arquivo: 'teste.xlsx',
        estado: 'sucesso',
        abas: [
          {
            nome: 'Nominal',
            tipo: 'nominal',
            cabecalho: 1,
            linhasLidas: 1,
            linhasAceitas: 1,
            linhasRejeitadas: 0,
          },
        ],
        totais: {
          tutores: 1,
          bolsistas: 1,
          vinculos: 1,
          tutoresSemBolsista: 0,
          cpfsProvisorios: 1,
          cnesAusentes: 1,
        },
        ocorrencias: [],
        divergencias: [],
      },
    };
    const output = adaptarImportacao(result, 'lote1');
    expect(output.report.relationships?.[0]?.tutorId).toBe(output.report.participants[0]?.id);
    expect(output.report.relationships?.[0]?.fellowId).toBe(output.report.participants[1]?.id);
    expect(output.report.relationships?.[0]?.reportedKm).toBeNull();
    expect(output.report.participants[1]?.identityUnverified).toBe(true);
    expect(output.report.participants.every((person) => person.location === null)).toBe(true);
    expect(JSON.stringify(output)).not.toContain('00000000001');
  });
});
