import {
  AbaDetectada,
  AlertaTutor,
  CampoImportacao,
  ContagemTutor,
  DadosImportados,
  DocumentoCru,
  DivergenciaImportacao,
  FonteImportacao,
  IdentidadeImportada,
  LinhaCruaAlerta,
  LinhaCruaBase,
  LinhaCruaContagem,
  LinhaCruaNominal,
  OcorrenciaImportacao,
  RelatorioImportacao,
  ResultadoImportacao,
  TipoAba,
  Tutor,
  Bolsista,
  Vinculo,
} from './import-contracts';
import {
  criarIdentidade,
  cpfAjustado,
  extrairCpfMascarado,
  normalizarCpf,
  normalizarIbge,
  normalizarTexto,
} from './import-normalizers';
import { interpretarMotivo, mapearCriterio, mapearOrigem } from './import-rules';

type Colunas = Partial<Record<CampoImportacao, number>>;
type ColunasFonte = Partial<Record<CampoImportacao, string>>;
type LinhaNominalMapeada = LinhaCruaNominal & { colunasFonte: ColunasFonte };
type LinhaContagemMapeada = LinhaCruaContagem & { colunasFonte: ColunasFonte };
type LinhaBaseMapeada = LinhaCruaBase & { colunasFonte: ColunasFonte };
type LinhaAlertaMapeada = LinhaCruaAlerta & { colunasFonte: ColunasFonte };

interface PlanilhaContagem {
  resumo: RelatorioImportacao['abas'][number];
  linhasNominais: LinhaNominalMapeada[];
  linhasContagem: LinhaContagemMapeada[];
  linhasBase: LinhaBaseMapeada[];
  linhasAlerta: LinhaAlertaMapeada[];
  cabecalhoValido: boolean;
}

interface RegistroBase extends LinhaCruaBase {
  cpfNormalizado: string | null;
  ibgeNormalizado: string;
  seisDigitos: string;
  nomeNormalizado: string;
}

interface RegistroPessoa<T> {
  identidade: IdentidadeImportada;
  registro: T;
}

const OPCIONAIS: TipoAba[] = ['contagem', 'base-bolsistas', 'alerta-50km', 'alerta-rodada2'];

const VALORES_VAZIOS: unknown[] = [null, undefined, ''];

/**
 * Converte as abas classificadas em dados de domínio. As coordenadas e outros
 * valores originais permanecem no documento de entrada; este mapper só cria
 * a representação normalizada e referências às fontes físicas.
 */
