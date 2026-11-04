import { ImportBatch, ImportReport, Participant } from '../domain/models';
import { ResultadoImportacao } from './import-contracts';

export function adaptarImportacao(resultado: ResultadoImportacao, loteId: string): ImportBatch {
  const { dados, relatorio } = resultado;
  const participantes: Participant[] = [
    ...dados.tutores.map((tutor): Participant => ({
      id: `${loteId}:tutor:${tutor.id}`,
      type: 'tutor',
      name: tutor.nome,
      city: tutor.municipio,
      state: null,
      address: null,
      postalCode: null,
      location: null,
      sourceRow: tutor.fonte.linha,
      identityUnverified: tutor.cpfProvisorio,
    })),
    ...dados.bolsistas.map((bolsista): Participant => ({
      id: `${loteId}:bolsista:${bolsista.id}`,
      type: 'fellow',
      name: bolsista.nome,
      city: null,
      state: null,
      address: null,
      postalCode: null,
      location: null,
      sourceRow: bolsista.fonte.linha,
      identityUnverified: bolsista.cpfProvisorio,
    })),
  ];
  // IDs de identidade permanecem privados na importação; a apresentação recebe chaves opacas.
  const opaqueIds = new Map(
    participantes.map((participant, index) => [participant.id, `${loteId}:p${index + 1}`]),
  );
  const opaqueId = (id: string): string => {
    const mapped = opaqueIds.get(id);
    if (!mapped)
      throw new Error('Vínculo inconsistente: participante não encontrado na importação.');
    return mapped;
  };
  const report: ImportReport = {
    totalRows: relatorio.abas
      .filter((aba) => aba.tipo === 'nominal')
      .reduce((total, aba) => total + aba.linhasLidas, 0),
    participants: participantes.map((participant) => ({
      ...participant,
      id: opaqueId(participant.id),
    })),
    issues: relatorio.ocorrencias.map((issue) => ({
      rowNumber: issue.linha > 0 ? issue.linha : null,
      severity: issue.severidade === 'erro' ? 'error' : 'warning',
      code: issue.codigo,
      message: `${issue.aba}${issue.coluna ? ' · ' + issue.coluna : ''}: ${issue.mensagem}`,
    })),
    invalidRows: [
      ...new Set(
        relatorio.ocorrencias
          .filter(
            (issue) =>
              issue.severidade === 'erro' &&
              relatorio.abas.some((aba) => aba.tipo === 'nominal' && aba.nome === issue.aba),
          )
          .map((issue) => issue.linha)
          .filter((linha) => linha > 0),
      ),
    ],
    participantsWithoutCoordinates: participantes.length,
    participantsWithProvisionalIdentity: relatorio.totais.cpfsProvisorios,
    relationships: dados.vinculos.map((vinculo) => ({
      tutorId: opaqueId(`${loteId}:tutor:${vinculo.tutorId}`),
      fellowId: opaqueId(`${loteId}:bolsista:${vinculo.bolsistaId}`),
      reportedKm: vinculo.kmPlanilha,
      sourceRow: vinculo.fonte.linha,
      sheetName: vinculo.fonte.aba,
      fileName: relatorio.arquivo,
    })),
  };
  return {
    fileName: relatorio.arquivo,
    sheetName: relatorio.abas
      .filter((aba) => aba.tipo === 'nominal')
      .map((aba) => aba.nome)
      .join(', '),
    participantType: null,
    report,
  };
}