export function mapearWorkbook(documento: DocumentoCru, abas: AbaDetectada[]): ResultadoImportacao {
  const ocorrencias: OcorrenciaImportacao[] = [];
  const divergencias: DivergenciaImportacao[] = [];
  const planilhas: PlanilhaContagem[] = [];
  const classificadas = new Map(abas.map((aba) => [aba.aba.name, aba]));
  const resumoPorNome = new Map<string, PlanilhaContagem>();

  for (const abaCrua of documento.sheets) {
    const detectada = classificadas.get(abaCrua.name);
    const tipo = detectada?.tipo ?? 'ignorada';
    const cabecalho = detectada && detectada.tipo !== 'ignorada' ? detectada.cabecalho + 1 : null;
    const resumo: RelatorioImportacao['abas'][number] = {
      nome: abaCrua.name,
      tipo,
      cabecalho,
      linhasLidas: 0,
      linhasAceitas: 0,
      linhasRejeitadas: 0,
    };
    const planilha: PlanilhaContagem = {
      resumo,
      linhasNominais: [],
      linhasContagem: [],
      linhasBase: [],
      linhasAlerta: [],
      cabecalhoValido: true,
    };
    planilhas.push(planilha);
    resumoPorNome.set(abaCrua.name, planilha);

    if (!detectada) continue;
    ocorrencias.push(...detectada.ocorrencias.map((ocorrencia) => ({ ...ocorrencia })));
    if (tipo === 'ignorada') continue;

    const linhas = linhasDeDados(abaCrua.rows, detectada.cabecalho);
    resumo.linhasLidas = linhas.length;
    const colunas = mapearColunasAba(detectada);
    const classifierHeaderValido = !detectada.ocorrencias.some(
      ({ severidade }) => severidade === 'erro',
    );
    if (tipo === 'nominal') {
      planilha.cabecalhoValido =
        validarCabecalhoNominal(detectada, colunas, ocorrencias) && classifierHeaderValido;
    } else {
      planilha.cabecalhoValido =
        validarCabecalhoOpcional(detectada, colunas, ocorrencias) && classifierHeaderValido;
    }

    for (const { row, index } of linhas) {
      const fonte = fonteDaLinha(
        abaCrua.name,
        index + 1,
        letraColuna(colunas.nomeTutor ?? colunas.nome),
      );
      if (tipo === 'nominal') {
        planilha.linhasNominais.push(criarLinhaNominal(row, colunas, fonte));
      } else if (tipo === 'contagem') {
        planilha.linhasContagem.push(criarLinhaContagem(row, colunas, fonte));
      } else if (tipo === 'base-bolsistas') {
        planilha.linhasBase.push(criarLinhaBase(row, colunas, fonte));
      } else if (tipo === 'alerta-50km' || tipo === 'alerta-rodada2') {
        planilha.linhasAlerta.push(criarLinhaAlerta(row, colunas, fonte));
      }
    }
  }

  const presentes = new Set(planilhas.map(({ resumo }) => resumo.tipo));
  if (!presentes.has('nominal')) {
    ocorrencias.push(
      ocorrencia(
        'erro',
        'aba_nominal_ausente',
        'A planilha não contém uma aba nominal classificada; não há dados de vínculos para importar.',
        fonteDaLinha(documento.sheets[0]?.name ?? '', 1, null),
      ),
    );
  }
  for (const tipo of OPCIONAIS) {
    if (!presentes.has(tipo)) {
      ocorrencias.push(
        ocorrencia(
          'aviso',
          'aba_opcional_ausente',
          `Aba opcional "${tipo}" não encontrada; a importação continuará sem esses dados.`,
          fonteDaLinha(documento.sheets[0]?.name ?? '', 1, null),
        ),
      );
    }
  }

  const dados: DadosImportados = {
    tutores: [],
    bolsistas: [],
    vinculos: [],
    alertas: [],
    contagens: [],
  };
  const tutoresPorIdentidade = new Map<string, RegistroPessoa<Tutor>>();
  const bolsistasPorIdentidade = new Map<string, RegistroPessoa<Bolsista>>();
  const tutoresPorId = new Map<string, Tutor>();
  const bolsistasPorId = new Map<string, Bolsista>();
  const base = lerBase(planilhas, ocorrencias, divergencias);
  const linhasNominais = planilhas.flatMap(({ linhasNominais }) => linhasNominais);

  for (const linha of linhasNominais) {
    const planilha = resumoPorNome.get(linha.fonte.aba);
    if (planilha && !planilha.cabecalhoValido) {
      planilha.resumo.linhasRejeitadas += 1;
      continue;
    }
    const ocorrenciasAntes = ocorrencias.length;
    const resultado = importarLinhaNominal(
      linha,
      base,
      tutoresPorIdentidade,
      bolsistasPorIdentidade,
      tutoresPorId,
      bolsistasPorId,
      dados,
      ocorrencias,
      divergencias,
    );
    if (planilha) {
      const linhaComErro = ocorrencias
        .slice(ocorrenciasAntes)
        .some(({ severidade }) => severidade === 'erro');
      if (resultado.tutorAceito && !linhaComErro) planilha.resumo.linhasAceitas += 1;
      else planilha.resumo.linhasRejeitadas += 1;
    }
  }

  for (const linha of planilhas.flatMap(({ linhasContagem }) => linhasContagem)) {
    const planilha = resumoPorNome.get(linha.fonte.aba);
    if (planilha && !planilha.cabecalhoValido) {
      planilha.resumo.linhasRejeitadas += 1;
      continue;
    }
    const contagem = importarContagem(linha, tutoresPorId, ocorrencias);
    if (contagem) {
      dados.contagens.push(contagem);
      planilha && (planilha.resumo.linhasAceitas += 1);
    } else {
      planilha && (planilha.resumo.linhasRejeitadas += 1);
    }
  }

  reconciliarContagens(dados, tutoresPorId, divergencias, ocorrencias);

  for (const planilha of planilhas) {
    for (const linha of planilha.linhasAlerta) {
      if (!planilha.cabecalhoValido) {
        planilha.resumo.linhasRejeitadas += 1;
        continue;
      }
      const alerta = importarAlerta(
        linha,
        planilha.resumo.tipo,
        base,
        tutoresPorId,
        tutoresPorIdentidade,
        ocorrencias,
        divergencias,
      );
      if (alerta) {
        dados.alertas.push(alerta);
        const linhaComErro = ocorrencias.some(
          ({ severidade, aba, linha: linhaOcorrencia }) =>
            severidade === 'erro' &&
            aba === linha.fonte.aba &&
            linhaOcorrencia === linha.fonte.linha,
        );
        if (linhaComErro) planilha.resumo.linhasRejeitadas += 1;
        else planilha.resumo.linhasAceitas += 1;
      } else {
        planilha.resumo.linhasRejeitadas += 1;
      }
    }
  }

  for (const tutor of dados.tutores) {
    if (tutor.bolsistas.length === 0) {
      dados.alertas.push({
        tutorId: tutor.id,
        nome: tutor.nome,
        ibge: tutor.ibge,
        tipo: 'sem-bolsista',
        quantidadeBolsistas: 0,
        motivo: 'Tutor sem vínculo nominal importado.',
        fonte: { ...tutor.fonte },
      });
    }
  }

  const totais = {
    tutores: dados.tutores.length,
    bolsistas: dados.bolsistas.length,
    vinculos: dados.vinculos.length,
    tutoresSemBolsista: dados.tutores.filter((tutor) => tutor.bolsistas.length === 0).length,
    cpfsProvisorios:
      dados.tutores.filter((tutor) => tutor.cpfProvisorio).length +
      dados.bolsistas.filter((bolsista) => bolsista.cpfProvisorio).length,
    cnesAusentes: dados.tutores.filter((tutor) => tutor.cnes === null).length,
  };
  const hasErrors = ocorrencias.some(({ severidade }) => severidade === 'erro');
  const hasWarnings = ocorrencias.some(({ severidade }) => severidade === 'aviso');
  const nominalPresente = planilhas.some(
    (planilha) => planilha.resumo.tipo === 'nominal' && planilha.cabecalhoValido,
  );
  const hasImportedData =
    dados.tutores.length > 0 || dados.bolsistas.length > 0 || dados.contagens.length > 0;
  const estado: RelatorioImportacao['estado'] =
    !nominalPresente || !hasImportedData
      ? 'erro'
      : hasErrors
        ? 'parcial'
        : hasWarnings
          ? 'parcial'
          : 'sucesso';

  return {
    dados,
    relatorio: {
      arquivo: documento.fileName,
      estado,
      abas: planilhas.map(({ resumo }) => resumo),
      totais,
      ocorrencias,
      divergencias,
    },
  };
}

function linhasDeDados(
  rows: unknown[][],
  headerIndex: number,
): Array<{ row: unknown[]; index: number }> {
  if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= rows.length) return [];
  const resultado: Array<{ row: unknown[]; index: number }> = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (!row.every(valorVazio)) resultado.push({ row, index });
  }
  return resultado;
}

function mapearColunasAba(aba: AbaDetectada): Colunas {
  const colunas: Colunas = { ...aba.colunas };
  if (aba.tipo !== 'nominal' || colunas.ibgeBolsista !== undefined) return colunas;
  const cabecalho = aba.aba.rows[aba.cabecalho] ?? [];
  const genericas = cabecalho.flatMap((valor, index) =>
    normalizarCabecalhoLocal(valor) === 'ibge' ? [index] : [],
  );
  if (genericas.length === 1) colunas.ibgeBolsista = genericas[0];
  return colunas;
}

function normalizarCabecalhoLocal(value: unknown): string {
  return texto(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function criarLinhaNominal(
  row: unknown[],
  colunas: Colunas,
  fonte: FonteImportacao,
): LinhaNominalMapeada {
  return {
    nomeTutor: valor(row, colunas.nomeTutor),
    cpfTutor: valor(row, colunas.cpfTutor),
    ibgeTutor: valor(row, colunas.ibgeTutor),
    cnesTutor: valor(row, colunas.cnesTutor),
    pcsTutor: valor(row, colunas.pcsTutor),
    municipioTutor: valor(row, colunas.municipioTutor),
    nomeBolsista: valor(row, colunas.nomeBolsista),
    cpfBolsista: valor(row, colunas.cpfBolsista),
    ibgeBolsista: valor(row, colunas.ibgeBolsista),
    km: valor(row, colunas.km),
    regra: valor(row, colunas.regra),
    regraAgregacao: valor(row, colunas.regraAgregacao),
    fonte,
    colunasFonte: mapearColunasFonte(colunas),
  };
}

function criarLinhaContagem(
  row: unknown[],
  colunas: Colunas,
  fonte: FonteImportacao,
): LinhaContagemMapeada {
  return {
    nomeTutor: valor(row, colunas.nomeTutor),
    ibgeTutor: valor(row, colunas.ibgeTutor),
    municipioTutor: valor(row, colunas.municipioTutor),
    quantidadeBolsistas: valor(row, colunas.quantidadeBolsistas),
    regraAgregacao: valor(row, colunas.regraAgregacao),
    fonte,
    colunasFonte: mapearColunasFonte(colunas),
  };
}

function criarLinhaBase(
  row: unknown[],
  colunas: Colunas,
  fonte: FonteImportacao,
): LinhaBaseMapeada {
  return {
    nome: valor(row, colunas.nome),
    cpf: valor(row, colunas.cpf),
    ibge: valor(row, colunas.ibge),
    cpfAjustado: valor(row, colunas.cpfAjustado),
    fonte,
    colunasFonte: mapearColunasFonte(colunas),
  };
}

function criarLinhaAlerta(
  row: unknown[],
  colunas: Colunas,
  fonte: FonteImportacao,
): LinhaAlertaMapeada {
  return {
    nome: valor(row, colunas.nome ?? colunas.nomeTutor),
    cpf: valor(row, colunas.cpf ?? colunas.cpfTutor),
    ibge: valor(row, colunas.ibge ?? colunas.ibgeTutor),
    municipio: valor(row, colunas.municipio ?? colunas.municipioTutor),
    motivo: valor(row, colunas.motivo),
    quantidadeBolsistas: valor(row, colunas.quantidadeBolsistas),
    fonte,
    colunasFonte: mapearColunasFonte(colunas),
  };
}

function validarCabecalhoNominal(
  aba: AbaDetectada,
  colunas: Colunas,
  ocorrencias: OcorrenciaImportacao[],
): boolean {
  const required: CampoImportacao[] = ['nomeTutor', 'nomeBolsista'];
  const missing = required.filter((campo) => coluna(colunas, campo) === null);
  if (coluna(colunas, 'cpfTutor') === null && coluna(colunas, 'ibgeTutor') === null) {
    missing.push('cpfTutor');
  }
  if (coluna(colunas, 'cpfBolsista') === null && coluna(colunas, 'ibgeBolsista') === null) {
    missing.push('cpfBolsista');
  }
  if (missing.length) {
    ocorrencias.push(
      ocorrencia(
        'erro',
        'cabecalho_nominal_invalido',
        `Aba nominal "${aba.aba.name}" sem mapeamento obrigatório: ${missing.join(', ')}.`,
        fonteDaLinha(aba.aba.name, aba.cabecalho + 1, null),
      ),
    );
  }
  if (coluna(colunas, 'ibgeTutor') === null || coluna(colunas, 'ibgeBolsista') === null) {
    ocorrencias.push(
      ocorrencia(
        'aviso',
        'ibge_nominal_ausente',
        'A aba nominal usa cabeçalho legado sem uma ou mais colunas IBGE; os valores ausentes serão mantidos como string vazia.',
        fonteDaLinha(aba.aba.name, aba.cabecalho + 1, null),
      ),
    );
  }
  return missing.length === 0;
}

function validarCabecalhoOpcional(
  aba: AbaDetectada,
  colunas: Colunas,
  ocorrencias: OcorrenciaImportacao[],
): boolean {
  const tipo = aba.tipo as Exclude<TipoAba, 'ignorada'>;
  const required: CampoImportacao[] =
    tipo === 'base-bolsistas'
      ? ['nome', 'cpf', 'ibge']
      : tipo === 'contagem'
        ? ['nomeTutor', 'ibgeTutor', 'quantidadeBolsistas']
        : tipo === 'alerta-50km'
          ? ['nome', 'ibge', 'motivo']
          : ['nomeTutor', 'ibgeTutor', 'quantidadeBolsistas'];
  const missing = required.filter((campo) => coluna(colunas, campo) === null);
  if (missing.length) {
    ocorrencias.push(
      ocorrencia(
        'erro',
        'cabecalho_aba_invalido',
        `Aba "${aba.aba.name}" (${tipo}) sem mapeamento obrigatório: ${missing.join(', ')}.`,
        fonteDaLinha(aba.aba.name, aba.cabecalho + 1, null),
      ),
    );
  }
  return missing.length === 0;
}

function lerBase(
  planilhas: PlanilhaContagem[],
  ocorrencias: OcorrenciaImportacao[],
  divergencias: DivergenciaImportacao[],
): RegistroBase[] {
  const resultado: RegistroBase[] = [];
  const identidadesBase = new Set<string>();
  for (const planilha of planilhas) {
    if (planilha.resumo.tipo !== 'base-bolsistas') continue;
    if (!planilha.cabecalhoValido) {
      planilha.resumo.linhasRejeitadas += planilha.linhasBase.length;
      continue;
    }
    for (const linha of planilha.linhasBase) {
      const nome = normalizarTexto(linha.nome);
      const cpf = normalizarCpf(linha.cpf);
      const meio6Mascarado = extrairCpfMascarado(linha.cpf);
      const ibge = normalizarIbge(linha.ibge);
      const ibgeOriginal = texto(linha.ibge);
      const invalidFields: string[] = [];
      if (!nome) invalidFields.push('nome');
      if (!cpf && !meio6Mascarado) invalidFields.push('cpf');
      if (ibgeOriginal && !ibge) invalidFields.push('ibge');
      if (invalidFields.length > 0) {
        const campoInvalido = !nome
          ? linha.colunasFonte.nome
          : !cpf && !meio6Mascarado
            ? linha.colunasFonte.cpf
            : linha.colunasFonte.ibge;
        reportarInvalidos(
          ocorrencias,
          linha.fonte,
          'linha_base_invalida',
          `Registro da base de bolsistas rejeitado: ${invalidFields.join(', ')} ausente ou inválido.`,
          undefined,
          campoInvalido ?? null,
        );
        planilha.resumo.linhasRejeitadas += 1;
        continue;
      }
      if (!ibge) {
        ocorrencias.push(
          ocorrencia(
            'aviso',
            'base_ibge_ausente',
            'Registro da base mantido sem IBGE; não será usado para conciliação geográfica.',
            fonteDaLinha(linha.fonte.aba, linha.fonte.linha, linha.colunasFonte.ibge ?? null),
          ),
        );
      }
      const seisDigitos = cpf ? cpfAjustado(cpf) : meio6Mascarado;
      if (!seisDigitos) {
        reportarInvalidos(
          ocorrencias,
          linha.fonte,
          'linha_base_invalida',
          'Registro da base rejeitado: não foi possível extrair os seis dígitos de conciliação.',
          undefined,
          linha.colunasFonte.cpf ?? null,
        );
        planilha.resumo.linhasRejeitadas += 1;
        continue;
      }
      const esperado = seisDigitos;
      const ajustadoInformado = texto(linha.cpfAjustado);
      const ajustadoNormalizado = ajustadoInformado ? normalizarIbge(linha.cpfAjustado) : null;
      if (ajustadoInformado && ajustadoNormalizado !== esperado) {
        divergencias.push({
          ...fonteDaLinha(
            linha.fonte.aba,
            linha.fonte.linha,
            linha.colunasFonte.cpfAjustado ?? linha.colunasFonte.cpf ?? null,
          ),
          codigo: 'cpf_ajustado_divergente',
          mensagem: 'O campo de CPF ajustado diverge do valor calculado a partir do CPF validado.',
          esperado: protegerValorRelatorio(esperado),
          encontrado: protegerValorRelatorio(ajustadoNormalizado ?? ajustadoInformado),
        });
      }
      const registroBase: RegistroBase = {
        ...linha,
        cpfNormalizado: cpf,
        ibgeNormalizado: ibge ?? '',
        seisDigitos,
        nomeNormalizado: nome,
      };
      const chaveIdentidade = JSON.stringify([cpf ?? `MASK-${meio6Mascarado}`, ibge ?? '', nome]);
      if (identidadesBase.has(chaveIdentidade)) {
        ocorrencias.push(
          ocorrencia(
            'aviso',
            'base_registro_duplicado',
            'Registro idêntico já consta na base; mantida uma única identidade candidata.',
            fonteDaLinha(linha.fonte.aba, linha.fonte.linha, linha.colunasFonte.cpf ?? null),
          ),
        );
      } else {
        identidadesBase.add(chaveIdentidade);
        resultado.push(registroBase);
      }
      if (!cpf) {
        ocorrencias.push(
          ocorrencia(
            'aviso',
            'base_cpf_mascarado',
            'CPF da base mascarado; registro mantido apenas como candidato provisório, sem reconstruir o CPF completo.',
            fonteDaLinha(linha.fonte.aba, linha.fonte.linha, linha.colunasFonte.cpf ?? null),
          ),
        );
      }
      planilha.resumo.linhasAceitas += 1;
    }
  }
  return resultado;
}

function importarLinhaNominal(
  linha: LinhaNominalMapeada,
  base: RegistroBase[],
  tutoresPorIdentidade: Map<string, RegistroPessoa<Tutor>>,
  bolsistasPorIdentidade: Map<string, RegistroPessoa<Bolsista>>,
  tutoresPorId: Map<string, Tutor>,
  bolsistasPorId: Map<string, Bolsista>,
  dados: DadosImportados,
  ocorrencias: OcorrenciaImportacao[],
  divergencias: DivergenciaImportacao[],
): { tutorAceito: boolean } {
  const nomeTutor = texto(linha.nomeTutor);
  const ibgeTutor = normalizarIbge(linha.ibgeTutor) ?? '';
  const tutorIdentidade = resolverIdentidade(
    linha.cpfTutor,
    linha.ibgeTutor,
    nomeTutor,
    base,
    linha.fonte,
    linha.colunasFonte.cpfTutor ?? null,
    linha.colunasFonte.ibgeTutor ?? null,
    ocorrencias,
  );
  if (!nomeTutor || !tutorIdentidade) {
    reportarInvalidos(
      ocorrencias,
      linha.fonte,
      'invalid_relationship_identity',
      !nomeTutor
        ? 'Tutor rejeitado: nome ausente.'
        : 'Tutor rejeitado: CPF/identidade inválida ou não identificável.',
      undefined,
      !nomeTutor ? (linha.colunasFonte.nomeTutor ?? null) : (linha.colunasFonte.cpfTutor ?? null),
    );
    return { tutorAceito: false };
  }

  const origemInfo = mapearOrigem(linha.regra);
  const criterioInfo = mapearCriterio(linha.regraAgregacao);
  const tutorId = `tutor-${tutorIdentidade.id}`;
  let tutorEntry = tutoresPorIdentidade.get(tutorIdentidade.id);
  if (!tutorEntry) {
    const tutor: Tutor = {
      id: tutorId,
      cpf: tutorIdentidade.cpf,
      cpfProvisorio: tutorIdentidade.cpfProvisorio,
      nome: nomeTutor,
      ibge: ibgeTutor,
      municipio: textoOuNull(linha.municipioTutor),
      cnes: normalizarIdentificador(linha.cnesTutor),
      pcs: textoOuNull(linha.pcsTutor),
      bolsistas: [],
      criterio: criterioInfo.valor,
      criterioOriginal: criterioInfo.original,
      fonte: { ...linha.fonte },
    };
    tutorEntry = { identidade: tutorIdentidade, registro: tutor };
    tutoresPorIdentidade.set(tutorIdentidade.id, tutorEntry);
    tutoresPorId.set(tutor.id, tutor);
    dados.tutores.push(tutor);
  } else {
    reportarDivergenciasPessoa(
      'tutor',
      tutorEntry.registro.nome,
      nomeTutor,
      tutorEntry.registro.ibge,
      ibgeTutor,
      tutorEntry.registro.cnes,
      normalizarIdentificador(linha.cnesTutor),
      linha.fonte,
      ocorrencias,
      divergencias,
      linha.colunasFonte,
    );
  }

  if (tutorIdentidade.cpfProvisorio) {
    avisarProvisorio(ocorrencias, linha.fonte, 'cpfTutor', linha.colunasFonte.cpfTutor ?? null);
  }
  if (origemInfo.desconhecida && origemInfo.original.trim()) {
    ocorrencias.push(
      ocorrencia(
        'aviso',
        'regra_origem_desconhecida',
        `Regra de origem não reconhecida; preservado como RegraDesconhecida (${textoSeguroRelatorio(origemInfo.original)}).`,
        fonteDaLinha(linha.fonte.aba, linha.fonte.linha, colunaDaFonte(linha, 'regra')),
      ),
    );
  }
  if (criterioInfo.desconhecida && criterioInfo.original.trim()) {
    ocorrencias.push(
      ocorrencia(
        'aviso',
        'criterio_desconhecido',
        `Critério de alocação não reconhecido; preservado como RegraDesconhecida (${textoSeguroRelatorio(criterioInfo.original)}).`,
        fonteDaLinha(linha.fonte.aba, linha.fonte.linha, colunaDaFonte(linha, 'regraAgregacao')),
      ),
    );
  }

  const camposBolsistaVazios = [
    linha.nomeBolsista,
    linha.cpfBolsista,
    linha.km,
    linha.ibgeBolsista,
    linha.regra,
  ].every(valorVazio);
  if (camposBolsistaVazios) return { tutorAceito: true };

  const nomeBolsista = texto(linha.nomeBolsista);
  const ibgeBolsista = normalizarIbge(linha.ibgeBolsista) ?? '';
  const bolsistaIdentidade = resolverIdentidade(
    linha.cpfBolsista,
    linha.ibgeBolsista,
    nomeBolsista,
    base,
    linha.fonte,
    linha.colunasFonte.cpfBolsista ?? null,
    linha.colunasFonte.ibgeBolsista ?? null,
    ocorrencias,
  );
  if (!nomeBolsista || !bolsistaIdentidade) {
    reportarInvalidos(
      ocorrencias,
      linha.fonte,
      'invalid_relationship_identity',
      !nomeBolsista
        ? 'Vínculo rejeitado: nome do bolsista ausente; tutor válido foi preservado.'
        : 'Vínculo rejeitado: CPF/identidade do bolsista inválida; tutor válido foi preservado.',
      undefined,
      !nomeBolsista
        ? (linha.colunasFonte.nomeBolsista ?? null)
        : (linha.colunasFonte.cpfBolsista ?? null),
    );
    return { tutorAceito: true };
  }
  const bolsistaId = `bolsista-${bolsistaIdentidade.id}`;
  let bolsistaEntry = bolsistasPorIdentidade.get(bolsistaIdentidade.id);
  if (!bolsistaEntry) {
    const bolsista: Bolsista = {
      id: bolsistaId,
      cpf: bolsistaIdentidade.cpf,
      cpfProvisorio: bolsistaIdentidade.cpfProvisorio,
      nome: nomeBolsista,
      ibge: ibgeBolsista,
      seisDigitos: bolsistaIdentidade.seisDigitos,
      origem: origemInfo.valor,
      origemOriginal: origemInfo.original,
      fonte: { ...linha.fonte },
    };
    bolsistaEntry = { identidade: bolsistaIdentidade, registro: bolsista };
    bolsistasPorIdentidade.set(bolsistaIdentidade.id, bolsistaEntry);
    bolsistasPorId.set(bolsista.id, bolsista);
    dados.bolsistas.push(bolsista);
  } else {
    reportarDivergenciasPessoa(
      'bolsista',
      bolsistaEntry.registro.nome,
      nomeBolsista,
      bolsistaEntry.registro.ibge,
      ibgeBolsista,
      null,
      null,
      linha.fonte,
      ocorrencias,
      divergencias,
      linha.colunasFonte,
    );
  }
  if (bolsistaIdentidade.cpfProvisorio) {
    avisarProvisorio(
      ocorrencias,
      linha.fonte,
      'cpfBolsista',
      linha.colunasFonte.cpfBolsista ?? null,
    );
  }

  const tutor = tutorEntry.registro;
  const bolsista = bolsistaEntry.registro;
  if (!tutor.bolsistas.includes(bolsista.id)) tutor.bolsistas.push(bolsista.id);
  else {
    ocorrencias.push(
      ocorrencia(
        'aviso',
        'duplicate_relationship',
        'Vínculo tutor–bolsista repetido: a linha foi preservada, mas a lista de bolsistas do tutor mantém IDs únicos.',
        fonteDaLinha(linha.fonte.aba, linha.fonte.linha, colunaDaFonte(linha, 'nomeBolsista')),
      ),
    );
  }
  const km = lerKm(linha.km);
  if (km.invalido) {
    reportarInvalidos(
      ocorrencias,
      linha.fonte,
      'invalid_reported_km',
      'KM inválido; vínculo preservado sem distância.',
      undefined,
      linha.colunasFonte.km ?? null,
    );
  }
  const vinculo: Vinculo = {
    id: `vinculo-${dados.vinculos.length + 1}`,
    tutorId: tutor.id,
    bolsistaId: bolsista.id,
    kmPlanilha: km.valor,
    origem: origemInfo.valor,
    origemOriginal: origemInfo.original,
    criterio: criterioInfo.valor,
    criterioOriginal: criterioInfo.original,
    fonte: { ...linha.fonte, coluna: colunaDaFonte(linha, 'nomeBolsista') },
  };
  dados.vinculos.push(vinculo);
  return { tutorAceito: true };
}

function resolverIdentidade(
  cpfOriginal: unknown,
  ibgeOriginal: unknown,
  nome: string,
  base: RegistroBase[],
  fonte: FonteImportacao,
  colunaCpf: string | null,
  colunaIbge: string | null,
  ocorrencias: OcorrenciaImportacao[],
): IdentidadeImportada | null {
  const cpfTexto = texto(cpfOriginal);
  const ibge = normalizarIbge(ibgeOriginal);
  const cpf = normalizarCpf(cpfOriginal);
  if (cpfTexto && !cpf && !extrairCpfMascarado(cpfOriginal)) {
    reportarInvalidos(
      ocorrencias,
      fonte,
      'cpf_invalido',
      'CPF ausente ou inválido; valor não foi incluído no relatório.',
      undefined,
      colunaCpf,
    );
  }
  const ibgeTexto = texto(ibgeOriginal);
  if (ibgeTexto && !ibge) {
    reportarInvalidos(
      ocorrencias,
      fonte,
      'ibge_invalido',
      'Código IBGE inválido.',
      undefined,
      colunaIbge,
    );
    return null;
  }
  if (cpf) {
    return criarIdentidade(cpf, ibge ?? '', nome);
  }
  const meio6 = extrairCpfMascarado(cpfOriginal);
  if (meio6 && ibge && nome) {
    const candidatos = base.filter(
      (registro) => registro.ibgeNormalizado === ibge && registro.seisDigitos === meio6,
    );
    if (candidatos.length === 1) {
      const candidato = candidatos[0];
      if (candidato && candidato.nomeNormalizado === normalizarTexto(nome)) {
        return candidato.cpfNormalizado
          ? criarIdentidade(candidato.cpfNormalizado, candidato.ibgeNormalizado, nome)
          : criarIdentidade(cpfOriginal, candidato.ibgeNormalizado, nome);
      }
      ocorrencias.push(
        ocorrencia(
          'aviso',
          'base_mascarada_nome_divergente',
          'CPF mascarado não conciliado: o nome normalizado diverge do único registro candidato da base.',
          fonteDaLinha(fonte.aba, fonte.linha, colunaCpf),
        ),
      );
    } else if (candidatos.length > 1) {
      ocorrencias.push(
        ocorrencia(
          'aviso',
          'base_mascarada_colisao',
          'CPF mascarado não conciliado: há mais de um registro candidato para IBGE e seis dígitos; mantida identidade provisória.',
          fonteDaLinha(fonte.aba, fonte.linha, colunaCpf),
        ),
      );
    }
  }
  if (!nome) return null;
  if (meio6 && !ibge) {
    ocorrencias.push(
      ocorrencia(
        'aviso',
        'ibge_ausente',
        'Identidade mascarada mantida como provisória sem IBGE e sem conciliação com a base.',
        fonteDaLinha(fonte.aba, fonte.linha, colunaIbge),
      ),
    );
  }
  return criarIdentidade(cpfOriginal, ibge ?? '', nome);
}

function importarContagem(
  linha: LinhaContagemMapeada,
  tutoresPorId: Map<string, Tutor>,
  ocorrencias: OcorrenciaImportacao[],
): ContagemTutor | null {
  const nome = texto(linha.nomeTutor);
  const ibge = normalizarIbge(linha.ibgeTutor);
  const quantidade = inteiroNaoNegativo(linha.quantidadeBolsistas);
  if (!nome || !ibge || quantidade === null) {
    reportarInvalidos(
      ocorrencias,
      linha.fonte,
      'contagem_invalida',
      'Contagem rejeitada: nome, IBGE ou quantidade ausente/inválida.',
      undefined,
      linha.colunasFonte.quantidadeBolsistas ?? null,
    );
    return null;
  }
  const correspondencias = [...tutoresPorId.values()].filter(
    (tutor) => normalizarTexto(tutor.nome) === normalizarTexto(nome) && tutor.ibge === ibge,
  );
  if (correspondencias.length > 1) {
    ocorrencias.push(
      ocorrencia(
        'aviso',
        'contagem_tutor_ambiguo',
        'Contagem não associada: nome e IBGE correspondem a mais de um tutor.',
        fonteDaLinha(linha.fonte.aba, linha.fonte.linha, linha.colunasFonte.nomeTutor ?? null),
      ),
    );
  } else if (correspondencias.length === 0) {
    ocorrencias.push(
      ocorrencia(
        'aviso',
        'contagem_sem_referencia',
        'Contagem mantida sem tutor associado: não houve correspondência única por nome normalizado e IBGE.',
        fonteDaLinha(linha.fonte.aba, linha.fonte.linha, linha.colunasFonte.nomeTutor ?? null),
      ),
    );
  }
  const tutorId = correspondencias.length === 1 ? (correspondencias[0]?.id ?? null) : null;
  return {
    tutorId,
    nome,
    ibge,
    quantidadeBolsistas: quantidade,
    fonte: fonteDaLinha(
      linha.fonte.aba,
      linha.fonte.linha,
      linha.colunasFonte.quantidadeBolsistas ?? linha.fonte.coluna,
    ),
  };
}

function reconciliarContagens(
  dados: DadosImportados,
  tutoresPorId: Map<string, Tutor>,
  divergencias: DivergenciaImportacao[],
  ocorrencias: OcorrenciaImportacao[],
): void {
  for (const contagem of dados.contagens) {
    if (!contagem.tutorId) continue;
    const tutor = tutoresPorId.get(contagem.tutorId);
    if (!tutor) continue;
    // A comparação usa vínculos nominais distintos; linhas repetidas são preservadas
    // em `vinculos`, mas não aumentam a contagem de bolsistas do tutor.
    const encontrado = new Set(tutor.bolsistas).size;
    if (encontrado !== contagem.quantidadeBolsistas) {
      divergencias.push({
        ...contagem.fonte,
        codigo: 'contagem_divergente',
        mensagem:
          'A contagem da aba B difere do número de bolsistas distintos nos vínculos nominais (duplicatas excluídas).',
        esperado: contagem.quantidadeBolsistas,
        encontrado,
      });
      ocorrencias.push(
        ocorrencia(
          'aviso',
          'contagem_divergente',
          'A contagem informada diverge dos vínculos nominais distintos.',
          { ...contagem.fonte },
        ),
      );
    }
  }
}

function importarAlerta(
  linha: LinhaAlertaMapeada,
  tipoAba: TipoAba,
  base: RegistroBase[],
  tutoresPorId: Map<string, Tutor>,
  tutoresPorIdentidade: Map<string, RegistroPessoa<Tutor>>,
  ocorrencias: OcorrenciaImportacao[],
  divergencias: DivergenciaImportacao[],
): AlertaTutor | null {
  const nome = texto(linha.nome);
  const ibge = normalizarIbge(linha.ibge) ?? '';
  const cpf = normalizarCpf(linha.cpf);
  if (texto(linha.cpf) && !cpf && !extrairCpfMascarado(linha.cpf)) {
    reportarInvalidos(
      ocorrencias,
      linha.fonte,
      'cpf_invalido',
      'CPF inválido; valor não foi incluído no relatório.',
      undefined,
      linha.colunasFonte.cpf ?? linha.colunasFonte.cpfTutor ?? null,
    );
  }
  if (texto(linha.ibge) && !normalizarIbge(linha.ibge)) {
    reportarInvalidos(
      ocorrencias,
      linha.fonte,
      'ibge_invalido',
      'Código IBGE inválido.',
      undefined,
      linha.colunasFonte.ibge ?? linha.colunasFonte.ibgeTutor ?? null,
    );
  }
  let tutor: Tutor | undefined;
  if (cpf) {
    const matches = [...tutoresPorId.values()].filter((item) => item.cpf === cpf);
    if (matches.length === 1) tutor = matches[0];
    if (matches.length > 1) {
      ocorrencias.push(
        ocorrencia(
          'aviso',
          'alerta_tutor_ambiguo',
          'Alerta não associado: CPF corresponde a mais de um tutor.',
          linha.fonte,
        ),
      );
    }
  } else if (extrairCpfMascarado(linha.cpf)) {
    const identity = resolverIdentidade(
      linha.cpf,
      linha.ibge,
      nome,
      base,
      linha.fonte,
      linha.colunasFonte.cpf ?? linha.colunasFonte.cpfTutor ?? null,
      linha.colunasFonte.ibge ?? linha.colunasFonte.ibgeTutor ?? null,
      ocorrencias,
    );
    if (identity) tutor = tutoresPorIdentidade.get(identity.id)?.registro;
  } else if (nome && ibge) {
    const matches = [...tutoresPorId.values()].filter(
      (item) => normalizarTexto(item.nome) === normalizarTexto(nome) && item.ibge === ibge,
    );
    if (matches.length === 1) tutor = matches[0];
    else if (matches.length > 1) {
      ocorrencias.push(
        ocorrencia(
          'aviso',
          'alerta_tutor_ambiguo',
          'Alerta não associado: nome e IBGE correspondem a mais de um tutor.',
          linha.fonte,
        ),
      );
    }
  }
  if (!nome) {
    reportarInvalidos(
      ocorrencias,
      linha.fonte,
      'alerta_invalido',
      'Alerta rejeitado: nome do tutor ausente.',
      undefined,
      linha.colunasFonte.nome ?? linha.colunasFonte.nomeTutor ?? null,
    );
    return null;
  }
  if (!tutor) {
    ocorrencias.push(
      ocorrencia(
        'aviso',
        'alerta_sem_referencia',
        'Alerta mantido sem associação: tutor não encontrado por CPF ou correspondência única e segura.',
        { ...linha.fonte },
      ),
    );
  } else {
    reportarDivergenciasPessoa(
      'tutor',
      tutor.nome,
      nome,
      tutor.ibge,
      ibge,
      tutor.cnes,
      tutor.cnes,
      linha.fonte,
      ocorrencias,
      divergencias,
      linha.colunasFonte,
    );
  }

  let tipo: AlertaTutor['tipo'];
  let quantidade: number | null;
  let motivo: string;
  if (tipoAba === 'alerta-rodada2') {
    tipo = 'rodada2';
    quantidade = inteiroNaoNegativo(linha.quantidadeBolsistas);
    motivo = 'Alerta de segunda rodada.';
    if (linha.quantidadeBolsistas !== null && quantidade === null) {
      reportarInvalidos(
        ocorrencias,
        linha.fonte,
        'quantidade_alerta_invalida',
        'Quantidade do alerta inválida; mantida como ausente.',
        undefined,
        linha.colunasFonte.quantidadeBolsistas ?? null,
      );
    } else if (tutor && quantidade !== null) {
      const encontrado = new Set(tutor.bolsistas).size;
      if (quantidade !== encontrado) {
        const fonteQuantidade = fonteDaLinha(
          linha.fonte.aba,
          linha.fonte.linha,
          linha.colunasFonte.quantidadeBolsistas ?? null,
        );
        divergencias.push({
          ...fonteQuantidade,
          codigo: 'alerta_rodada2_divergente',
          mensagem:
            'A quantidade da aba E difere do número de bolsistas distintos nos vínculos nominais.',
          esperado: quantidade,
          encontrado,
        });
        ocorrencias.push(
          ocorrencia(
            'aviso',
            'alerta_rodada2_divergente',
            'A quantidade do alerta de segunda rodada diverge dos vínculos nominais distintos.',
            fonteQuantidade,
          ),
        );
      }
    }
  } else {
    const interpretado = interpretarMotivo(linha.motivo);
    tipo = interpretado.tipo === 'desconhecido' ? 'desconhecido' : interpretado.tipo;
    quantidade = interpretado.quantidade;
    motivo = textoSeguroRelatorio(interpretado.original);
    if (tipo === 'desconhecido' && interpretado.original.trim()) {
      ocorrencias.push(
        ocorrencia(
          'aviso',
          'motivo_alerta_desconhecido',
          `Motivo do alerta não reconhecido: ${motivo}.`,
          fonteDaLinha(linha.fonte.aba, linha.fonte.linha, linha.colunasFonte.motivo ?? null),
        ),
      );
    }
  }
  return {
    tutorId: tutor?.id ?? null,
    nome,
    ibge,
    tipo,
    quantidadeBolsistas: quantidade,
    motivo,
    fonte: { ...linha.fonte },
  };
}

function reportarDivergenciasPessoa(
  entidade: 'tutor' | 'bolsista',
  nomeExistente: string,
  nomeNovo: string,
  ibgeExistente: string,
  ibgeNovo: string,
  cnesExistente: string | null,
  cnesNovo: string | null,
  fonte: FonteImportacao,
  ocorrencias: OcorrenciaImportacao[],
  divergencias: DivergenciaImportacao[],
  colunasFonte: ColunasFonte,
): void {
  const divergentes: Array<{
    campo: string;
    esperado: string | null;
    encontrado: string | null;
    coluna: string | null;
  }> = [];
  if (nomeNovo && normalizarTexto(nomeExistente) !== normalizarTexto(nomeNovo)) {
    divergentes.push({
      campo: 'nome',
      esperado: nomeExistente,
      encontrado: nomeNovo,
      coluna:
        entidade === 'tutor'
          ? (colunasFonte.nomeTutor ?? colunasFonte.nome ?? null)
          : (colunasFonte.nomeBolsista ?? colunasFonte.nome ?? null),
    });
  }
  if (ibgeExistente && ibgeNovo && ibgeExistente !== ibgeNovo) {
    divergentes.push({
      campo: 'ibge',
      esperado: ibgeExistente,
      encontrado: ibgeNovo,
      coluna:
        entidade === 'tutor'
          ? (colunasFonte.ibgeTutor ?? colunasFonte.ibge ?? null)
          : (colunasFonte.ibgeBolsista ?? colunasFonte.ibge ?? null),
    });
  }
  if (entidade === 'tutor' && cnesNovo !== null && cnesExistente !== cnesNovo) {
    divergentes.push({
      campo: 'cnes',
      esperado: cnesExistente,
      encontrado: cnesNovo,
      coluna: colunasFonte.cnesTutor ?? null,
    });
  }
  for (const item of divergentes) {
    const fonteDivergente = fonteDaLinha(fonte.aba, fonte.linha, item.coluna);
    divergencias.push({
      ...fonteDivergente,
      codigo: `${entidade}_${item.campo}_divergente`,
      mensagem: `Valor de ${item.campo} divergente para ${entidade}; mantido o primeiro registro.`,
      esperado: protegerValorRelatorio(item.esperado),
      encontrado: protegerValorRelatorio(item.encontrado),
    });
    ocorrencias.push(
      ocorrencia(
        'aviso',
        `${entidade}_${item.campo}_divergente`,
        `Valor de ${item.campo} divergente para ${entidade}; mantido o primeiro registro.`,
        fonteDivergente,
      ),
    );
  }
}

function lerKm(value: unknown): { valor: number | null; invalido: boolean } {
  if (valorVazio(value)) return { valor: null, invalido: false };
  const parsed = parseNumero(value);
  return parsed !== null && Number.isFinite(parsed) && parsed >= 0
    ? { valor: parsed, invalido: false }
    : { valor: null, invalido: true };
}

function inteiroNaoNegativo(value: unknown): number | null {
  const parsed = parseNumero(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNumero(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = texto(value).trim();
  if (!raw || !/^[+-]?\d+(?:[.,]\d+)?$/.test(raw)) return null;
  const parsed = Number(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function reportarInvalidos(
  ocorrencias: OcorrenciaImportacao[],
  fonte: FonteImportacao,
  codigo: string,
  mensagem: string,
  campo?: CampoImportacao,
  colunaFisica?: string | null,
): void {
  ocorrencias.push(
    ocorrencia(
      'erro',
      codigo,
      mensagem,
      fonteDaLinha(
        fonte.aba,
        fonte.linha,
        colunaFisica ?? (campo ? colunaDaFonteByName(campo) : fonte.coluna),
      ),
    ),
  );
}

function avisarProvisorio(
  ocorrencias: OcorrenciaImportacao[],
  fonte: FonteImportacao,
  campo: string,
  coluna: string | null,
): void {
  ocorrencias.push(
    ocorrencia(
      'aviso',
      'masked_identity',
      `Identidade provisória originada do campo ${campo}; consulte a fonte indicada antes de consolidar o registro.`,
      fonteDaLinha(fonte.aba, fonte.linha, coluna),
    ),
  );
}

function ocorrencia(
  severidade: 'aviso' | 'erro',
  codigo: string,
  mensagem: string,
  fonte: FonteImportacao,
): OcorrenciaImportacao {
  return { ...fonte, severidade, codigo, mensagem };
}

function fonteDaLinha(aba: string, linha: number, coluna: string | null): FonteImportacao {
  return { aba, linha, coluna };
}

function colunaDaFonte(linha: LinhaNominalMapeada, campo: CampoImportacao): string | null {
  return linha.colunasFonte[campo] ?? null;
}

function colunaDaFonteByName(campo: string): string | null {
  void campo;
  return null;
}

function mapearColunasFonte(colunas: Colunas): ColunasFonte {
  const resultado: ColunasFonte = {};
  for (const campo of Object.keys(colunas) as CampoImportacao[]) {
    const letra = letraColuna(colunas[campo]);
    if (letra !== null) resultado[campo] = letra;
  }
  return resultado;
}

function textoSeguroRelatorio(value: string): string {
  return value.replace(/(?:\d[.\-\s]?){11,}/g, '[valor sensível omitido]');
}

function protegerValorRelatorio(value: string | null): string | null {
  return value === null ? null : textoSeguroRelatorio(value);
}

function valor(row: unknown[], index: number | null | undefined): unknown {
  return index === null || index === undefined ? null : (row[index] ?? null);
}

function coluna(colunas: Colunas, campo: CampoImportacao): number | null {
  const index = colunas[campo];
  return Number.isInteger(index) && (index ?? -1) >= 0 ? (index ?? null) : null;
}

function valorVazio(value: unknown): boolean {
  return VALORES_VAZIOS.includes(value) || (typeof value === 'string' && value.trim() === '');
}

function texto(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function textoOuNull(value: unknown): string | null {
  return texto(value) || null;
}

function normalizarIdentificador(value: unknown): string | null {
  return texto(value) || null;
}

function letraColuna(index: number | null | undefined): string | null {
  if (index === null || index === undefined || !Number.isInteger(index) || index < 0) return null;
  let number = index + 1;
  let result = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}
